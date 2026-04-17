import { describe, expect, it } from "vitest";

import { levenshtein, normalise, scoreField } from "@/lib/fuzzyMatch";

describe("normalise", () => {
  it("lowercases, strips punctuation, and collapses spaces", () => {
    expect(normalise(" First Name: ")).toBe("first name");
  });
});

describe("levenshtein", () => {
  it("computes edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("email", "email")).toBe(0);
  });
});

describe("scoreField", () => {
  it("returns 1.0 for exact match", () => {
    expect(scoreField(["first_name"], "firstName")).toBe(1);
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
});
