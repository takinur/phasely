/**
 * ProfileSteps.tsx — the three steps of the guided profile form.
 *
 *   1. Contact                 — who you are and how to reach you
 *   2. Eligibility & prefs     — the questions every application form asks
 *   3. Experience              — what you've done, for fills and AI context
 *
 * Steps are presentation only: all state, validation and persistence live in
 * ProfileSetup.tsx. No markdown appears anywhere in here.
 */

import type { ProfileFormField, ProfileFormValues } from "@/lib/profile";
import { FieldPair, TextAreaField, TextField, ToggleField } from "./FormFields";

export interface StepProps {
  values: ProfileFormValues;
  onChange: (patch: Partial<ProfileFormValues>) => void;
  /** Returns a message only once the field is touched or a save was attempted. */
  errorFor: (field: ProfileFormField) => string | undefined;
  onTouch: (field: ProfileFormField) => void;
  /** Index-aligned with values.education. */
  educationErrors: (string | null)[];
}

const WORK_AUTH_SUGGESTIONS = [
  "US Citizen",
  "US Permanent Resident (Green Card)",
  "H-1B visa holder",
  "Requires H-1B sponsorship",
  "EU Citizen",
  "UK Citizen",
  "UK Skilled Worker visa",
  "Canadian Citizen / PR",
  "Requires visa sponsorship",
] as const;

const REMOTE_SUGGESTIONS = ["Remote", "Hybrid", "On-site", "Remote or hybrid", "Flexible"] as const;

const NOTICE_SUGGESTIONS = [
  "Immediately",
  "2 weeks",
  "1 month",
  "2 months",
  "3 months",
] as const;

// ---------------------------------------------------------------------------
// Step 1 — Contact
// ---------------------------------------------------------------------------

