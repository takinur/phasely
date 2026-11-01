import { describe, expect, it } from "vitest"

import { GHOST_SIGNAL_COUNT, assessGhostJob, bandFor } from "@/lib/ghostScore"
import type { GhostEvidence } from "@/lib/types"

const NOW = Date.parse("2026-10-22T00:00:00Z")
const DAY = 86_400_000

/**
 * A description long enough to clear the vague/boilerplate thresholds and
 * specific enough that boilerplateDescription does not fire.
 */
const HEALTHY_DESCRIPTION = [
  "In this role you will own the billing service end to end.",
  "Responsibilities include designing the ledger schema, reporting to the",
  "payments lead, and running the day-to-day on-call rotation.",
  "Requirements: five years of backend experience, strong SQL.",
  "Our tech stack is TypeScript, Postgres and Kubernetes.",
  "Qualifications we value: prior fintech exposure.",
  "The salary range is $150,000 - $185,000 per year.",
].join(" ")
  // Pad past the 600-char vagueness floor without adding boilerplate markers.
  .padEnd(700, " We review every application individually.")

function evidence(overrides: Partial<GhostEvidence> = {}): GhostEvidence {
  return {
    url: "https://jobs.example.com/req/1",
    company: "Example Corp",
    title: "Senior Backend Engineer",
    descriptionText: HEALTHY_DESCRIPTION,
    datePosted: NOW - 3 * DAY,
    metaText: "Posted 3 days ago",
    applicantCount: 12,
    hasStructuredSalary: true,
    now: NOW,
    ...overrides,
  }
}

describe("bandFor", () => {
  it("maps scores to the three bands at the documented thresholds", () => {
    expect(bandFor(0)).toBe("low")
    expect(bandFor(0.24)).toBe("low")
    expect(bandFor(0.25)).toBe("medium")
    expect(bandFor(0.54)).toBe("medium")
    expect(bandFor(0.55)).toBe("high")
    expect(bandFor(1)).toBe("high")
  })
})

