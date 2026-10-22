/**
 * tracker.ts — local, encrypted application tracker.
 *
 * Every record lives in chrome.storage.local as an AES-GCM blob (see
 * getApplications / setApplications in storage.ts). Nothing leaves the device:
 * no sync, no server, no telemetry. That is the whole pitch versus cloud
 * trackers.
 *
 * The file is split in two halves:
 *   1. Pure functions over ApplicationRecord[] — no storage, no chrome.*,
 *      fully unit-testable. All the real logic lives here.
 *   2. Thin async CRUD wrappers that read, transform, write.
 */

import { getApplications, setApplications } from "@/lib/storage"
import type {
  ApplicationRecord,
  ApplicationStatus,
  JobContext,
} from "@/lib/types"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000

/** Hard cap on log size, newest kept. Keeps the encrypted blob bounded. */
export const MAX_APPLICATIONS = 500

/**
 * Statuses that mean the thread is closed or has moved past the point where a
 * "did anyone read this?" nudge helps. Reaching one clears the follow-up.
 */
const TERMINAL_STATUSES: readonly ApplicationStatus[] = [
  "interview",
  "offer",
  "rejected",
  "withdrawn",
]

/** Query params that identify a tracking campaign, not a job posting. */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gh_src",
  "src",
  "source",
  "ref",
  "referrer",
  "trk",
  "trkparam",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Everything needed to log one application. */
export interface NewApplicationInput {
  company?: string
  title?: string
  location?: string
  url: string
  /** How many fields the autofill actually wrote. */
  fieldsFilled?: number
  /**
   * Snapshot of the ghost-job score at apply time. Owned by another feature —
   * pass it when available, otherwise it is stored as null.
   */
  ghostScore?: number | null
  notes?: string
  status?: ApplicationStatus
  /** Epoch ms; defaults to now. */
  appliedAt?: number
  /** Days until the follow-up nudge. 0 or negative disables it. */
  followUpDays?: number
}

export type DuplicateReason = "url" | "companyTitle"

export interface DuplicateMatch {
  record: ApplicationRecord
  reason: DuplicateReason
}

export interface LogApplicationResult {
  record: ApplicationRecord
  /** Pre-existing records that look like the same application. */
  duplicates: DuplicateMatch[]
}

// ---------------------------------------------------------------------------
// Pure helpers — normalisation
// ---------------------------------------------------------------------------

/**
 * Canonical form of a job URL for duplicate comparison.
 *
 * Drops the fragment, lowercases the host, strips a leading "www." and any
 * trailing slash, and removes known tracking params while KEEPING functional
 * ones (`?gh_jid=123`, `?jobId=456` identify the posting itself). Remaining
 * params are sorted so param order never splits one job into two records.
 * Unparseable input falls back to a trimmed, lowercased string.
 */
export function normaliseUrl(url: string): string {
  const raw = (url ?? "").trim()
  if (raw.length === 0) return ""

  try {
    const parsed = new URL(raw)
    parsed.hash = ""

    const kept: Array<[string, string]> = []
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!TRACKING_PARAMS.has(key.toLowerCase())) kept.push([key, value])
    }
    kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))

    const host = parsed.host.toLowerCase().replace(/^www\./, "")
    const path = parsed.pathname.replace(/\/+$/, "")
    const query = kept.map(([k, v]) => `${k}=${v}`).join("&")

    return `${host}${path}${query ? `?${query}` : ""}`
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "")
  }
}

/** Collapse whitespace / punctuation for company + title comparison. */
function normaliseName(value: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Legal-entity suffixes to drop so "Acme" and "Acme, Inc." compare equal —
 * job boards spell the same employer both ways constantly.
 */
const COMPANY_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "llp",
  "ltd",
  "limited",
  "plc",
  "co",
  "corp",
  "corporation",
  "company",
  "gmbh",
  "ag",
  "bv",
  "nv",
  "sa",
  "sas",
  "srl",
  "spa",
  "oy",
  "ab",
  "as",
  "pty",
  "pte",
  "group",
  "holdings",
])

function normaliseCompany(value: string): string {
  const tokens = normaliseName(value).split(" ").filter((t) => t.length > 0)
  while (tokens.length > 1 && COMPANY_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop()
  }
  return tokens.join(" ")
}

/**
 * Comparison key for the company+title duplicate rule. Returns "" when either
 * half is missing — an incomplete scrape must never collapse two different
 * applications into one "duplicate".
 */
export function companyTitleKey(company: string, title: string): string {
  const c = normaliseCompany(company)
  const t = normaliseName(title)
  if (c.length === 0 || t.length === 0) return ""
  return `${c}|${t}`
}

