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

import { getProfile, setProfile } from "@/lib/storage";
import { parseProfile, ProfileParseError } from "@/lib/profile";
import type { DetectedField, Profile } from "@/lib/types";

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
  | { type: "DETECT_FIELDS" }
  | { type: "FILL_ALL"; profile: Profile }
  | { type: "FILL_ONLY"; fields: string[]; profile: Profile }
  | { type: "SUBMIT" }
  | { type: "GENERATE_AI"; question: string; fieldKey: string }
  | { type: "GET_PROFILE" }
  | { type: "SAVE_PROFILE"; markdown: string };

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

async function handleDetectFields(): Promise<Response<{ fields: DetectedField[] }>> {
  try {
    const result = await forwardToActiveTab({ type: "DETECT_FIELDS" });
    debug("DETECT_FIELDS result:", result);
    return { ok: true, fields: result as DetectedField[] };
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
            sendResponse(await handleDetectFields());
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
