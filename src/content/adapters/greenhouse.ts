/**
 * adapters/greenhouse.ts — Greenhouse ATS adapter.
 *
 * Greenhouse uses standard HTML forms with predictable name= attributes.
 * This adapter detects Greenhouse pages and applies targeted fill logic
 * on top of the generic detector/filler.
 *
 * Greenhouse field name patterns (common):
 *   first_name, last_name, email, phone, resume (file), cover_letter,
 *   linkedin_profile_url, website, college_name, discipline,
 *   school_year, job_id (hidden), source_id (hidden)
 */

import type { Profile } from "@/lib/types"
import { setValue, setSelectValue } from "@/content/filler"

// ---------------------------------------------------------------------------
// Detect
// ---------------------------------------------------------------------------

/**
 * Returns true if the current page is served from Greenhouse.
 * Greenhouse apps are hosted on greenhouse.io or boards.greenhouse.io,
 * or embedded via the Greenhouse JS embed (detectable via meta tag).
 */
export function detect(): boolean {
  const host = document.location.hostname
  if (host.includes("greenhouse.io")) return true

  // Embedded Greenhouse boards set a meta tag
  const meta = document.querySelector<HTMLMetaElement>('meta[name="greenhouse-job-post"]')
  if (meta) return true

  // Some customers embed via an iframe; check the parent frame URL if accessible
  try {
    if (window.parent !== window) {
      // Cross-origin access will throw; that's fine — we just won't match
      const parentHost = window.parent.location.hostname
      if (parentHost.includes("greenhouse.io")) return true
    }
  } catch {
    // Cross-origin — ignore
  }

  return false
}

// ---------------------------------------------------------------------------
// Fill
// ---------------------------------------------------------------------------

/**
 * Fill Greenhouse-specific fields by their known name= attributes.
 * This supplements the generic detectFields() pass rather than replacing it.
 * Fields that are reliably named in Greenhouse get direct targeted fills.
 */
export function fill(profile: Profile): void {
  try {
    // First name
    const firstNameEl = document.querySelector<HTMLInputElement>(
      'input[name="first_name"]'
    )
    if (firstNameEl) setValue(firstNameEl, profile.firstName)

    // Last name
    const lastNameEl = document.querySelector<HTMLInputElement>(
      'input[name="last_name"]'
    )
    if (lastNameEl) setValue(lastNameEl, profile.lastName)

    // Email
    const emailEl = document.querySelector<HTMLInputElement>('input[name="email"]')
    if (emailEl) setValue(emailEl, profile.email)

    // Phone
    const phoneEl = document.querySelector<HTMLInputElement>('input[name="phone"]')
    if (phoneEl) setValue(phoneEl, profile.phone)

    // LinkedIn
    const linkedinEl = document.querySelector<HTMLInputElement>(
      'input[name="linkedin_profile_url"], input[name="linkedin"]'
    )
    if (linkedinEl && profile.linkedin) setValue(linkedinEl, profile.linkedin)

    // GitHub / website / portfolio
    const websiteEl = document.querySelector<HTMLInputElement>(
      'input[name="website"], input[name="portfolio"]'
    )
    if (websiteEl && profile.portfolio) setValue(websiteEl, profile.portfolio)

    // Location / city
    const locationEl = document.querySelector<HTMLInputElement>(
      'input[name="location"], input[name="city"]'
    )
    if (locationEl) setValue(locationEl, profile.location)

    // Work authorisation / EEOC dropdowns
    const workAuthSelect = document.querySelector<HTMLSelectElement>(
      'select[name="work_authorization"], select[name="visa_status"]'
    )
    if (workAuthSelect) setSelectValue(workAuthSelect, profile.workAuth)

    // Willing to relocate
    const relocateSelect = document.querySelector<HTMLSelectElement>(
      'select[name="relocate"], select[name="willing_to_relocate"]'
    )
    if (relocateSelect) {
      setSelectValue(relocateSelect, profile.willingToRelocate ? "Yes" : "No")
    }

    // Resume file input — only attach if a blob was pre-fetched
    // (The caller is responsible for retrieving the blob from storage and
    // calling setFile directly; this adapter cannot fetch it.)
    const resumeEl = document.querySelector<HTMLInputElement>(
      'input[type="file"][name="resume"], input[type="file"][id*="resume"]'
    )
    if (resumeEl) {
      // Signal availability to the message handler so it can call fillFile()
      resumeEl.dataset.phaselyResumeTarget = "true"
    }
  } catch (err) {
    console.error("[Phasely] greenhouse adapter fill failed:", err)
  }
}