// ---------------------------------------------------------------------------
// Pure helpers — records
// ---------------------------------------------------------------------------

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  // Fallback for environments without randomUUID; collision risk is negligible
  // at tracker scale and ids are never used as security tokens.
  return `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Epoch ms of the next follow-up nudge, or null when nudges are disabled.
 */
export function computeFollowUpAt(
  fromMs: number,
  followUpDays: number,
): number | null {
  if (!Number.isFinite(followUpDays) || followUpDays <= 0) return null
  return fromMs + Math.round(followUpDays * MS_PER_DAY)
}

/**
 * Build a record from scraped job context + fill stats. Pure: the caller
 * supplies `now` in tests.
 */
export function buildApplicationRecord(
  input: NewApplicationInput,
  now: number = Date.now(),
): ApplicationRecord {
  const appliedAt = Number.isFinite(input.appliedAt) ? (input.appliedAt as number) : now
  const status: ApplicationStatus = input.status ?? "applied"
  const followUpDays = input.followUpDays ?? 0

  return {
    id: newId(),
    company: (input.company ?? "").trim(),
    title: (input.title ?? "").trim(),
    location: (input.location ?? "").trim(),
    url: (input.url ?? "").trim(),
    appliedAt,
    status,
    lastStatusAt: appliedAt,
    followUpAt: TERMINAL_STATUSES.includes(status)
      ? null
      : computeFollowUpAt(appliedAt, followUpDays),
    notes: input.notes ?? "",
    // Owned by the ghost-job feature; null when it did not run.
    ghostScore: typeof input.ghostScore === "number" ? input.ghostScore : null,
    fieldsFilled: Number.isFinite(input.fieldsFilled) ? (input.fieldsFilled as number) : 0,
  }
}

/**
 * Pre-existing records that look like the same application.
 *
 * Two rules, both of which users hit in practice:
 *   - same canonical URL  → applying to the exact posting twice
 *   - same company+title  → the same job reposted or found via another board
 *
 * `excludeId` skips a record being updated in place.
 */
export function findDuplicates(
  records: ApplicationRecord[],
  candidate: { url?: string; company?: string; title?: string },
  excludeId?: string,
): DuplicateMatch[] {
  const list = Array.isArray(records) ? records : []
  const candidateUrl = normaliseUrl(candidate.url ?? "")
  const candidateKey = companyTitleKey(candidate.company ?? "", candidate.title ?? "")

  const matches: DuplicateMatch[] = []

  for (const record of list) {
    if (!record || record.id === excludeId) continue

    if (candidateUrl.length > 0 && normaliseUrl(record.url) === candidateUrl) {
      matches.push({ record, reason: "url" })
      continue // URL is the stronger signal; don't report the same record twice
    }

    if (
      candidateKey.length > 0 &&
      companyTitleKey(record.company, record.title) === candidateKey
    ) {
      matches.push({ record, reason: "companyTitle" })
    }
  }

  return matches
}

/** Human-readable duplicate warning, or "" when there is nothing to warn about. */
export function describeDuplicates(duplicates: DuplicateMatch[]): string {
  if (!Array.isArray(duplicates) || duplicates.length === 0) return ""

  const first = duplicates[0]
  const when = new Date(first.record.appliedAt).toLocaleDateString()
  const what =
    first.reason === "url"
      ? "You already applied to this exact posting"
      : `You already applied to ${first.record.title || "this role"} at ${first.record.company || "this company"}`
  const extra = duplicates.length > 1 ? ` (+${duplicates.length - 1} more match${duplicates.length > 2 ? "es" : ""})` : ""

  return `${what} on ${when}.${extra}`
}

/** Newest-first, capped at MAX_APPLICATIONS. */
export function insertApplication(
  records: ApplicationRecord[],
  record: ApplicationRecord,
): ApplicationRecord[] {
  const list = Array.isArray(records) ? records : []
  return [record, ...list].slice(0, MAX_APPLICATIONS)
}

/**
 * Apply a status change. Stamps `lastStatusAt`, clears the follow-up for
 * terminal statuses and re-arms it from now for active ones. Returns the same
 * array instance semantics as the other helpers: a new array, original
 * untouched. Unknown ids are a no-op.
 */
export function setApplicationStatus(
  records: ApplicationRecord[],
  id: string,
  status: ApplicationStatus,
  followUpDays = 0,
  now: number = Date.now(),
): ApplicationRecord[] {
  const list = Array.isArray(records) ? records : []

  return list.map((record) => {
    if (record.id !== id) return record
    return {
      ...record,
      status,
      lastStatusAt: now,
      followUpAt: TERMINAL_STATUSES.includes(status)
        ? null
        : computeFollowUpAt(now, followUpDays),
    }
  })
}

/** Remove one record by id. Unknown ids are a no-op. */
export function removeApplication(
  records: ApplicationRecord[],
  id: string,
): ApplicationRecord[] {
  const list = Array.isArray(records) ? records : []
  return list.filter((record) => record.id !== id)
}

/** Records whose follow-up nudge is due at or before `now`. */
export function dueFollowUps(
  records: ApplicationRecord[],
  now: number = Date.now(),
): ApplicationRecord[] {
  const list = Array.isArray(records) ? records : []
  return list.filter((r) => typeof r.followUpAt === "number" && r.followUpAt <= now)
}

/** Records with a nudge still in the future, soonest first. */
export function pendingFollowUps(
  records: ApplicationRecord[],
  now: number = Date.now(),
): ApplicationRecord[] {
  const list = Array.isArray(records) ? records : []
  return list
    .filter((r) => typeof r.followUpAt === "number" && (r.followUpAt as number) > now)
    .sort((a, b) => (a.followUpAt as number) - (b.followUpAt as number))
}

/** Count per status, for the options-page summary. */
export function statusCounts(
  records: ApplicationRecord[],
): Record<ApplicationStatus, number> {
  const counts: Record<ApplicationStatus, number> = {
    applied: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    withdrawn: 0,
    ghosted: 0,
  }
  for (const record of Array.isArray(records) ? records : []) {
    if (record && record.status in counts) counts[record.status] += 1
  }
  return counts
}

/**
 * Map a scraped JobContext onto the tracker input fields. `description` is
 * deliberately dropped — the tracker stores what the user needs to recognise
 * the application, not the whole posting.
 */
export function inputFromJobContext(
  jobContext: JobContext | null,
  fallbackUrl: string,
  extra: Omit<NewApplicationInput, "company" | "title" | "location" | "url"> = {},
): NewApplicationInput {
  return {
    company: jobContext?.company ?? "",
    title: jobContext?.title ?? "",
    location: jobContext?.location ?? "",
    url: jobContext?.url || fallbackUrl,
    ...extra,
  }
}

/** Minimal CSV export of the log (local download only, never uploaded). */
export function toCsv(records: ApplicationRecord[]): string {
  const header = [
    "company",
    "title",
    "location",
    "url",
    "appliedAt",
    "status",
    "followUpAt",
    "ghostScore",
    "fieldsFilled",
    "notes",
  ]

  const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`

  const rows = (Array.isArray(records) ? records : []).map((r) =>
    [
      escape(r.company),
      escape(r.title),
      escape(r.location),
      escape(r.url),
      escape(new Date(r.appliedAt).toISOString()),
      escape(r.status),
      escape(r.followUpAt === null ? "" : new Date(r.followUpAt).toISOString()),
      escape(r.ghostScore === null ? "" : String(r.ghostScore)),
      escape(String(r.fieldsFilled)),
      escape(r.notes),
    ].join(","),
  )

  return [header.join(","), ...rows].join("\n")
}

