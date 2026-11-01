/**
 * knockout.ts — knockout-question classification layer.
 *
 * A "knockout" question is one whose answer can auto-reject an application
 * outright: work authorization, sponsorship, location, relocation, travel,
 * shift availability, license, background check, salary. Phasely never answers
 * these on autopilot — the detector flags them, the popup forces an explicit
 * human confirm, and the submitter refuses to fire until they are confirmed.
 *
 * Everything in this file is PURE: no DOM access, no chrome.* access, no
 * network. The content script passes signals in; this module hands a category
 * back. That keeps it unit-testable and safe to import from the service
 * worker, the popup and the content script alike.
 */

import { KNOCKOUT_FIELD_MAP, KNOCKOUT_PROFILE_KEYS } from "@/lib/fieldMap"
import { normalise } from "@/lib/fuzzyMatch"
import type { DetectedField, KnockoutCategory, KnockoutField } from "@/lib/types"

// ---------------------------------------------------------------------------
// Category metadata
// ---------------------------------------------------------------------------

/**
 * Tie-break order, most specific → least specific.
 *
 * When two categories match a label with phrases of equal length, the earlier
 * entry wins. "Will you now or in the future require sponsorship to work in
 * the US?" matches both sponsorship and workAuthorization; sponsorship is the
 * more actionable reading, so it is listed first. `location` is last because
 * its vocabulary is the broadest and most easily triggered.
 */
export const KNOCKOUT_CATEGORY_PRIORITY: readonly KnockoutCategory[] = [
  "sponsorship",
  "workAuthorization",
  "backgroundCheck",
  "license",
  "relocation",
  "travel",
  "shiftAvailability",
  "salary",
  "location",
]

/** Human-readable category names for the confirm UI. */
export const KNOCKOUT_CATEGORY_LABELS: Record<KnockoutCategory, string> = {
  workAuthorization: "Work authorization",
  sponsorship: "Visa sponsorship",
  location: "Location",
  relocation: "Relocation",
  travel: "Travel",
  shiftAvailability: "Shift availability",
  license: "License / clearance",
  backgroundCheck: "Background check",
  salary: "Salary",
}

/**
 * Short explanation of why each category is gated. Shown under the question in
 * the review UI so the user understands the stakes before confirming.
 */
export const KNOCKOUT_CATEGORY_HINTS: Record<KnockoutCategory, string> = {
  workAuthorization: "A wrong answer here is an instant automated rejection.",
  sponsorship: "Sponsorship answers are filtered on before a human ever reads your application.",
  location: "Many postings auto-reject candidates outside the stated region.",
  relocation: "Answering 'no' can disqualify you from an otherwise matching role.",
  travel: "Travel percentage is often a hard requirement screen.",
  shiftAvailability: "Shift and weekend availability is commonly a pass/fail filter.",
  license: "Missing a required license or clearance is a hard disqualifier.",
  backgroundCheck: "Consent and disclosure answers are legally sensitive — read them yourself.",
  salary: "A number outside the band can end the application immediately.",
}

export function knockoutCategoryLabel(category: KnockoutCategory): string {
  return KNOCKOUT_CATEGORY_LABELS[category] ?? category
}

// ---------------------------------------------------------------------------
// Matching internals
// ---------------------------------------------------------------------------

/** Split a raw signal into normalised tokens. */
function tokenise(value: string): string[] {
  const normalised = normalise(value)
  if (normalised.length === 0) return []
  return normalised.split(" ").filter((t) => t.length > 0)
}

/**
 * True when `needle` appears as a consecutive run of tokens inside `haystack`.
 *
 * Token-run matching rather than raw substring matching: "us" must not match
 * inside "thus", and "shift" must not match inside "shifting-gears". Multi-word
 * aliases therefore only fire on real phrase hits.
 */
function containsTokenRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false

  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let matched = true
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        matched = false
        break
      }
    }
    if (matched) return true
  }

  return false
}

/**
 * Strength of the best alias hit for one category against a set of signals,
 * measured in matched tokens. 0 means no hit. Longer phrase hits beat shorter
 * ones, which is what makes "legally authorized to work" (4) outrank a bare
 * "work permit" (2) on the same label.
 */
