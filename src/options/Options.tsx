/**
 * Options.tsx — Phasely extension settings page
 *
 * Sections:
 *   1. Profile import — paste/upload profile.md, see parse preview, save
 *   2. Profile summary — display stored profile fields, export .md
 *   3. Extension settings — Gemini model, submit confirm dialog
 *   4. Danger zone — wipe all data
 *
 * All persistence goes through the service worker (SAVE_PROFILE, GET_PROFILE,
 * GET_SETTINGS, SAVE_SETTINGS). No direct storage calls from this page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExtensionSettings, Profile, StoredResume } from "@/lib/types";
import { profileToMarkdown, detectInjection, parseProfile, ProfileParseError } from "@/lib/profile";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import logoIcon from "@/assets/logo_phasely.png";

// ---------------------------------------------------------------------------
// Chrome message helper
// ---------------------------------------------------------------------------

type MsgPayload =
  | { type: "GET_PROFILE" }
  | { type: "SAVE_PROFILE"; markdown: string }
  | { type: "GET_RESUME" }
  | { type: "SAVE_RESUME"; base64: string; filename: string; mimeType: string }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: ExtensionSettings }
  | { type: "GET_GEMINI_MODELS" }
  | { type: "SAVE_GEMINI_API_KEY"; apiKey: string }
  | { type: "WIPE_DATA" };

function sendMsg<T = unknown>(payload: MsgPayload, timeoutMs = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Request timed out — please try again"));
    }, timeoutMs);

    chrome.runtime.sendMessage(payload, (response: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Small shared UI primitives
// ---------------------------------------------------------------------------

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="options-heading text-base font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="options-subheading text-sm text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function Alert({
  type,
  children,
}: {
  type: "success" | "error" | "info" | "warning";
  children: React.ReactNode;
}) {
  const classes = {
    success: "options-alert-success bg-green-50 border-green-200 text-green-800",
    error: "options-alert-error bg-red-50 border-red-200 text-red-800",
    info: "options-alert-info bg-indigo-50 border-indigo-200 text-indigo-800",
    warning: "options-alert-warning bg-amber-50 border-amber-200 text-amber-800",
  }[type];

  return (
    <div className={`options-alert rounded-md border px-4 py-3 text-sm ${classes}`}>{children}</div>
  );
}

// ---------------------------------------------------------------------------
// Profile section
// ---------------------------------------------------------------------------

const PROFILE_TEMPLATE = `---
firstName: Alex
lastName: Chen
email: alex.chen@example.com
phone: +1 415 555 0192
location: San Francisco, CA
currentTitle: Senior Software Engineer
currentCompany: Acme Corp
yearsExperience: 7
workAuth: US Citizen
noticePeriod: 2 weeks
salaryExpectation: $160,000
willingToRelocate: false
remotePreference: Remote
linkedin: https://linkedin.com/in/alexchen
github: https://github.com/alexchen
portfolio: https://alexchen.dev
skills:
  - TypeScript
  - React
  - Node.js
  - PostgreSQL
  - AWS
  - Docker
education:
  - degree: BSc Computer Science
    institution: UC Berkeley
    year: 2017
referencesAvailable: true
---

## Summary

Results-driven software engineer with 7 years of experience building scalable web applications and APIs. Track record of reducing latency, cutting infrastructure costs, and mentoring junior engineers.

## Experience

**Senior Software Engineer — Acme Corp** (2021–present)
- Led migration from monolith to microservices, reducing p99 latency by 40%
- Mentored 3 junior engineers and introduced PR standards adopted team-wide

**Software Engineer — StartupXYZ** (2018–2021)
- Built real-time collaboration features serving 50k daily active users
- Cut cloud spend by $120k/year through query and caching optimisations
`;

function ProfileSection({
  profile,
  onProfileSaved,
}: {
  profile: Profile | null;
  onProfileSaved: (p: Profile) => void;
}) {
  // Initialise to existing profile markdown if available, otherwise show the template.
  const [markdown, setMarkdown] = useState(() =>
    profile ? profileToMarkdown(profile) : PROFILE_TEMPLATE
  );
  const initialisedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const injectionHits = useMemo(() => detectInjection(markdown), [markdown]);

  // When a profile loads async after mount, populate the textarea once.
  useEffect(() => {
    if (profile && !initialisedRef.current) {
      initialisedRef.current = true;
      setMarkdown(profileToMarkdown(profile));
    }
  }, [profile]);

  const handleSave = useCallback(async () => {
    if (!markdown.trim()) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await sendMsg<{ ok: boolean; profile: Profile; error?: string }>({
        type: "SAVE_PROFILE",
        markdown,
      });
      if (!res.ok) throw new Error(res.error ?? "Save failed");
      onProfileSaved(res.profile);
      setSaveSuccess(true);
      // Keep the textarea showing what was just saved (not the generic template).
      setMarkdown(profileToMarkdown(res.profile));
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }, [markdown, onProfileSaved]);

  const handleExport = useCallback(() => {
    if (!profile) return;
    const md = profileToMarkdown(profile);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "profile.md";
    a.click();
    URL.revokeObjectURL(url);
  }, [profile]);


  return (
    <section className="options-panel rounded-lg border border-gray-200 p-6">
      <SectionHeader
        title="Profile"
        subtitle="Paste your profile.md here and click Save. Phasely reads this to fill every job application form — required fields are firstName, lastName, and email. Everything else is optional but improves fill accuracy."
      />

      {/* Current profile summary */}
      {profile && (
        <div className="options-inset options-profile-summary mb-5 rounded-md bg-gray-50 border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="options-profile-name text-sm font-medium text-gray-700">
              {profile.firstName} {profile.lastName}
            </span>
            <button
              onClick={handleExport}
              className="options-profile-export text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
            >
              Export .md
            </button>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <ProfileField label="Email" value={profile.email} />
            <ProfileField label="Phone" value={profile.phone} />
            <ProfileField label="Title" value={profile.currentTitle} />
            <ProfileField label="Location" value={profile.location} />
            <ProfileField label="Experience" value={`${profile.yearsExperience} yrs`} />
          </dl>
          {profile.skills.length > 0 && (
            <div className="mt-2">
              <span className="options-profile-label text-xs">Skills: </span>
              <span className="options-profile-skills text-xs">{profile.skills.slice(0, 6).join(", ")}{profile.skills.length > 6 ? ` +${profile.skills.length - 6} more` : ""}</span>
            </div>
          )}
        </div>
      )}

      {/* AI generation hint */}
      <div className="options-hint mb-4 rounded-md bg-indigo-50 border border-indigo-100 px-3 py-2.5 text-xs text-indigo-800">
        <span className="font-semibold">Tip:</span> Drop your CV into ChatGPT or Gemini and ask it to <span className="italic">"convert this CV into a Phasely profile.md with YAML front-matter"</span> — then paste the result here.
      </div>

      {/* Paste area */}
      <div className="space-y-3">
        <textarea
          value={markdown}
          onChange={(e) => {
            setMarkdown(e.target.value);
            setSaveSuccess(false);
            setSaveError(null);
          }}
          spellCheck={false}
          rows={18}
          className={[
            "options-input w-full rounded-md border px-3 py-2 text-xs font-mono text-gray-700 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:border-transparent resize-y",
            injectionHits.length > 0
              ? "border-amber-400 focus:ring-amber-400"
              : "border-gray-300 focus:ring-indigo-500",
          ].join(" ")}
        />

        {injectionHits.length > 0 && (
          <Alert type="warning">
            <span className="font-semibold">Suspicious content detected.</span> The following phrases look like AI prompt instructions and will be automatically stripped before saving:{" "}
            <span className="font-mono">{injectionHits.map((h) => `"${h}"`).join(", ")}</span>
          </Alert>
        )}

        {/* Live YAML validator — shows green preview or red error list as user types */}
        <ProfileValidator markdown={markdown} />

        <p className="options-profile-help text-xs text-gray-400 flex items-center gap-1">
          <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
          Prompt injection patterns are automatically stripped before saving.
        </p>

        {saveError && <Alert type="error">{saveError}</Alert>}
        {saveSuccess && (
          <Alert type="success">Profile saved and encrypted successfully.</Alert>
        )}

        <button
          onClick={handleSave}
          disabled={!markdown.trim() || saving}
          className={[
            "options-btn-primary rounded-md px-4 py-2 text-sm font-medium transition-colors",
            markdown.trim() && !saving
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "bg-gray-100 text-gray-400 cursor-not-allowed",
          ].join(" ")}
        >
          {saving ? "Saving…" : profile ? "Update Profile" : "Save Profile"}
        </button>
      </div>

    </section>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <>
      <dt className="options-profile-label">{label}</dt>
      <dd className="options-profile-value truncate">{value}</dd>
    </>
  );
}

