/**
 * TrackerSettings.tsx — options-page controls for the application tracker and
 * the knockout submit guard.
 *
 * Props-driven: the parent owns the ExtensionSettings object, persists it via
 * SAVE_SETTINGS, and passes a patch handler down. This component reads nothing
 * from storage itself.
 */

import type { ExtensionSettings } from "@/lib/types";

/** The settings slice this panel edits. */
export type TrackerSettingsSlice = Pick<
  ExtensionSettings,
  "trackApplications" | "followUpDays" | "blockSubmitOnUnconfirmedKnockouts"
>;

export interface TrackerSettingsProps {
  settings: TrackerSettingsSlice;
  /** Called with only the keys that changed. */
  onChange: (patch: Partial<TrackerSettingsSlice>) => void;
  /** Number of records currently in the encrypted log. */
  applicationCount?: number;
  /** Disables the controls while a save is in flight. */
  saving?: boolean;
  /** Omit to hide the CSV export button. */
  onExportCsv?: () => void;
  /** Omit to hide the destructive "clear log" button. */
  onClearApplications?: () => void;
}

const FOLLOW_UP_MIN = 0;
const FOLLOW_UP_MAX = 90;

function Toggle({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-indigo-600 disabled:opacity-50"
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className="block text-sm font-medium text-gray-800">
          {label}
        </label>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
    </div>
  );
}

export default function TrackerSettings({
  settings,
  onChange,
  applicationCount,
  saving,
  onExportCsv,
  onClearApplications,
}: TrackerSettingsProps) {
  const followUpDays = Number.isFinite(settings.followUpDays) ? settings.followUpDays : 7;

  return (
    <section className="options-panel rounded-lg border border-gray-200 p-6 space-y-5">
      <div>
        <h2 className="options-heading text-base font-semibold text-gray-900">
          Tracking &amp; safety
        </h2>
        <p className="options-subheading text-sm text-gray-500 mt-0.5">
          Your application log and knockout guard. Both live on this device, encrypted — nothing
          is uploaded anywhere.
        </p>
      </div>

      <Toggle
        id="phasely-block-knockouts"
        label="Require confirmation for knockout answers"
        description="Work authorization, sponsorship, relocation, salary and similar answers are the only ones that auto-reject an application. With this on, Phasely refuses to submit until you have explicitly checked each one."
        checked={settings.blockSubmitOnUnconfirmedKnockouts}
        disabled={saving}
        onChange={(next) => onChange({ blockSubmitOnUnconfirmedKnockouts: next })}
      />

      {!settings.blockSubmitOnUnconfirmedKnockouts && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Guard off.</span> Phasely will submit knockout answers
          straight from your profile. One wrong work-authorization answer is an instant rejection.
        </div>
      )}

      <hr className="border-gray-100" />

      <Toggle
        id="phasely-track-applications"
        label="Log applications I submit"
        description="Records the company, title, location, URL and how many fields were filled each time you submit through Phasely, so you can spot duplicates and missed follow-ups."
        checked={settings.trackApplications}
        disabled={saving}
        onChange={(next) => onChange({ trackApplications: next })}
      />

      <div className="flex items-start gap-3">
        <div className="space-y-0.5">
          <label
            htmlFor="phasely-follow-up-days"
            className="block text-sm font-medium text-gray-800"
          >
            Follow-up nudge
          </label>
          <p className="text-xs text-gray-500">
            Days after applying before Phasely flags the application for a follow-up. Set 0 to turn
            nudges off.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <input
              id="phasely-follow-up-days"
              type="number"
              min={FOLLOW_UP_MIN}
              max={FOLLOW_UP_MAX}
              step={1}
              value={followUpDays}
              disabled={saving || !settings.trackApplications}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                const next = Number.isNaN(parsed)
                  ? FOLLOW_UP_MIN
                  : Math.min(FOLLOW_UP_MAX, Math.max(FOLLOW_UP_MIN, parsed));
                onChange({ followUpDays: next });
              }}
              className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400"
            />
            <span className="text-xs text-gray-500">days</span>
          </div>
        </div>
      </div>

      {(typeof applicationCount === "number" || onExportCsv || onClearApplications) && (
        <div className="options-inset flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
          {typeof applicationCount === "number" && (
            <span className="text-xs text-gray-600">
              <span className="font-semibold">{applicationCount}</span> application
              {applicationCount === 1 ? "" : "s"} logged on this device
            </span>
          )}

          {onExportCsv && (
            <button
              type="button"
              onClick={onExportCsv}
              disabled={saving || applicationCount === 0}
              className="ml-auto text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:underline disabled:text-gray-300 disabled:no-underline"
            >
              Export CSV
            </button>
          )}

          {onClearApplications && (
            <button
              type="button"
              onClick={onClearApplications}
              disabled={saving || applicationCount === 0}
              className="text-xs font-medium text-red-600 hover:text-red-800 hover:underline disabled:text-gray-300 disabled:no-underline"
            >
              Clear log
            </button>
          )}
        </div>
      )}
    </section>
  );
}
