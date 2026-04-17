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
});
