/**
 * ghostScore.ts — heuristic scoring for low-intent ("ghost") job listings.
 *
 * Why this exists: independent studies put ghost listings somewhere between
 * 1 in 7 and 1 in 3 of all postings, and 86% of surveyed job seekers report
 * hitting one. Seekers already defend against this by hand — checking the
 * original post date, verifying on the employer's own careers site, skipping
 * repeat reposts. Phasely can run that check automatically, in the page,
 * before the user spends six minutes filling the form.
 *
 * Deliberate design choices:
 *   - Pure function over an evidence object. No DOM access here, so scoring is
 *     deterministic and unit-testable; DOM collection lives in
 *     src/content/ghostSignals.ts.
 *   - Fully local. No network calls, no third-party scoring API — the same
 *     constraint as the rest of the extension.
 *   - Signals that cannot be evaluated on a given page are excluded from the
 *     denominator rather than counted as passes, so a sparse page yields a
 *     low-confidence assessment instead of a falsely clean one.
 *   - The output is a risk signal, never a verdict. Published research
 *     disagrees by a factor of three on how common ghost jobs are, so the UI
 *     presents this as "worth checking", not "this job is fake".
 */

import type {
  GhostEvidence,
  GhostJobAssessment,
  GhostSignal,
  GhostSignalId,
} from "@/lib/types"

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** A posting older than this (days) is treated as stale. */
const STALE_DAYS = 45

/** Descriptions shorter than this (chars) read as vague rather than brief. */
const VAGUE_DESCRIPTION_CHARS = 600

/** Applicant count above which a still-open posting looks like a funnel. */
const HIGH_APPLICANT_COUNT = 500

/** Score thresholds for the three bands. */
const BAND_MEDIUM = 0.25
const BAND_HIGH = 0.55

const DAY_MS = 86_400_000

// ---------------------------------------------------------------------------
// Signal definitions
// ---------------------------------------------------------------------------

interface SignalDef {
  id: GhostSignalId
  label: string
  weight: number
  /**
   * Minimum composite this signal justifies on its own, when set.
   *
   * A plain weighted average under-reports near-conclusive findings: a posting
   * that calls itself a "talent community" is a pipeline posting whatever the
   * other nine signals say, but on a page that is otherwise tidy the average
   * dilutes it into the low band. A floor lets a decisive signal carry the
   * score by itself without inflating the weights of the ordinary ones.
   */
  floor?: number
  /**
   * True when the page carries enough information to judge this signal at all.
   * Signals that return false are left out of numerator and denominator both.
   */
  evaluable: (e: GhostEvidence) => boolean
  /** Returns the observed detail when the signal fires, else null. */
  test: (e: GhostEvidence) => string | null
}

/** Case-insensitive phrase search returning the matched phrase, else null. */
function firstPhrase(haystack: string, phrases: string[]): string | null {
  const lower = haystack.toLowerCase()
  for (const phrase of phrases) {
    if (lower.includes(phrase)) return phrase
  }
  return null
}

/** Count how many of `phrases` appear in an already-lowercased string. */
function countPhrases(lowerText: string, phrases: string[]): number {
  return phrases.filter((p) => lowerText.includes(p)).length
}

const SALARY_PATTERNS: RegExp[] = [
  // $120,000 - $150,000 / £45k–£60k
  /[$£€]\s?\d{2,3}[,.]?\d{0,3}\s?k?\s*(?:-|–|to)\s*[$£€]?\s?\d{2,3}[,.]?\d{0,3}\s?k?/i,
  // 120000 - 150000 USD / per year
  /\d{2,3}[,.]?\d{3}\s*(?:-|–|to)\s*\d{2,3}[,.]?\d{3}\s*(?:usd|gbp|eur|per\s+(?:year|annum)|\/\s?(?:yr|year))/i,
  // $55 - $70 per hour
  /[$£€]\s?\d{1,3}(?:\.\d{2})?\s*(?:-|–|to)\s*[$£€]?\s?\d{1,3}(?:\.\d{2})?\s*(?:\/|per\s+)h(?:ou)?r/i,
  // Explicit range labels
  /(?:salary|pay|compensation|base)\s*(?:range|band)\s*[:\-–]/i,
]

