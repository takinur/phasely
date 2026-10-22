// src/lib/types.ts

export interface Profile {
  firstName: string
  lastName: string
  email: string
  phone: string
  location: string
  linkedin?: string
  github?: string
  portfolio?: string
  workAuth: string
  noticePeriod: string
  salaryExpectation: string
  willingToRelocate: boolean
  remotePreference: string
  currentTitle: string
  currentCompany: string
  yearsExperience: number
  skills: string[]
  education: Education[]
  referencesAvailable: boolean
  rawMarkdown: string        // full .md body, passed to AI as context
}

export interface Education {
  degree: string
  institution: string
  year: number
}

export interface DetectedField {
  element: HTMLElement        // reference to DOM node
  profileKey: string          // matched profile key, e.g. "firstName"
  confidence: number          // 0–1
  currentValue: string        // existing value in field (if any)
  suggestedValue: string      // value from profile
  isAiField: boolean          // true if this needs AI generation
  fieldType: "input" | "textarea" | "select" | "file" | "contenteditable"

  // Knockout guard (feature 2). Optional so existing construction sites that
  // predate the guard stay valid; the detector populates it for every field.
  isKnockout?: boolean
  knockoutCategory?: KnockoutCategory
}

export interface JobContext {
  title: string
  company: string
  location: string
  description: string         // scraped job description text
  url: string
}

// ---------------------------------------------------------------------------
// Knockout questions (feature 2)
//
// These are the only answers that can auto-reject an application outright, so
// they are never filled on autopilot — the popup forces an explicit
// confirmation before submit regardless of match confidence.
// ---------------------------------------------------------------------------

export type KnockoutCategory =
  | "workAuthorization"
  | "sponsorship"
  | "location"
  | "relocation"
  | "travel"
  | "shiftAvailability"
  | "license"
  | "backgroundCheck"
  | "salary"

export interface KnockoutField {
  profileKey: string
  category: KnockoutCategory
  /** The question text as it appears on the page, for the confirm UI. */
  question: string
  suggestedValue: string
  confirmed: boolean
}

// ---------------------------------------------------------------------------
// Ghost-job assessment (feature 3)
//
// Scored entirely from page signals — no network calls, no third-party API.
// ---------------------------------------------------------------------------

export type GhostSignalId =
  | "noSalaryRange"
  | "stalePosting"
  | "repostedListing"
  | "evergreenRequisition"
  | "vagueDescription"
  | "boilerplateDescription"
  | "highApplicantCount"
  | "missingCompanyIdentity"
  | "staffingAgencyPost"
  | "alwaysHiringLanguage"

export interface GhostSignal {
  id: GhostSignalId
  /** Human-readable finding shown in the popup. */
  label: string
  /** Contribution to the composite score, 0–1. */
  weight: number
  /** What we actually observed on the page, for transparency. */
  detail: string
}

/**
 * Everything the scorer needs, collected from the page by the content script.
 * Kept separate from the scorer so scoring stays pure and testable.
 */
export interface GhostEvidence {
  url: string
  company: string
  title: string
  /** Plain text, HTML already stripped. */
  descriptionText: string
  /** Epoch ms the posting claims it was created, or null when unknown. */
  datePosted: number | null
  /** Nearby metadata text ("Reposted 3 weeks ago", "500 applicants"). */
  metaText: string
  /** Applicant count when the page states one, else null. */
  applicantCount: number | null
  /** True when structured data carried a pay range, which beats a text scan. */
  hasStructuredSalary: boolean
  /** Injected so tests are deterministic. */
  now: number
}

export interface GhostJobAssessment {
  /** 0–1 composite. Higher means more likely a low-intent / ghost listing. */
  score: number
  band: "low" | "medium" | "high"
  /** Only the signals that actually fired. */
  signals: GhostSignal[]
  /** How many signals could be evaluated on this page. */
  checked: number
  url: string
}

// ---------------------------------------------------------------------------
// Application tracker (feature 4)
// ---------------------------------------------------------------------------

export type ApplicationStatus =
  | "applied"
  | "screening"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn"
  | "ghosted"

export interface ApplicationRecord {
  id: string
  company: string
  title: string
  location: string
  url: string
  /** Epoch ms. */
  appliedAt: number
  status: ApplicationStatus
  /** Epoch ms of the last status change. */
  lastStatusAt: number
  /** Epoch ms for the next follow-up nudge, or null when none is scheduled. */
  followUpAt: number | null
  notes: string
  /** Snapshot of GhostJobAssessment.score at apply time, when available. */
  ghostScore: number | null
  fieldsFilled: number
}

export interface ExtensionSettings {
  geminiModel: string
  autoSubmit: boolean
  confirmBeforeSubmit: boolean
  claudeApiKey?: string       // dormant in v1, active in next feature

  // Feature 2 — knockout guard
  /** Block submit until every detected knockout answer is confirmed. */
  blockSubmitOnUnconfirmedKnockouts: boolean

  // Feature 3 — ghost-job scoring
  ghostJobWarnings: boolean

  // Feature 4 — tracker
  trackApplications: boolean
  /** Days after applying before a follow-up nudge fires. */
  followUpDays: number
}

export interface StoredResume {
  base64: string     // ArrayBuffer → base64 of the PDF bytes
  filename: string
  mimeType: string
}

export interface ProfilePreset {
  id: string;
  name: string;
  overrides: {
    currentTitle?: string;
    salaryExpectation?: string;
    noticePeriod?: string;
    remotePreference?: string;
    workAuth?: string;
    willingToRelocate?: boolean;
  };
}

export interface StoredData {
  profile: Profile | null
  resume: StoredResume | null
  settings: ExtensionSettings
  presets: ProfilePreset[]
  applications: ApplicationRecord[]
}
