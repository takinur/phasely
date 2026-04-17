/**
 * Popup.tsx — Phasely extension popup
 *
 * Responsibilities:
 *   1. Load stored profile from the service worker (GET_PROFILE)
 *   2. Run DETECT_FIELDS on the active tab when user clicks "Fill"
 *   3. Display detected fields grouped by confidence (green ≥ 0.7, amber < 0.7)
 *   4. Fill all high-confidence fields via FILL_ALL
 *   5. Fill individual fields via FILL_ONLY
 *   6. Trigger submit via SUBMIT (with optional confirm dialog)
 *   7. Show job context (title + company) when available
 *
 * All chrome.runtime.sendMessage calls go through the service worker — no
 * direct content-script calls are made from here.
 */

import { useCallback, useEffect, useState } from "react";
import type { DetectedField, ExtensionSettings, JobContext, Profile } from "@/lib/types";
import logoIcon from "@/assets/phasely-icon.svg";

// ---------------------------------------------------------------------------
// Chrome message helpers (typed)
// ---------------------------------------------------------------------------

type MsgPayload =
  | { type: "GET_PROFILE" }
  | { type: "GET_SETTINGS" }
  | { type: "DETECT_FIELDS"; profile?: Profile }
  | { type: "FILL_ALL"; profile: Profile }
  | { type: "FILL_ONLY"; fields: string[]; profile: Profile }
  | { type: "SUBMIT"; settings?: Pick<ExtensionSettings, "confirmBeforeSubmit"> };

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
// Sub-components
// ---------------------------------------------------------------------------

function Badge({ confidence }: { confidence: number }) {
  const isGreen = confidence >= 0.7;
  return (
    <span
      className={[
        "inline-block rounded-full px-2 py-0.5 text-xs font-semibold",
        isGreen
          ? "bg-green-100 text-green-800"
          : "bg-amber-100 text-amber-800",
      ].join(" ")}
    >
      {Math.round(confidence * 100)}%
    </span>
  );
}

