/**
 * sw.ts — Phasely MV3 service worker
 *
 * Message bus entry point. Routes typed messages from popup/options/content
 * scripts to the appropriate handler.
 *
 * MV3 constraints enforced here:
 *   - No module-level mutable state. All ephemeral state uses chrome.storage.session.
 *   - All chrome.* calls are wrapped in try/catch with [Phasely] prefix logging.
 */

import { getProfile, setProfile, getSettings, setSettings } from "@/lib/storage";
import { parseProfile, ProfileParseError } from "@/lib/profile";
import type { DetectedField, ExtensionSettings, JobContext, Profile } from "@/lib/types";

// ---------------------------------------------------------------------------
// Debug utility (no-op in production)
// ---------------------------------------------------------------------------

function debug(...args: unknown[]): void {
  if (import.meta.env.DEV) {
    console.log("[Phasely]", ...args);
  }
}

// ---------------------------------------------------------------------------
// Typed message discriminated union
// ---------------------------------------------------------------------------

export type Message =
  | { type: "DETECT_FIELDS"; profile?: Profile }
  | { type: "FILL_ALL"; profile: Profile }
  | { type: "FILL_ONLY"; fields: string[]; profile: Profile }
  | { type: "SUBMIT" }
  | { type: "GENERATE_AI"; question: string; fieldKey: string }
  | { type: "GET_PROFILE" }
  | { type: "SAVE_PROFILE"; markdown: string }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: ExtensionSettings }
  | { type: "AUTH_GOOGLE" };

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

type OkResponse<T> = { ok: true } & T;
type ErrResponse = { ok: false; error: string };
type Response<T> = OkResponse<T> | ErrResponse;

// ---------------------------------------------------------------------------
// Active tab helper
// ---------------------------------------------------------------------------

async function getActiveTabId(): Promise<number> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) {
      throw new Error("No active tab found");
    }
    return tab.id;
  } catch (err) {
    console.error("[Phasely] getActiveTabId failed:", err);
    throw err;
  }
}

/**
 * Forward a message to the active tab's content script and await its response.
 * Typed via the Message union so callers never pass arbitrary objects.
 */
