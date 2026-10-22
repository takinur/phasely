/**
 * GhostJobBanner.tsx — surfaces the local ghost-job assessment in the popup.
 *
 * Presentation rules, in priority order:
 *   - Nothing readable on the page (checked === 0) → render nothing. Silence
 *     beats a fake all-clear.
 *   - Clean sweep → one quiet reassurance line, so the check is visibly running.
 *   - Findings → a collapsible card, colour-keyed to the band, listing what we
 *     actually saw. High-risk opens expanded; anything lower stays folded.
 *
 * The copy deliberately never asserts a listing is fake. Published estimates of
 * how common ghost jobs are disagree by a factor of three, so this is framed as
 * "worth a look before you spend six minutes on the form".
 */

import { useState } from "react";
import { GHOST_SIGNAL_COUNT } from "@/lib/ghostScore";
import type { GhostJobAssessment } from "@/lib/types";

interface GhostJobBannerProps {
  assessment: GhostJobAssessment | null;
}

type BandStyle = {
  wrapper: string;
  heading: string;
  dot: string;
  title: string;
};

const BAND_STYLES: Record<GhostJobAssessment["band"], BandStyle> = {
  high: {
    wrapper: "border-red-200 bg-red-50",
    heading: "text-red-800",
    dot: "bg-red-500",
    title: "Several signs this may not be a live opening",
  },
  medium: {
    wrapper: "border-amber-200 bg-amber-50",
    heading: "text-amber-800",
    dot: "bg-amber-500",
    title: "Worth checking before you apply",
  },
  low: {
    wrapper: "border-gray-200 bg-gray-50",
    heading: "text-gray-700",
    dot: "bg-gray-400",
    title: "Minor things worth noting",
  },
};

export function GhostJobBanner({ assessment }: GhostJobBannerProps) {
  // Expanded by default only when the finding is serious enough to read now.
  const [open, setOpen] = useState(assessment?.band === "high");

  // No job page we could read — say nothing rather than imply an all-clear.
  if (assessment === null || assessment.checked === 0) return null;

  const { band, signals, checked, score } = assessment;

  // Fewer than half the checks could run, so the result is weak either way.
  const lowCoverage = checked < Math.ceil(GHOST_SIGNAL_COUNT / 2);

  if (signals.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-2.5 py-2 text-xs text-green-800">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500 shrink-0" />
        <span>
          No ghost-listing signs found
          <span className="text-green-700/70"> · {checked} checks run</span>
        </span>
      </div>
    );
  }

  const style = BAND_STYLES[band];

  return (
    <div className={["rounded-md border", style.wrapper].join(" ")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-left"
      >
        <span
          className={["inline-block w-2 h-2 rounded-full shrink-0", style.dot].join(" ")}
        />
        <span className={["font-medium", style.heading].join(" ")}>{style.title}</span>
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className={["tabular-nums", style.heading].join(" ")}>
            {signals.length}
          </span>
          <svg
            className={[
              "w-3.5 h-3.5 text-gray-400 transition-transform",
              open ? "rotate-180" : "",
            ].join(" ")}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.19l3.71-3.96a.75.75 0 111.08 1.04l-4.25 4.53a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>

      {open && (
        <ul className="border-t border-black/5 divide-y divide-black/5">
          {signals.map((signal) => (
            <li key={signal.id} className="px-2.5 py-1.5 text-xs">
              <div className="font-medium text-gray-800">{signal.label}</div>
              <div className="text-gray-500 mt-0.5 wrap-break-word">{signal.detail}</div>
            </li>
          ))}
          <li className="px-2.5 py-1.5 text-[11px] text-gray-500 leading-relaxed">
            Scored on this page only — nothing was sent anywhere.
            {" "}
            {checked} of {GHOST_SIGNAL_COUNT} checks ran
            {lowCoverage ? ", so treat this as a weak read" : ""}
            {" · risk "}
            {Math.round(score * 100)}%
          </li>
        </ul>
      )}
    </div>
  );
}

export default GhostJobBanner;