describe("assessGhostJob", () => {
  it("scores a complete, specific, freshly posted listing as low risk", () => {
    const result = assessGhostJob(evidence())

    expect(result.signals).toEqual([])
    expect(result.score).toBe(0)
    expect(result.band).toBe("low")
    expect(result.checked).toBe(GHOST_SIGNAL_COUNT)
  })

  it("flags an evergreen talent-pipeline posting as the heaviest signal", () => {
    const result = assessGhostJob(
      evidence({ title: "General Application - Talent Community" }),
    )

    expect(result.signals[0].id).toBe("evergreenRequisition")
    expect(result.signals[0].detail).toContain("talent community")
    expect(result.band).not.toBe("low")
  })

  it("flags a stale posting using the injected clock", () => {
    const result = assessGhostJob(evidence({ datePosted: NOW - 90 * DAY }))

    const stale = result.signals.find((s) => s.id === "stalePosting")
    expect(stale?.detail).toBe("First posted 90 days ago and still open")
  })

  it("does not flag a posting that is stale by less than the threshold", () => {
    const result = assessGhostJob(evidence({ datePosted: NOW - 44 * DAY }))
    expect(result.signals.map((s) => s.id)).not.toContain("stalePosting")
  })

  it("excludes signals it cannot evaluate from the denominator", () => {
    // No date and no applicant count means two fewer checks, and because
    // nothing fires the score stays 0 while `checked` reveals the uncertainty.
    const result = assessGhostJob(
      evidence({ datePosted: null, applicantCount: null }),
    )

    expect(result.checked).toBe(GHOST_SIGNAL_COUNT - 2)
    expect(result.score).toBe(0)
  })

  it("treats an unreadable page as uncertain rather than clean", () => {
    const result = assessGhostJob(
      evidence({
        company: "",
        title: "",
        descriptionText: "",
        datePosted: null,
        metaText: "",
        applicantCount: null,
        hasStructuredSalary: false,
      }),
    )

    // Nothing is knowable, so nothing fires and nothing is counted.
    expect(result.checked).toBe(0)
    expect(result.score).toBe(0)
    expect(result.band).toBe("low")
  })

  it("stacks multiple findings into the high band", () => {
    const result = assessGhostJob(
      evidence({
        company: "",
        title: "Evergreen Requisition",
        descriptionText:
          "We are always hiring. Our client is seeking candidates. Reposted.",
        datePosted: NOW - 120 * DAY,
        metaText: "Reposted 4 months ago · 2,400 applicants",
        applicantCount: 2400,
        hasStructuredSalary: false,
      }),
    )

    const ids = result.signals.map((s) => s.id)
    expect(ids).toContain("evergreenRequisition")
    expect(ids).toContain("alwaysHiringLanguage")
    expect(ids).toContain("stalePosting")
    expect(ids).toContain("repostedListing")
    expect(ids).toContain("missingCompanyIdentity")
    expect(ids).toContain("staffingAgencyPost")
    expect(ids).toContain("highApplicantCount")
    expect(result.band).toBe("high")

    // Signals are ordered heaviest-first so the popup leads with the worst.
    const weights = result.signals.map((s) => s.weight)
    expect([...weights].sort((a, b) => b - a)).toEqual(weights)
  })

  it("trusts structured salary data over a text scan", () => {
    const withStructured = assessGhostJob(
      evidence({ descriptionText: "Short.", hasStructuredSalary: true }),
    )
    const withoutStructured = assessGhostJob(
      evidence({ descriptionText: "Short.", hasStructuredSalary: false }),
    )

    expect(withStructured.signals.map((s) => s.id)).not.toContain("noSalaryRange")
    expect(withoutStructured.signals.map((s) => s.id)).toContain("noSalaryRange")
  })

  it("detects a pay range written only in the description text", () => {
    const result = assessGhostJob(
      evidence({
        hasStructuredSalary: false,
        descriptionText: HEALTHY_DESCRIPTION, // contains "$150,000 - $185,000"
      }),
    )

    expect(result.signals.map((s) => s.id)).not.toContain("noSalaryRange")
  })

  it("lets a decisive signal carry the score past the averaging dilution", () => {
    // One firing signal out of ten would average to ~0.15 and read as "low".
    // The floor is what stops an otherwise tidy pipeline posting slipping by.
    const result = assessGhostJob(evidence({ title: "Evergreen Requisition" }))

    expect(result.signals.map((s) => s.id)).toEqual(["evergreenRequisition"])
    expect(result.score).toBeGreaterThanOrEqual(0.6)
    expect(result.band).toBe("high")
  })

  it("keeps a weak lone signal in the low band", () => {
    // noSalaryRange has no floor — on its own it is not evidence of much.
    const result = assessGhostJob(
      evidence({ hasStructuredSalary: false, descriptionText: HEALTHY_DESCRIPTION.replace("$150,000 - $185,000 per year", "a competitive package") }),
    )

    expect(result.signals.map((s) => s.id)).toEqual(["noSalaryRange"])
    expect(result.band).toBe("low")
  })

  it("never exceeds a score of 1", () => {
    const result = assessGhostJob(
      evidence({
        company: "",
        title: "Evergreen talent pool",
        descriptionText: "We are always hiring. Our client is seeking. Reposted.",
        datePosted: NOW - 400 * DAY,
        metaText: "Reposted · 9,000 applicants",
        applicantCount: 9000,
        hasStructuredSalary: false,
      }),
    )

    expect(result.score).toBeLessThanOrEqual(1)
  })

  it("rounds the score to two decimals and echoes the url", () => {
    const result = assessGhostJob(evidence({ company: "" }))

    expect(result.url).toBe("https://jobs.example.com/req/1")
    expect(result.score).toBe(Math.round(result.score * 100) / 100)
    expect(result.score).toBeGreaterThan(0)
  })
})