function categoryStrength(
  tokenisedSignals: string[][],
  category: KnockoutCategory,
): number {
  const aliases = KNOCKOUT_FIELD_MAP[category] ?? []
  let best = 0

  for (const alias of aliases) {
    const aliasTokens = tokenise(alias)
    if (aliasTokens.length <= best) continue // cannot improve on the best hit

    for (const signalTokens of tokenisedSignals) {
      if (containsTokenRun(signalTokens, aliasTokens)) {
        best = aliasTokens.length
        break
      }
    }
  }

  return best
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a detected form field as a knockout question, or `null` when it is
 * an ordinary field.
 *
 * @param signals    Raw text signals for the element — label text, name, id,
 *                   placeholder, aria-label, autocomplete, surrounding text.
 *                   The same array the detector already builds.
 * @param profileKey The canonical profile key the detector matched, e.g.
 *                   "workAuth". Used as a floor: a field that resolved to an
 *                   inherently knockout-bearing profile key is gated even when
 *                   its label text was too unusual to classify.
 *
 * Resolution order:
 *   1. Longest alias phrase hit across all signals wins.
 *   2. Ties break on KNOCKOUT_CATEGORY_PRIORITY.
 *   3. No phrase hit → KNOCKOUT_PROFILE_KEYS floor for the profile key.
 *   4. Otherwise null.
 */
export function classifyKnockout(
  signals: string[],
  profileKey: string,
): KnockoutCategory | null {
  const tokenisedSignals = (Array.isArray(signals) ? signals : [])
    .filter((s): s is string => typeof s === "string")
    .map(tokenise)
    .filter((tokens) => tokens.length > 0)

  if (tokenisedSignals.length > 0) {
    let bestCategory: KnockoutCategory | null = null
    let bestStrength = 0

    // Iterating in priority order means an equal-strength later category never
    // displaces an earlier one, so ties resolve deterministically.
    for (const category of KNOCKOUT_CATEGORY_PRIORITY) {
      const strength = categoryStrength(tokenisedSignals, category)
      if (strength > bestStrength) {
        bestStrength = strength
        bestCategory = category
      }
    }

    if (bestCategory !== null) return bestCategory
  }

  return knockoutCategoryForProfileKey(profileKey)
}

/**
 * The knockout category a canonical profile key inherently implies, or null.
 * Deliberately narrow — see KNOCKOUT_PROFILE_KEYS in fieldMap.ts.
 */
export function knockoutCategoryForProfileKey(
  profileKey: string,
): KnockoutCategory | null {
  if (typeof profileKey !== "string" || profileKey.length === 0) return null
  return KNOCKOUT_PROFILE_KEYS[profileKey] ?? null
}

/** True when the key is inherently knockout-bearing regardless of label text. */
export function isKnockoutProfileKey(profileKey: string): boolean {
  return knockoutCategoryForProfileKey(profileKey) !== null
}

/**
 * Knockout fields are force-flagged for review regardless of match score — a
 * 1.0-confidence match on a work-auth question still needs a human to look at
 * it. Callers use this instead of comparing `confidence` to a threshold.
 */
export function requiresManualReview(
  field: Pick<DetectedField, "profileKey"> & Partial<Pick<DetectedField, "isKnockout" | "confidence">>,
  greenThreshold = 0.75,
): boolean {
  if (field.isKnockout === true) return true
  if (isKnockoutProfileKey(field.profileKey)) return true
  return (field.confidence ?? 0) < greenThreshold
}

// ---------------------------------------------------------------------------
// KnockoutField construction / gating
// ---------------------------------------------------------------------------

/**
 * Minimal input needed to build a KnockoutField. Structurally satisfied by a
 * DetectedField and by the serialised field summaries the popup receives over
 * the message boundary (which drop the DOM `element` reference).
 */
export type KnockoutSource = Pick<DetectedField, "profileKey" | "suggestedValue"> &
  Partial<Pick<DetectedField, "isKnockout" | "knockoutCategory">> & {
    /** Question text as it appears on the page, when the caller has it. */
    question?: string
  }

/** Stable identity for a knockout field: category + profile key. */
export function knockoutFieldId(
  field: Pick<KnockoutField, "profileKey" | "category">,
): string {
  return `${field.category}:${field.profileKey}`
}

/**
 * Turn detected fields into the KnockoutField[] the review UI and the submit
 * gate work with. Non-knockout fields are dropped; duplicates collapse on
 * `knockoutFieldId` (the same work-auth question often appears as a radio
 * group, i.e. several elements, one question).
 *
 * Every returned field starts `confirmed: false` — confirmation is always an
 * explicit human act, never inherited from a previous page or a high score.
 */
export function buildKnockoutFields(sources: KnockoutSource[]): KnockoutField[] {
  const byId = new Map<string, KnockoutField>()

  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source || typeof source.profileKey !== "string") continue

    const category =
      source.knockoutCategory ??
      (source.isKnockout === true
        ? classifyKnockout([source.question ?? ""], source.profileKey)
        : knockoutCategoryForProfileKey(source.profileKey))

    if (category === null) continue

    const field: KnockoutField = {
      profileKey: source.profileKey,
      category,
      question: (source.question ?? "").trim() || knockoutCategoryLabel(category),
      suggestedValue: source.suggestedValue ?? "",
      confirmed: false,
    }

    const id = knockoutFieldId(field)
    const existing = byId.get(id)

    // Prefer the entry with a real question string over a category-label stub.
    if (!existing || (existing.question === knockoutCategoryLabel(category) && field.question !== existing.question)) {
      byId.set(id, field)
    }
  }

  return [...byId.values()]
}

