// src/lib/fieldMap.ts — canonical mapping

import type { KnockoutCategory } from "@/lib/types"

const RAW_FIELD_MAP: Record<string, string[]> = {
  // Personal
  "firstName":         ["first_name", "fname", "given-name", "given_name", "givenname", "firstname", "first-name", "first", "legal_first_name", "candidate_first_name", "applicant_first_name", "firstName"],
  "lastName":          ["last_name", "lname", "family-name", "family_name", "familyname", "lastname", "last-name", "surname", "last", "legal_last_name", "candidate_last_name", "applicant_last_name", "lastName"],
  "email":             ["email", "email_address", "emailaddress", "e-mail", "email_addr", "candidate_email", "applicant_email", "primary_email", "work_email"],
  "phone":             ["phone", "phone_number", "phoneNumber", "telephone", "telephone_number", "mobile", "mobile_phone", "cell", "cell_phone", "contact_number", "tel", "tel-national", "tel-area-code", "phone_number_value"],
  "location":          ["location", "city", "address", "street_address", "street-address", "address_line1", "address-line1", "address_line2", "address-level1", "address-level2", "state", "province", "postal_code", "postal-code", "zip", "zip_code", "country", "country-name", "current_location", "city_state", "city_state_zip", "candidate_location"],
  "linkedin":          ["linkedin", "linked_in", "linkedin_url", "linkedin_profile", "linkedinprofile", "linkedinProfile", "linkedin_url", "LinkedIn"],
  "github":            ["github", "github_url", "github_profile", "githubprofile", "Github", "git_hub", "github_link"],
  "portfolio":         ["portfolio", "website", "personal_website", "portfolio_url", "portfolio_link", "personal_site", "personal_url", "other_website", "Other Website", "url", "homepage", "site"],

  // Work auth
  "workAuth":          ["work_authorization", "work_auth", "visa_status", "right_to_work", "right_to_work_status", "employment_authorization", "work_eligibility", "authorized_to_work", "legally_authorized", "sponsorship", "requires_sponsorship", "need_visa_sponsorship", "work_permit", "citizenship_status"],
  "noticePeriod":      ["notice_period", "notice", "availability", "available_from", "available_date", "available_start_date", "earliest_start_date", "start_date", "startdate", "joining_date", "join_date", "when_can_you_start"],
  "salaryExpectation": ["salary", "salary_expectation", "salaryExpectation", "desired_salary", "expected_salary", "salary_range", "compensation", "desired_compensation", "expected_compensation", "compensation_expectation", "compensation_range", "salary_amount"],
  "willingToRelocate": ["relocate", "relocation", "willing_to_relocate", "open_to_relocation", "relocation_preference", "willing_to_move"],
  "remotePreference":  ["remote", "work_type", "work_arrangement", "workplace_type", "workplaceType", "work_mode", "onsite_or_remote", "remote_or_onsite", "hybrid", "onsite"],

  // Role
  "currentTitle":      ["current_title", "currentTitle", "job_title", "current_position", "present_title", "present_position", "organization-title", "professional_title", "role", "title"],
  "currentCompany":    ["current_company", "currentCompany", "current_employer", "company", "company_name", "employer", "employer_name", "organization", "current_organization"],
  "yearsExperience":   ["years_experience", "years_of_experience", "yearsExperience", "total_years_experience", "total_experience", "experience_years", "experience", "yoe"],

  // File upload
  "resumeUrl":         ["resume", "resume_upload", "resumeUpload", "cv", "cv_upload", "cvUpload", "upload_resume", "upload_cv", "resume_file", "cv_file", "attach_resume", "attach_cv", "resume_attachment"],

  // Open text — handled by AI, not direct fill
  "coverLetter":       ["cover_letter", "coverLetter", "cover_letter_text", "coverletter", "coverletter_text", "cover_letter_content", "covering_letter", "motivation", "motivation_letter", "why_us", "application_message", "letter"],
  "additionalInfo":    ["additional_information", "additionalInformation", "additional_info", "anything_else", "other_information", "other_info", "comments", "comment", "notes", "note", "notes_comments", "personal_statement", "summary", "about_you"],
}

function normaliseAlias(alias: string): string {
  return alias.trim().toLowerCase()
}

function buildCanonicalFieldMap(
  source: Record<string, string[]>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {}

  for (const [key, aliases] of Object.entries(source)) {
    const seen = new Set<string>()
    const deduped: string[] = []

    for (const rawAlias of aliases) {
      const alias = normaliseAlias(rawAlias)
      if (!alias || seen.has(alias)) continue

      seen.add(alias)
      deduped.push(alias)
    }

    result[key] = deduped
  }

  return result
}

export const FIELD_MAP: Record<string, string[]> = buildCanonicalFieldMap(
  RAW_FIELD_MAP,
)

