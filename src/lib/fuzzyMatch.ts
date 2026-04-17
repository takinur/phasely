/**
 * fuzzyMatch.ts — scoring utilities for field-to-profile-key matching.
 *
 * Scoring scale (0–1):
 *   1.00  exact match (after normalise) between any signal and the key or an alias
 *   0.85  Levenshtein distance ≤ 2 between any signal and the key or an alias
 *   0.60  token overlap: at least one token from a signal matches a token in the key/alias
 *   0.00  no match
 */

import { FIELD_MAP } from "@/lib/fieldMap";

// ---------------------------------------------------------------------------
// normalise
// ---------------------------------------------------------------------------

/**
 * Lower-case, strip non-alphanumeric characters, collapse whitespace.
 * "First Name:" → "first name" → compared as "first name"
 */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// levenshtein
// ---------------------------------------------------------------------------

/**
 * Standard DP Levenshtein distance. O(m·n) time, O(min(m,n)) space.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string to minimise memory
  if (a.length > b.length) {
    const tmp = a;
    a = b;
    b = tmp;
  }

  const prev = new Array<number>(a.length + 1);
  const curr = new Array<number>(a.length + 1);

  for (let i = 0; i <= a.length; i++) prev[i] = i;

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1] + 1,          // insertion
        prev[i] + 1,              // deletion
        prev[i - 1] + cost,       // substitution
      );
    }
    for (let i = 0; i <= a.length; i++) prev[i] = curr[i];
  }

  return prev[a.length];
}

// ---------------------------------------------------------------------------
// scoreField
// ---------------------------------------------------------------------------

/**
 * Score a set of DOM signals (label text, name attr, placeholder, etc.)
 * against a profile key such as "firstName".
 *
 * Strategy:
 *   1. Build the candidate set: the camelCase key itself + all its FIELD_MAP aliases.
 *   2. Normalise every candidate and every signal.
 *   3. Walk scoring tiers from highest to lowest; return the first match found.
 */
export function scoreField(signals: string[], profileKey: string): number {
  // Build the set of terms to match against: key + aliases
  const rawCandidates: string[] = [profileKey, ...(FIELD_MAP[profileKey] ?? [])];
  const candidates = rawCandidates.map(normalise);

  const normalisedSignals = signals.map(normalise).filter((s) => s.length > 0);
  if (normalisedSignals.length === 0 || candidates.length === 0) return 0;

  // Tier 1: exact match
  for (const sig of normalisedSignals) {
    if (candidates.some((c) => c === sig)) return 1.0;
  }

  // Tier 2: Levenshtein ≤ 2
  for (const sig of normalisedSignals) {
    if (candidates.some((c) => levenshtein(sig, c) <= 2)) return 0.85;
  }

  // Tier 3: token overlap — any token from a signal appears in any candidate
  for (const sig of normalisedSignals) {
    const sigTokens = sig.split(" ");
    for (const candidate of candidates) {
      const candTokens = candidate.split(" ");
      const overlap = sigTokens.some((st) => candTokens.includes(st));
      if (overlap) return 0.6;
    }
  }

  return 0;
}
