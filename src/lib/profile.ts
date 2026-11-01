import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Education, Profile } from "@/lib/types";

// ---------------------------------------------------------------------------
// Minimal front-matter parser (replaces gray-matter, no Node.js deps)
// ---------------------------------------------------------------------------

/**
 * Split a markdown string into its YAML front-matter data object and the
 * remaining body text. Handles both LF and CRLF line endings.
 *
 * Returns `{ data: {}, content: markdown }` when no front-matter is found.
 */
function extractFrontMatter(markdown: string): { data: unknown; content: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { data: {}, content: markdown };
  // Let YAML errors propagate — callers wrap with try/catch and surface a clear message.
  const data = parseYaml(match[1]) as unknown;
  const content = markdown.slice(match[0].length);
  return { data, content };
}

// ---------------------------------------------------------------------------
// Prompt-injection defence
// ---------------------------------------------------------------------------

/**
 * Phrases that are strong signals of prompt-injection attempts embedded in
 * user-supplied profile text. Each pattern is written without the `g` flag so
 * it can be safely reused across multiple `.test()` calls.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above|the\s+above|earlier)\s*(instructions?|rules?|prompts?|directives?|context)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s*(instructions?|rules?|prompts?|directives?)/i,
  /forget\s+(all\s+)?(previous|prior|above)\s*(instructions?|rules?|context|prompts?)/i,
  /you\s+are\s+now\s+(a\s+|an\s+|the\s+)?\w/i,
  /act\s+as\s+(if\s+(you\s+are\s+)?|a\s+|an\s+)/i,
  /pretend\s+(you\s+are|to\s+be)\s+/i,
  /your\s+new\s+(instructions?|task|role|purpose|goal|objective)/i,
  /override\s+(previous|prior|all)?\s*(instructions?|rules?|constraints?)/i,
  /new\s+instructions?\s*:/i,
  /\[?\s*(system|assistant|human)\s*\]?\s*:/i,
];

/**
 * Scan raw markdown for prompt-injection patterns.
 * Returns an array of matched snippets (empty when clean).
 * Exported so the Options page can show a live warning before saving.
 */
export function detectInjection(raw: string): string[] {
  const flagged: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    const match = raw.match(new RegExp(pattern.source, "gi"));
    if (match) {
      for (const m of match) {
        if (!flagged.includes(m)) flagged.push(m);
      }
    }
  }
  return flagged;
}

/**
 * Sanitize raw markdown before it is stored and sent to Gemini.
 * Lines that contain injection patterns are replaced with a neutral placeholder
 * so the rest of the profile remains intact.
 */
export function sanitizeRawMarkdown(raw: string): string {
  return raw
    .split("\n")
    .map((line) =>
      INJECTION_PATTERNS.some((p) => p.test(line))
        ? "[line removed by Phasely security filter]"
        : line,
    )
    .join("\n");
}

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
  try {
    if (!markdown.trim()) {
      throw new ProfileParseError(["Profile is empty — paste your profile.md content"]);
    }
    // Check for the opening --- fence before attempting to parse, so users get a
    // clear message instead of "firstName required" when the front-matter is absent.
    if (!/^---/.test(markdown.trimStart())) {
      throw new ProfileParseError([
        "Missing YAML front-matter — profile must start with --- on the first line, followed by your fields (e.g. firstName: Alex)",
      ]);
    }
    const { data } = extractFrontMatter(markdown);
    return validateProfile(isRecord(data) ? data : {}, markdown);
  } catch (err) {
    if (err instanceof ProfileParseError) throw err;
    // YAML syntax error — re-throw as a ProfileParseError with a useful message
    // so the Options page can display it instead of "firstName cannot be empty".
    throw new ProfileParseError([`YAML syntax error — ${String(err)}`]);
  }
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

    rawMarkdown: sanitizeRawMarkdown(rawMarkdown),
  };
}

/**
 * Serialize a Profile back to a .md string with YAML front-matter.
 * Preserves the original markdown body (Summary, Experience, etc.) that was
 * stored in rawMarkdown so saving doesn't silently erase the user's prose.
 */
export function profileToMarkdown(profile: Profile): string {
  return assembleMarkdown(profile, extractMarkdownBody(profile.rawMarkdown));
}