function FieldRow({
  field,
  onFillOne,
}: {
  field: DetectedField;
  onFillOne: (key: string) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-100 last:border-0">
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-medium text-gray-700 truncate">{field.profileKey}</span>
        {field.suggestedValue && (
          <span className="text-xs text-gray-400 truncate max-w-[160px]">
            {field.suggestedValue}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Badge confidence={field.confidence} />
        {!field.isAiField && (
          <button
            onClick={() => onFillOne(field.profileKey)}
            className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            Fill
          </button>
        )}
        {field.isAiField && (
          <span className="text-xs text-gray-400 italic">AI</span>
        )}
      </div>
    </li>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={[
        "inline-block w-2 h-2 rounded-full",
        ok ? "bg-green-500" : "bg-red-400",
      ].join(" ")}
    />
  );
}

function normaliseValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function countFilledFields(detected: DetectedField[]): number {
  return detected.filter((field) => {
    if (field.fieldType === "file") {
      return Boolean(field.currentValue.trim());
    }
    const suggested = normaliseValue(field.suggestedValue);
    if (!suggested) return false;
    const current = normaliseValue(field.currentValue);
    return current === suggested;
  }).length;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type Phase = "idle" | "filling" | "submitting";

export function Popup() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [fields, setFields] = useState<DetectedField[] | null>(null);
  const [jobContext, setJobContext] = useState<JobContext | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fillDone, setFillDone] = useState(false);
  const [lastFilledCount, setLastFilledCount] = useState(0);

  // Load profile + settings once on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [pRes, sRes] = await Promise.all([
          sendMsg<{ ok: boolean; profile: Profile | null }>({ type: "GET_PROFILE" }),
          sendMsg<{ ok: boolean; settings: ExtensionSettings }>({ type: "GET_SETTINGS" }),
        ]);
        if (cancelled) return;
        if (pRes.ok) setProfile(pRes.profile);
        if (sRes.ok) setSettings(sRes.settings);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const refreshDetectedState = useCallback(async () => {
    if (!profile) {
      setFields(null);
      setJobContext(null);
      setFillDone(false);
      setLastFilledCount(0);
      return;
    }
    try {
      const detectRes = await sendMsg<{
        ok: boolean;
        fields: DetectedField[];
        jobContext: JobContext | null;
        error?: string;
      }>({ type: "DETECT_FIELDS", profile });
      if (!detectRes.ok) throw new Error(detectRes.error ?? "Detection failed");

      const detected = detectRes.fields ?? [];
      const filledCount = countFilledFields(detected);
      setFields(detected);
      setJobContext(detectRes.jobContext ?? null);
      setFillDone(filledCount > 0);
      setLastFilledCount(filledCount);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [profile]);

  useEffect(() => {
    void refreshDetectedState();
  }, [refreshDetectedState]);

  const detectAndFill = useCallback(async () => {
    if (!profile) return;
    setPhase("filling");
    setError(null);
    setFillDone(false);
    setLastFilledCount(0);
    try {
      const detectRes = await sendMsg<{
        ok: boolean;
        fields: DetectedField[];
        jobContext: JobContext | null;
        error?: string;
      }>({ type: "DETECT_FIELDS", profile });
      if (!detectRes.ok) throw new Error(detectRes.error ?? "Fill failed");

      const detected = detectRes.fields ?? [];
      setFields(detected);
      setJobContext(detectRes.jobContext ?? null);
      if (detected.length === 0) {
        return false;
      }

      const fillRes = await sendMsg<{ ok: boolean; error?: string }>({
        type: "FILL_ALL",
        profile,
      });
      if (!fillRes.ok) throw new Error(fillRes.error ?? "Fill failed");
      const optimistic = detected.map((field) =>
        field.fieldType === "file"
          ? field
          : { ...field, currentValue: field.suggestedValue }
      );
      const filledCount = countFilledFields(optimistic);
      setFillDone(filledCount > 0);
      setLastFilledCount(filledCount);
      setFields(optimistic);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setPhase("idle");
    }
  }, [profile]);

  const handleFill = useCallback(async () => {
    await detectAndFill();
  }, [detectAndFill]);

  const handleFillOne = useCallback(
    async (key: string) => {
      if (!profile) return;
      setError(null);
      try {
        const res = await sendMsg<{ ok: boolean; error?: string }>({
          type: "FILL_ONLY",
          fields: [key],
          profile,
        });
        if (!res.ok) throw new Error(res.error ?? "Fill failed");
      } catch (err) {
        setError(String(err));
      }
    },
    [profile],
  );

  const submitApplication = useCallback(async () => {
    setPhase("submitting");
    setError(null);
    try {
      const res = await sendMsg<{ ok: boolean; error?: string }>({
        type: "SUBMIT",
        settings: {
          confirmBeforeSubmit: settings?.confirmBeforeSubmit ?? true,
        },
      });
      if (!res.ok) throw new Error(res.error ?? "Submit failed");
    } catch (err) {
      setError(String(err));
    } finally {
      setPhase("idle");
    }
  }, [settings]);

  const handleFillAndSubmit = useCallback(async () => {
    const filled = await detectAndFill();
    if (!filled) return;
    await submitApplication();
  }, [detectAndFill, submitApplication]);

  // Split fields into high / low confidence
  const highFields = fields?.filter((f) => f.confidence >= 0.7) ?? [];
  const lowFields = fields?.filter((f) => f.confidence < 0.7) ?? [];

  const hasProfile = profile !== null;
  const isWorking = phase !== "idle";

  return (
    <div className="w-80 min-h-36 bg-white font-sans text-sm flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <img src={logoIcon} alt="Phasely logo" className="w-5 h-5 rounded" />
          <span className="font-bold text-base tracking-tight text-gray-900">Phasely</span>
          <StatusDot ok={hasProfile} />
        </div>
        <a
          href={chrome.runtime.getURL("src/options.html")}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-indigo-500 hover:text-indigo-700 hover:underline"
        >
          Settings
        </a>
      </header>

      <div className="flex flex-col gap-3 p-4 flex-1">
        {/* No profile state */}
        {!hasProfile && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            No profile found. Open{" "}
            <a
              href={chrome.runtime.getURL("src/options.html")}
              target="_blank"
              rel="noreferrer"
              className="underline font-medium"
            >
              Settings
            </a>{" "}
            to import your profile.md.
          </div>
        )}

        {/* Profile summary chip */}
        {hasProfile && profile && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="truncate font-medium text-gray-700">
              {profile.firstName} {profile.lastName}
            </span>
            <span className="text-gray-300">·</span>
            <span className="truncate">{profile.currentTitle}</span>
          </div>
        )}

        {/* Job context */}
        {jobContext && (jobContext.title || jobContext.company) && (
          <div className="rounded-md bg-indigo-50 border border-indigo-100 px-3 py-2 text-xs text-indigo-700">
            <span className="font-semibold">{jobContext.title}</span>
            {jobContext.company && (
              <span className="text-indigo-400"> at {jobContext.company}</span>
            )}
            {jobContext.location && (
              <span className="block text-indigo-400 mt-0.5">{jobContext.location}</span>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 break-words">
            {error}
          </div>
        )}

        {/* Fill done banner */}
        {fillDone && !error && (
          <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
            Filled {lastFilledCount} field{lastFilledCount === 1 ? "" : "s"} successfully.
          </div>
        )}

        {/* Primary actions */}
        <div className="flex gap-2">
          <button
            onClick={handleFill}
            disabled={!hasProfile || isWorking}
            className={[
              "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1.5",
              hasProfile && !isWorking
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "bg-gray-100 text-gray-400 cursor-not-allowed",
            ].join(" ")}
          >
            {phase === "filling" ? (
              "Filling…"
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M11.25 1.5a.75.75 0 00-1.37-.16l-6 9A.75.75 0 004.5 11.5h4.71l-1.45 6.54a.75.75 0 001.36.56l6.5-10A.75.75 0 0015 7.5h-4.68l.93-5.25z" />
                </svg>
                {fillDone ? `Filled (${lastFilledCount})` : "Fill"}
              </>
            )}
          </button>

          <button
            onClick={handleFillAndSubmit}
            disabled={!hasProfile || isWorking}
            className={[
              "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              hasProfile && !isWorking
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-gray-100 text-gray-400 cursor-not-allowed",
            ].join(" ")}
          >
            {phase === "submitting" ? "Submitting…" : "Fill & Submit"}
          </button>
        </div>

        {/* Field list — high confidence */}
        {highFields.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              High confidence ({highFields.length})
            </h2>
            <ul className="rounded-md border border-gray-200 px-3 bg-gray-50">
              {highFields.map((f, i) => (
                <FieldRow key={`high-${i}`} field={f} onFillOne={handleFillOne} />
              ))}
            </ul>
          </section>
        )}

        {/* Field list — amber */}
        {lowFields.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">
              Needs review ({lowFields.length})
            </h2>
            <ul className="rounded-md border border-amber-200 px-3 bg-amber-50">
              {lowFields.map((f, i) => (
                <FieldRow key={`low-${i}`} field={f} onFillOne={handleFillOne} />
              ))}
            </ul>
          </section>
        )}

        {/* No fields found */}
        {fields !== null && fields.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-2">
            No fillable fields detected on this page.
          </p>
        )}

        {/* Submit */}
        {fields !== null && fields.length > 0 && (
          <button
            onClick={submitApplication}
            disabled={isWorking}
            className={[
              "w-full rounded-md px-3 py-2 text-sm font-medium border transition-colors",
              !isWorking
                ? "border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50"
                : "border-gray-200 text-gray-300 cursor-not-allowed",
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