export function StepContact({ values, onChange, errorFor, onTouch }: StepProps) {
  return (
    <div className="space-y-4">
      <FieldPair>
        <TextField
          id="firstName"
          label="First name"
          required
          value={values.firstName}
          onChange={(v) => onChange({ firstName: v })}
          onBlur={() => onTouch("firstName")}
          error={errorFor("firstName")}
          placeholder="Alex"
          autoComplete="given-name"
        />
        <TextField
          id="lastName"
          label="Last name"
          required
          value={values.lastName}
          onChange={(v) => onChange({ lastName: v })}
          onBlur={() => onTouch("lastName")}
          error={errorFor("lastName")}
          placeholder="Chen"
          autoComplete="family-name"
        />
      </FieldPair>

      <FieldPair>
        <TextField
          id="email"
          label="Email"
          required
          type="email"
          value={values.email}
          onChange={(v) => onChange({ email: v })}
          onBlur={() => onTouch("email")}
          error={errorFor("email")}
          placeholder="alex.chen@example.com"
          autoComplete="email"
        />
        <TextField
          id="phone"
          label="Phone"
          required
          type="tel"
          value={values.phone}
          onChange={(v) => onChange({ phone: v })}
          onBlur={() => onTouch("phone")}
          error={errorFor("phone")}
          hint="Include the country code if you apply internationally"
          placeholder="+1 415 555 0192"
          autoComplete="tel"
        />
      </FieldPair>

      <TextField
        id="location"
        label="Location"
        required
        value={values.location}
        onChange={(v) => onChange({ location: v })}
        onBlur={() => onTouch("location")}
        error={errorFor("location")}
        hint="City and country — used for location and relocation questions"
        placeholder="San Francisco, CA"
      />

      <TextField
        id="linkedin"
        label="LinkedIn"
        type="url"
        value={values.linkedin}
        onChange={(v) => onChange({ linkedin: v })}
        onBlur={() => onTouch("linkedin")}
        error={errorFor("linkedin")}
        placeholder="https://linkedin.com/in/alexchen"
      />

      <FieldPair>
        <TextField
          id="github"
          label="GitHub"
          type="url"
          value={values.github}
          onChange={(v) => onChange({ github: v })}
          onBlur={() => onTouch("github")}
          error={errorFor("github")}
          placeholder="https://github.com/alexchen"
        />
        <TextField
          id="portfolio"
          label="Portfolio or website"
          type="url"
          value={values.portfolio}
          onChange={(v) => onChange({ portfolio: v })}
          onBlur={() => onTouch("portfolio")}
          error={errorFor("portfolio")}
          placeholder="https://alexchen.dev"
        />
      </FieldPair>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Eligibility & preferences
// ---------------------------------------------------------------------------

export function StepEligibility({ values, onChange, errorFor, onTouch }: StepProps) {
  return (
    <div className="space-y-4">
      <TextField
        id="workAuth"
        label="Work authorisation"
        required
        value={values.workAuth}
        onChange={(v) => onChange({ workAuth: v })}
        onBlur={() => onTouch("workAuth")}
        error={errorFor("workAuth")}
        hint="Pick a suggestion or write your own — a wrong answer here is an instant reject"
        placeholder="US Citizen"
        suggestions={WORK_AUTH_SUGGESTIONS}
      />

      <FieldPair>
        <TextField
          id="remotePreference"
          label="Remote preference"
          value={values.remotePreference}
          onChange={(v) => onChange({ remotePreference: v })}
          onBlur={() => onTouch("remotePreference")}
          error={errorFor("remotePreference")}
          placeholder="Remote"
          suggestions={REMOTE_SUGGESTIONS}
        />
        <TextField
          id="noticePeriod"
          label="Notice period"
          value={values.noticePeriod}
          onChange={(v) => onChange({ noticePeriod: v })}
          onBlur={() => onTouch("noticePeriod")}
          error={errorFor("noticePeriod")}
          placeholder="2 weeks"
          suggestions={NOTICE_SUGGESTIONS}
        />
      </FieldPair>

      <TextField
        id="salaryExpectation"
        label="Salary expectation"
        value={values.salaryExpectation}
        onChange={(v) => onChange({ salaryExpectation: v })}
        onBlur={() => onTouch("salaryExpectation")}
        error={errorFor("salaryExpectation")}
        hint="Free text — a number, a range, or something like 'open to discussion'"
        placeholder="$160,000"
      />

      <div className="options-inset space-y-4 rounded-md border px-4 py-3">
        <ToggleField
          id="willingToRelocate"
          label="Willing to relocate"
          hint="Answers the relocation question on application forms"
          checked={values.willingToRelocate}
          onChange={(v) => onChange({ willingToRelocate: v })}
        />
        <ToggleField
          id="referencesAvailable"
          label="References available on request"
          checked={values.referencesAvailable}
          onChange={(v) => onChange({ referencesAvailable: v })}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Experience
// ---------------------------------------------------------------------------

export function StepExperience({
  values,
  onChange,
  errorFor,
  onTouch,
  educationErrors,
}: StepProps) {
  const skillCount = values.skills
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean).length;

  const updateRow = (index: number, patch: Partial<ProfileFormValues["education"][number]>) => {
    onChange({
      education: values.education.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });
  };

  return (
    <div className="space-y-4">
      <FieldPair>
        <TextField
          id="currentTitle"
          label="Current title"
          value={values.currentTitle}
          onChange={(v) => onChange({ currentTitle: v })}
          onBlur={() => onTouch("currentTitle")}
          error={errorFor("currentTitle")}
          placeholder="Senior Software Engineer"
        />
        <TextField
          id="currentCompany"
          label="Current company"
          value={values.currentCompany}
          onChange={(v) => onChange({ currentCompany: v })}
          onBlur={() => onTouch("currentCompany")}
          error={errorFor("currentCompany")}
          placeholder="Acme Corp"
        />
      </FieldPair>

      <TextField
        id="yearsExperience"
        label="Years of experience"
        value={values.yearsExperience}
        onChange={(v) => onChange({ yearsExperience: v })}
        onBlur={() => onTouch("yearsExperience")}
        error={errorFor("yearsExperience")}
        placeholder="7"
      />

      <TextField
        id="skills"
        label="Skills"
        value={values.skills}
        onChange={(v) => onChange({ skills: v })}
        onBlur={() => onTouch("skills")}
        error={errorFor("skills")}
        hint={
          skillCount > 0
            ? `${skillCount} skill${skillCount === 1 ? "" : "s"} — separate them with commas`
            : "Separate them with commas"
        }
        placeholder="TypeScript, React, Node.js, PostgreSQL"
      />

      {/* Education repeater */}
      <div>
        <span className="options-heading block text-sm font-medium mb-1.5">Education</span>
        <div className="space-y-3">
          {values.education.map((row, index) => (
            <div
              key={index}
              className="options-inset rounded-md border px-3 py-3 space-y-3"
            >
              <FieldPair>
                <TextField
                  id={`education-degree-${index}`}
                  label="Degree"
                  value={row.degree}
                  onChange={(v) => updateRow(index, { degree: v })}
                  placeholder="BSc Computer Science"
                />
                <TextField
                  id={`education-institution-${index}`}
                  label="Institution"
                  value={row.institution}
                  onChange={(v) => updateRow(index, { institution: v })}
                  placeholder="UC Berkeley"
                />
              </FieldPair>
              <div className="flex items-end justify-between gap-4">
                <div className="w-32">
                  <TextField
                    id={`education-year-${index}`}
                    label="Year"
                    value={row.year}
                    onChange={(v) => updateRow(index, { year: v })}
                    onBlur={() => onTouch("education")}
                    error={educationErrors[index] ?? undefined}
                    placeholder="2017"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChange({ education: values.education.filter((_, i) => i !== index) })
                  }
                  className="mb-0.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            onChange({
              education: [...values.education, { degree: "", institution: "", year: "" }],
            })
          }
          className="options-btn-secondary mt-3 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
        >
          {values.education.length === 0 ? "Add education" : "Add another"}
        </button>
      </div>

      <TextAreaField
        id="notes"
        label="Summary and highlights"
        value={values.notes}
        onChange={(v) => onChange({ notes: v })}
        onBlur={() => onTouch("notes")}
        error={errorFor("notes")}
        hint="Optional. This is the context Phasely gives the AI when it writes cover letters and open answers — leave it empty and one is generated from the fields above."
        placeholder={"Results-driven engineer with 7 years building scalable APIs. Led a monolith-to-microservices migration that cut p99 latency by 40%."}
        rows={6}
      />
    </div>
  );
}
