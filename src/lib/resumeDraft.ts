/**
 * resumeDraft.ts — the seam where local resume parsing plugs in.
 *
 * SCOPE NOTE: resume (PDF/DOCX) text extraction is deliberately NOT implemented
 * in this pass — no parsing dependency has been added. What lives here is the
 * contract the future parser must satisfy, plus the sanitisation it must route
 * through, so wiring it up later is additive rather than a redesign.
 *
 * Non-negotiables for whoever implements it (from CLAUDE.md):
 *   - 100% local. Bundle the parser; never POST the file anywhere.
 *   - A resume is UNTRUSTED input. Every extracted string passes through
 *     sanitizeRawMarkdown before it is shown, stored, or sent to a model.
 *   - The user reviews and corrects the draft before anything is saved. A draft
 *     is a form prefill, never a silent write to chrome.storage.
 */

import {
  detectInjection,
  sanitizeRawMarkdown,
  type ProfileFormValues,
} from "@/lib/profile";

/**
 * A reviewable prefill for the guided setup form.
 *
 * Partial on purpose: a parser should only claim the fields it actually found,
 * so untouched inputs keep whatever the user already typed.
 */
export interface ResumeDraft {
  /** Fields the parser is confident enough to prefill. */
  values: Partial<ProfileFormValues>;
  /** Per-field confidence 0–1, keyed by the same field names as `values`. */
  confidence: Partial<Record<keyof ProfileFormValues, number>>;
  /** Full extracted plain text, sanitised. Becomes the markdown body / AI context. */
  rawText: string;
  /** Injection phrases found in the resume, for a visible warning before save. */
  injectionHits: string[];
  /** Name of the file the draft came from, for the review UI. */
  sourceFilename: string;
}

/** Thrown when a file cannot be read or contains no extractable text. */
export class ResumeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeParseError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Extract a reviewable profile draft from a resume file, entirely in-browser.
 *
 * TODO(phill): implement. Planned shape:
 *   1. Read the File as an ArrayBuffer (no network, no worker fetch).
 *   2. Extract plain text with a bundled parser (pdf.js for PDF, a DOCX
 *      unzip + XML text walk for .docx). Adding that dependency needs sign-off.
 *   3. Heuristically pull name / email / phone / location / links / title /
 *      company / years / skills / education out of the text.
 *   4. Hand the result to sanitizeResumeDraft() — never return unsanitised text.
 *   5. The caller prefills the guided form and lets the user correct it;
 *      nothing is persisted until they press Save.
 *
 * Until then this throws, and the Options page keeps the guided form as the
 * primary path with the resume drop-zone absent rather than broken.
 */
export async function parseResumeToProfileDraft(file: File): Promise<ResumeDraft> {
  throw new ResumeParseError(
    `Resume import is not available yet — fill the guided form instead (${file.name}).`,
  );
}

/**
 * Run an extracted draft through Phasely's untrusted-input filter.
 *
 * Implemented now, even though the parser isn't, so the seam cannot be wired up
 * without sanitisation: every string value and the full raw text are filtered,
 * and injection hits are surfaced for the review UI.
 */
export function sanitizeResumeDraft(
  draft: Omit<ResumeDraft, "injectionHits">,
): ResumeDraft {
  const values: Partial<ProfileFormValues> = {};

  for (const [key, value] of Object.entries(draft.values)) {
    if (typeof value === "string") {
      Object.assign(values, { [key]: sanitizeRawMarkdown(value) });
    } else if (Array.isArray(value)) {
      Object.assign(values, {
        [key]: value.map((row) => ({
          degree: sanitizeRawMarkdown(row.degree),
          institution: sanitizeRawMarkdown(row.institution),
          year: row.year,
        })),
      });
    } else if (typeof value === "boolean") {
      Object.assign(values, { [key]: value });
    }
  }

  const rawText = sanitizeRawMarkdown(draft.rawText);

  return {
    values,
    confidence: draft.confidence,
    rawText,
    injectionHits: detectInjection(draft.rawText),
    sourceFilename: draft.sourceFilename,
  };
}
