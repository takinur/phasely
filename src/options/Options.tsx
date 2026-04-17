/**
 * Options.tsx — Phasely extension settings page
 *
 * Sections:
 *   1. Profile import — paste/upload profile.md, see parse preview, save
 *   2. Profile summary — display stored profile fields, export .md
 *   3. Extension settings — Gemini model, auto-submit toggle, confirm dialog
 *   4. Danger zone — wipe all data
 *
 * All persistence goes through the service worker (SAVE_PROFILE, GET_PROFILE,
 * GET_SETTINGS, SAVE_SETTINGS). No direct storage calls from this page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExtensionSettings, Profile, StoredResume } from "@/lib/types";
import { profileToMarkdown, detectInjection } from "@/lib/profile";
import { DEFAULT_SETTINGS } from "@/lib/defaults";

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
  | { type: "AUTH_GOOGLE" };

function sendMsg<T = unknown>(payload: MsgPayload): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response: T) => {
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
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
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
    success: "bg-green-50 border-green-200 text-green-800",
    error: "bg-red-50 border-red-200 text-red-800",
    info: "bg-indigo-50 border-indigo-200 text-indigo-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
  }[type];

  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${classes}`}>{children}</div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <div className="relative mt-0.5">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div
          className={[
            "w-10 h-5 rounded-full transition-colors",
            checked ? "bg-indigo-600" : "bg-gray-300",
          ].join(" ")}
        />
        <div
          className={[
            "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5",
          ].join(" ")}
        />
      </div>
      <div>
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        )}
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Profile section
// ---------------------------------------------------------------------------

function ProfileSection({
  profile,
  onProfileSaved,
}: {
  profile: Profile | null;
  onProfileSaved: (p: Profile) => void;
}) {
  const [markdown, setMarkdown] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const injectionHits = useMemo(() => detectInjection(markdown), [markdown]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setMarkdown("");
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }, [markdown, onProfileSaved]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result;
        if (typeof text === "string") setMarkdown(text);
      };
      reader.readAsText(file);
      // Reset so same file can be re-selected
      e.target.value = "";
    },
    [],
  );

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
    <section className="rounded-lg border border-gray-200 p-6">
      <SectionHeader
        title="Profile"
        subtitle="Import your profile.md file to power autofill. Required fields: firstName, lastName, email."
      />

      {/* Current profile summary */}
      {profile && (
        <div className="mb-5 rounded-md bg-gray-50 border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">
              {profile.firstName} {profile.lastName}
            </span>
            <button
              onClick={handleExport}
              className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
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
                <dt className="text-gray-400 inline">LinkedIn: </dt>
                <dd className="inline">
                  <a
                    href={profile.linkedin}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-600 hover:underline"
                  >
                    {profile.linkedin}
                  </a>
                </dd>
              </div>
            )}
          </dl>
          {profile.skills.length > 0 && (
            <div className="mt-2">
              <span className="text-xs text-gray-400">Skills: </span>
              <span className="text-xs text-gray-600">{profile.skills.join(", ")}</span>
            </div>
          )}
        </div>
      )}

      {/* Import area */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md px-3 py-1.5 text-sm font-medium border border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-colors"
          >
            Choose file…
          </button>
          <span className="text-sm text-gray-400 self-center">
            or paste markdown below
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        <textarea
          value={markdown}
          onChange={(e) => {
            setMarkdown(e.target.value);
            setSaveSuccess(false);
            setSaveError(null);
          }}
          placeholder={`---\nfirstName: Jane\nlastName: Doe\nemail: jane@example.com\nphone: +1 555 000 0000\nlocation: New York, NY\ncurrentTitle: Software Engineer\ncurrentCompany: Acme Corp\nyearsExperience: 5\nworkAuth: US Citizen\nnoticePeriod: 2 weeks\nsalaryExpectation: $120,000\nwillingToRelocate: false\nremotePreference: Remote\nskills:\n  - TypeScript\n  - React\n---`}
          rows={12}
          className={[
            "w-full rounded-md border px-3 py-2 text-xs font-mono text-gray-700 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:border-transparent resize-y",
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

        <p className="text-xs text-gray-400 flex items-center gap-1">
          <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
          Phasely strips any AI instructions from your profile before saving and before sending to Gemini.
        </p>

        {saveError && <Alert type="error">{saveError}</Alert>}
        {saveSuccess && (
          <Alert type="success">Profile saved and encrypted successfully.</Alert>
        )}

        <button
          onClick={handleSave}
          disabled={!markdown.trim() || saving}
          className={[
            "rounded-md px-4 py-2 text-sm font-medium transition-colors",
            markdown.trim() && !saving
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "bg-gray-100 text-gray-400 cursor-not-allowed",
          ].join(" ")}
        >
          {saving ? "Saving…" : "Save Profile"}
        </button>
      </div>
    </section>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-gray-400">{label}</dt>
      <dd className="text-gray-700 truncate">{value}</dd>
    </>
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
    <section className="rounded-lg border border-gray-200 p-6">
      <SectionHeader
        title="Resume"
        subtitle="Upload your resume PDF. It will be stored encrypted and attached to file-upload fields automatically."
      />

      <div className="space-y-3">
        {storedFilename && (
          <div className="flex items-center gap-2 rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-700">
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
              "rounded-md px-3 py-1.5 text-sm font-medium border transition-colors",
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
}: {
  settings: ExtensionSettings;
  onSettingsSaved: (s: ExtensionSettings) => void;
}) {
  const [draft, setDraft] = useState<ExtensionSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

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
    <section className="rounded-lg border border-gray-200 p-6">
      <SectionHeader
        title="Extension Settings"
        subtitle="Control autofill behaviour and AI model selection."
      />

      <div className="space-y-5">
        {/* Gemini model picker */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Gemini model
          </label>
          <select
            value={draft.geminiModel}
            onChange={(e) =>
              update("geminiModel", e.target.value as ExtensionSettings["geminiModel"])
            }
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="gemini-1.5-flash">Gemini 1.5 Flash (faster, cheaper)</option>
            <option value="gemini-1.5-pro">Gemini 1.5 Pro (smarter, slower)</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">Used for AI-written fields (cover letter, open questions).</p>
        </div>

        {/* Auto-submit toggle */}
        <Toggle
          label="Auto-submit"
          description="Automatically click the submit button after filling all fields."
          checked={draft.autoSubmit}
          onChange={(v) => update("autoSubmit", v)}
        />

        {/* Confirm before submit */}
        <Toggle
          label="Confirm before submitting"
          description="Show a confirmation dialog before auto-submitting the application."
          checked={draft.confirmBeforeSubmit}
          onChange={(v) => update("confirmBeforeSubmit", v)}
        />

        {saveError && <Alert type="error">{saveError}</Alert>}
        {saveSuccess && <Alert type="success">Settings saved.</Alert>}

        <button
          onClick={handleSave}
          disabled={saving}
          className={[
            "rounded-md px-4 py-2 text-sm font-medium transition-colors",
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
// Google Auth section
// ---------------------------------------------------------------------------

function AuthSection() {
  const [authing, setAuthing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState(false);

  const handleAuth = useCallback(async () => {
    setAuthing(true);
    setAuthError(null);
    setAuthSuccess(false);
    try {
      const res = await sendMsg<{ ok: boolean; token?: string; error?: string }>({
        type: "AUTH_GOOGLE",
      });
      if (!res.ok) throw new Error(res.error ?? "Auth failed");
      setAuthSuccess(true);
    } catch (err) {
      setAuthError(String(err));
    } finally {
      setAuthing(false);
    }
  }, []);

  return (
    <section className="rounded-lg border border-gray-200 p-6">
      <SectionHeader
        title="Google Account (AI features)"
        subtitle="Sign in with Google to enable AI-written cover letters and open questions. Your token never leaves your browser."
      />

      <div className="space-y-3">
        {authError && <Alert type="error">{authError}</Alert>}
        {authSuccess && (
          <Alert type="success">
            Signed in successfully. AI features are now active.
          </Alert>
        )}

        <button
          onClick={handleAuth}
          disabled={authing}
          className={[
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium border transition-colors",
            !authing
              ? "border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50"
              : "border-gray-200 text-gray-300 cursor-not-allowed",
          ].join(" ")}
        >
          {authing ? (
            "Connecting…"
          ) : (
            <>
              <GoogleIcon />
              Sign in with Google
            </>
          )}
        </button>

        <p className="text-xs text-gray-400">
          Only the Gemini AI scope is requested. No access to Gmail or Drive.
        </p>
      </div>
    </section>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------

function DangerZone({ onWiped }: { onWiped: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wipeError, setWipeError] = useState<string | null>(null);

  const handleWipe = useCallback(async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setWiping(true);
    setWipeError(null);
    try {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.clear(() => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
      onWiped();
    } catch (err) {
      setWipeError(String(err));
      setWiping(false);
    }
  }, [confirming, onWiped]);

  return (
    <section className="rounded-lg border border-red-200 p-6">
      <SectionHeader
        title="Danger Zone"
        subtitle="Permanently delete all stored data including your profile, encryption key, and settings. This cannot be undone."
      />

      <div className="space-y-3">
        {wipeError && <Alert type="error">{wipeError}</Alert>}

        {confirming && (
          <Alert type="warning">
            This will permanently delete all Phasely data including the encryption key.
            Previously stored data will be unrecoverable. Click again to confirm.
          </Alert>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleWipe}
            disabled={wiping}
            className={[
              "rounded-md px-4 py-2 text-sm font-medium transition-colors",
              confirming
                ? "bg-red-600 text-white hover:bg-red-700"
                : "border border-red-300 text-red-600 hover:border-red-400 hover:bg-red-50",
              wiping ? "opacity-50 cursor-not-allowed" : "",
            ].join(" ")}
          >
            {wiping ? "Wiping…" : confirming ? "Confirm — Wipe Everything" : "Wipe All Data"}
          </button>

          {confirming && !wiping && (
            <button
              onClick={() => setConfirming(false)}
              className="rounded-md px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
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
  const [settingsResetKey, setSettingsResetKey] = useState(0);
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

  const handleWiped = useCallback(() => {
    setProfile(null);
    setResumeFilename(null);
    setSettings(DEFAULT_SETTINGS);
    setSettingsResetKey((k) => k + 1);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {/* Page header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 tracking-tight">Phasely</h1>
            <p className="text-xs text-gray-400">Settings</p>
          </div>
          <div className="flex items-center gap-1.5">
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
        <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white px-6 py-5">
          <h2 className="text-sm font-semibold text-indigo-900 mb-1.5">One profile. Every application.</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Phasely reads your <code className="text-xs bg-indigo-100 text-indigo-700 px-1 py-0.5 rounded">profile.md</code> once,
            then autofills any job application form in a single click — Workday, Greenhouse, Lever, iCIMS, and more.
            Your data is encrypted on your device and never sent to any Phasely server.
            AI-written fields (cover letters, open questions) call Gemini directly from your browser using your Google account.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              AES-256 encrypted storage
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              Zero telemetry
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              No Phasely servers
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              Prompt injection protection
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

        <SettingsSection
          key={settingsResetKey}
          settings={settings}
          onSettingsSaved={setSettings}
        />

        <AuthSection />

        <DangerZone onWiped={handleWiped} />

        <p className="text-xs text-gray-400 text-center pb-4">
          Phasely v0.1.0 — All data is encrypted locally. Zero telemetry.
        </p>
      </main>
    </div>
  );
}

export default Options;
