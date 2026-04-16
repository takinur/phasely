// src/lib/fieldMap.ts — canonical mapping
export const FIELD_MAP: Record<string, string[]> = {
  // Personal
  "firstName":         ["first_name", "fname", "given-name", "given_name", "firstname", "first-name"],
  "lastName":          ["last_name", "lname", "family-name", "family_name", "lastname", "last-name", "surname"],
  "email":             ["email", "email_address", "emailaddress", "e-mail"],
  "phone":             ["phone", "phone_number", "telephone", "mobile", "cell", "contact_number"],
  "location":          ["location", "city", "address", "current_location", "city_state"],
  "linkedin":          ["linkedin", "linkedin_url", "linkedin_profile"],
  "github":            ["github", "github_url", "github_profile"],
  "portfolio":         ["portfolio", "website", "personal_website", "portfolio_url"],

  // Work auth
  "workAuth":          ["work_authorization", "work_auth", "visa_status", "right_to_work", "sponsorship"],
  "noticePeriod":      ["notice_period", "availability", "start_date", "available_from"],
  "salaryExpectation": ["salary", "salary_expectation", "desired_salary", "compensation", "expected_salary"],
  "willingToRelocate": ["relocate", "relocation", "willing_to_relocate"],
  "remotePreference":  ["remote", "work_type", "work_arrangement", "hybrid"],

  // Role
  "currentTitle":      ["current_title", "job_title", "current_position", "title"],
  "currentCompany":    ["current_company", "current_employer", "company", "employer"],
  "yearsExperience":   ["years_experience", "experience", "years_of_experience"],

  // Open text — handled by AI, not direct fill
  "coverLetter":       ["cover_letter", "cover_letter_text", "covering_letter", "why_us", "motivation"],
  "additionalInfo":    ["additional_information", "anything_else", "other_information"],
}