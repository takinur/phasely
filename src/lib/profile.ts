import matter from "gray-matter";
import type { Education, Profile } from "@/lib/types";

// ---------------------------------------------------------------------------
// ProfileParseError
// ---------------------------------------------------------------------------

export class ProfileParseError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    const list = fields.join(", ");
    super(`Profile validation failed. Invalid or missing fields: ${list}`);
    this.name = "ProfileParseError";
    this.fields = fields;
    // Restore prototype chain (required when extending built-ins in TS)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a profile.md string (YAML front-matter + optional markdown body)
 * into a fully validated Profile object.
 *
 * Throws ProfileParseError if required fields are absent or have the wrong type.
 */
export function parseProfile(markdown: string): Profile {
  const parsed = matter(markdown);
  const data: unknown = isRecord(parsed.data) ? parsed.data : {};
  return validateProfile(data, markdown);
}

/**
 * Standalone validator. Accepts an unknown value (e.g. data from storage or
 * a deserialized JSON blob) and returns a typed Profile, or throws
 * ProfileParseError listing every field that failed validation.
 *
 * The optional rawMarkdown parameter is attached to the returned Profile and
 * is used when reconstructing AI prompts. Pass it when calling from parseProfile.
 */
export function validateProfile(data: unknown, rawMarkdown = ""): Profile {
  if (!isRecord(data)) {
    throw new ProfileParseError(["(root) — expected a key-value object"]);
  }

  const invalidFields: string[] = [];

  // Required string fields — collect failures instead of throwing immediately
  const firstName = extractRequiredString(data, "firstName", invalidFields);
  const lastName = extractRequiredString(data, "lastName", invalidFields);
  const email = extractRequiredEmail(data, "email", invalidFields);

  if (invalidFields.length > 0) {
    throw new ProfileParseError(invalidFields);
  }

  // At this point the required fields are guaranteed strings (TS doesn't know
  // that yet, so we assert via the non-null assertion — safe because we just
  // checked invalidFields is empty).
  return {
    firstName: firstName!,
    lastName: lastName!,
    email: email!,

    // Optional-but-typed-as-string fields fall back to empty string
    phone: getString(data, "phone"),
    location: getString(data, "location"),
    workAuth: getString(data, "workAuth"),
    noticePeriod: getString(data, "noticePeriod"),
    salaryExpectation: getString(data, "salaryExpectation"),
    remotePreference: getString(data, "remotePreference"),
    currentTitle: getString(data, "currentTitle"),
    currentCompany: getString(data, "currentCompany"),

    // Truly optional fields (interface declares `?`)
    linkedin: getOptionalString(data, "linkedin"),
    github: getOptionalString(data, "github"),
    portfolio: getOptionalString(data, "portfolio"),

    // Boolean fields
    willingToRelocate: getBoolean(data, "willingToRelocate"),
    referencesAvailable: getBoolean(data, "referencesAvailable"),

    // Numeric field — safe coercion from string
    yearsExperience: getNumber(data, "yearsExperience"),

    // Array fields
    skills: getStringArray(data, "skills"),
    education: getEducationArray(data, "education"),

    rawMarkdown,
  };
}

/**
 * Serialize a Profile back to a .md string with YAML front-matter.
 * Useful for the Options page "Export my data" feature.
 */
export function profileToMarkdown(profile: Profile): string {
  // Build front-matter data — omit rawMarkdown (it's internal metadata)
  const frontMatter: Record<string, unknown> = {
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    workAuth: profile.workAuth,
    noticePeriod: profile.noticePeriod,
    salaryExpectation: profile.salaryExpectation,
    willingToRelocate: profile.willingToRelocate,
    remotePreference: profile.remotePreference,
    currentTitle: profile.currentTitle,
    currentCompany: profile.currentCompany,
    yearsExperience: profile.yearsExperience,
    skills: profile.skills,
    education: profile.education,
    referencesAvailable: profile.referencesAvailable,
  };

  // Only include optional fields if they have a value
  if (profile.linkedin !== undefined) frontMatter.linkedin = profile.linkedin;
  if (profile.github !== undefined) frontMatter.github = profile.github;
  if (profile.portfolio !== undefined) frontMatter.portfolio = profile.portfolio;

  return matter.stringify("", frontMatter);
}

// ---------------------------------------------------------------------------
// Internal extraction helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extract a required string field. On failure, pushes to `errors` and returns
 * undefined so callers can continue collecting all errors before throwing.
 */
function extractRequiredString(
  data: Record<string, unknown>,
  key: string,
  errors: string[],
): string | undefined {
  const raw = data[key];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    const coerced = String(raw).trim();
    if (coerced.length > 0) return coerced;
  }
  errors.push(`${key} — required, must be a non-empty string`);
  return undefined;
}

/**
 * Extract and loosely validate the email field.
 * Does not perform full RFC-5321 validation — just ensures "@" is present.
 */
function extractRequiredEmail(
  data: Record<string, unknown>,
  key: string,
  errors: string[],
): string | undefined {
  const raw = data[key];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length > 0 && trimmed.includes("@")) {
      return trimmed;
    }
  }
  errors.push(`${key} — required, must be a valid email address`);
  return undefined;
}

function getString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function getOptionalString(
  data: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = getString(data, key);
  return value.length > 0 ? value : undefined;
}

function getBoolean(data: Record<string, unknown>, key: string): boolean {
  const value = data[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (normalised === "true" || normalised === "yes" || normalised === "1") return true;
    if (normalised === "false" || normalised === "no" || normalised === "0") return false;
  }
  if (typeof value === "number") return value !== 0;
  return false;
}

function getNumber(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function getStringArray(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function getEducationArray(
  data: Record<string, unknown>,
  key: string,
): Education[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];

  const result: Education[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    result.push({
      degree: getString(item, "degree"),
      institution: getString(item, "institution"),
      year: getNumber(item, "year"),
    });
  }
  return result;
}
