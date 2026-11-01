/**
 * ghostSignals.ts — collects ghost-listing evidence from the live page.
 *
 * This is the DOM half of feature 3; the scoring half is src/lib/ghostScore.ts.
 * Everything here is read-only and local: we only ever read from the page the
 * user is already looking at, and nothing leaves the browser.
 *
 * Collection is best-effort by design. A field we cannot read becomes null,
 * and the scorer then drops that signal from the denominator rather than
 * treating the gap as a clean result.
 */

import type { GhostEvidence, JobContext } from "@/lib/types"

/** Narrow a parsed date to a sane epoch, rejecting junk and future dates. */
function toEpoch(raw: string | null | undefined, now: number): number | null {
  if (!raw) return null
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) return null
  // A posting dated in the future is bad data, not a signal.
  if (parsed > now) return null
  // Anything before 2000 is almost certainly a parse accident.
  if (parsed < 946_684_800_000) return null
  return parsed
}

/**
 * Pull datePosted and a salary flag out of schema.org JobPosting data.
 * scrapeJobContext() already reads JSON-LD for title/company, but it discards
 * these two fields, and re-reading is cheaper than threading them through.
 */
function fromJsonLd(now: number): {
  datePosted: number | null
  hasStructuredSalary: boolean
} {
  const result = { datePosted: null as number | null, hasStructuredSalary: false }

  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  )

  for (const script of scripts) {
    let data: unknown
    try {
      data = JSON.parse(script.textContent ?? "")
    } catch {
      continue // malformed JSON-LD — skip
    }

    const entries = Array.isArray(data) ? data : [data]
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue
      const record = entry as Record<string, unknown>
      if (record["@type"] !== "JobPosting") continue

      if (result.datePosted === null) {
        result.datePosted = toEpoch(
          typeof record.datePosted === "string" ? record.datePosted : null,
          now,
        )
      }

      // baseSalary is the schema.org field; a bare presence is enough here
      // because we only need to know a range was published at all.
      const salary = record.baseSalary ?? record.estimatedSalary
      if (salary !== undefined && salary !== null && salary !== "") {
        result.hasStructuredSalary = true
      }
    }
  }

  return result
}

/**
 * Scrape relative post-age phrasing that most boards render instead of a date
 * ("Posted 3 months ago", "Reposted 2 weeks ago"). Returns an epoch estimate.
 */
function fromRelativeAge(text: string, now: number): number | null {
  const match = text
    .toLowerCase()
    .match(/(?:re)?posted\s+(\d{1,3})\+?\s+(day|week|month|year)s?\s+ago/)
  if (!match) return null

  const amount = Number.parseInt(match[1], 10)
  if (!Number.isFinite(amount)) return null

  const unitMs: Record<string, number> = {
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000, // 30 days
    year: 31_536_000_000,
  }
  const ms = unitMs[match[2]]
  if (ms === undefined) return null

  return now - amount * ms
}

/** Parse an applicant count out of text like "1,204 applicants". */
function applicantCountFrom(text: string): number | null {
  const match = text.toLowerCase().match(/([\d,.]+)\s*\+?\s*(?:applicants|people clicked apply)/)
  if (!match) return null

  const digits = match[1].replace(/[,.]/g, "")
  const count = Number.parseInt(digits, 10)
  return Number.isFinite(count) ? count : null
}

/**
 * Gather the small amount of metadata text that sits near a job title on the
 * major boards — post age, applicant counts, repost markers. We cap the slice
 * so a mis-targeted selector cannot pull in the whole page.
 */
function collectMetaText(): string {
  const selectors = [
    "[class*='posted']",
    "[class*='postedDate']",
    "[data-automation-id='postedOn']",
    "[class*='applicant']",
    "[class*='job-age']",
    "[class*='metadata']",
    "[class*='job-details-jobs-unified-top-card']",
    ".posting-categories",
    "time",
    "[datetime]",
  ]

  const parts: string[] = []
  for (const selector of selectors) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(0, 4)) {
      const text = el.textContent?.replace(/\s+/g, " ").trim() ?? ""
      if (text && text.length < 200) parts.push(text)

      // <time datetime="..."> carries the machine-readable date we prefer.
      const dt = el.getAttribute("datetime")
      if (dt) parts.push(dt)
    }
    if (parts.length > 24) break
  }

  return [...new Set(parts)].join(" · ").slice(0, 1200)
}

/**
 * Build the evidence object for the current page.
 *
 * @param context — the already-scraped JobContext, reused so we do not pay for
 *                  a second description scrape. Pass null when scraping failed.
 * @param now     — injectable clock, for deterministic tests.
 */
export function collectGhostEvidence(
  context: JobContext | null,
  now: number = Date.now(),
): GhostEvidence {
  const metaText = collectMetaText()
  const { datePosted: jsonLdDate, hasStructuredSalary } = fromJsonLd(now)

  // Prefer a real date from structured data; fall back to relative phrasing,
  // and look at <time datetime> values captured into metaText as a last resort.
  const datePosted =
    jsonLdDate ??
    fromRelativeAge(metaText, now) ??
    toEpoch(document.querySelector("time")?.getAttribute("datetime"), now)

  return {
    url: window.location.href,
    company: context?.company ?? "",
    title: context?.title ?? "",
    descriptionText: context?.description ?? "",
    datePosted,
    metaText,
    applicantCount: applicantCountFrom(metaText),
    hasStructuredSalary,
    now,
  }
}
