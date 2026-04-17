import { describe, expect, it } from "vitest";

import { levenshtein, normalise, scoreField } from "@/lib/fuzzyMatch";

describe("normalise", () => {
  it("lowercases, strips punctuation, and collapses spaces", () => {
    expect(normalise(" First Name: ")).toBe("first name");
  });

  it("preserves digits", () => {
    expect(normalise("address2")).toBe("address2");
  });

  it("collapses multiple spaces into one", () => {
    expect(normalise("first   last   name")).toBe("first last name");
  });

  it("returns empty string for blank input", () => {
    expect(normalise("   ")).toBe("");
  });

  it("strips special characters only", () => {
    expect(normalise("e-mail@address")).toBe("e mail address");
  });
});

describe("levenshtein", () => {
  it("computes edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("email", "email")).toBe(0);
  });

  it("handles empty string inputs", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("", "")).toBe(0);
  });

  it("is symmetric", () => {
    expect(levenshtein("phone", "phon")).toBe(levenshtein("phon", "phone"));
  });

  it("returns 1 for a single substitution", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });
});

describe("scoreField", () => {
  it("returns 1.0 for exact match", () => {
    expect(scoreField(["first_name"], "firstName")).toBe(1);
  });

  it("returns 1.0 when signal matches an alias exactly", () => {
    // "email address" is an alias for "email" in FIELD_MAP
    expect(scoreField(["email address"], "email")).toBe(1);
  });

  it("returns 0.85 for close typo match", () => {
    expect(scoreField(["fristname"], "firstName")).toBe(0.85);
  });

  it("returns 0.6 for token overlap", () => {
    expect(scoreField(["current title role"], "currentTitle")).toBe(0.6);
  });

  it("returns 0 when there is no match", () => {
    expect(scoreField(["favorite color"], "firstName")).toBe(0);
  });

  it("returns 0 for empty signals array", () => {
    expect(scoreField([], "firstName")).toBe(0);
  });

  it("takes the highest score across multiple signals", () => {
    // one noise signal + one exact signal → should still return 1.0
    const score = scoreField(["favorite color", "first_name"], "firstName");
    expect(score).toBe(1);
  });

  it("returns 0 for signals that are only whitespace after normalise", () => {
    expect(scoreField(["   ", "---"], "email")).toBe(0);
  });
});
