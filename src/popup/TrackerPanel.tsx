/**
 * TrackerPanel.tsx — local application log, rendered in the popup.
 *
 * Shows what you applied to, when, where it stands, and whether this page
 * duplicates something you already filed. Entirely props-driven: the parent
 * owns the records (they arrive from the SW via GET_APPLICATIONS) and performs
 * every mutation through the callbacks here.
 *
 * The log is stored AES-GCM encrypted on this device only — nothing in this
 * component talks to the network.
 */

import { useState } from "react";

import type { DuplicateMatch } from "@/lib/tracker";
import type { ApplicationRecord, ApplicationStatus } from "@/lib/types";

export interface TrackerPanelProps {
  /** Records to show, newest first (the SW already sorts them). */
  applications: ApplicationRecord[];
  /** Matches against the job in the active tab, to warn before re-applying. */
  duplicates?: DuplicateMatch[];
  /** Pre-rendered duplicate sentence from `describeDuplicates`. */
  duplicateWarning?: string;
  loading?: boolean;
  error?: string | null;
  /** How many follow-ups are due now (SW returns this with GET_APPLICATIONS). */
  dueCount?: number;
  onChangeStatus: (id: string, status: ApplicationStatus) => void;
  onDelete: (id: string) => void;
  /** Omit to hide the refresh control. */
  onRefresh?: () => void;
  /** Omit to render the job title as plain text instead of a link. */
  onOpenUrl?: (url: string) => void;
  /** Rows rendered before the list scrolls. Default 6. */
  maxVisible?: number;
  /** "Now" for follow-up comparisons. Defaults to mount time; pass it to keep
   *  the panel deterministic (tests, or a parent that already ticks a clock). */
  now?: number;
}

const STATUS_OPTIONS: ReadonlyArray<{ value: ApplicationStatus; label: string }> = [
  { value: "applied", label: "Applied" },
  { value: "screening", label: "Screening" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "ghosted", label: "Ghosted" },
];

const STATUS_CLASSES: Record<ApplicationStatus, string> = {
  applied: "bg-blue-50 text-blue-700 border-blue-200",
  screening: "bg-indigo-50 text-indigo-700 border-indigo-200",
  interview: "bg-violet-50 text-violet-700 border-violet-200",
  offer: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  withdrawn: "bg-gray-50 text-gray-600 border-gray-200",
  ghosted: "bg-amber-50 text-amber-700 border-amber-200",
};

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

/** "3d ago" style age, used for the follow-up hint. */
function daysSince(ms: number, now: number): number {
  return Math.max(0, Math.floor((now - ms) / 86_400_000));
}

function TrashIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8.5 2h3a1 1 0 011 1v1h3a.75.75 0 010 1.5h-.6l-.7 9.6A2 2 0 0112.2 17H7.8a2 2 0 01-2-1.9L5.1 5.5h-.6a.75.75 0 010-1.5h3V3a1 1 0 011-1zm-.9 5a.6.6 0 00-.6.65l.4 6.5a.6.6 0 101.2-.08l-.4-6.5A.6.6 0 007.6 7zm4.8 0a.6.6 0 00-.6.57l-.4 6.5a.6.6 0 101.2.08l.4-6.5a.6.6 0 00-.6-.65z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ApplicationRow({
  record,
  now,
  isDuplicate,
  onChangeStatus,
  onDelete,
  onOpenUrl,
}: {
  record: ApplicationRecord;
  now: number;
  isDuplicate: boolean;
  onChangeStatus: TrackerPanelProps["onChangeStatus"];
  onDelete: TrackerPanelProps["onDelete"];
  onOpenUrl?: TrackerPanelProps["onOpenUrl"];
}) {
  const followUpDue = record.followUpAt !== null && record.followUpAt <= now;
  const title = record.title || "Untitled role";
  const company = record.company || "Unknown company";

  return (
    <li className="px-2.5 py-2 space-y-1">
      <div className="flex items-center gap-2">
        {onOpenUrl && record.url ? (
          <button
            type="button"
            onClick={() => onOpenUrl(record.url)}
            title={record.url}
            className="truncate text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            {title}
          </button>
        ) : (
          <span className="truncate text-xs font-medium text-gray-800" title={title}>
            {title}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[11px] text-gray-400">
          {formatDate(record.appliedAt)}
        </span>
        <button
          type="button"
          onClick={() => onDelete(record.id)}
          aria-label={`Delete ${title} at ${company}`}
          className="shrink-0 text-gray-300 hover:text-red-500"
        >
          <TrashIcon />
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span className="truncate" title={company}>
          {company}
        </span>
        {record.location && (
          <>
            <span className="text-gray-300">·</span>
            <span className="truncate">{record.location}</span>
          </>
        )}
        {record.fieldsFilled > 0 && (
          <>
            <span className="text-gray-300">·</span>
            <span>{record.fieldsFilled} fields</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <select
          value={record.status}
          onChange={(e) => onChangeStatus(record.id, e.target.value as ApplicationStatus)}
          aria-label={`Status for ${title}`}
          className={[
            "rounded border px-1.5 py-0.5 text-[11px] font-medium focus:outline-none focus:ring-1 focus:ring-indigo-400",
            STATUS_CLASSES[record.status],
          ].join(" ")}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {isDuplicate && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
            Same job
          </span>
        )}

        {followUpDue && (
          <span className="ml-auto text-[11px] font-medium text-amber-700">
            Follow up · {daysSince(record.appliedAt, now)}d old
          </span>
        )}
      </div>
    </li>
  );
}

export default function TrackerPanel({
  applications,
  duplicates,
  duplicateWarning,
  loading,
  error,
  dueCount,
  onChangeStatus,
  onDelete,
  onRefresh,
  onOpenUrl,
  maxVisible = 6,
  now: nowProp,
}: TrackerPanelProps) {
  // Frozen at mount: a popup lives for seconds, and re-reading the clock on
  // every render would make the rendered output non-idempotent.
  const [mountedAt] = useState(() => Date.now());
  const now = nowProp ?? mountedAt;
  const records = Array.isArray(applications) ? applications : [];
  const duplicateIds = new Set((duplicates ?? []).map((d) => d.record.id));
  const due = dueCount ?? records.filter((r) => r.followUpAt !== null && r.followUpAt <= now).length;

  // ~54px per row — cap the visible height so the popup never grows unbounded.
  const listHeightClass = records.length > maxVisible ? "max-h-56 overflow-y-auto" : "";

  return (
    <section className="rounded-md border border-gray-200 bg-white" aria-label="Application tracker">
      <header className="flex items-center gap-2 rounded-t-md bg-gray-50 px-2.5 py-2 text-xs">
        <span className="font-medium text-gray-700">Applications</span>
        <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
          {records.length}
        </span>
        {due > 0 && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
            {due} to follow up
          </span>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="ml-auto text-[11px] font-medium text-indigo-600 hover:text-indigo-800 disabled:text-gray-300"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        )}
      </header>

      {duplicateWarning && (
        <p className="border-t border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          {duplicateWarning}
        </p>
      )}

      {error && (
        <p className="border-t border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700 wrap-break-word">
          {error}
        </p>
      )}

      {records.length === 0 ? (
        <p className="border-t border-gray-100 px-2.5 py-3 text-[11px] text-gray-500">
          {loading
            ? "Loading your application log…"
            : "No applications logged yet. Submitting through Phasely records them here — on this device, encrypted."}
        </p>
      ) : (
        <ul className={["divide-y divide-gray-100 border-t border-gray-100", listHeightClass].join(" ")}>
          {records.map((record) => (
            <ApplicationRow
              key={record.id}
              record={record}
              now={now}
              isDuplicate={duplicateIds.has(record.id)}
              onChangeStatus={onChangeStatus}
              onDelete={onDelete}
              onOpenUrl={onOpenUrl}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