/**
 * Build a complete, valid profile.md for a Profile — front-matter plus a body.
 *
 * Differs from profileToMarkdown in one way that matters: when the profile has
 * no prose body (which is the case for every profile created through the guided
 * form), a body is *synthesized* from the structured fields. rawMarkdown is the
 * context the AI generation path consumes, so it must never be empty just
 * because the user never opened a markdown editor.
 */
export function buildProfileMarkdown(profile: Profile): string {
  const body = extractMarkdownBody(profile.rawMarkdown) || synthesizeMarkdownBody(profile);
  return assembleMarkdown(profile, body);
}

/**
 * Front-matter block + optional body, with a blank line between them.
 * Single source of truth for markdown layout.
 */
function assembleMarkdown(profile: Profile, body: string): string {
  const yamlSection = `---\n${stringifyYaml(buildFrontMatterData(profile))}---\n`;
  const trimmedBody = body.trim();
  return trimmedBody ? `${yamlSection}\n${trimmedBody}\n` : yamlSection;
}

/**
 * Everything after the front-matter fence. Returns "" when the markdown is
 * front-matter only, or when there is no front-matter fence at all.
 */
function extractMarkdownBody(rawMarkdown: string): string {
  const bodyMatch = rawMarkdown.match(
    /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)([\s\S]*)$/,
  );
  return (bodyMatch ? bodyMatch[1] : "").trim();
}

/**
 * Compose a readable prose body out of the structured fields, so a
 * form-authored profile still gives the AI something to work with.
 * Sections with no data are omitted entirely.
 */
function synthesizeMarkdownBody(profile: Profile): string {
  const sections: string[] = [];

  const summarySentences: string[] = [];
  if (profile.currentTitle && profile.currentCompany) {
    summarySentences.push(`${profile.currentTitle} at ${profile.currentCompany}.`);
  } else if (profile.currentTitle) {
    summarySentences.push(`${profile.currentTitle}.`);
  } else if (profile.currentCompany) {
    summarySentences.push(`Currently at ${profile.currentCompany}.`);
  }
  if (profile.yearsExperience > 0) {
    summarySentences.push(
      `${profile.yearsExperience} year${profile.yearsExperience === 1 ? "" : "s"} of professional experience.`,
    );
  }
  if (profile.location) summarySentences.push(`Based in ${profile.location}.`);
  if (profile.workAuth) summarySentences.push(`Work authorisation: ${profile.workAuth}.`);
  if (summarySentences.length > 0) {
    sections.push(`## Summary\n\n${summarySentences.join(" ")}`);
  }

  if (profile.skills.length > 0) {
    sections.push(`## Skills\n\n${profile.skills.join(", ")}`);
  }

  if (profile.education.length > 0) {
    const lines = profile.education
      .map((entry) => {
        const parts = [entry.degree, entry.institution].filter(Boolean).join(" — ");
        return entry.year > 0 ? `- ${parts} (${entry.year})` : `- ${parts}`;
      })
      .filter((line) => line.trim() !== "-");
    if (lines.length > 0) sections.push(`## Education\n\n${lines.join("\n")}`);
  }

  const preferences: string[] = [];
  if (profile.remotePreference) preferences.push(`- Remote preference: ${profile.remotePreference}`);
  if (profile.noticePeriod) preferences.push(`- Notice period: ${profile.noticePeriod}`);
  if (profile.salaryExpectation) preferences.push(`- Salary expectation: ${profile.salaryExpectation}`);
  preferences.push(`- Willing to relocate: ${profile.willingToRelocate ? "yes" : "no"}`);
  if (preferences.length > 1) {
    sections.push(`## Preferences\n\n${preferences.join("\n")}`);
  }

  return sections.join("\n\n");
}

