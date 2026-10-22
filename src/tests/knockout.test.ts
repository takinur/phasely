import { describe, expect, it } from "vitest";

import { KNOCKOUT_FIELD_MAP, KNOCKOUT_PROFILE_KEYS } from "@/lib/fieldMap";
import {
  buildKnockoutFields,
  classifyKnockout,
  describeKnockoutBlock,
  evaluateKnockoutGate,
  isKnockoutProfileKey,
  knockoutFieldId,
  requiresManualReview,
  unconfirmedKnockoutCategories,
} from "@/lib/knockout";
import type { KnockoutField } from "@/lib/types";

describe("KNOCKOUT_FIELD_MAP", () => {
  it("covers every KnockoutCategory", () => {
    const expected = [
      "workAuthorization",
      "sponsorship",
      "location",
      "relocation",
      "travel",
      "shiftAvailability",
      "license",
      "backgroundCheck",
      "salary",
    ];
    expect(Object.keys(KNOCKOUT_FIELD_MAP).sort()).toEqual([...expected].sort());
  });

  it("normalises aliases to lowercase and removes duplicates", () => {
    for (const aliases of Object.values(KNOCKOUT_FIELD_MAP)) {
      expect(aliases.length).toBeGreaterThanOrEqual(2);

      const seen = new Set<string>();
      for (const alias of aliases) {
        expect(alias).toBe(alias.trim());
        expect(alias).toBe(alias.toLowerCase());
        expect(seen.has(alias)).toBe(false);
        seen.add(alias);
      }
    }
  });

  it("no alias is claimed by two categories", () => {
    const owner = new Map<string, string>();
    for (const [category, aliases] of Object.entries(KNOCKOUT_FIELD_MAP)) {
      for (const alias of aliases) {
        const existing = owner.get(alias);
        expect(existing, `alias "${alias}" claimed by "${existing}" and "${category}"`).toBeUndefined();
        owner.set(alias, category);
      }
    }
  });
});

describe("classifyKnockout — real job-application question text", () => {
  const cases: Array<[string, string]> = [
    ["Are you legally authorized to work in the United States?", "workAuthorization"],
    ["Do you have the right to work in the UK?", "workAuthorization"],
    ["What is your current visa status?", "workAuthorization"],
    ["Will you now or in the future require sponsorship to work in the US?", "sponsorship"],
    ["Do you require visa sponsorship?", "sponsorship"],
    ["Are you willing to relocate to Austin, TX?", "relocation"],
    ["Open to relocation?", "relocation"],
    ["Are you willing to travel up to 50% of the time?", "travel"],
    ["Are you able to commute to our Dublin office?", "location"],
    ["What is your country of residence?", "location"],
    ["Are you available to work night shift and weekends?", "shiftAvailability"],
    ["Do you have a valid driver's license?", "license"],
    ["Do you hold an active security clearance?", "license"],
    ["Do you consent to a background check?", "backgroundCheck"],
    ["Have you ever been convicted of a felony?", "backgroundCheck"],
    ["What are your salary expectations?", "salary"],
    ["Desired salary (USD)", "salary"],
  ];

  for (const [question, expected] of cases) {
    it(`classifies "${question}" as ${expected}`, () => {
      expect(classifyKnockout([question], "")).toBe(expected);
    });
  }

  it("prefers the longer phrase hit when two categories overlap", () => {
    // Mentions both sponsorship and work authorization; the longer alias
    // ("legally authorized to work") wins.
    expect(
      classifyKnockout(
        ["Are you legally authorized to work in the US without sponsorship?"],
        "",
      ),
    ).toBe("workAuthorization");
  });

  it("reads name / id / aria-label signals, not just label text", () => {
    expect(classifyKnockout(["work_authorization", "q_12345"], "")).toBe("workAuthorization");
    expect(classifyKnockout(["requires_sponsorship"], "")).toBe("sponsorship");
  });

  it("returns null for ordinary contact fields", () => {
    expect(classifyKnockout(["First name", "first_name", "given-name"], "firstName")).toBeNull();
    expect(classifyKnockout(["Email address"], "email")).toBeNull();
    expect(classifyKnockout(["Phone number"], "phone")).toBeNull();
    expect(classifyKnockout(["LinkedIn profile URL"], "linkedin")).toBeNull();
  });

  it("does not flag a plain address field as a location knockout", () => {
    expect(classifyKnockout(["City"], "location")).toBeNull();
    expect(classifyKnockout(["Postal code"], "location")).toBeNull();
    expect(classifyKnockout(["Street address"], "location")).toBeNull();
  });

  it("matches token runs, never substrings inside words", () => {
    // "shift" must not fire on "shifting" / "Shiftwell Ltd"
    expect(classifyKnockout(["Shiftwell Ltd"], "")).toBeNull();
    expect(classifyKnockout(["Shift preference"], "")).toBe("shiftAvailability");
  });

  it("falls back to the profile-key floor when the label is unclassifiable", () => {
    expect(classifyKnockout(["Q4"], "workAuth")).toBe("workAuthorization");
    expect(classifyKnockout([], "willingToRelocate")).toBe("relocation");
    expect(classifyKnockout(["anything"], "salaryExpectation")).toBe("salary");
    expect(classifyKnockout(["Q4"], "firstName")).toBeNull();
  });

  it("tolerates junk input", () => {
    expect(classifyKnockout([], "")).toBeNull();
    expect(classifyKnockout(["", "   ", "???"], "")).toBeNull();
    expect(classifyKnockout(undefined as unknown as string[], "")).toBeNull();
    expect(classifyKnockout([null as unknown as string], "")).toBeNull();
  });
});

