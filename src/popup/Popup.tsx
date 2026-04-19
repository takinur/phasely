/**
 * Popup.tsx — Phasely extension popup
 *
 * Flow:
 *   1. Load profile, resume, and settings from SW on mount
 *   2. Fill sends the profile to the content script via FILL_ALL
 *   3. Fill & Submit triggers FILL_ALL then SUBMIT in sequence
 */

import { useCallback, useEffect, useState } from "react";
import type { ExtensionSettings, Profile, StoredResume } from "@/lib/types";
import logoIcon from "@/assets/logo_phasely.png";

// ---------------------------------------------------------------------------
// Chrome message helpers (typed)
// ---------------------------------------------------------------------------

type MsgPayload =
  | { type: "GET_PROFILE" }
  | { type: "GET_SETTINGS" }
  | { type: "GET_RESUME" }
  | { type: "FILL_ALL"; profile: Profile }
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
// Main component
// ---------------------------------------------------------------------------

type Phase = "idle" | "filling" | "submitting";

export function Popup() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [hasResume, setHasResume] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fillDone, setFillDone] = useState(false);

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
        if (rRes.ok) setHasResume(rRes.resume !== null);
        if (sRes.ok) setSettings(sRes.settings);
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

  const hasProfile = profile !== null;
  const isWorking = phase !== "idle";
  // Fill only requires a profile; resume is optional (file fields are skipped gracefully when absent).
  const canFill = hasProfile && !isWorking;

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
      </div>
    </div>
  );
}

export default Popup;