/** Front-matter key/value map. Shared by every serializer above. */
function buildFrontMatterData(profile: Profile): Record<string, unknown> {
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

  return frontMatter;
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

// ---------------------------------------------------------------------------
// Guided form model — the primary (markdown-free) authoring path
//
// Everything a user types in the setup form lives here as plain strings, which
// is what <input> elements actually produce. Coercion to the typed Profile
// happens in exactly one place (formValuesToProfile), and markdown is
// synthesized rather than hand-authored.
// ---------------------------------------------------------------------------

export interface EducationFormRow {
  degree: string;
  institution: string;
  /** Kept as a string so a half-typed year isn't coerced to 0 mid-keystroke. */
  year: string;
}

export interface ProfileFormValues {
  // Step 1 — Contact
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;

  // Step 2 — Eligibility & preferences
  workAuth: string;
  willingToRelocate: boolean;
  remotePreference: string;
  noticePeriod: string;
  salaryExpectation: string;

  // Step 3 — Experience
  currentTitle: string;
  currentCompany: string;
  yearsExperience: string;
  /** Comma-separated in the form; split into Profile.skills on save. */
  skills: string;
  education: EducationFormRow[];

  // Extras that have no step of their own
  github: string;
  portfolio: string;
  referencesAvailable: boolean;
  /**
   * Free-text prose that becomes the markdown body — and therefore the context
   * the AI generation path reads. Optional; a body is synthesized when empty.
   */
  notes: string;
}

export type ProfileFormField = keyof ProfileFormValues;

export const EMPTY_PROFILE_FORM: ProfileFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  location: "",
  linkedin: "",
  workAuth: "",
  willingToRelocate: false,
  remotePreference: "",
  noticePeriod: "",
  salaryExpectation: "",
  currentTitle: "",
  currentCompany: "",
  yearsExperience: "",
  skills: "",
  education: [],
  github: "",
  portfolio: "",
  referencesAvailable: false,
  notes: "",
};

export const PROFILE_FIELD_LABELS: Record<ProfileFormField, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  linkedin: "LinkedIn",
  workAuth: "Work authorisation",
  willingToRelocate: "Willing to relocate",
  remotePreference: "Remote preference",
  noticePeriod: "Notice period",
  salaryExpectation: "Salary expectation",
  currentTitle: "Current title",
  currentCompany: "Current company",
  yearsExperience: "Years of experience",
  skills: "Skills",
  education: "Education",
  github: "GitHub",
  portfolio: "Portfolio",
  referencesAvailable: "References available",
  notes: "Summary / notes",
};

/**
 * The only fields that gate a first fill. Everything else is a soft nudge —
 * never a blocking error.
 */
export const FILL_REQUIRED_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "location",
  "workAuth",
] as const satisfies readonly ProfileFormField[];

/**
 * Fields that measurably improve fill coverage but must never block the user.
 * Drives the "N fields left to improve your match rate" nudge.
 */
export const RECOMMENDED_FIELDS = [
  "linkedin",
  "currentTitle",
  "currentCompany",
  "yearsExperience",
  "skills",
  "education",
  "remotePreference",
  "noticePeriod",
  "salaryExpectation",
] as const satisfies readonly ProfileFormField[];

export type ProfileFormErrors = Partial<Record<ProfileFormField, string>>;

export interface ProfileFormValidation {
  /** Per-field message, shown inline next to the input it belongs to. */
  errors: ProfileFormErrors;
  /** Per-row message for the education repeater, index-aligned with `education`. */
  educationErrors: (string | null)[];
  /** Gating fields that are still missing or invalid. */
  blocking: ProfileFormField[];
  /** Optional fields worth filling in, for the soft nudge. */
  nudges: ProfileFormField[];
  /** True when all FILL_REQUIRED_FIELDS are present and valid. */
  readyToFill: boolean;
  /** True when the three fields parseProfile insists on are valid. */
  savable: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_ALLOWED_RE = /^[+()\-.\s\d]+$/;
const URL_RE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/;

/**
 * Validate form values field by field. Returns messages written for a job
 * seeker, not a developer — they render next to the offending input.
 *
 * Never throws: the form stays usable while it is incomplete.
 */
export function validateProfileForm(values: ProfileFormValues): ProfileFormValidation {
  const errors: ProfileFormErrors = {};

  if (!values.firstName.trim()) errors.firstName = "Enter your first name";
  if (!values.lastName.trim()) errors.lastName = "Enter your last name";

  const email = values.email.trim();
  if (!email) {
    errors.email = "Enter your email address";
  } else if (!EMAIL_RE.test(email)) {
    errors.email = "That doesn't look like an email address";
  }

  const phone = values.phone.trim();
  if (!phone) {
    errors.phone = "Enter a phone number — most application forms require one";
  } else if (!PHONE_ALLOWED_RE.test(phone) || digitCount(phone) < 7 || digitCount(phone) > 15) {
    errors.phone = "That doesn't look like a phone number";
  }

  if (!values.location.trim()) {
    errors.location = "Enter a city and country, e.g. Berlin, Germany";
  }

  if (!values.workAuth.trim()) {
    errors.workAuth = "Enter your work authorisation — forms ask about it constantly";
  }

  for (const key of ["linkedin", "github", "portfolio"] as const) {
    const value = values[key].trim();
    if (value && !URL_RE.test(value)) {
      errors[key] = "That doesn't look like a link";
    }
  }

  const years = values.yearsExperience.trim();
  if (years) {
    const parsed = Number(years);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 60) {
      errors.yearsExperience = "Enter a number of years between 0 and 60";
    }
  }

