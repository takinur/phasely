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
import { evaluateKnockoutGate } from "@/lib/knockout";
import {
  clearApplications,
  deleteApplication,
  describeDuplicates,
  dueFollowUps,
  inputFromJobContext,
  listApplications,
  logApplication,
  pendingFollowUps,
  updateApplicationStatus,
} from "@/lib/tracker";
import type { DuplicateMatch, NewApplicationInput } from "@/lib/tracker";
import type {
  ApplicationRecord,
  ApplicationStatus,
  DetectedField,
  ExtensionSettings,
  JobContext,
  KnockoutCategory,
  KnockoutField,
  Profile,
  ProfilePreset,
} from "@/lib/types";

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
  | { type: "GET_JOB_CONTEXT" }
  | { type: "FILL_ALL"; profile: Profile; resume: StoredResume | null }
  | { type: "FILL_ONLY"; fields: string[]; profile: Profile }
  | { type: "FILL_AI_TEXT"; key: string; value: string; profile: Profile }
  | {
      type: "SUBMIT";
      settings?: Pick<ExtensionSettings, "confirmBeforeSubmit"> &
        Partial<Pick<ExtensionSettings, "blockSubmitOnUnconfirmedKnockouts">>;
      /** Detected knockout answers + their confirmation state. The gate below
       *  refuses to submit while any of these is unconfirmed. */
      knockouts?: KnockoutField[];
      /** How many fields the autofill wrote, recorded on the tracker entry. */
      fieldsFilled?: number;
      /** Ghost-job score snapshot, owned by another feature. */
      ghostScore?: number | null;
    }
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
  | { type: "GET_APPLICATIONS" }
  | { type: "SAVE_APPLICATION"; application: NewApplicationInput }
  | { type: "UPDATE_APPLICATION_STATUS"; id: string; status: ApplicationStatus }
  | { type: "DELETE_APPLICATION"; id: string }
  | { type: "CLEAR_APPLICATIONS" }
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

// ---------------------------------------------------------------------------
// Submit — knockout gate + auto-log
// ---------------------------------------------------------------------------

type SubmitResponse =
  | {
      ok: true;
      message: string;
      /** Tracker entry written for this submission, when tracking is on. */
      application?: ApplicationRecord;
      duplicates?: DuplicateMatch[];
      /** Ready-to-show duplicate warning, "" when there is none. */
      duplicateWarning?: string;
    }
  | {
      ok: false;
      error: string;
      /** True when the knockout guard refused to submit. */
      blockedByKnockouts?: boolean;
      /** Categories that still need an explicit human confirm. */
      unconfirmedCategories?: KnockoutCategory[];
    };

/**
 * Resolve the effective settings for a submit: stored settings layered over
 * DEFAULT_SETTINGS (getSettings already does that), with `confirmBeforeSubmit`
 * overridable by the caller because the popup owns that toggle in-session.
 *
 * `blockSubmitOnUnconfirmedKnockouts` is deliberately NOT caller-overridable:
 * the gate is a safety property of the install, not of the message.
 */
async function resolveSubmitSettings(
  override?: Pick<ExtensionSettings, "confirmBeforeSubmit">,
): Promise<ExtensionSettings> {
  const stored = await getSettings().catch(() => null);
  const base = stored ?? DEFAULT_SETTINGS;
  return {
    ...base,
    confirmBeforeSubmit: override?.confirmBeforeSubmit ?? base.confirmBeforeSubmit,
  };
}

/**
 * Submit the application in the active tab.
 *
 * Order matters: the knockout gate runs BEFORE anything is forwarded to the
 * page, so a blocked submit never touches the DOM. Knockout answers are the
 * only ones that auto-reject an application outright, so an unconfirmed one is
 * a hard stop rather than a warning.
 */
