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
  onWiped,
}: {
  profile: Profile | null;
  onProfileSaved: (p: Profile) => void;
  onWiped: () => void;
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
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wipeError, setWipeError] = useState<string | null>(null);

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

  const handleWipe = useCallback(async () => {
    if (!confirmingWipe) {
      setWipeError(null);
      setConfirmingWipe(true);
      return;
    }
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
      setConfirmingWipe(false);
    }
  }, [confirmingWipe, onWiped]);

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
            <ProfileField label="Company" value={profile.currentCompany} />
            <ProfileField label="Location" value={profile.location} />
            <ProfileField label="Experience" value={`${profile.yearsExperience} yrs`} />
            <ProfileField label="Work Auth" value={profile.workAuth} />
            <ProfileField label="Remote" value={profile.remotePreference} />
            {profile.linkedin && (
              <div className="col-span-2">
                <dt className="options-profile-label inline">LinkedIn: </dt>
                <dd className="inline">
                  <a
                    href={profile.linkedin}
                    target="_blank"
                    rel="noreferrer"
                    className="options-profile-link text-indigo-600 hover:underline"
                  >
                    {profile.linkedin}
                  </a>
                </dd>
              </div>
            )}
          </dl>
          {profile.skills.length > 0 && (
            <div className="mt-2">
              <span className="options-profile-label text-xs">Skills: </span>
              <span className="options-profile-skills text-xs">{profile.skills.join(", ")}</span>
            </div>
          )}
        </div>
      )}

      {/* AI generation hint */}
      <div className="options-hint mb-4 rounded-md bg-indigo-50 border border-indigo-100 px-4 py-3 text-xs text-indigo-800 space-y-2">
        <p>
          <span className="font-semibold">Don't want to write this by hand?</span> Drop your CV into ChatGPT or Gemini and use this prompt:
        </p>
        <blockquote className="italic border-l-2 border-indigo-300 pl-3 text-indigo-700">
          "Convert this CV into a Phasely profile.md. Use YAML front-matter (between --- delimiters). Required fields: firstName, lastName, email. Include if present: phone, location, currentTitle, currentCompany, yearsExperience, skills (YAML list), education (YAML list with degree / institution / year), workAuth, noticePeriod, salaryExpectation, willingToRelocate, remotePreference. After the closing ---, add a brief markdown summary and experience section."
        </blockquote>
        <p>Paste the result here and click <span className="font-semibold">Save Profile</span>. The live preview below the editor will tell you if anything is missing before you save.</p>
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

      {/* Danger zone — wipe all data */}
      <div className="mt-6 pt-5 border-t border-red-100">
        <p className="options-profile-help text-xs text-gray-400 mb-3">
          Permanently delete all Phasely data — profile, resume, encryption key, and settings. Cannot be undone.
        </p>

        {wipeError && <div className="mb-2"><Alert type="error">{wipeError}</Alert></div>}

        {confirmingWipe && (
          <div className="mb-2">
            <Alert type="warning">
              This will permanently delete everything. There is no recovery. Click again to confirm.
            </Alert>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleWipe}
            disabled={wiping}
            className={[
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              confirmingWipe
                ? "bg-red-600 text-white hover:bg-red-700"
                : "border border-red-300 text-red-600 hover:border-red-400 hover:bg-red-50",
              wiping ? "opacity-50 cursor-not-allowed" : "",
            ].join(" ")}
          >
            {wiping ? "Wiping…" : confirmingWipe ? "Confirm — Wipe Everything" : "Wipe All Data"}
          </button>

          {confirmingWipe && !wiping && (
            <button
              onClick={() => setConfirmingWipe(false)}
              className="rounded-md px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
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
  settings,
  onSettingsSaved,
  modelsRefreshKey,
}: {
  settings: ExtensionSettings;
  onSettingsSaved: (s: ExtensionSettings) => void;
  modelsRefreshKey: number;
}) {
  const [draft, setDraft] = useState<ExtensionSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await sendMsg<{
          ok: boolean;
          apiKeySet: boolean;
          models: string[];
          error?: string;
        }>({ type: "GET_GEMINI_MODELS" });
        if (!res.ok) throw new Error(res.error ?? "Failed to load Gemini models");
        if (cancelled) return;

        const models = res.models ?? [];
        setApiKeySet(res.apiKeySet);
        setAvailableModels(models);
        setModelsError(null);

        // Use functional setDraft to read current geminiModel without adding it
        // as a dependency — avoids re-fetching models on every model change.
        if (res.apiKeySet && models.length > 0) {
          setDraft((prev) => ({
            ...prev,
            geminiModel: models.includes(prev.geminiModel) ? prev.geminiModel : models[0],
          }));
        }
      } catch (err) {
        if (!cancelled) setModelsError(String(err));
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [modelsRefreshKey]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await sendMsg<{ ok: boolean; settings: ExtensionSettings; error?: string }>({
        type: "SAVE_SETTINGS",
        settings: draft,
      });
      if (!res.ok) throw new Error(res.error ?? "Save failed");
      onSettingsSaved(res.settings);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }, [draft, onSettingsSaved]);

  const update = useCallback(
    <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => {
      setSaveSuccess(false);
      setDraft((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  return (
    <section className="options-panel rounded-lg border border-gray-200 p-6">
      <SectionHeader
        title="Extension Settings"
        subtitle="Control how Phasely fills and submits applications. Submit settings take effect immediately — no Google sign-in required."
      />

      <div className="space-y-5">
        {/* Confirm before submit toggle */}
        <div className="flex items-start gap-3">
          <input
            id="confirmBeforeSubmit"
            type="checkbox"
            checked={draft.confirmBeforeSubmit}
            onChange={(e) => update("confirmBeforeSubmit", e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
          <label htmlFor="confirmBeforeSubmit" className="text-sm text-gray-700 cursor-pointer">
            <span className="font-medium">Confirm before submitting</span>
            <p className="text-xs text-gray-400 mt-0.5">
              Show a confirmation dialog before Phasely clicks the Submit button. Recommended — keeps you in control.
            </p>
          </label>
        </div>

        {/* Auto-submit toggle */}
        <div className="flex items-start gap-3">
          <input
            id="autoSubmit"
            type="checkbox"
            checked={draft.autoSubmit}
            onChange={(e) => update("autoSubmit", e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
          <label htmlFor="autoSubmit" className="text-sm text-gray-700 cursor-pointer">
            <span className="font-medium">Auto-submit after fill</span>
            <p className="text-xs text-gray-400 mt-0.5">
              Automatically click Submit after filling all fields. Only takes effect when "Confirm before submitting" is also enabled.
            </p>
          </label>
        </div>

        {/* Gemini model picker — only relevant when API key is saved */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Gemini model <span className="text-xs font-normal text-gray-400">(AI features)</span>
          </label>
          <select
            value={draft.geminiModel}
            onChange={(e) =>
              update("geminiModel", e.target.value as ExtensionSettings["geminiModel"])
            }
            disabled={!apiKeySet || modelsLoading}
            className={[
              "options-select rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 transition-colors cursor-pointer disabled:cursor-not-allowed",
              !apiKeySet
                ? "border-gray-200 bg-gray-50 text-gray-400 focus:ring-gray-300"
                : "border-gray-300 text-gray-700 focus:ring-indigo-500",
            ].join(" ")}
          >
            {availableModels.length > 0 ? (
              availableModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))
            ) : (
              <option value={draft.geminiModel}>{draft.geminiModel}</option>
            )}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            {!apiKeySet
              ? "Save your Gemini API key in the AI Settings section above to enable model selection."
              : modelsLoading
                ? "Loading available Gemini models…"
                : "Used for AI-written fields (cover letter, open questions)."}
          </p>
          {modelsError && <Alert type="error">{modelsError}</Alert>}
        </div>

        {saveError && <Alert type="error">{saveError}</Alert>}
        {saveSuccess && <Alert type="success">Settings saved.</Alert>}

        <button
          onClick={handleSave}
          disabled={saving}
          className={[
            "options-btn-primary rounded-md px-4 py-2 text-sm font-medium transition-colors",
            !saving
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "bg-gray-100 text-gray-400 cursor-not-allowed",
          ].join(" ")}
        >
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// AI Settings section (Gemini API key)
// ---------------------------------------------------------------------------

function AiSettingsSection({ onKeySaved }: { onKeySaved: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [keyAlreadySaved, setKeyAlreadySaved] = useState(false);

  // Check on mount whether a key is already stored.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await sendMsg<{ ok: boolean; apiKeySet: boolean; models: string[] }>(
          { type: "GET_GEMINI_MODELS" },
        );
        if (!cancelled && res.ok) setKeyAlreadySaved(res.apiKeySet);
      } catch {
        // Ignore — treat as no key stored.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = useCallback(async () => {
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
      setKeyAlreadySaved(true);
      setApiKey("");
      onKeySaved();
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }, [apiKey, onKeySaved]);

  return (
    <section className="options-panel rounded-lg border border-gray-200 p-6">
      <SectionHeader
        title="AI Settings"
        subtitle="Enter your Gemini API key to enable AI-powered cover letter and field generation. Get a free key at aistudio.google.com."
      />

      <div className="space-y-3">
        {/* Show saved-key indicator when a key is already stored */}
        {keyAlreadySaved && !saveSuccess && (
          <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800">
            <svg className="w-3.5 h-3.5 shrink-0 text-green-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            API key saved and encrypted. Enter a new key below to replace it.
          </div>
        )}

        <div>
          <label htmlFor="geminiApiKey" className="block text-sm font-medium text-gray-700 mb-1.5">
            {keyAlreadySaved ? "Replace Gemini API key" : "Gemini API key"}
          </label>
          <input
            id="geminiApiKey"
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setSaveSuccess(false);
              setSaveError(null);
            }}
            placeholder="AIza…"
            autoComplete="off"
            spellCheck={false}
            className="options-input w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        <p className="text-xs text-gray-400">
          Your key is encrypted on-device and never leaves your browser.
          Get a free key at{" "}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-600 hover:underline"
          >
            aistudio.google.com
          </a>
          . Form filling works without a key — this only unlocks AI-generated fields.
        </p>

        {saveError && <Alert type="error">{saveError}</Alert>}
        {saveSuccess && (
          <Alert type="success">API key saved and encrypted. AI features are now active.</Alert>
        )}

        <button
          onClick={handleSave}
          disabled={!apiKey.trim() || saving}
          className={[
            "options-btn-primary rounded-md px-4 py-2 text-sm font-medium transition-colors",
            apiKey.trim() && !saving
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "bg-gray-100 text-gray-400 cursor-not-allowed",
          ].join(" ")}
        >
          {saving ? "Saving…" : keyAlreadySaved ? "Replace API key" : "Save API key"}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Premium section (UI only)
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
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
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

  const handleKeySaved = useCallback(() => {
    setModelsRefreshKey((k) => k + 1);
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
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsDarkMode((prev) => !prev)}
              className="options-btn-secondary rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {isDarkMode ? "Light mode" : "Dark mode"}
            </button>
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
        <div className="options-hero rounded-xl border border-indigo-100 bg-linear-to-br from-indigo-50 to-white dark:bg-gray-800 px-6 py-5">
          <h2 className="options-hero-title text-sm font-semibold text-indigo-900 mb-1.5">Fill every form. Once.</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Write your profile once. Phasely handles the copy-paste — Workday, Greenhouse, Lever, iCIMS, and more,
            all filled in one click. Everything stays encrypted on your device. No accounts. No servers. No nonsense.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              Encrypted on-device
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              Zero telemetry
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              No servers
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              Open source
            </span>
          </div>
        </div>

        <ProfileSection
          profile={profile}
          onProfileSaved={setProfile}
          onWiped={handleWiped}
        />

        <ResumeSection
          storedFilename={resumeFilename}
          onResumeSaved={setResumeFilename}
        />

        <AiSettingsSection onKeySaved={handleKeySaved} />

        <SettingsSection
          settings={settings}
          onSettingsSaved={setSettings}
          modelsRefreshKey={modelsRefreshKey}
        />

        <UpcomingSection />

        <p className="text-xs text-gray-400 text-center pb-4">
          Phasely v1.0.2 — open source · encrypted locally · zero telemetry
        </p>
        {/* Github Link */}
        <div className="text-center">
          crafted with care <a
            href="https://github.com/phasely/phasely"
            target="_blank"
            rel="noopener noreferrer"
            className="options-link text-sm text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
           Source code on GitHub
          </a>
        </div>

      </main>
    </div>
  );
}

export default Options;