  const educationErrors = values.education.map((row) => {
    const hasText = Boolean(row.degree.trim() || row.institution.trim());
    const year = row.year.trim();
    if (year) {
      const parsed = Number(year);
      const maxYear = new Date().getFullYear() + 10;
      if (!Number.isInteger(parsed) || parsed < 1900 || parsed > maxYear) {
        return `Enter a year between 1900 and ${maxYear}`;
      }
    }
    if (!hasText && year) return "Add the degree or institution for this entry";
    return null;
  });
  if (educationErrors.some((e) => e !== null)) {
    errors.education = "Check the highlighted education entries";
  }

  const blocking = FILL_REQUIRED_FIELDS.filter((field) => errors[field] !== undefined);
  const nudges = RECOMMENDED_FIELDS.filter((field) => isFormFieldEmpty(values, field));

  return {
    errors,
    educationErrors,
    blocking: [...blocking],
    nudges: [...nudges],
    readyToFill: blocking.length === 0,
    savable:
      errors.firstName === undefined &&
      errors.lastName === undefined &&
      errors.email === undefined,
  };
}

function digitCount(value: string): number {
  return value.replace(/\D/g, "").length;
}

function isFormFieldEmpty(values: ProfileFormValues, field: ProfileFormField): boolean {
  const value = values[field];
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) {
    return value.every((row) => !row.degree.trim() && !row.institution.trim());
  }
  return false;
}

/**
 * Readiness of an already-stored Profile, for the popup's first-fill gate.
 * Returns human labels so the caller can render them directly.
 */
