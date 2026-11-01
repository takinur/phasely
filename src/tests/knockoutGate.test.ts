/**
 * Integration test for the knockout guard, covering the seam between
 * content.ts and the popup: detector-shaped field summaries →
 * buildKnockoutFields → unconfirmedKnockoutCategories → describeKnockoutBlock.
 *
 * This is the path that actually blocks a submit, and it spans three modules
 * that are each unit-tested in isolation — so a contract break here (a dropped
 * field on the message boundary, say) would otherwise pass every other test.
 *
 * The real detector needs a DOM and vitest runs in a `node` environment, so
 * the summaries are hand-built to the exact shape content.ts sends.
 */
import { describe, expect, it } from "vitest"

import {
  buildKnockoutFields,
  classifyKnockout,
  describeKnockoutBlock,
  unconfirmedKnockoutCategories,
} from "@/lib/knockout"

describe("knockout guard, popup data path", () => {
  it("classifies a sponsorship question from its label text", () => {
    const category = classifyKnockout(
      ["Will you now or in the future require sponsorship?"],
      "workAuth",
    )
    expect(category).toBe("sponsorship")
  })

  it("builds, blocks, then releases once confirmed", () => {
    // Shaped exactly like what content.ts now sends over the boundary.
    const summaries = [
      {
        profileKey: "workAuth",
        suggestedValue: "Yes",
        isKnockout: true,
        knockoutCategory: "sponsorship" as const,
        question: "Will you now or in the future require sponsorship?",
      },
      {
        profileKey: "willingToRelocate",
        suggestedValue: "false",
        isKnockout: true,
        knockoutCategory: "relocation" as const,
        question: "Are you willing to relocate for this role?",
      },
      {
        profileKey: "firstName",
        suggestedValue: "Ada",
        isKnockout: false,
        question: "First name",
      },
    ]

    const fields = buildKnockoutFields(summaries)

    // The ordinary name field must not be dragged into the guard.
    expect(fields.map((f) => f.category).sort()).toEqual(["relocation", "sponsorship"])
    // The page's own wording is preserved for the confirm UI.
    expect(fields.find((f) => f.category === "sponsorship")?.question).toBe(
      "Will you now or in the future require sponsorship?",
    )
    // Nothing starts confirmed.
    expect(fields.every((f) => !f.confirmed)).toBe(true)

    const blocked = unconfirmedKnockoutCategories(fields)
    expect(blocked).toHaveLength(2)
    expect(describeKnockoutBlock(blocked)).toBeTruthy()

    // Confirm one — still blocked.
    const partial = fields.map((f) =>
      f.category === "sponsorship" ? { ...f, confirmed: true } : f,
    )
    expect(unconfirmedKnockoutCategories(partial)).toHaveLength(1)

    // Confirm both — released.
    const all = fields.map((f) => ({ ...f, confirmed: true }))
    expect(unconfirmedKnockoutCategories(all)).toHaveLength(0)
  })

  it("does not treat a company named Shiftwell as a shift-availability question", () => {
    expect(classifyKnockout(["Current employer", "Shiftwell Ltd"], "currentCompany")).toBeNull()
  })
})