// ---------------------------------------------------------------------------
// Knockout question vocabulary
//
// Knockout questions are the answers that can auto-reject an application
// outright (work authorization, sponsorship, relocation, …). They are kept in
// a SEPARATE map from FIELD_MAP on purpose:
//
//   - FIELD_MAP keys are canonical *Profile* keys — the detector resolves a
//     field to one of them and reads a value off the Profile object. Adding
//     question categories there would invent keys with no Profile backing.
//   - KNOCKOUT_FIELD_MAP keys are KnockoutCategory values — they classify the
//     *question being asked*, independent of which profile value answers it.
//
// Both maps go through buildCanonicalFieldMap, so aliases are lowercased,
// trimmed and deduped identically. Aliases here are written as question
// fragments (phrases), not bare column names, because knockout questions show
// up as label text far more often than as tidy `name` attributes.
//
// Expected markdown front-matter keys that answer these:
//   work_auth / workAuth          → workAuthorization, sponsorship
//   willing_to_relocate           → relocation
//   salary_expectation            → salary
//   location                      → location
// ---------------------------------------------------------------------------

const RAW_KNOCKOUT_MAP: Record<KnockoutCategory, string[]> = {
  "workAuthorization": [
    "work authorization", "work authorisation", "work_authorization", "work_auth",
    "authorized to work", "authorised to work", "legally authorized to work",
    "legally authorised to work", "legally authorized", "legally eligible to work",
    "eligible to work", "right to work", "right_to_work", "employment authorization",
    "employment eligibility", "work eligibility", "work permit", "working rights",
    "citizenship status", "are you a citizen", "citizen or permanent resident",
    "permanent resident", "visa status", "immigration status", "e verify",
    "proof of eligibility", "without restriction",
  ],

  "sponsorship": [
    "sponsorship", "requires sponsorship", "require sponsorship", "need sponsorship",
    "visa sponsorship", "require visa sponsorship", "need visa sponsorship",
    "immigration sponsorship", "sponsorship now or in the future",
    "will you require sponsorship", "will you now or in the future require",
    "h1b", "h 1b", "h1b transfer", "tn visa", "opt cpt", "sponsored visa",
  ],

  "location": [
    "where are you located", "where are you based", "current location",
    "are you located", "located in", "country of residence", "country you reside",
    "legally reside", "currently reside", "residency", "work location",
    "preferred work location", "office location", "able to commute",
    "willing to commute", "commuting distance", "commute", "based in",
    "time zone", "timezone", "work onsite", "work from the office",
    "in office days", "hybrid schedule",
  ],

  "relocation": [
    "relocate", "relocation", "willing to relocate", "open to relocation",
    "able to relocate", "would you relocate", "relocation assistance",
    "relocation preference", "willing to move", "prepared to relocate",
  ],

  "travel": [
    "travel", "willing to travel", "able to travel", "travel requirement",
    "travel requirements", "travel percentage", "percent travel", "overnight travel",
    "travel up to", "domestic travel", "international travel", "valid passport",
  ],

  "shiftAvailability": [
    "shift", "shifts", "shift availability", "available shifts", "shift preference",
    "night shift", "swing shift", "graveyard shift", "rotating shift",
    "weekend availability", "work weekends", "willing to work weekends",
    "overtime", "work overtime", "on call", "availability to work",
    "schedule availability", "hours per week", "full time or part time",
  ],

  "license": [
    "license", "licence", "licensure", "drivers license", "driver license",
    "driver s license", "valid driver", "cdl", "commercial driver",
    "professional license", "license number", "certification required",
    "security clearance", "clearance level", "active clearance", "bar admission",
  ],

  "backgroundCheck": [
    "background check", "background screening", "background investigation",
    "criminal record", "criminal history", "convicted", "conviction", "felony",
    "misdemeanor", "drug test", "drug screen", "drug screening",
    "pre employment screening", "credit check", "consent to background check",
    "fingerprint",
  ],

  "salary": [
    "salary expectation", "salary expectations", "desired salary", "expected salary",
    "salary requirement", "salary requirements", "minimum salary", "salary range",
    "compensation expectation", "compensation expectations", "expected compensation",
    "desired compensation", "base salary expectation", "pay expectation",
    "expected ctc", "current ctc", "hourly rate expectation", "desired rate",
  ],
}

/**
 * Canonical knockout vocabulary: KnockoutCategory → deduped lowercase aliases.
 * Consumed by `classifyKnockout` in src/lib/knockout.ts.
 */
export const KNOCKOUT_FIELD_MAP = buildCanonicalFieldMap(
  RAW_KNOCKOUT_MAP,
) as Record<KnockoutCategory, string[]>

/**
 * Profile keys whose answer is *inherently* a knockout, whatever the question
 * text looks like. Used as the floor in `classifyKnockout` so a field that
 * matched one of these keys is still gated even when its label text was too
 * unusual to classify.
 *
 * Deliberately narrow: `location` and `remotePreference` are NOT here because
 * every plain city/state/country input would then demand a manual confirm.
 * Those categories are still reachable through the question-phrase aliases.
 */
export const KNOCKOUT_PROFILE_KEYS: Record<string, KnockoutCategory> = {
  workAuth: "workAuthorization",
  willingToRelocate: "relocation",
  salaryExpectation: "salary",
}