describe("profile-key floor", () => {
  it("is narrow on purpose", () => {
    expect(Object.keys(KNOCKOUT_PROFILE_KEYS).sort()).toEqual([
      "salaryExpectation",
      "willingToRelocate",
      "workAuth",
    ]);
    // location / remotePreference would flag every address input.
    expect(isKnockoutProfileKey("location")).toBe(false);
    expect(isKnockoutProfileKey("remotePreference")).toBe(false);
  });
});

describe("requiresManualReview", () => {
  it("forces review on a knockout field even at perfect confidence", () => {
    expect(requiresManualReview({ profileKey: "workAuth", confidence: 1, isKnockout: true })).toBe(true);
    expect(requiresManualReview({ profileKey: "workAuth", confidence: 1 })).toBe(true);
  });

  it("leaves high-confidence ordinary fields alone", () => {
    expect(requiresManualReview({ profileKey: "email", confidence: 1 })).toBe(false);
    expect(requiresManualReview({ profileKey: "email", confidence: 0.6 })).toBe(true);
  });
});

describe("buildKnockoutFields", () => {
  it("keeps knockout fields, drops ordinary ones, and never pre-confirms", () => {
    const fields = buildKnockoutFields([
      {
        profileKey: "workAuth",
        suggestedValue: "Citizen",
        isKnockout: true,
        knockoutCategory: "workAuthorization",
        question: "Are you legally authorized to work in the US?",
      },
      { profileKey: "email", suggestedValue: "a@b.com", isKnockout: false },
    ]);

    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      profileKey: "workAuth",
      category: "workAuthorization",
      suggestedValue: "Citizen",
      confirmed: false,
    });
  });

  it("collapses the same question appearing as several elements", () => {
    const sources = [
      { profileKey: "workAuth", suggestedValue: "Yes", isKnockout: true, knockoutCategory: "workAuthorization" as const, question: "Authorized?" },
      { profileKey: "workAuth", suggestedValue: "Yes", isKnockout: true, knockoutCategory: "workAuthorization" as const, question: "Authorized?" },
    ];
    expect(buildKnockoutFields(sources)).toHaveLength(1);
  });

  it("falls back to the profile-key floor when the detector sent no flags", () => {
    const fields = buildKnockoutFields([{ profileKey: "salaryExpectation", suggestedValue: "90000" }]);
    expect(fields).toHaveLength(1);
    expect(fields[0].category).toBe("salary");
    expect(knockoutFieldId(fields[0])).toBe("salary:salaryExpectation");
  });

  it("uses the category label when no question text is available", () => {
    const fields = buildKnockoutFields([{ profileKey: "workAuth", suggestedValue: "" }]);
    expect(fields[0].question).toBe("Work authorization");
  });
});

describe("submit gate", () => {
  const ko = (category: KnockoutField["category"], confirmed: boolean): KnockoutField => ({
    profileKey: "workAuth",
    category,
    question: "q",
    suggestedValue: "v",
    confirmed,
  });

  it("blocks while any knockout is unconfirmed and names the categories", () => {
    const gate = evaluateKnockoutGate({ blockSubmitOnUnconfirmedKnockouts: true }, [
      ko("workAuthorization", false),
      ko("salary", false),
      ko("relocation", true),
    ]);

    expect(gate.blocked).toBe(true);
    // Priority order, not insertion order.
    expect(gate.categories).toEqual(["workAuthorization", "salary"]);
    expect(gate.message).toContain("Work authorization");
    expect(gate.message).toContain("Salary");
    expect(gate.message).not.toContain("Relocation");
  });

  it("allows submit once everything is confirmed", () => {
    const gate = evaluateKnockoutGate({ blockSubmitOnUnconfirmedKnockouts: true }, [
      ko("workAuthorization", true),
    ]);
    expect(gate).toEqual({ blocked: false, categories: [], message: "" });
  });

  it("allows submit when there are no knockouts at all", () => {
    expect(evaluateKnockoutGate({ blockSubmitOnUnconfirmedKnockouts: true }, []).blocked).toBe(false);
    expect(evaluateKnockoutGate({ blockSubmitOnUnconfirmedKnockouts: true }, undefined).blocked).toBe(false);
  });

  it("fails safe: a missing toggle is treated as enabled", () => {
    expect(evaluateKnockoutGate({}, [ko("sponsorship", false)]).blocked).toBe(true);
    expect(evaluateKnockoutGate(null, [ko("sponsorship", false)]).blocked).toBe(true);
    expect(evaluateKnockoutGate(undefined, [ko("sponsorship", false)]).blocked).toBe(true);
  });

  it("respects an explicit opt-out", () => {
    expect(
      evaluateKnockoutGate({ blockSubmitOnUnconfirmedKnockouts: false }, [ko("sponsorship", false)])
        .blocked,
    ).toBe(false);
  });

  it("dedupes categories for the message", () => {
    const categories = unconfirmedKnockoutCategories([ko("salary", false), ko("salary", false)]);
    expect(categories).toEqual(["salary"]);
    expect(describeKnockoutBlock(categories)).toContain("Salary answer first");
    expect(describeKnockoutBlock([])).toBe("");
  });
});
