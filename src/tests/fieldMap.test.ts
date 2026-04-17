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
});