/** The knockout fields still awaiting an explicit human confirm. */
export function unconfirmedKnockouts(fields: KnockoutField[]): KnockoutField[] {
  return (Array.isArray(fields) ? fields : []).filter((f) => f?.confirmed !== true)
}

/**
 * Deduped categories that still need review, ordered by KNOCKOUT_CATEGORY_PRIORITY
 * so the blocking message reads consistently every time.
 */
export function unconfirmedKnockoutCategories(
  fields: KnockoutField[],
): KnockoutCategory[] {
  const pending = new Set(unconfirmedKnockouts(fields).map((f) => f.category))
  return KNOCKOUT_CATEGORY_PRIORITY.filter((c) => pending.has(c))
}

/**
 * Message naming the categories that need review, for the submit refusal.
 */
export function describeKnockoutBlock(categories: KnockoutCategory[]): string {
  if (categories.length === 0) return ""

  const names = categories.map(knockoutCategoryLabel)
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  const noun = categories.length === 1 ? "answer" : "answers"

  return `Submit blocked: confirm your ${list} ${noun} first. A wrong knockout answer auto-rejects the application.`
}

// ---------------------------------------------------------------------------
// Submit gate
// ---------------------------------------------------------------------------

export interface KnockoutGateResult {
  /** True when submit must not proceed. */
  blocked: boolean
  /** Categories awaiting confirmation (empty when not blocked). */
  categories: KnockoutCategory[]
  /** Human-readable refusal, or "" when not blocked. */
  message: string
}

/**
 * Decide whether submit may proceed.
 *
 * `blockSubmitOnUnconfirmedKnockouts` defaults to TRUE when undefined: an
 * older install whose stored settings predate the toggle, or a caller that
 * forgot to pass it, must fail safe rather than submit blind.
 */
export function evaluateKnockoutGate(
  settings: { blockSubmitOnUnconfirmedKnockouts?: boolean } | null | undefined,
  knockouts: KnockoutField[] | null | undefined,
): KnockoutGateResult {
  const blocking = settings?.blockSubmitOnUnconfirmedKnockouts ?? true
  if (!blocking) return { blocked: false, categories: [], message: "" }

  const categories = unconfirmedKnockoutCategories(knockouts ?? [])
  if (categories.length === 0) return { blocked: false, categories: [], message: "" }

  return { blocked: true, categories, message: describeKnockoutBlock(categories) }
}