// ---------------------------------------------------------------------------
// Live YAML validator — shown below the textarea as the user types
// ---------------------------------------------------------------------------

type ValidationState =
  | { status: "idle" }
  | { status: "valid"; firstName: string; lastName: string; email: string; skillsCount: number; educationCount: number }
  | { status: "invalid"; errors: string[] };

/**
 * Parses the textarea content in real time (debounced 400 ms) and shows either
 * a green "looks good" summary or a red list of specific errors — so users fix
 * problems before clicking Save, not after.
 */
function ProfileValidator({ markdown }: { markdown: string }) {

  const [state, setState] = useState<ValidationState>({ status: "idle" });

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!markdown.trim()) {
        setState({ status: "idle" });
        return;
      }
      try {
        const profile = parseProfile(markdown);
        setState({
          status: "valid",
          firstName: profile.firstName,
          lastName: profile.lastName,
          email: profile.email,
          skillsCount: profile.skills.length,
          educationCount: profile.education.length,
        });
      } catch (err) {
        const errors =
          err instanceof ProfileParseError
            ? err.fields
            : [String(err)];
        setState({ status: "invalid", errors });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [markdown]);

  if (state.status === "idle") return null;

  if (state.status === "valid") {
    return (
      <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800 flex items-center gap-2">
        <svg className="w-3.5 h-3.5 shrink-0 text-green-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        <span>
          <span className="font-semibold">{state.firstName} {state.lastName}</span>
          {" · "}{state.email}
          {state.skillsCount > 0 && <span className="text-green-600"> · {state.skillsCount} skill{state.skillsCount !== 1 ? "s" : ""}</span>}
          {state.educationCount > 0 && <span className="text-green-600"> · {state.educationCount} education entr{state.educationCount !== 1 ? "ies" : "y"}</span>}
        </span>
      </div>
    );
  }

  // Invalid
  return (
    <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 space-y-1">
      <p className="font-semibold">Fix these before saving:</p>
      <ul className="ml-3 list-disc space-y-0.5">
        {state.errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resume section
// ---------------------------------------------------------------------------

/**
 * Read a File as an ArrayBuffer and return the bytes as a base64 string.
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer
      const bytes = new Uint8Array(buffer)
      let binary = ""
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      resolve(btoa(binary))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

function ResumeSection({
  storedFilename,
  onResumeSaved,
}: {
  storedFilename: string | null
  onResumeSaved: (filename: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      e.target.value = ""
      setSaving(true)
      setSaveError(null)
      setSaveSuccess(false)
      try {
        const base64 = await fileToBase64(file)
        const res = await sendMsg<{ ok: boolean; error?: string }>({
          type: "SAVE_RESUME",
          base64,
          filename: file.name,
          mimeType: file.type || "application/pdf",
        })
        if (!res.ok) throw new Error(res.error ?? "Save failed")
        onResumeSaved(file.name)
        setSaveSuccess(true)
      } catch (err) {
        setSaveError(String(err))
      } finally {
        setSaving(false)
      }
    },
    [onResumeSaved],
  )

  return (
    <section className="options-panel rounded-lg border border-gray-200 p-6">
      <SectionHeader
        title="Resume"
        subtitle="Upload your resume once (PDF, DOC, or DOCX). Phasely attaches it automatically to file-upload fields on application forms. Optional — form filling works without it."
      />

      <div className="space-y-3">
        {storedFilename && (
          <div className="options-inset flex items-center gap-2 rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-700">
            <svg className="w-4 h-4 text-red-500 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
            </svg>
            <span className="truncate font-medium">{storedFilename}</span>
            <span className="ml-auto text-xs text-gray-400 shrink-0">stored</span>
          </div>
        )}

        {saveError && <Alert type="error">{saveError}</Alert>}
        {saveSuccess && <Alert type="success">Resume saved and encrypted successfully.</Alert>}

        <div className="flex items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={saving}
            className={[
              "options-btn-secondary rounded-md px-3 py-1.5 text-sm font-medium border transition-colors",
              !saving
                ? "border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50"
                : "border-gray-200 text-gray-300 cursor-not-allowed",
            ].join(" ")}
          >
            {saving ? "Saving…" : storedFilename ? "Replace resume…" : "Upload resume…"}
          </button>
          <span className="text-xs text-gray-400">PDF, DOC, or DOCX</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Settings section
// ---------------------------------------------------------------------------

function SettingsSection({
  isDarkMode,
  onDarkModeChange,
  onWiped,
}: {
  isDarkMode: boolean;
  onDarkModeChange: (v: boolean) => void;
  onWiped: () => void;
}) {
  const [wiping, setWiping] = useState(false);
  const [wipeError, setWipeError] = useState<string | null>(null);

  const handleWipe = useCallback(async () => {
    // C3: require explicit confirmation before destroying all user data
    if (!window.confirm("Permanently delete your profile, resume, API key, and all settings? This cannot be undone.")) return;
    setWiping(true);
    setWipeError(null);
    try {
      const res = await sendMsg<{ ok: boolean; error?: string }>({ type: "WIPE_DATA" });
      if (!res.ok) throw new Error(res.error ?? "Wipe failed");
      onWiped();
    } catch (err) {
      setWipeError(String(err));
    } finally {
      setWiping(false);
    }
  }, [onWiped]);

  return (
    <section className="options-panel rounded-lg border border-gray-200 p-6">
      <SectionHeader title="Settings" />

      <div className="space-y-4">
        {/* Dark mode slider */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            {/* Sun icon */}
            <svg className="w-4 h-4 text-amber-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">Dark mode</span>
            {/* Moon icon */}
            <svg className="w-4 h-4 text-indigo-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          </div>
          {/* Slider toggle */}
          <button
            role="switch"
            aria-checked={isDarkMode}
            onClick={() => onDarkModeChange(!isDarkMode)}
            className={[
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
              isDarkMode ? "bg-indigo-600" : "bg-gray-200",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                isDarkMode ? "translate-x-6" : "translate-x-1",
              ].join(" ")}
            />
          </button>
        </div>

        {/* Wipe */}
        <div className="pt-3 border-t border-gray-100">
          {wipeError && <div className="mb-2"><Alert type="error">{wipeError}</Alert></div>}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Permanently delete all data — profile, resume, key, and settings.</p>
            <button
              onClick={handleWipe}
              disabled={wiping}
              className={[
                "ml-4 shrink-0 rounded-md px-3 py-1.5 text-xs font-medium border border-red-300 text-red-600 hover:border-red-400 hover:bg-red-50 transition-colors",
                wiping ? "opacity-50 cursor-not-allowed" : "",
              ].join(" ")}
            >
              {wiping ? "Wiping…" : "Wipe All Data"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// AI Settings section (Gemini API key)
// ---------------------------------------------------------------------------

function AiSettingsSection({
  settings,
  onSettingsSaved,
}: {
  settings: ExtensionSettings;
  onSettingsSaved: (s: ExtensionSettings) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [keyAlreadySaved, setKeyAlreadySaved] = useState(false);

  // Model list state
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(settings.geminiModel);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelSaveSuccess, setModelSaveSuccess] = useState(false);
  const [modelSaveError, setModelSaveError] = useState<string | null>(null);

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await sendMsg<{ ok: boolean; apiKeySet: boolean; models: string[]; error?: string }>(
        { type: "GET_GEMINI_MODELS" },
      );
      if (!res.ok) throw new Error(res.error ?? "Failed to load models");
      setKeyAlreadySaved(res.apiKeySet);
      const models = res.models ?? [];
      setAvailableModels(models);
      if (models.length > 0) {
        setSelectedModel((prev) => models.includes(prev) ? prev : models[0]);
      }
    } catch (err) {
      setModelsError(String(err));
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // Load key status + model list on mount.
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const handleSaveKey = useCallback(async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await sendMsg<{ ok: boolean; error?: string }>({
        type: "SAVE_GEMINI_API_KEY",
        apiKey: trimmed,
      });
      if (!res.ok) throw new Error(res.error ?? "Save failed");
      setSaveSuccess(true);
      setApiKey("");
      // Re-fetch models with the new key.
      await fetchModels();
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }, [apiKey, fetchModels]);

  const handleSaveModel = useCallback(async (model: string) => {
    setModelSaving(true);
    setModelSaveSuccess(false);
    setModelSaveError(null);
    try {
      const updated: ExtensionSettings = { ...settings, geminiModel: model };
      const res = await sendMsg<{ ok: boolean; settings: ExtensionSettings; error?: string }>({
        type: "SAVE_SETTINGS",
        settings: updated,
      });
      if (!res.ok) throw new Error(res.error ?? "Save failed");
      onSettingsSaved(res.settings);
      setModelSaveSuccess(true);
      setTimeout(() => setModelSaveSuccess(false), 2000);
    } catch (err) {
      setModelSaveError(String(err));
      // Revert the select back to the previously saved model
      setSelectedModel(settings.geminiModel);
    } finally {
      setModelSaving(false);
    }
  }, [settings, onSettingsSaved]);

  return (
    <section className="options-panel rounded-lg border border-gray-200 p-6">
      <SectionHeader
        title="AI Settings"
        subtitle="Gemini API key for AI-powered cover letters and open-text field generation."
      />

      <div className="space-y-4">
        {/* Key saved indicator */}
        {keyAlreadySaved && !saveSuccess && (
          <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800">
            <svg className="w-3.5 h-3.5 shrink-0 text-green-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            API key saved and encrypted. Enter a new key below to replace it.
          </div>
        )}

        {/* API key input */}
        <div>
          <label htmlFor="geminiApiKey" className="block text-sm font-medium text-gray-700 mb-1.5">
            {keyAlreadySaved ? "Replace Gemini API key" : "Gemini API key"}
          </label>
          <div className="flex gap-2">
            <input
              id="geminiApiKey"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setSaveSuccess(false);
                setSaveError(null);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveKey(); }}
              placeholder="AIza…"
              autoComplete="off"
              spellCheck={false}
              className="options-input flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-mono text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <button
              onClick={handleSaveKey}
              disabled={!apiKey.trim() || saving}
              className={[
                "options-btn-primary rounded-md px-3 py-2 text-sm font-medium transition-colors shrink-0",
                apiKey.trim() && !saving
                  ? "bg-indigo-600 text-white hover:bg-indigo-700"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed",
              ].join(" ")}
            >
              {saving ? "Saving…" : keyAlreadySaved ? "Replace" : "Save"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            Encrypted on-device, never leaves your browser. Get a free key at{" "}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-600 hover:underline"
            >
              aistudio.google.com
            </a>
            .
          </p>
        </div>

        {saveError && <Alert type="error">{saveError}</Alert>}
        {saveSuccess && <Alert type="success">API key saved. Loading available models…</Alert>}

        {/* Model picker — shown only when a key is set and models have loaded */}
        {keyAlreadySaved && (
          <div className="pt-3 border-t border-gray-100">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Model
              {modelsLoading && (
                <span className="ml-2 text-xs font-normal text-gray-400">Loading…</span>
              )}
              {modelSaveSuccess && (
                <span className="ml-2 text-xs font-normal text-green-600">Saved</span>
              )}
              {modelSaving && (
                <span className="ml-2 text-xs font-normal text-gray-400">Saving…</span>
              )}
            </label>

            {modelsError && <Alert type="error">{modelsError}</Alert>}
            {modelSaveError && <Alert type="error">Model save failed: {modelSaveError}</Alert>}

            {!modelsLoading && !modelsError && availableModels.length > 0 && (
              <>
                <select
                  value={selectedModel}
                  onChange={(e) => {
                    const m = e.target.value;
                    setSelectedModel(m);
                    handleSaveModel(m);
                  }}
                  disabled={modelSaving}
                  className="options-select w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  {availableModels.length} model{availableModels.length !== 1 ? "s" : ""} available from your API key. Used for cover letters and open-text fields.
                </p>
              </>
            )}

            {!modelsLoading && !modelsError && availableModels.length === 0 && (
              <p className="text-xs text-gray-400">
                No models returned. Check that your API key has Gemini API access.{" "}
                <button
                  onClick={fetchModels}
                  className="text-indigo-600 hover:underline"
                >
                  Retry
                </button>
              </p>
            )}

            {!modelsLoading && modelsError && (
              <button
                onClick={fetchModels}
                className="text-xs text-indigo-600 hover:underline"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Upcoming section (UI only)
// ---------------------------------------------------------------------------

function UpcomingSection() {
  const upcoming = [
    "Claude API integration",
    "GPT API integration",
    "Tailored resume generation",
    "Multiple profiles",
  ];

  return (
    <section className="options-upcoming rounded-lg border border-amber-200 bg-linear-to-br from-amber-50 to-white p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-amber-900">Coming up</h2>
        <p className="text-sm text-amber-800 mt-0.5">
          Things being worked on — not available yet.
        </p>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-700">
        {upcoming.map((feature) => (
          <li key={feature} className="options-upcoming-item rounded-md border border-amber-100 bg-white px-3 py-2">
            {feature}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Options() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [resumeFilename, setResumeFilename] = useState<string | null>(null);
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("phasely-options-theme") === "dark";
    } catch {
      return false;
    }
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load profile + resume + settings on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [pRes, rRes, sRes] = await Promise.all([
          sendMsg<{ ok: boolean; profile: Profile | null }>({ type: "GET_PROFILE" }),
          sendMsg<{ ok: boolean; resume: StoredResume | null }>({ type: "GET_RESUME" }),
          sendMsg<{ ok: boolean; settings: ExtensionSettings }>({ type: "GET_SETTINGS" }),
        ]);
        if (cancelled) return;
        if (pRes.ok) setProfile(pRes.profile);
        if (rRes.ok && rRes.resume) setResumeFilename(rRes.resume.filename);
        if (sRes.ok) setSettings(sRes.settings ?? DEFAULT_SETTINGS);
      } catch (err) {
        if (!cancelled) setLoadError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("phasely-options-theme", isDarkMode ? "dark" : "light");
    } catch {
      // Ignore storage write errors in restricted contexts.
    }
  }, [isDarkMode]);

  const handleWiped = useCallback(() => {
    window.location.reload();
  }, []);

  if (loading) {
    return (
      <div className={[
        "options-page min-h-screen flex items-center justify-center",
        isDarkMode ? "options-dark bg-gray-900" : "bg-gray-50",
      ].join(" ")}>
        <span className="text-sm text-gray-500">Loading…</span>
      </div>
    );
  }

  return (
    <div className={[
      "options-page min-h-screen font-sans",
      isDarkMode ? "options-dark bg-gray-900" : "bg-gray-50",
    ].join(" ")}>
      {/* Page header */}
      <div className="options-topbar bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logoIcon} alt="Phasely logo" className="w-8 h-8 rounded-lg" />
            <div>
              <h1 className="options-brand text-lg font-bold text-gray-900 tracking-tight">Phasely</h1>
              <p className="options-brand-sub text-xs text-gray-400">Settings</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={[
                "inline-block w-2 h-2 rounded-full",
                profile ? "bg-green-500" : "bg-amber-400",
              ].join(" ")}
            />
            <span className="text-xs text-gray-500">
              {profile ? "Profile loaded" : "No profile"}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {loadError && (
          <Alert type="error">Failed to load stored data: {loadError}</Alert>
        )}

        {/* Introduction */}
        <div className="options-hero rounded-xl border border-indigo-100 bg-linear-to-br from-indigo-50 to-white dark:bg-gray-800 px-5 py-4 flex items-center justify-between gap-4">
          <p className="text-sm text-gray-600">
            Write your profile once — Phasely fills Workday, Greenhouse, Lever, iCIMS and more in one click. Encrypted locally, zero telemetry.
          </p>
          <div className="flex shrink-0 gap-2 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
              Encrypted
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              No servers
            </span>
          </div>
        </div>

        <ProfileSection
          profile={profile}
          onProfileSaved={setProfile}
        />

        <ResumeSection
          storedFilename={resumeFilename}
          onResumeSaved={setResumeFilename}
        />

        <AiSettingsSection
          settings={settings}
          onSettingsSaved={setSettings}
        />

        <SettingsSection
          isDarkMode={isDarkMode}
          onDarkModeChange={setIsDarkMode}
          onWiped={handleWiped}
        />

        <UpcomingSection />

        <p className="text-xs text-gray-400 text-center pb-4">
          Phasely v1.0.2 — open source · encrypted locally · zero telemetry
        </p>
        {/* Github Link */}
        <div className="text-center">
          Crafted with care, Source code on <a
            href="https://github.com/takinur/phasely"
            target="_blank"
            rel="noopener noreferrer"
            className="options-link text-sm text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            GitHub
          </a>
        </div>

      </main>
    </div>
  );
}

export default Options;