export function fillReadiness(profile: Profile | null): { ready: boolean; missing: string[] } {
  if (!profile) {
    return { ready: false, missing: FILL_REQUIRED_FIELDS.map((f) => PROFILE_FIELD_LABELS[f]) };
  }
  const missing = FILL_REQUIRED_FIELDS.filter((field) => {
    const value = profile[field];
    return typeof value !== "string" || value.trim().length === 0;
  }).map((field) => PROFILE_FIELD_LABELS[field]);
  return { ready: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Form <-> Profile <-> markdown conversion
// ---------------------------------------------------------------------------

/**
 * Hydrate the guided form from a stored Profile (or produce an empty form).
 * The markdown body is surfaced verbatim in `notes` so prose written by a
 * power user in the markdown view survives a trip through the form.
 */
export function profileToFormValues(profile: Profile | null): ProfileFormValues {
  if (!profile) return { ...EMPTY_PROFILE_FORM, education: [] };
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    linkedin: profile.linkedin ?? "",
    workAuth: profile.workAuth,
    willingToRelocate: profile.willingToRelocate,
    remotePreference: profile.remotePreference,
    noticePeriod: profile.noticePeriod,
    salaryExpectation: profile.salaryExpectation,
    currentTitle: profile.currentTitle,
    currentCompany: profile.currentCompany,
    yearsExperience: profile.yearsExperience > 0 ? String(profile.yearsExperience) : "",
    skills: profile.skills.join(", "),
    education: profile.education.map((entry) => ({
      degree: entry.degree,
      institution: entry.institution,
      year: entry.year > 0 ? String(entry.year) : "",
    })),
    github: profile.github ?? "",
    portfolio: profile.portfolio ?? "",
    referencesAvailable: profile.referencesAvailable,
    notes: extractMarkdownBody(profile.rawMarkdown),
  };
}

/**
 * Turn form values into the front-matter map the serializers expect.
 * Internal: callers want buildProfileMarkdownFromForm or formValuesToProfile.
 */
function formValuesToFrontMatter(values: ProfileFormValues): Record<string, unknown> {
  const data: Record<string, unknown> = {
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    email: values.email.trim(),
    phone: values.phone.trim(),
    location: values.location.trim(),
    workAuth: values.workAuth.trim(),
    noticePeriod: values.noticePeriod.trim(),
    salaryExpectation: values.salaryExpectation.trim(),
    willingToRelocate: values.willingToRelocate,
    remotePreference: values.remotePreference.trim(),
    currentTitle: values.currentTitle.trim(),
    currentCompany: values.currentCompany.trim(),
    yearsExperience: toYears(values.yearsExperience),
    skills: splitSkills(values.skills),
    education: values.education
      .filter((row) => row.degree.trim() || row.institution.trim())
      .map((row) => ({
        degree: row.degree.trim(),
        institution: row.institution.trim(),
        year: toYear(row.year),
      })),
    referencesAvailable: values.referencesAvailable,
  };

  for (const key of ["linkedin", "github", "portfolio"] as const) {
    const value = values[key].trim();
    if (value) data[key] = value;
  }

  return data;
}

/**
 * Synthesize a complete profile.md from form values.
 *
 * This is what the Options page sends to SAVE_PROFILE: the service worker
 * still parses markdown, so the guided form and the markdown path converge on
 * one storage path — and rawMarkdown is always populated for the AI context.
 *
 * Deliberately NOT sanitized here: sanitization happens inside validateProfile
 * when rawMarkdown is attached, so front-matter YAML can never be corrupted by
 * a placeholder line dropped mid-document. Never throws.
 */
export function buildProfileMarkdownFromForm(values: ProfileFormValues): string {
  const frontMatter = formValuesToFrontMatter(values);
  const yamlSection = `---\n${stringifyYaml(frontMatter)}---\n`;
  const notes = values.notes.trim();
  const body = notes || synthesizeMarkdownBody(draftProfileFromFrontMatter(frontMatter));
  return body ? `${yamlSection}\n${body}\n` : yamlSection;
}

/**
 * Build a validated Profile straight from form values, with rawMarkdown
 * populated by the synthesizer.
 *
 * Throws ProfileParseError when firstName / lastName / email are missing — the
 * same contract as parseProfile, because it routes through it.
 */
export function formValuesToProfile(values: ProfileFormValues): Profile {
  return parseProfile(buildProfileMarkdownFromForm(values));
}

/**
 * A Profile-shaped value used only to feed synthesizeMarkdownBody before the
 * real validation pass. Not exported: it skips required-field checks.
 */
function draftProfileFromFrontMatter(data: Record<string, unknown>): Profile {
  return {
    firstName: getString(data, "firstName"),
    lastName: getString(data, "lastName"),
    email: getString(data, "email"),
    phone: getString(data, "phone"),
    location: getString(data, "location"),
    workAuth: getString(data, "workAuth"),
    noticePeriod: getString(data, "noticePeriod"),
    salaryExpectation: getString(data, "salaryExpectation"),
    remotePreference: getString(data, "remotePreference"),
    currentTitle: getString(data, "currentTitle"),
    currentCompany: getString(data, "currentCompany"),
    linkedin: getOptionalString(data, "linkedin"),
    github: getOptionalString(data, "github"),
    portfolio: getOptionalString(data, "portfolio"),
    willingToRelocate: getBoolean(data, "willingToRelocate"),
    referencesAvailable: getBoolean(data, "referencesAvailable"),
    yearsExperience: getNumber(data, "yearsExperience"),
    skills: getStringArray(data, "skills"),
    education: getEducationArray(data, "education"),
    rawMarkdown: "",
  };
}

function splitSkills(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toYears(raw: string): number {
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function toYear(raw: string): number {
  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}
