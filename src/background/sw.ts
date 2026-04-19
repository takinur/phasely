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

import { getProfile, setProfile, getResume, setResume, getSettings, setSettings, getGeminiApiKey, setGeminiApiKey, wipeAll, getPresets, setPresets } from "@/lib/storage";
import { COVER_LETTER_SYSTEM, COVER_LETTER_USER } from "@/lib/prompts";
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
  | { type: "GET_GEMINI_MODELS" }
  | { type: "SAVE_GEMINI_API_KEY"; apiKey: string }
  | { type: "GENERATE_COVER_LETTER" }
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

async function handleGetGeminiModels(): Promise<Response<{ apiKeySet: boolean; models: string[] }>> {
  try {
    const apiKey = await getGeminiApiKey();
    if (!apiKey || apiKey.trim().length === 0) {
      return { ok: true, apiKeySet: false, models: [] };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, { method: "GET" });

    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
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

    return { ok: true, apiKeySet: true, models: Array.from(new Set(available)) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleGenerateCoverLetter(): Promise<Response<Record<never, never>>> {
  try {
    // 1. Get profile and API key from storage.
    const [profile, apiKey, settings] = await Promise.all([
      getProfile(),
      getGeminiApiKey(),
      getSettings(),
    ]);
    if (!profile) return { ok: false, error: "No profile saved. Add your profile in Settings first." };
    if (!apiKey) return { ok: false, error: "No Gemini API key saved. Add one in Settings → AI Settings." };

    const model = settings?.geminiModel ?? "gemini-2.5-flash-preview-05-20";

    // 2. Get job context from the active tab via the content script.
    const tabResult = await forwardToActiveTab({ type: "DETECT_FIELDS", profile });
    const jobContext = (tabResult as { jobContext?: { title: string; company: string; location: string; description: string; url: string } } | null)?.jobContext ?? {
      title: "the role",
      company: "the company",
      location: "",
      description: "",
      url: "",
    };

    // 3. Call Gemini generateContent REST API.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      system_instruction: { parts: [{ text: COVER_LETTER_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: COVER_LETTER_USER(profile, jobContext) }] }],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: `Gemini error (${response.status}): ${text}` };
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!generatedText) return { ok: false, error: "Gemini returned an empty response." };

    debug("GENERATE_COVER_LETTER: generated", generatedText.length, "chars");

    // 4. Inject the text into the cover letter field on the active tab.
    const fillResult = await forwardToActiveTab({
      type: "FILL_AI_TEXT" as never,
      key: "coverLetter",
      value: generatedText,
      profile,
    } as never);

    if (fillResult === null) {
      // No content script reachable — return text so popup can at least display it.
      return { ok: false, error: "Cover letter generated but no fillable field was found on this page." };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleSaveGeminiApiKey(
  apiKey: string,
): Promise<Response<Record<never, never>>> {
  try {
    await setGeminiApiKey(apiKey);
    debug("SAVE_GEMINI_API_KEY: key stored");
    return { ok: true };
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

          case "GET_GEMINI_MODELS":
            sendResponse(await handleGetGeminiModels());
            break;

          case "SAVE_GEMINI_API_KEY":
            sendResponse(await handleSaveGeminiApiKey(msg.apiKey));
            break;

          case "GENERATE_COVER_LETTER":
            sendResponse(await handleGenerateCoverLetter());
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
