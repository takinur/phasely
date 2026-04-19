/**
 * Popup.tsx — Phasely extension popup
 *
 * Flow:
 *   1. Load profile, resume, and settings from SW on mount
 *   2. Fill sends the profile to the content script via FILL_ALL
 *   3. Fill & Submit triggers FILL_ALL then SUBMIT in sequence
 */

import { useCallback, useEffect, useState } from "react";
import type { ExtensionSettings, JobContext, Profile, StoredResume } from "@/lib/types";
import logoIcon from "@/assets/logo_phasely.png";

// ---------------------------------------------------------------------------
// Chrome message helpers (typed)
// ---------------------------------------------------------------------------

type MsgPayload =
  | { type: "GET_PROFILE" }
  | { type: "GET_SETTINGS" }
  | { type: "GET_RESUME" }
  | { type: "GET_GEMINI_MODELS" }
  | { type: "GET_JOB_CONTEXT" }
  | { type: "FILL_ALL"; profile: Profile }
  | { type: "GENERATE_COVER_LETTER" }
  | { type: "SUBMIT"; settings?: Pick<ExtensionSettings, "confirmBeforeSubmit"> };

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
// Sub-components
// ---------------------------------------------------------------------------

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={[
        "inline-block w-2.5 h-2.5 rounded-full popup-status-dot",
        ok ? "popup-status-ok" : "popup-status-missing",
      ].join(" ")}
    />
  );
}

// ---------------------------------------------------------------------------
// Cover letter result panel
// ---------------------------------------------------------------------------

function CoverLetterResult({ text, filled }: { text: string; filled: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    // Primary: Clipboard API (works in popup with user gesture)
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => fallbackCopy());
    } else {
      fallbackCopy();
    }

    function fallbackCopy() {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }, [text]);

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700">
          {filled ? "✓ Filled into form" : "No field found — copy manually"}
        </span>
        <button
          onClick={handleCopy}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <textarea
        readOnly
        value={text}
        rows={6}
        className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type Phase = "idle" | "filling" | "submitting" | "generating";

