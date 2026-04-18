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

import { getProfile, setProfile, getResume, setResume, getSettings, setSettings, setGeminiToken, getGeminiToken, wipeAll, getPresets, setPresets } from "@/lib/storage";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import type { StoredResume } from "@/lib/types";
import { parseProfile, ProfileParseError } from "@/lib/profile";
import type { DetectedField, ExtensionSettings, JobContext, Profile, ProfilePreset } from "@/lib/types";

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
  | { type: "FILL_ALL"; profile: Profile; resume: StoredResume | null }
  | { type: "FILL_ONLY"; fields: string[]; profile: Profile }
  | { type: "SUBMIT"; settings?: Pick<ExtensionSettings, "confirmBeforeSubmit"> }
  | { type: "GENERATE_AI"; question: string; fieldKey: string }
  | { type: "GET_PROFILE" }
  | { type: "SAVE_PROFILE"; markdown: string }
  | { type: "GET_RESUME" }
  | { type: "SAVE_RESUME"; base64: string; filename: string; mimeType: string }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: ExtensionSettings }
  | { type: "AUTH_GOOGLE" }
  | { type: "GET_GEMINI_MODELS" }
  | { type: "GET_PRESETS" }
  | { type: "SAVE_PRESETS"; presets: ProfilePreset[] }
  | { type: "WIPE_DATA" };

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
 * Returns null (instead of throwing) when the tab is not a web page (e.g.
 * chrome://, about:, chrome-extension://) or when the content script has not
 * yet loaded — callers treat null as "no content script available".
 */
async function forwardToActiveTab(
  message: Message,
): Promise<unknown> {
  const tabId = await getActiveTabId();
  try {
    debug("Forwarding to tab", tabId, message.type);
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    const msg = String(err);
    // These errors mean the content script isn't reachable on this tab —
    // not a real error for the user; callers handle null gracefully.
    if (
      msg.includes("Could not establish connection") ||
      msg.includes("Receiving end does not exist") ||
      msg.includes("No tab with id")
    ) {
      debug("forwardToActiveTab: content script not reachable on tab", tabId, "—", msg);
      return null;
    }
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
    // null means the content script isn't available on this tab (non-web page)
    if (result === null) return { ok: true, fields: [], jobContext: null };
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
    // Fetch the resume here in the SW so the content script never needs to
    // make a nested round-trip back to the SW while handling FILL_ALL.
    const resume = await getResume().catch(() => null);
    const result = await forwardToActiveTab({ type: "FILL_ALL", profile, resume });
    if (result === null) return { ok: false, error: "No fillable page is open in the active tab." };
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
    const result = await forwardToActiveTab({ type: "FILL_ONLY", fields, profile });
    if (result === null) return { ok: false, error: "No fillable page is open in the active tab." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleWipeData(): Promise<Response<Record<never, never>>> {
  try {
    await wipeAll();
    debug("WIPE_DATA: all storage cleared");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleSubmit(
  settings?: Pick<ExtensionSettings, "confirmBeforeSubmit">,
): Promise<Response<Record<never, never>>> {
  try {
    await forwardToActiveTab({ type: "SUBMIT", settings });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// CLAUDE_INTEGRATION: dormant — activate in next feature release
// const anthropic = new Anthropic({ apiKey: settings.claudeApiKey })

function handleGenerateAI(): ErrResponse {
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

async function handleGetGeminiModels(): Promise<Response<{ oauthEnabled: boolean; models: string[] }>> {
  try {
    const fetchModels = async (token: string): Promise<{ ok: boolean; models: string[]; authFailed: boolean; error?: string }> => {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { ok: false, models: [], authFailed: true };
        }
        const body = await response.text();
        return {
          ok: false,
          models: [],
          authFailed: false,
          error: `Failed to fetch Gemini models (${response.status}): ${body}`,
        };
      }

      const payload = (await response.json()) as {
        models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
      };
      const available = (payload.models ?? [])
        .filter((model) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((model) => (model.name ?? "").replace(/^models\//, ""))
        .filter((name) => name.startsWith("gemini-"));

      return { ok: true, models: Array.from(new Set(available)), authFailed: false };
    };

    const readAuthToken = async (): Promise<string | null> => {
      const token = await getGeminiToken();
      return token && token.trim().length > 0 ? token : null;
    };

    const acquireAuthToken = async (interactive: boolean): Promise<string | null> => {
      const token = await new Promise<string | null>((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, (result) => {
          if (chrome.runtime.lastError) {
            const message = chrome.runtime.lastError.message ?? "getAuthToken failed";
            if (!interactive) {
              resolve(null);
              return;
            }
            reject(new Error(message));
            return;
          }

          const tokenStr =
            typeof result === "string"
              ? result
              : (result as { token?: string })?.token ?? "";
          resolve(tokenStr || null);
        });
      });
      if (token) {
        await setGeminiToken(token);
      }
      return token;
    };

    const invalidateAuthToken = async (token: string): Promise<void> => {
      await new Promise<void>((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, () => resolve());
      });
    };

    let token = await readAuthToken();
    if (!token) {
      return { ok: true, oauthEnabled: false, models: [] };
    }

    let result = await fetchModels(token);
    if (result.ok) {
      return { ok: true, oauthEnabled: true, models: result.models };
    }

    if (!result.authFailed) {
      throw new Error(result.error ?? "Failed to fetch Gemini models");
    }

    await invalidateAuthToken(token);
    token = await acquireAuthToken(false);
    if (!token) {
      return { ok: true, oauthEnabled: false, models: [] };
    }

    result = await fetchModels(token);
    if (result.ok) {
      return { ok: true, oauthEnabled: true, models: result.models };
    }

    if (result.authFailed) {
      return { ok: true, oauthEnabled: false, models: [] };
    }
    throw new Error(result.error ?? "Failed to fetch Gemini models");
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Resume handlers
// ---------------------------------------------------------------------------

async function handleGetResume(): Promise<Response<{ resume: StoredResume | null }>> {
  try {
    const resume = await getResume();
    debug("GET_RESUME:", resume ? resume.filename : "null");
    return { ok: true, resume };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleSaveResume(
  base64: string,
  filename: string,
  mimeType: string,
): Promise<Response<Record<never, never>>> {
  try {
    await setResume({ base64, filename, mimeType });
    debug("SAVE_RESUME stored:", filename);
    return { ok: true };
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

    // Persist the token encrypted so it is consistent with the rest of stored data.
    await setGeminiToken(token);

    return { ok: true, token };
  } catch (err) {
    console.error("[Phasely] AUTH_GOOGLE failed:", err);
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Preset handlers
// ---------------------------------------------------------------------------

async function handleGetPresets(): Promise<Response<{ presets: ProfilePreset[] }>> {
  try {
    const presets = await getPresets();
    return { ok: true, presets };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleSavePresets(
  presets: ProfilePreset[],
): Promise<Response<{ presets: ProfilePreset[] }>> {
  try {
    await setPresets(presets);
    debug("SAVE_PRESETS stored", presets.length, "presets");
    return { ok: true, presets };
  } catch (err) {
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
            sendResponse(await handleSubmit(msg.settings));
            break;

          case "GENERATE_AI":
            sendResponse(handleGenerateAI());
            break;

          case "GET_PROFILE":
            sendResponse(await handleGetProfile());
            break;

          case "SAVE_PROFILE":
            sendResponse(await handleSaveProfile(msg.markdown));
            break;

          case "GET_RESUME":
            sendResponse(await handleGetResume());
            break;

          case "SAVE_RESUME": {
            const raw = msg as unknown as Record<string, unknown>;
            if (
              typeof raw.base64 !== "string" ||
              typeof raw.filename !== "string" ||
              typeof raw.mimeType !== "string"
            ) {
              sendResponse({ ok: false, error: "SAVE_RESUME: missing or invalid fields" });
              break;
            }
            sendResponse(await handleSaveResume(raw.base64, raw.filename, raw.mimeType));
            break;
          }

          case "GET_SETTINGS":
            sendResponse(await handleGetSettings());
            break;

          case "SAVE_SETTINGS":
            sendResponse(await handleSaveSettings(msg.settings));
            break;

          case "AUTH_GOOGLE":
            sendResponse(await handleAuthGoogle());
            break;

          case "GET_GEMINI_MODELS":
            sendResponse(await handleGetGeminiModels());
            break;

          case "GET_PRESETS":
            sendResponse(await handleGetPresets());
            break;

          case "SAVE_PRESETS":
            sendResponse(await handleSavePresets(msg.presets));
            break;

          case "WIPE_DATA":
            sendResponse(await handleWipeData());
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
