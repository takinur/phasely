const fieldAliases: Record<string, string[]> = {
  first_name: ["fname", "first", "given-name"],
  last_name: ["lname", "last", "family-name"],
  email: ["e-mail", "mail"],
};

export function normalizeFieldKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

export function resolveFieldKey(value: string): string | undefined {
  const normalized = normalizeFieldKey(value);

  if (fieldAliases[normalized]) {
    return normalized;
  }

  for (const [canonicalKey, aliases] of Object.entries(fieldAliases)) {
    if (aliases.includes(normalized)) {
      return canonicalKey;
    }
  }

  return undefined;
}