export function Popup() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [hasResume, setHasResume] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [jobContext, setJobContext] = useState<JobContext | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fillDone, setFillDone] = useState(false);
  const [coverLetterDone, setCoverLetterDone] = useState(false);
  const [coverLetterText, setCoverLetterText] = useState<string | null>(null);
  const [coverLetterFilled, setCoverLetterFilled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [pRes, rRes, sRes, gRes, jRes] = await Promise.all([
          sendMsg<{ ok: boolean; profile: Profile | null }>({ type: "GET_PROFILE" }),
          sendMsg<{ ok: boolean; resume: StoredResume | null }>({ type: "GET_RESUME" }),
          sendMsg<{ ok: boolean; settings: ExtensionSettings }>({ type: "GET_SETTINGS" }),
          sendMsg<{ ok: boolean; apiKeySet: boolean; models: string[] }>({ type: "GET_GEMINI_MODELS" }),
          sendMsg<{ ok: boolean; jobContext: JobContext | null }>({ type: "GET_JOB_CONTEXT" }),
        ]);
        if (cancelled) return;
        if (pRes.ok) setProfile(pRes.profile);
        if (rRes.ok) setHasResume(rRes.resume !== null);
        if (sRes.ok) setSettings(sRes.settings);
        if (gRes.ok) setApiKeySet(gRes.apiKeySet);
        if (jRes.ok) setJobContext(jRes.jobContext);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const handleFill = useCallback(async () => {
    if (!profile) return;
    setPhase("filling");
    setError(null);
    setFillDone(false);
    try {
      const res = await sendMsg<{ ok: boolean; error?: string }>({
        type: "FILL_ALL",
        profile,
      });
      if (!res.ok) throw new Error(res.error ?? "Fill failed");
      setFillDone(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setPhase("idle");
    }
  }, [profile]);

  const submitApplication = useCallback(async () => {
    setPhase("submitting");
    setError(null);
    try {
      const res = await sendMsg<{ ok: boolean; error?: string }>({
        type: "SUBMIT",
        settings: { confirmBeforeSubmit: settings?.confirmBeforeSubmit ?? true },
      });
      if (!res.ok) throw new Error(res.error ?? "Submit failed");
    } catch (err) {
      setError(String(err));
    } finally {
      setPhase("idle");
    }
  }, [settings]);

  const handleFillAndSubmit = useCallback(async () => {
    if (!profile) return;
    setPhase("filling");
    setError(null);
    setFillDone(false);
    try {
      const fillRes = await sendMsg<{ ok: boolean; error?: string }>({
        type: "FILL_ALL",
        profile,
      });
      if (!fillRes.ok) throw new Error(fillRes.error ?? "Fill failed");
      setFillDone(true);
      setPhase("submitting");
      const submitRes = await sendMsg<{ ok: boolean; error?: string }>({
        type: "SUBMIT",
        settings: { confirmBeforeSubmit: settings?.confirmBeforeSubmit ?? true },
      });
      if (!submitRes.ok) throw new Error(submitRes.error ?? "Submit failed");
    } catch (err) {
      setError(String(err));
    } finally {
      setPhase("idle");
    }
  }, [profile, settings]);

  const handleGenerateCoverLetter = useCallback(async () => {
    setPhase("generating");
    setError(null);
    setCoverLetterDone(false);
    setCoverLetterText(null);
    setCoverLetterFilled(false);
    try {
      const res = await sendMsg<{ ok: boolean; text?: string; filled?: boolean; error?: string }>(
        { type: "GENERATE_COVER_LETTER" },
        60_000,
      );
      if (!res.ok) throw new Error(res.error ?? "Generation failed");
      setCoverLetterDone(true);
      setCoverLetterText(res.text ?? null);
      setCoverLetterFilled(res.filled ?? false);
    } catch (err) {
      setError(String(err));
    } finally {
      setPhase("idle");
    }
  }, []);

  const hasProfile = profile !== null;
  const isWorking = phase !== "idle";
  // Fill only requires a profile; resume is optional (file fields are skipped gracefully when absent).
  const canFill = hasProfile && !isWorking;
  const canGenerate = hasProfile && apiKeySet && !isWorking;

  const generateDisabledReason = !hasProfile
    ? "Add your profile in Settings first"
    : !apiKeySet
      ? "Add a Gemini API key in Settings → AI Settings"
      : null;

  return (
    <div className="popup-shell w-80 min-h-36 text-sm flex flex-col">
      {/* Header */}
      <header className="popup-header flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <img src={logoIcon} alt="Phasely logo" className="w-5 h-5 rounded-md ring-1 ring-white/20" />
          <span className="popup-brand font-semibold text-base tracking-tight">Phasely</span>
          <StatusDot ok={hasProfile && hasResume} />
        </div>
        <a
          href={chrome.runtime.getURL("src/options.html")}
          target="_blank"
          rel="noreferrer"
          className="popup-link text-xs"
        >
          Settings
        </a>
      </header>

      <div className="flex flex-col gap-3 p-4 flex-1">
        {/* No profile */}
        {!hasProfile && (
          <div className="popup-alert popup-alert-warning px-3 py-2 text-xs">
            No profile found. Open{" "}
            <a
              href={chrome.runtime.getURL("src/options.html")}
              target="_blank"
              rel="noreferrer"
              className="underline font-medium"
            >
              Settings
            </a>{" "}
            to import your profile.
          </div>
        )}

        {/* No resume */}
        {hasProfile && !hasResume && (
          <div className="popup-alert popup-alert-warning px-3 py-2 text-xs">
            <span className="font-semibold">No resume uploaded.</span> Add one in{" "}
            <a
              href={chrome.runtime.getURL("src/options.html")}
              target="_blank"
              rel="noreferrer"
              className="underline font-medium"
            >
              Settings
            </a>{" "}
            — Phasely will attach it to file-upload fields automatically.
          </div>
        )}

        {/* Profile chip */}
        {hasProfile && profile && (
          <div className="popup-chip flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md">
            <span className="truncate font-semibold popup-chip-name">
              {profile.firstName} {profile.lastName}
            </span>
            <span className="popup-chip-dot">•</span>
            <span className="truncate popup-chip-role">{profile.currentTitle}</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="popup-alert popup-alert-error px-3 py-2 text-xs wrap-break-word">
            {error}
          </div>
        )}

        {/* Fill done */}
        {fillDone && !error && (
          <div className="popup-alert popup-alert-success px-3 py-2 text-xs">
            Fields filled successfully.
          </div>
        )}

        {/* Primary actions */}
        <div className="flex gap-2">
          <button
            onClick={handleFill}
            disabled={!canFill}
            className={[
              "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150 flex items-center justify-center gap-1.5",
              canFill
                ? "popup-btn popup-btn-fill"
                : "popup-btn-disabled cursor-not-allowed",
            ].join(" ")}
          >
            {phase === "filling" ? (
              "Filling…"
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M11.25 1.5a.75.75 0 00-1.37-.16l-6 9A.75.75 0 004.5 11.5h4.71l-1.45 6.54a.75.75 0 001.36.56l6.5-10A.75.75 0 0015 7.5h-4.68l.93-5.25z" />
                </svg>
                Fill
              </>
            )}
          </button>

          <button
            onClick={handleFillAndSubmit}
            disabled={!canFill}
            className={[
              "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150",
              canFill
                ? "popup-btn popup-btn-submit"
                : "popup-btn-disabled cursor-not-allowed",
            ].join(" ")}
          >
            {phase === "submitting" ? "Submitting…" : "Fill & Submit"}
          </button>
        </div>

        {/* Submit only — for when the user has already filled manually */}
        {hasProfile && (
          <button
            onClick={submitApplication}
            disabled={isWorking}
            className={[
              "w-full rounded-md px-3 py-2 text-sm font-medium border transition-all duration-150",
              !isWorking
                ? "popup-btn-secondary"
                : "popup-btn-disabled cursor-not-allowed",
            ].join(" ")}
          >
            {phase === "submitting" ? "Submitting…" : "Submit Application"}
          </button>
        )}

        {/* Generate cover letter — requires profile + Gemini API key + detected job title */}
        {hasProfile && (
          <div className="space-y-1.5">
            <button
              onClick={handleGenerateCoverLetter}
              disabled={!canGenerate}
              title={generateDisabledReason ?? undefined}
              className={[
                "w-full rounded-md px-3 py-2 text-sm font-medium border transition-all duration-150 flex items-center justify-center gap-1.5",
                canGenerate
                  ? "popup-btn-secondary"
                  : "popup-btn-disabled cursor-not-allowed opacity-50",
              ].join(" ")}
            >
              {phase === "generating" ? (
                "Generating…"
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M9.243 3.03a1 1 0 01.727 1.213L9.53 6h2.94l.56-2.243a1 1 0 111.94.486L14.53 6H17a1 1 0 110 2h-2.97l-1 4H15a1 1 0 110 2h-2.47l-.56 2.243a1 1 0 11-1.94-.486L10.47 14H7.53l-.56 2.243a1 1 0 11-1.94-.486L5.47 14H3a1 1 0 110-2h2.97l1-4H5a1 1 0 110-2h2.47l.56-2.243a1 1 0 011.213-.727zM9.03 8l-1 4h2.938l1-4H9.031z" clipRule="evenodd" />
                  </svg>
                  Generate Cover Letter
                </>
              )}
            </button>

            {/* Detected job chip — shown when a title was found */}
            {jobContext?.title && (
              <p className="text-xs text-center truncate popup-chip-role px-1">
                {jobContext.title}{jobContext.company ? ` · ${jobContext.company}` : ""}
              </p>
            )}
          </div>
        )}

        {/* Cover letter result — always shown below the button when text exists */}
        {coverLetterDone && !error && coverLetterText && (
          <CoverLetterResult text={coverLetterText} filled={coverLetterFilled} />
        )}
      </div>
    </div>
  );
}

export default Popup;
