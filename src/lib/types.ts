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
}

export interface JobContext {
  title: string
  company: string
  location: string
  description: string         // scraped job description text
  url: string
}

export interface ExtensionSettings {
  geminiModel: string
  autoSubmit: boolean
  confirmBeforeSubmit: boolean
  claudeApiKey?: string       // dormant in v1, active in next feature
  preferredAiProvider: "gemini" | "claude"  // "gemini" locked in v1
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
  geminiToken: string | null  // OAuth token, managed by chrome.identity
  presets: ProfilePreset[]
}
