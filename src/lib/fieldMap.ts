// src/lib/fieldMap.ts — canonical mapping
export const FIELD_MAP: Record<string, string[]> = {
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

  // Open text — handled by AI, not direct fill
  "coverLetter":       ["cover_letter", "coverLetter", "cover_letter_text", "coverletter", "coverletter_text", "cover_letter_content", "covering_letter", "motivation", "motivation_letter", "why_us", "application_message", "letter"],
  "additionalInfo":    ["additional_information", "additionalInformation", "additional_info", "anything_else", "other_information", "other_info", "comments", "comment", "notes", "note", "notes_comments", "personal_statement", "summary", "about_you"],
}