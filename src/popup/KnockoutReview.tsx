/**
 * KnockoutReview.tsx — explicit confirmation UI for knockout questions.
 *
 * Knockout answers (work authorization, sponsorship, relocation, …) are the
 * only ones that can auto-reject an application outright, so Phasely never
 * fires them on autopilot: every one shown here needs a human tick before
 * submit is allowed, no matter how confident the match was.
 *
 * Fully props-driven and stateless — it fetches nothing and owns no state.
 * The parent holds the KnockoutField[] (including `confirmed`) and passes
 * updates back down.
 */

import {
  KNOCKOUT_CATEGORY_HINTS,
  knockoutCategoryLabel,
  knockoutFieldId,
  unconfirmedKnockouts,
} from "@/lib/knockout";
import type { KnockoutField } from "@/lib/types";

export interface KnockoutReviewProps {
  /** Knockout fields detected on the page, with their confirmation state. */
  fields: KnockoutField[];
  /** Called when the user ticks / unticks one field. */
  onToggleConfirm: (field: KnockoutField, confirmed: boolean) => void;
  /** Called by the "Confirm all" shortcut. Omit to hide that button. */
  onConfirmAll?: () => void;
  /**
   * Called when the user edits an answer before confirming. Omit to render
   * the suggested value as read-only text.
   */
  onEditValue?: (field: KnockoutField, value: string) => void;
  /** Submit is currently blocked by the guard — shown as a footer note. */
  blocked?: boolean;
  /** Message from the guard explaining the block. */
  blockMessage?: string;
}

function ShieldIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 1.5l6 2.2v5.1c0 3.9-2.5 7.4-6 8.7-3.5-1.3-6-4.8-6-8.7V3.7l6-2.2zm0 4.3a.9.9 0 00-.9.9v3.1a.9.9 0 001.8 0V6.7a.9.9 0 00-.9-.9zm0 7.8a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function KnockoutRow({
  field,
  onToggleConfirm,
  onEditValue,
}: {
  field: KnockoutField;
  onToggleConfirm: KnockoutReviewProps["onToggleConfirm"];
  onEditValue?: KnockoutReviewProps["onEditValue"];
}) {
  const confirmed = field.confirmed === true;

  return (
    <li
      className={[
        "px-2.5 py-2 space-y-1.5 border-l-2",
        confirmed ? "border-l-green-500 bg-green-50/40" : "border-l-amber-500",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <span
          className={[
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            confirmed ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800",
          ].join(" ")}
        >
          {knockoutCategoryLabel(field.category)}
        </span>
        <p className="text-xs leading-snug text-gray-700 wrap-break-word">{field.question}</p>
      </div>

      <p className="text-[11px] leading-snug text-gray-500">
        {KNOCKOUT_CATEGORY_HINTS[field.category]}
      </p>

      {onEditValue ? (
        <input
          type="text"
          value={field.suggestedValue}
          onChange={(e) => onEditValue(field, e.target.value)}
          placeholder="Your answer"
          aria-label={`Answer for ${knockoutCategoryLabel(field.category)}`}
          className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      ) : (
        <p className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 wrap-break-word">
          {field.suggestedValue || <span className="text-gray-400">No value in profile</span>}
        </p>
      )}

      <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onToggleConfirm(field, e.target.checked)}
          className="h-3.5 w-3.5 rounded border-gray-300 accent-green-600"
        />
        {confirmed ? (
          <span className="inline-flex items-center gap-1 text-green-700">
            <CheckIcon />
            Confirmed
          </span>
        ) : (
          <span className="text-amber-700">I&apos;ve checked this answer</span>
        )}
      </label>
    </li>
  );
}

export default function KnockoutReview({
  fields,
  onToggleConfirm,
  onConfirmAll,
  onEditValue,
  blocked,
  blockMessage,
}: KnockoutReviewProps) {
  // Nothing to gate — render nothing rather than an empty panel.
  if (!Array.isArray(fields) || fields.length === 0) return null;

  const pending = unconfirmedKnockouts(fields).length;

  return (
    <section
      className={[
        "rounded-md border bg-white",
        pending > 0 ? "border-amber-300" : "border-green-300",
      ].join(" ")}
      aria-label="Knockout answers to review"
    >
      <header
        className={[
          "flex items-center gap-2 rounded-t-md px-2.5 py-2 text-xs font-semibold",
          pending > 0 ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-800",
        ].join(" ")}
      >
        <ShieldIcon />
        <span>
          {pending > 0
            ? `${pending} knockout answer${pending === 1 ? "" : "s"} need${pending === 1 ? "s" : ""} review`
            : "Knockout answers confirmed"}
        </span>
        {pending > 0 && onConfirmAll && (
          <button
            type="button"
            onClick={onConfirmAll}
            className="ml-auto text-[11px] font-medium text-amber-700 underline hover:text-amber-900"
          >
            Confirm all
          </button>
        )}
      </header>

      <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto border-t border-gray-100">
        {fields.map((field) => (
          <KnockoutRow
            key={knockoutFieldId(field)}
            field={field}
            onToggleConfirm={onToggleConfirm}
            onEditValue={onEditValue}
          />
        ))}
      </ul>

      {blocked && (
        <p className="rounded-b-md border-t border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          {blockMessage ?? "Submit is blocked until every knockout answer is confirmed."}
        </p>
      )}
    </section>
  );
}