async function handleSubmit(
  settings?: Pick<ExtensionSettings, "confirmBeforeSubmit">,
  knockouts?: KnockoutField[],
  fieldsFilled?: number,
  ghostScore?: number | null,
): Promise<SubmitResponse> {
  try {
    const effective = await resolveSubmitSettings(settings);

    const gate = evaluateKnockoutGate(effective, knockouts);
    if (gate.blocked) {
      debug("SUBMIT blocked by unconfirmed knockouts:", gate.categories.join(", "));
      return {
        ok: false,
        error: gate.message,
        blockedByKnockouts: true,
        unconfirmedCategories: gate.categories,
      };
    }

    const result = await forwardToActiveTab({
      type: "SUBMIT",
      settings: {
        confirmBeforeSubmit: effective.confirmBeforeSubmit,
        blockSubmitOnUnconfirmedKnockouts: effective.blockSubmitOnUnconfirmedKnockouts,
      },
      knockouts,
    });

    if (result === null) {
      return { ok: false, error: "No fillable page is open in the active tab." };
    }

    const payload = result as {
      ok?: boolean;
      message?: string;
      blockedByKnockouts?: boolean;
      unconfirmedCategories?: KnockoutCategory[];
    };

    // The content-side gate is defence in depth — surface its refusal verbatim.
    if (payload.blockedByKnockouts === true) {
      return {
        ok: false,
        error: payload.message ?? "Submit blocked: confirm your knockout answers first.",
        blockedByKnockouts: true,
        unconfirmedCategories: payload.unconfirmedCategories ?? [],
      };
    }

    const message = payload.message ?? "";
    if (payload.ok !== true) {
      // Cancelled by the user, no submit button found, etc.
      return { ok: true, message };
    }

    // --- Auto-log the application -----------------------------------------
    // A tracker failure must never make a successful submit look failed, so
    // the whole block is best-effort.
    if (!effective.trackApplications) return { ok: true, message };

    try {
      const logged = await autoLogApplication(effective, fieldsFilled, ghostScore);
      if (logged === null) return { ok: true, message };
      return {
        ok: true,
        message,
        application: logged.record,
        duplicates: logged.duplicates,
        duplicateWarning: describeDuplicates(logged.duplicates),
      };
    } catch (err) {
      console.error("[Phasely] auto-log after submit failed:", err);
      return { ok: true, message };
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Write a tracker entry for the submission that just succeeded, using the job
 * context scraped from the page.
 *
 * The URL comes from scrapeJobContext() (window.location.href in the page) —
 * the SW cannot read tab.url without the broad "tabs" permission, and this
 * extension keeps permissions minimal. chrome.tabs.query is still consulted as
 * a fallback in case a host permission makes the URL visible.
 */
async function autoLogApplication(
  settings: ExtensionSettings,
  fieldsFilled?: number,
  ghostScore?: number | null,
): Promise<{ record: ApplicationRecord; duplicates: DuplicateMatch[] } | null> {
  const ctxResult = await forwardToActiveTab({ type: "GET_JOB_CONTEXT" });
  const jobContext =
    (ctxResult as { jobContext?: JobContext | null } | null)?.jobContext ?? null;

  let fallbackUrl = "";
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    fallbackUrl = tabs[0]?.url ?? "";
  } catch {
    // No "tabs" permission — expected; the scraped context carries the URL.
  }

  const input = inputFromJobContext(jobContext, fallbackUrl, {
    fieldsFilled: fieldsFilled ?? 0,
    ghostScore: ghostScore ?? null,
    followUpDays: settings.followUpDays,
  });

  // Nothing identifying at all — do not write a blank row.
  if (!input.url && !input.company && !input.title) {
    debug("auto-log skipped: no identifying job context");
    return null;
  }

  const logged = await logApplication(input);
  await scheduleFollowUpAlarm(logged.record);
  await refreshFollowUpBadge();
  debug("auto-logged application:", logged.record.id, logged.record.company);

  return logged;
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

async function handleGenerateCoverLetter(): Promise<Response<{ text: string; filled: boolean }>> {
  try {
    // 1. Get profile and API key from storage.
    const [profile, apiKey, settings] = await Promise.all([
      getProfile(),
      getGeminiApiKey(),
      getSettings(),
    ]);
    if (!profile) return { ok: false, error: "No profile saved. Add your profile in Settings first." };
    if (!apiKey) return { ok: false, error: "No Gemini API key saved. Add one in Settings → AI Settings." };

    const model = settings?.geminiModel ?? DEFAULT_SETTINGS.geminiModel;

    // 2. Get job context from the active tab — dedicated message, no profile sent.
    const ctxResult = await forwardToActiveTab({ type: "GET_JOB_CONTEXT" });
    const jobContext = (ctxResult as { jobContext?: JobContext } | null)?.jobContext ?? {
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
      // Parse only the message field — never echo the raw body which may contain the API key.
      let errMsg = `Gemini error (${response.status})`;
      try {
        const errBody = (await response.json()) as { error?: { message?: string } };
        if (errBody?.error?.message) errMsg += `: ${errBody.error.message}`;
      } catch {
        // Body not JSON — use status only.
      }
      return { ok: false, error: errMsg };
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!generatedText) return { ok: false, error: "Gemini returned an empty response." };

    debug("GENERATE_COVER_LETTER: generated", generatedText.length, "chars");

    // 4. Inject the text into the cover letter field on the active tab.
    // Always return the generated text to the popup regardless of fill outcome.
    let filled = false;
    const fillResult = await forwardToActiveTab({
      type: "FILL_AI_TEXT",
      key: "coverLetter",
      value: generatedText,
      profile,
    });

    if (fillResult !== null) {
      filled = (fillResult as { ok: boolean }).ok === true;
    }

    return { ok: true, text: generatedText, filled };
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
// Follow-up nudges (chrome.alarms)
//
// One one-shot alarm per tracked application, named "phasely-followup:<id>".
// When it fires we recompute how many follow-ups are due and surface that as
// the toolbar badge count — no "notifications" permission needed, which keeps
// the manifest minimal. Alarm state lives in the alarms API itself, never in a
// module-level variable (the SW is torn down between events).
// ---------------------------------------------------------------------------

const FOLLOW_UP_ALARM_PREFIX = "phasely-followup:";

function followUpAlarmName(id: string): string {
  return `${FOLLOW_UP_ALARM_PREFIX}${id}`;
}

/** True when the alarms API is actually available (permission present). */
function alarmsAvailable(): boolean {
  return typeof chrome !== "undefined" && typeof chrome.alarms !== "undefined";
}

async function scheduleFollowUpAlarm(record: ApplicationRecord): Promise<void> {
  if (!alarmsAvailable()) return;
  try {
    await chrome.alarms.clear(followUpAlarmName(record.id));
    if (record.followUpAt === null) return;
    chrome.alarms.create(followUpAlarmName(record.id), { when: record.followUpAt });
  } catch (err) {
    console.error("[Phasely] scheduleFollowUpAlarm failed:", err);
  }
}

async function clearFollowUpAlarm(id: string): Promise<void> {
  if (!alarmsAvailable()) return;
  try {
    await chrome.alarms.clear(followUpAlarmName(id));
  } catch (err) {
    console.error("[Phasely] clearFollowUpAlarm failed:", err);
  }
}

/**
 * Badge = how many applications are waiting on a follow-up right now.
 * Cleared when nothing is due.
 */
async function refreshFollowUpBadge(): Promise<void> {
  try {
    const records = await listApplications();
    const due = dueFollowUps(records).length;
    await chrome.action.setBadgeText({ text: due > 0 ? String(due) : "" });
    if (due > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
    }
  } catch (err) {
    console.error("[Phasely] refreshFollowUpBadge failed:", err);
  }
}

/**
 * Rebuild every pending alarm from the encrypted log. Run on install/startup
 * because a reinstall or profile move loses the alarm registry while the log
 * survives.
 */
async function resyncFollowUpAlarms(): Promise<void> {
  if (!alarmsAvailable()) return;
  try {
    const records = await listApplications();
    const pending = pendingFollowUps(records);
    for (const record of pending) {
      await scheduleFollowUpAlarm(record);
    }
    await refreshFollowUpBadge();
    debug("resyncFollowUpAlarms: rescheduled", pending.length, "nudges");
  } catch (err) {
    console.error("[Phasely] resyncFollowUpAlarms failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Application tracker handlers
// ---------------------------------------------------------------------------

const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "ghosted",
];

function isApplicationStatusValue(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

async function handleGetApplications(): Promise<
  Response<{ applications: ApplicationRecord[]; dueCount: number }>
> {
  try {
    const applications = await listApplications();
    return { ok: true, applications, dueCount: dueFollowUps(applications).length };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleSaveApplication(
  input: NewApplicationInput,
): Promise<
  Response<{
    application: ApplicationRecord;
    duplicates: DuplicateMatch[];
    duplicateWarning: string;
  }>
> {
  try {
    if (typeof input !== "object" || input === null) {
      return { ok: false, error: "SAVE_APPLICATION: missing application payload" };
    }

    const url = typeof input.url === "string" ? input.url : "";
    const company = typeof input.company === "string" ? input.company : "";
    const title = typeof input.title === "string" ? input.title : "";
    if (!url && !company && !title) {
      return { ok: false, error: "SAVE_APPLICATION: need at least a url, company or title" };
    }

    const settings = (await getSettings().catch(() => null)) ?? DEFAULT_SETTINGS;
    const status = isApplicationStatusValue(input.status) ? input.status : "applied";

    const logged = await logApplication({
      ...input,
      url,
      company,
      title,
      status,
      followUpDays: input.followUpDays ?? settings.followUpDays,
    });

    await scheduleFollowUpAlarm(logged.record);
    await refreshFollowUpBadge();
    debug("SAVE_APPLICATION stored:", logged.record.id);

    return {
      ok: true,
      application: logged.record,
      duplicates: logged.duplicates,
      duplicateWarning: describeDuplicates(logged.duplicates),
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleUpdateApplicationStatus(
  id: string,
  status: unknown,
): Promise<Response<{ application: ApplicationRecord }>> {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, error: "UPDATE_APPLICATION_STATUS: missing id" };
    }
    if (!isApplicationStatusValue(status)) {
      return { ok: false, error: "UPDATE_APPLICATION_STATUS: unknown status" };
    }

    const settings = (await getSettings().catch(() => null)) ?? DEFAULT_SETTINGS;
    const updated = await updateApplicationStatus(id, status, settings.followUpDays);
    if (updated === null) {
      return { ok: false, error: "UPDATE_APPLICATION_STATUS: no application with that id" };
    }

    // Re-arm or clear the nudge to match the new status.
    await scheduleFollowUpAlarm(updated);
    await refreshFollowUpBadge();
    debug("UPDATE_APPLICATION_STATUS:", id, "->", status);

    return { ok: true, application: updated };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handleDeleteApplication(
  id: string,
): Promise<Response<{ deleted: boolean }>> {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, error: "DELETE_APPLICATION: missing id" };
    }

    const deleted = await deleteApplication(id);
    await clearFollowUpAlarm(id);
    await refreshFollowUpBadge();
    debug("DELETE_APPLICATION:", id, deleted ? "removed" : "not found");

    return { ok: true, deleted };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Clear the whole application log.
 *
 * Destructive and irreversible, so the confirm lives in the Options page UI
 * rather than here — by the time this runs the user has already agreed. The
 * pending follow-up alarms are torn down with the records so no alarm can fire
 * pointing at an id that no longer exists.
 */
async function handleClearApplications(): Promise<Response<{ cleared: number }>> {
  try {
    const existing = await listApplications();
    for (const record of existing) {
      await clearFollowUpAlarm(record.id);
    }

    await clearApplications();
    await refreshFollowUpBadge();
    debug("CLEAR_APPLICATIONS: removed", existing.length);

    return { ok: true, cleared: existing.length };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  debug("Service worker installed");
  void resyncFollowUpAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  void resyncFollowUpAlarms();
});

// Follow-up nudge fired — recompute the badge. Registered at the top level so
// the alarm can wake the service worker.
if (alarmsAvailable()) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(FOLLOW_UP_ALARM_PREFIX)) return;
    debug("follow-up alarm fired:", alarm.name);
    void refreshFollowUpBadge();
  });
}

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
            sendResponse(
              await handleSubmit(msg.settings, msg.knockouts, msg.fieldsFilled, msg.ghostScore),
            );
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

          case "GET_APPLICATIONS":
            sendResponse(await handleGetApplications());
            break;

          case "SAVE_APPLICATION":
            sendResponse(await handleSaveApplication(msg.application));
            break;

          case "UPDATE_APPLICATION_STATUS":
            sendResponse(await handleUpdateApplicationStatus(msg.id, msg.status));
            break;

          case "DELETE_APPLICATION":
            sendResponse(await handleDeleteApplication(msg.id));
            break;

          case "CLEAR_APPLICATIONS":
            sendResponse(await handleClearApplications());
            break;

          case "GET_JOB_CONTEXT": {
            const ctxResult = await forwardToActiveTab({ type: "GET_JOB_CONTEXT" });
            if (ctxResult === null) {
              sendResponse({ ok: true, jobContext: null });
            } else {
              sendResponse({ ok: true, ...(ctxResult as Record<string, unknown>) });
            }
            break;
          }

          case "FILL_AI_TEXT": {
            // Forwards AI-generated text to the content script to inject into the DOM.
            const result = await forwardToActiveTab({ type: "FILL_AI_TEXT", key: msg.key, value: msg.value, profile: msg.profile });
            if (result === null) {
              sendResponse({ ok: false, error: "No active tab content script available." });
            } else {
              sendResponse(result);
            }
            break;
          }

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
