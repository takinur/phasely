/**
 * MarkdownAdvanced.tsx — the advanced (power-user) profile path.
 *
 * Markdown is no longer how you set Phasely up; it is how you bulk-edit, import
 * from somewhere else, or export what you have. The textarea is generated from
 * the guided form's current values and can be applied straight back into it,
 * so the two views never drift apart.
 */

import { useEffect, useState } from "react";
import { detectInjection, parseProfile, ProfileParseError } from "@/lib/profile";
import { Alert } from "./Primitives";

export function MarkdownAdvanced({
  markdown,
  onMarkdownChange,
  onApplyToForm,
  applyErrors,
  onSave,
  onExport,
  canExport,
  saving,
}: {
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  /** Parse the markdown and push it back into the guided form. */
  onApplyToForm: () => void;
  /** Parse failures from the last apply/save attempt. */
  applyErrors: string[] | null;
  onSave: () => void;
  onExport: () => void;
  canExport: boolean;
  saving: boolean;
}) {
  const injectionHits = detectInjection(markdown);

  return (
    <div className="space-y-3">
      <Alert type="info">
        Advanced view. Edits here are applied back to the form — the guided form
        stays the source of truth for everything Phasely fills.
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <label className="options-btn-secondary cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium transition-colors">
          Import .md file
          <input
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                onMarkdownChange(await file.text());
              } catch (err) {
                console.error("[Phasely] failed to read markdown file:", err);
              }
            }}
          />
        </label>
        {canExport && (
          <button
            type="button"
            onClick={onExport}
            className="options-btn-secondary rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
          >
            Export .md
          </button>
        )}
      </div>

      <textarea
        value={markdown}
        onChange={(e) => onMarkdownChange(e.target.value)}
        spellCheck={false}
        rows={18}
        aria-label="Profile markdown"
        className={[
          "options-input w-full rounded-md border px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:border-transparent resize-y",
          injectionHits.length > 0
            ? "border-amber-400 focus:ring-amber-400"
            : "border-gray-300 focus:ring-indigo-500",
        ].join(" ")}
      />

      {injectionHits.length > 0 && (
        <Alert type="warning">
          <span className="font-semibold">Suspicious content detected.</span> These
          phrases look like AI prompt instructions and are stripped before saving:{" "}
          <span className="font-mono">{injectionHits.map((h) => `"${h}"`).join(", ")}</span>
        </Alert>
      )}

      <MarkdownValidator markdown={markdown} />

      {applyErrors && applyErrors.length > 0 && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 space-y-1">
          <p className="font-semibold">Fix these before applying:</p>
          <ul className="ml-3 list-disc space-y-0.5">
            {applyErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !markdown.trim()}
          className={[
            "options-btn-primary rounded-md px-4 py-2 text-sm font-medium transition-colors",
            saving || !markdown.trim() ? "opacity-50 cursor-not-allowed" : "",
          ].join(" ")}
        >
          {saving ? "Saving…" : "Save markdown"}
        </button>
        <button
          type="button"
          onClick={onApplyToForm}
          className="options-btn-secondary rounded-md border px-3 py-2 text-sm font-medium transition-colors"
        >
          Apply to form
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live validator — unchanged behaviour from the old paste-only flow
// ---------------------------------------------------------------------------

type ValidationState =
  | { status: "idle" }
  | {
      status: "valid";
      firstName: string;
      lastName: string;
      email: string;
      skillsCount: number;
      educationCount: number;
    }
  | { status: "invalid"; errors: string[] };

/**
 * Parses the textarea content (debounced 400 ms) and shows either a green
 * summary or the specific errors, so problems surface before Save.
 */
function MarkdownValidator({ markdown }: { markdown: string }) {
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
        setState({
          status: "invalid",
          errors: err instanceof ProfileParseError ? err.fields : [String(err)],
        });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [markdown]);

  if (state.status === "idle") return null;

  if (state.status === "valid") {
    return (
      <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800 flex items-center gap-2">
        <svg
          className="w-3.5 h-3.5 shrink-0 text-green-600"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
        <span>
          <span className="font-semibold">
            {state.firstName} {state.lastName}
          </span>
          {" · "}
          {state.email}
          {state.skillsCount > 0 && (
            <span className="text-green-600">
              {" · "}
              {state.skillsCount} skill{state.skillsCount !== 1 ? "s" : ""}
            </span>
          )}
          {state.educationCount > 0 && (
            <span className="text-green-600">
              {" · "}
              {state.educationCount} education entr{state.educationCount !== 1 ? "ies" : "y"}
            </span>
          )}
        </span>
      </div>
    );
  }

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
