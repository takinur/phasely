/**
 * adapters/lever.ts — Lever ATS adapter.
 *
 * Lever hosts applications on jobs.lever.co and uses standard HTML forms
 * with consistent name= patterns. This adapter targets those patterns
 * directly, supplementing the generic detector pass.
 *
 * Common Lever field names:
 *   name (full name — split from profile), email, phone, org (current company),
 *   urls[LinkedIn], urls[GitHub], urls[Portfolio], resume (file)
 */

import type { Profile } from "@/lib/types"
import { setValue, setSelectValue } from "@/content/filler"

// ---------------------------------------------------------------------------
// Detect
// ---------------------------------------------------------------------------

/**
 * Returns true if the current page is served from Lever's job board.
 */
export function detect(): boolean {
  const host = document.location.hostname

  if (host.includes("lever.co")) return true
  if (host.includes("jobs.lever.co")) return true

  // Some companies use a custom domain but include a Lever-specific meta tag
  const meta = document.querySelector<HTMLMetaElement>('meta[name="lever-job-posting"]')
  if (meta) return true

  // Lever embeds a script tag with a recognisable src pattern
  const leverScript = document.querySelector('script[src*="lever.co"]')
  if (leverScript) return true

  return false
}

// ---------------------------------------------------------------------------
// Fill
// ---------------------------------------------------------------------------

/**
 * Fill Lever-specific form fields by their known name= / id patterns.
 * Lever uses a single "name" field for full name on some posting types;
 * we concatenate first + last when that is the only option.
 */
export function fill(profile: Profile): void {
  try {
    // Full name field (Lever sometimes uses a combined field)
    const fullNameEl = document.querySelector<HTMLInputElement>(
      'input[name="name"], input[id="name"]'
    )
    if (fullNameEl) {
      setValue(fullNameEl, `${profile.firstName} ${profile.lastName}`.trim())
    } else {
      // Split name fields (newer Lever versions)
      const firstEl = document.querySelector<HTMLInputElement>(
        'input[name="first_name"], input[id="first_name"]'
      )
      if (firstEl) setValue(firstEl, profile.firstName)

      const lastEl = document.querySelector<HTMLInputElement>(
        'input[name="last_name"], input[id="last_name"]'
      )
      if (lastEl) setValue(lastEl, profile.lastName)
    }

    // Email
    const emailEl = document.querySelector<HTMLInputElement>(
      'input[name="email"], input[id="email"]'
    )
    if (emailEl) setValue(emailEl, profile.email)

    // Phone
    const phoneEl = document.querySelector<HTMLInputElement>(
      'input[name="phone"], input[id="phone"]'
    )
    if (phoneEl) setValue(phoneEl, profile.phone)

    // Current company / org
    const orgEl = document.querySelector<HTMLInputElement>(
      'input[name="org"], input[name="company"], input[id="org"]'
    )
    if (orgEl) setValue(orgEl, profile.currentCompany)

    // LinkedIn — Lever uses urls[LinkedIn]
    const linkedinEl = document.querySelector<HTMLInputElement>(
      'input[name="urls[LinkedIn]"], input[name="linkedin"]'
    )
    if (linkedinEl && profile.linkedin) setValue(linkedinEl, profile.linkedin)

    // GitHub
    const githubEl = document.querySelector<HTMLInputElement>(
      'input[name="urls[GitHub]"], input[name="github"]'
    )
    if (githubEl && profile.github) setValue(githubEl, profile.github)

    // Portfolio / personal website
    const portfolioEl = document.querySelector<HTMLInputElement>(
      'input[name="urls[Portfolio]"], input[name="urls[Other Website]"], input[name="website"]'
    )
    if (portfolioEl && profile.portfolio) setValue(portfolioEl, profile.portfolio)

    // Location
    const locationEl = document.querySelector<HTMLInputElement>(
      'input[name="location"], input[id="location"]'
    )
    if (locationEl) setValue(locationEl, profile.location)

    // Work authorisation dropdowns (Lever EEOC section)
    const workAuthSelect = document.querySelector<HTMLSelectElement>(
      'select[name="eeo[workAuthorization]"], select[name="work_authorization"]'
    )
    if (workAuthSelect) setSelectValue(workAuthSelect, profile.workAuth)

    // Salary expectation
    const salaryEl = document.querySelector<HTMLInputElement>(
      'input[name="salary"], input[name="salary_expectation"]'
    )
    if (salaryEl) setValue(salaryEl, profile.salaryExpectation)

    // Resume file input — mark for the message handler
    const resumeEl = document.querySelector<HTMLInputElement>(
      'input[type="file"][name="resume"], input[type="file"][id*="resume"]'
    )
    if (resumeEl) {
      resumeEl.dataset.phaselyResumeTarget = "true"
    }
  } catch (err) {
    console.error("[Phasely] lever adapter fill failed:", err)
  }
}
