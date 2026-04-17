import matter from "gray-matter";
import type { Education, Profile } from "@/lib/types";

export type ProfileData = Record<string, unknown>;

export function parseProfileMarkdown(markdown: string): ProfileData {
  const parsed = matter(markdown);
  return parsed.data as ProfileData;
}

type RequiredProfileField = "firstName" | "lastName" | "email";

const REQUIRED_FIELDS: RequiredProfileField[] = [
  "firstName",
  "lastName",
  "email",
];

export function parseProfile(markdown: string): Profile {
  const parsed = matter(markdown);
  const data = isRecord(parsed.data) ? parsed.data : {};

  return {
    firstName: getString(data, "firstName"),
    lastName: getString(data, "lastName"),
    email: getString(data, "email"),
    phone: getString(data, "phone"),
    location: getString(data, "location"),
    linkedin: getOptionalString(data, "linkedin"),
    github: getOptionalString(data, "github"),
    portfolio: getOptionalString(data, "portfolio"),
    workAuth: getString(data, "workAuth"),
    noticePeriod: getString(data, "noticePeriod"),
    salaryExpectation: getString(data, "salaryExpectation"),
    willingToRelocate: getBoolean(data, "willingToRelocate"),
    remotePreference: getString(data, "remotePreference"),
    currentTitle: getString(data, "currentTitle"),
    currentCompany: getString(data, "currentCompany"),
    yearsExperience: getNumber(data, "yearsExperience"),
    skills: getStringArray(data, "skills"),
    education: getEducationArray(data, "education"),
    referencesAvailable: getBoolean(data, "referencesAvailable"),
    rawMarkdown: markdown,
  };
}

export function validateProfile(
  profile: Partial<Profile>,
): { valid: boolean; missing: string[] } {
  const missing = REQUIRED_FIELDS.filter((field) => {
    const value = profile[field];
    return typeof value !== "string" || value.trim().length === 0;
  });

  return {
    valid: missing.length === 0,
    missing,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
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
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (normalised === "true" || normalised === "yes") return true;
    if (normalised === "false" || normalised === "no") return false;
  }
  return false;
}

function getNumber(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function getStringArray(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  if (!Array.isArray(value)) {
    return [];
  }

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
  if (!Array.isArray(value)) {
    return [];
  }

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