const SIGNALS: SignalDef[] = [
  {
    id: "evergreenRequisition",
    label: "Posted as a talent pipeline, not a live opening",
    weight: 1.0,
    // Self-described pipeline postings are the clearest case there is.
    floor: 0.6,
    evaluable: (e) => e.descriptionText.length > 0 || e.title.length > 0,
    test: (e) => {
      const match = firstPhrase(`${e.title} ${e.descriptionText}`, [
        "evergreen",
        "talent community",
        "talent pipeline",
        "talent pool",
        "general application",
        "general interest",
        "future opportunities",
        "future openings",
        "speculative application",
        "expression of interest",
        "join our network",
        "keep your resume on file",
      ])
      return match ? `Listing describes itself as a "${match}"` : null
    },
  },
  {
    id: "alwaysHiringLanguage",
    label: 'Open-ended "always hiring" wording',
    weight: 0.9,
    floor: 0.45,
    evaluable: (e) => e.descriptionText.length > 0,
    test: (e) => {
      const match = firstPhrase(e.descriptionText, [
        "always hiring",
        "always looking for",
        "always on the lookout",
        "ongoing recruitment",
        "continuous recruitment",
        "we hire year round",
        "year-round hiring",
        "no specific start date",
      ])
      return match ? `Description says "${match}"` : null
    },
  },
  {
    id: "stalePosting",
    label: `Posted more than ${STALE_DAYS} days ago`,
    weight: 0.8,
    floor: 0.3,
    evaluable: (e) => e.datePosted !== null,
    test: (e) => {
      if (e.datePosted === null) return null
      const days = Math.floor((e.now - e.datePosted) / DAY_MS)
      if (days < STALE_DAYS) return null
      return `First posted ${days} days ago and still open`
    },
  },
  {
    id: "repostedListing",
    label: "Listing has been reposted",
    weight: 0.8,
    floor: 0.3,
    evaluable: (e) => e.metaText.length > 0 || e.descriptionText.length > 0,
    test: (e) => {
      const match = firstPhrase(`${e.metaText} ${e.descriptionText}`, [
        "reposted",
        "re-posted",
        "originally posted",
      ])
      return match ? `Page states the role was "${match}"` : null
    },
  },
  {
    id: "missingCompanyIdentity",
    label: "No hiring company named",
    weight: 0.6,
    // Only judge this where there was a real job page to read in the first place.
    evaluable: (e) => e.descriptionText.length > 0 || e.title.length > 0,
    test: (e) =>
      e.company.trim().length === 0
        ? "Posting does not name the employer anywhere we could read"
        : null,
  },
  {
    id: "vagueDescription",
    label: "Description too thin to describe a real role",
    weight: 0.6,
    // A page with no description at all is a scrape failure, not evidence.
    evaluable: (e) => e.descriptionText.length > 0,
    test: (e) =>
      e.descriptionText.length < VAGUE_DESCRIPTION_CHARS
        ? `Description is only ${e.descriptionText.length} characters`
        : null,
  },
  {
    id: "staffingAgencyPost",
    label: "Posted by an agency on behalf of an unnamed client",
    weight: 0.5,
    evaluable: (e) => e.descriptionText.length > 0,
    test: (e) => {
      const match = firstPhrase(e.descriptionText, [
        "our client",
        "on behalf of our client",
        "a leading client",
        "staffing agency",
        "recruitment agency",
        "recruiting partner",
        "client is seeking",
      ])
      return match
        ? `Description refers to "${match}" rather than the employer`
        : null
    },
  },
  {
    id: "highApplicantCount",
    label: "Very high applicant count, still accepting more",
    weight: 0.5,
    evaluable: (e) => e.applicantCount !== null,
    test: (e) => {
      if (e.applicantCount === null) return null
      if (e.applicantCount < HIGH_APPLICANT_COUNT) return null
      return `${e.applicantCount.toLocaleString()} applicants already`
    },
  },
  {
    id: "noSalaryRange",
    label: "No pay range given",
    weight: 0.4,
    evaluable: (e) => e.descriptionText.length > 0 || e.hasStructuredSalary,
    test: (e) => {
      if (e.hasStructuredSalary) return null
      const hasRange = SALARY_PATTERNS.some((p) => p.test(e.descriptionText))
      return hasRange
        ? null
        : "No pay range in the structured data or the description"
    },
  },
  {
    id: "boilerplateDescription",
    label: "Mostly boilerplate, little role-specific detail",
    weight: 0.4,
    // Short descriptions are already covered by vagueDescription.
    evaluable: (e) => e.descriptionText.length >= VAGUE_DESCRIPTION_CHARS,
    test: (e) => {
      const lower = e.descriptionText.toLowerCase()

      const boilerplate = countPhrases(lower, [
        "equal opportunity employer",
        "without regard to race",
        "reasonable accommodation",
        "competitive salary and benefits",
        "fast-paced environment",
        "wear many hats",
        "rockstar",
        "we offer a comprehensive benefits",
      ])

      const specific = countPhrases(lower, [
        "responsibilities",
        "you will",
        "requirements",
        "qualifications",
        "day to day",
        "day-to-day",
        "tech stack",
        "our stack",
        "reporting to",
        "in this role",
      ])

      if (specific > boilerplate) return null
      return `${boilerplate} boilerplate markers vs ${specific} role-specific markers`
    },
  },
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function bandFor(score: number): GhostJobAssessment["band"] {
  if (score >= BAND_HIGH) return "high"
  if (score >= BAND_MEDIUM) return "medium"
  return "low"
}

/**
 * Score a job page's evidence for ghost-listing risk.
 *
 * The composite is the fired signals' weight as a fraction of the weight of
 * every signal we were able to evaluate — so a page that reveals little scores
 * low but with a low `checked`, rather than scoring falsely clean.
 */
export function assessGhostJob(evidence: GhostEvidence): GhostJobAssessment {
  const fired: GhostSignal[] = []
  let evaluableWeight = 0
  let checked = 0

  for (const def of SIGNALS) {
    if (!def.evaluable(evidence)) continue

    checked++
    evaluableWeight += def.weight

    const detail = def.test(evidence)
    if (detail !== null) {
      fired.push({ id: def.id, label: def.label, weight: def.weight, detail })
    }
  }

  const firedWeight = fired.reduce((sum, s) => sum + s.weight, 0)
  const average = evaluableWeight === 0 ? 0 : firedWeight / evaluableWeight

  // A decisive signal floors the composite so it cannot be averaged away by
  // the signals that happened to come back clean.
  const highestFloor = fired.reduce((max, s) => {
    const def = SIGNALS.find((d) => d.id === s.id)
    return def?.floor !== undefined && def.floor > max ? def.floor : max
  }, 0)

  const score = Math.min(1, Math.max(average, highestFloor))

  // Heaviest finding first — that is the one worth reading.
  fired.sort((a, b) => b.weight - a.weight)

  return {
    score: Math.round(score * 100) / 100,
    band: bandFor(score),
    signals: fired,
    checked,
    url: evidence.url,
  }
}

/** Exposed so the Options page can say how many checks run, and for tests. */
export const GHOST_SIGNAL_COUNT = SIGNALS.length
