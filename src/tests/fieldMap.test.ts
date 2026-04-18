import { describe, expect, it } from "vitest";

import { FIELD_MAP } from "@/lib/fieldMap";

describe("FIELD_MAP", () => {
  it("contains expected canonical keys", () => {
    expect(FIELD_MAP).toHaveProperty("firstName");
    expect(FIELD_MAP).toHaveProperty("lastName");
    expect(FIELD_MAP).toHaveProperty("email");
    expect(FIELD_MAP).toHaveProperty("phone");
    expect(FIELD_MAP).toHaveProperty("coverLetter");
  });

  it("normalises aliases to lowercase and removes duplicates", () => {
    for (const aliases of Object.values(FIELD_MAP)) {
      expect(aliases.length).toBeGreaterThan(0);

      const seen = new Set<string>();
      for (const alias of aliases) {
        expect(alias).toBe(alias.trim());
        expect(alias).toBe(alias.toLowerCase());
        expect(alias.length).toBeGreaterThan(0);
        expect(seen.has(alias)).toBe(false);
        seen.add(alias);
      }
    }
  });

  it("has at least 2 aliases per key", () => {
    for (const [key, aliases] of Object.entries(FIELD_MAP)) {
      expect(aliases.length, `${key} should have ≥ 2 aliases`).toBeGreaterThanOrEqual(2);
    }
  });

  it("no alias is shared between two different keys", () => {
    const seen = new Map<string, string>(); // alias → first key that owns it
    for (const [key, aliases] of Object.entries(FIELD_MAP)) {
      for (const alias of aliases) {
        const owner = seen.get(alias);
        expect(owner, `alias "${alias}" is claimed by both "${owner}" and "${key}"`).toBeUndefined();
        seen.set(alias, key);
      }
    }
  });

  it("contains a key for resume / file upload matching", () => {
    // The detector uses this to identify file input fields for resume upload
    expect(FIELD_MAP).toHaveProperty("resumeUrl");
  });

  it("contains keys for AI-generated fields", () => {
    expect(FIELD_MAP).toHaveProperty("coverLetter");
    expect(FIELD_MAP).toHaveProperty("additionalInfo");
  });
});
