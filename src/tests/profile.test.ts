import { describe, expect, it } from "vitest";

import {
  parseProfile,
  ProfileParseError,
  profileToMarkdown,
  validateProfile,
} from "@/lib/profile";

describe("parseProfile", () => {
  it("parses profile markdown front matter", () => {
    const markdown = `---
firstName: Ada
lastName: Lovelace
email: ada@example.com
yearsExperience: 5
skills:
  - TypeScript
  - React
education:
  - degree: BSc Mathematics
    institution: University of London
    year: 1835
willingToRelocate: true
referencesAvailable: false
---
# Profile
`;

    const profile = parseProfile(markdown);

    expect(profile.firstName).toBe("Ada");
    expect(profile.lastName).toBe("Lovelace");
    expect(profile.email).toBe("ada@example.com");
    expect(profile.yearsExperience).toBe(5);
    expect(profile.skills).toEqual(["TypeScript", "React"]);
    expect(profile.education).toHaveLength(1);
    expect(profile.willingToRelocate).toBe(true);
    expect(profile.referencesAvailable).toBe(false);
    expect(profile.rawMarkdown).toBe(markdown);
  });

  it("throws with helpful field list when required values are missing", () => {
    const markdown = `---
firstName: ""
email: invalid-email
---
`;

    expect(() => parseProfile(markdown)).toThrow(ProfileParseError);

    try {
      parseProfile(markdown);
    } catch (error) {
      expect(error).toBeInstanceOf(ProfileParseError);
      const err = error as ProfileParseError;
      expect(err.fields.some((field) => field.includes("firstName"))).toBe(true);
      expect(err.fields.some((field) => field.includes("lastName"))).toBe(true);
      expect(err.fields.some((field) => field.includes("email"))).toBe(true);
    }
  });
});

describe("validateProfile", () => {
  it("validates unknown input into typed profile", () => {
    const profile = validateProfile({
      firstName: "Lin",
      lastName: "Clark",
      email: "lin@example.com",
      yearsExperience: "7",
      willingToRelocate: "yes",
      referencesAvailable: 0,
      skills: ["JS", "TS"],
      education: [{ degree: "BS", institution: "X", year: "2020" }],
    });

    expect(profile.yearsExperience).toBe(7);
    expect(profile.willingToRelocate).toBe(true);
    expect(profile.referencesAvailable).toBe(false);
    expect(profile.education[0].year).toBe(2020);
  });
});

describe("profileToMarkdown", () => {
  it("serialises profile into front matter", () => {
    const markdown = profileToMarkdown({
      firstName: "Sam",
      lastName: "Lee",
      email: "sam@example.com",
      phone: "",
      location: "",
      workAuth: "",
      noticePeriod: "",
      salaryExpectation: "",
      willingToRelocate: false,
      remotePreference: "",
      currentTitle: "",
      currentCompany: "",
      yearsExperience: 0,
      skills: [],
      education: [],
      referencesAvailable: false,
      rawMarkdown: "ignored",
    });

    expect(markdown).toContain("firstName: Sam");
    expect(markdown).toContain("lastName: Lee");
    expect(markdown).toContain("email: sam@example.com");
    expect(markdown).not.toContain("rawMarkdown");
  });

  it("includes optional URL fields only when defined", () => {
    const withUrls = profileToMarkdown({
      firstName: "Kim",
      lastName: "Park",
      email: "kim@example.com",
      phone: "",
      location: "",
      workAuth: "",
      noticePeriod: "",
      salaryExpectation: "",
      willingToRelocate: false,
      remotePreference: "",
      currentTitle: "",
      currentCompany: "",
      yearsExperience: 0,
      skills: [],
      education: [],
      referencesAvailable: false,
      rawMarkdown: "",
      linkedin: "https://linkedin.com/in/kim",
      github: "https://github.com/kim",
    });

    expect(withUrls).toContain("linkedin:");
    expect(withUrls).toContain("github:");
    expect(withUrls).not.toContain("portfolio:");
  });
});

describe("parseProfile — edge cases", () => {
  it("parses optional fields when present", () => {
    const markdown = `---
firstName: Grace
lastName: Hopper
email: grace@navy.mil
linkedin: https://linkedin.com/in/grace
github: https://github.com/grace
portfolio: https://grace.dev
---`;
    const profile = parseProfile(markdown);
    expect(profile.linkedin).toBe("https://linkedin.com/in/grace");
    expect(profile.github).toBe("https://github.com/grace");
    expect(profile.portfolio).toBe("https://grace.dev");
  });

  it("sets optional URL fields to undefined when absent", () => {
    const markdown = `---
firstName: Grace
lastName: Hopper
email: grace@navy.mil
---`;
    const profile = parseProfile(markdown);
    expect(profile.linkedin).toBeUndefined();
    expect(profile.github).toBeUndefined();
    expect(profile.portfolio).toBeUndefined();
  });

  it("coerces yearsExperience from a string number in front-matter", () => {
    const markdown = `---
firstName: Alan
lastName: Turing
email: alan@bletchley.uk
yearsExperience: "10"
---`;
    const profile = parseProfile(markdown);
    expect(profile.yearsExperience).toBe(10);
  });

  it("returns empty skills array when field is missing", () => {
    const markdown = `---
firstName: Alan
lastName: Turing
email: alan@bletchley.uk
---`;
    const profile = parseProfile(markdown);
    expect(profile.skills).toEqual([]);
  });

  it("collects all missing required fields in a single error", () => {
    try {
      parseProfile("---\n---");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProfileParseError);
      const e = err as ProfileParseError;
      expect(e.fields.length).toBeGreaterThanOrEqual(3);
      expect(e.fields.some((f) => f.includes("firstName"))).toBe(true);
      expect(e.fields.some((f) => f.includes("lastName"))).toBe(true);
      expect(e.fields.some((f) => f.includes("email"))).toBe(true);
    }
  });
});

describe("validateProfile — coercions", () => {
  it("coerces boolean string variants", () => {
    const p = validateProfile({
      firstName: "X",
      lastName: "Y",
      email: "x@y.com",
      willingToRelocate: "yes",
      referencesAvailable: "no",
    });
    expect(p.willingToRelocate).toBe(true);
    expect(p.referencesAvailable).toBe(false);
  });

  it("defaults yearsExperience to 0 for non-numeric input", () => {
    const p = validateProfile({
      firstName: "X",
      lastName: "Y",
      email: "x@y.com",
      yearsExperience: "not-a-number",
    });
    expect(p.yearsExperience).toBe(0);
  });

  it("filters non-string items out of skills array", () => {
    const p = validateProfile({
      firstName: "X",
      lastName: "Y",
      email: "x@y.com",
      skills: ["TypeScript", 42, null, "React"],
    });
    expect(p.skills).toEqual(["TypeScript", "React"]);
  });
});