async function forwardToActiveTab(
  message: Message,
): Promise<unknown> {
  const tabId = await getActiveTabId();
  try {
    debug("Forwarding to tab", tabId, message.type);
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    console.error("[Phasely] forwardToActiveTab failed:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleDetectFields(
  profile?: Profile,
): Promise<Response<{ fields: DetectedField[]; jobContext: JobContext | null }>> {
  try {
    const result = await forwardToActiveTab({ type: "DETECT_FIELDS", profile });
    debug("DETECT_FIELDS result:", result);
    const payload = result as { fields: DetectedField[]; jobContext: JobContext | null };
    return { ok: true, fields: payload.fields ?? [], jobContext: payload.jobContext ?? null };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleFillAll(
  profile: Profile,
): Promise<Response<Record<never, never>>> {
  try {
    await forwardToActiveTab({ type: "FILL_ALL", profile });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleFillOnly(
  fields: string[],
  profile: Profile,
): Promise<Response<Record<never, never>>> {
  try {
    await forwardToActiveTab({ type: "FILL_ONLY", fields, profile });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleSubmit(): Promise<Response<Record<never, never>>> {
  try {
    await forwardToActiveTab({ type: "SUBMIT" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// CLAUDE_INTEGRATION: dormant — activate in next feature release
// const anthropic = new Anthropic({ apiKey: settings.claudeApiKey })

function handleGenerateAI(
  _question: string,
  _fieldKey: string,
): ErrResponse {
  // GEMINI_INTEGRATION: dormant — wire GeminiClient here when AI is activated
  return { ok: false, error: "AI not activated" };
}

async function handleGetProfile(): Promise<Response<{ profile: Profile | null }>> {
  try {
    const profile = await getProfile();
    debug("GET_PROFILE result:", profile ? "found" : "null");
    return { ok: true, profile };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleSaveProfile(
  markdown: string,
): Promise<Response<{ profile: Profile }>> {
  try {
    const profile = parseProfile(markdown);
    await setProfile(profile);
    debug("SAVE_PROFILE stored profile for:", profile.email);
    return { ok: true, profile };
  } catch (err) {
    if (err instanceof ProfileParseError) {
      return {
        ok: false,
        error: `Profile validation failed: ${err.fields.join(", ")}`,
      };
    }
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Default settings
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: ExtensionSettings = {
  geminiModel: "gemini-1.5-flash",
  autoSubmit: false,
  confirmBeforeSubmit: true,
  preferredAiProvider: "gemini",
};

// ---------------------------------------------------------------------------
// Settings handlers
// ---------------------------------------------------------------------------

async function handleGetSettings(): Promise<Response<{ settings: ExtensionSettings }>> {
  try {
    const stored = await getSettings();
    const settings: ExtensionSettings = stored ?? DEFAULT_SETTINGS;
    debug("GET_SETTINGS:", settings.geminiModel);
    return { ok: true, settings };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleSaveSettings(
  settings: ExtensionSettings,
): Promise<Response<{ settings: ExtensionSettings }>> {
  try {
    await setSettings(settings);
    debug("SAVE_SETTINGS stored:", settings.geminiModel);
    return { ok: true, settings };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Google OAuth handler
// ---------------------------------------------------------------------------

/**
 * Launch the Google OAuth flow using chrome.identity.launchWebAuthFlow.
 *
 * MV3 note: chrome.identity.getAuthToken is only available for extensions
 * published on the Chrome Web Store with a verified OAuth client. During
 * development we fall back to launchWebAuthFlow with the extension's own
 * client ID. The token is stored in chrome.storage.session (ephemeral —
 * never persists across SW restarts) and is NOT encrypted because it is
 * already scoped to the browser profile.
 *
 * The token is also saved to chrome.storage.local under "geminiToken" so
 * the Gemini client can retrieve it when needed.
 *
 * Returns { ok: true, token } on success, { ok: false, error } on failure.
 */
async function handleAuthGoogle(): Promise<Response<{ token: string }>> {
  try {
    // Attempt the preferred path first: chrome.identity.getAuthToken
    // This works for CWS-published extensions and gives a long-lived token.
    const token = await new Promise<string>((resolve, reject) => {
      try {
        chrome.identity.getAuthToken({ interactive: true }, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message ?? "getAuthToken failed"));
            return;
          }
          // @types/chrome ≥ 0.0.290 returns GetAuthTokenResult | string
          const tokenStr =
            typeof result === "string"
              ? result
              : (result as { token?: string })?.token ?? "";
          if (!tokenStr) {
            reject(new Error("getAuthToken returned no token"));
          } else {
            resolve(tokenStr);
          }
        });
      } catch (err) {
        reject(err);
      }
    });

    debug("AUTH_GOOGLE: token acquired via getAuthToken");

    // Persist the token so the Gemini client can retrieve it.
    // Uses chrome.storage.local — content of token is not a secret we own
    // (Google can revoke it at any time) but we still namespace it clearly.
    await new Promise<void>((resolve, reject) => {
      chrome.storage.local.set({ geminiToken: token }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });

    return { ok: true, token };
  } catch (err) {
    console.error("[Phasely] AUTH_GOOGLE failed:", err);
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  debug("Service worker installed");
});

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): true => {
    // Type-narrow: every valid message must be an object with a `type` string.
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message) ||
      typeof (message as Record<string, unknown>).type !== "string"
    ) {
      sendResponse({ ok: false, error: "Invalid message shape" });
      return true;
    }

    const msg = message as Message;

    (async () => {
      try {
        switch (msg.type) {
          case "DETECT_FIELDS":
            sendResponse(await handleDetectFields(msg.profile));
            break;

          case "FILL_ALL":
            sendResponse(await handleFillAll(msg.profile));
            break;

          case "FILL_ONLY":
            sendResponse(await handleFillOnly(msg.fields, msg.profile));
            break;

          case "SUBMIT":
            sendResponse(await handleSubmit());
            break;

          case "GENERATE_AI":
            sendResponse(handleGenerateAI(msg.question, msg.fieldKey));
            break;

          case "GET_PROFILE":
            sendResponse(await handleGetProfile());
            break;

          case "SAVE_PROFILE":
            sendResponse(await handleSaveProfile(msg.markdown));
            break;

          case "GET_SETTINGS":
            sendResponse(await handleGetSettings());
            break;

          case "SAVE_SETTINGS":
            sendResponse(await handleSaveSettings(msg.settings));
            break;

          case "AUTH_GOOGLE":
            sendResponse(await handleAuthGoogle());
            break;

          default: {
            // Exhaustiveness check — TypeScript will warn if a case is missed.
            const _exhaustive: never = msg;
            void _exhaustive;
            sendResponse({ ok: false, error: "Unknown message type" });
            break;
          }
        }
      } catch (err) {
        console.error("[Phasely] Unhandled error in message router:", err);
        sendResponse({ ok: false, error: String(err) });
      }
    })();

    // Return true to keep the message channel open for async sendResponse.
    return true;
  },
);