// ---------------------------------------------------------------------------
// Async CRUD — encrypted persistence
// ---------------------------------------------------------------------------

/** The whole log, newest first. Never throws: a bad blob reads as []. */
export async function listApplications(): Promise<ApplicationRecord[]> {
  const records = await getApplications()
  return [...records].sort((a, b) => b.appliedAt - a.appliedAt)
}

/** One record by id, or null. */
export async function getApplication(id: string): Promise<ApplicationRecord | null> {
  const records = await getApplications()
  return records.find((r) => r.id === id) ?? null
}

/**
 * Duplicate check against the stored log, for warning the user *before* they
 * apply (the popup calls this with the scraped job context).
 */
export async function checkDuplicates(candidate: {
  url?: string
  company?: string
  title?: string
}): Promise<DuplicateMatch[]> {
  const records = await getApplications()
  return findDuplicates(records, candidate)
}

/**
 * Log a new application and persist the encrypted log.
 *
 * Duplicates are reported, NOT blocked — reapplying after a reorg or to a
 * genuinely different req at the same company is legitimate. The caller
 * surfaces `duplicates` to the user.
 */
export async function logApplication(
  input: NewApplicationInput,
  now: number = Date.now(),
): Promise<LogApplicationResult> {
  const existing = await getApplications()
  const duplicates = findDuplicates(existing, input)
  const record = buildApplicationRecord(input, now)

  await setApplications(insertApplication(existing, record))

  return { record, duplicates }
}

/**
 * Change a record's status. Returns the updated record, or null when the id is
 * unknown (nothing is written in that case).
 */
export async function updateApplicationStatus(
  id: string,
  status: ApplicationStatus,
  followUpDays = 0,
  now: number = Date.now(),
): Promise<ApplicationRecord | null> {
  const existing = await getApplications()
  if (!existing.some((r) => r.id === id)) return null

  const updated = setApplicationStatus(existing, id, status, followUpDays, now)
  await setApplications(updated)

  return updated.find((r) => r.id === id) ?? null
}

/**
 * Patch the free-text notes on a record. Returns the updated record, or null
 * when the id is unknown.
 */
export async function updateApplicationNotes(
  id: string,
  notes: string,
): Promise<ApplicationRecord | null> {
  const existing = await getApplications()
  if (!existing.some((r) => r.id === id)) return null

  const updated = existing.map((r) => (r.id === id ? { ...r, notes } : r))
  await setApplications(updated)

  return updated.find((r) => r.id === id) ?? null
}

/** Delete one record. Returns true when something was actually removed. */
export async function deleteApplication(id: string): Promise<boolean> {
  const existing = await getApplications()
  const updated = removeApplication(existing, id)
  if (updated.length === existing.length) return false

  await setApplications(updated)
  return true
}

/** Wipe the log (used by the options page "clear history" action). */
export async function clearApplications(): Promise<void> {
  await setApplications([])
}
