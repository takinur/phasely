/**
 * adapters/workday.ts — Workday ATS adapter.
 *
 * Workday applications are heavily built with Shadow DOM. Standard
 * document.querySelector calls do not reach inside shadow roots, so
 * this adapter uses recursive shadow DOM traversal to locate fields.
 *
 * Workday hostnames: *.workday.com, *.myworkdayjobs.com
 *
 * Workday uses data-automation-id attributes on its components as stable
 * identifiers. These are more reliable than name= on Workday pages.
 */

import type { Profile } from "@/lib/types"
import { setValue, setSelectValue } from "@/content/filler"

// ---------------------------------------------------------------------------
// Detect
// ---------------------------------------------------------------------------

/**
 * Returns true if the current page is a Workday application.
 */
export function detect(): boolean {
  const host = document.location.hostname
  if (host.includes("workday.com")) return true
  if (host.includes("myworkdayjobs.com")) return true
  return false
}

// ---------------------------------------------------------------------------
// Shadow DOM utilities
// ---------------------------------------------------------------------------

/**
 * Recursively query an element (or document) for all elements matching
 * a CSS selector, including those inside shadow roots.
 */
function deepQueryAll<T extends HTMLElement>(
  root: Document | Element | ShadowRoot,
  selector: string
): T[] {
  const results: T[] = []

  // Query in current root
  const found = Array.from((root as Element).querySelectorAll<T>(selector))
  results.push(...found)

  // Walk all elements in this root to find shadow roots
  const all = Array.from((root as Element).querySelectorAll("*"))
  for (const el of all) {
    const shadow = (el as HTMLElement).shadowRoot
    if (shadow) {
      const nested = deepQueryAll<T>(shadow, selector)
      results.push(...nested)
    }
  }

  return results
}

/**
 * Find a single element matching a CSS selector in the full shadow DOM tree.
 */
function deepQuery<T extends HTMLElement>(
  root: Document | Element | ShadowRoot,
  selector: string
): T | null {
  const results = deepQueryAll<T>(root, selector)
  return results[0] ?? null
}

// ---------------------------------------------------------------------------
// Workday field resolvers
// ---------------------------------------------------------------------------

/**
 * Find a Workday input by its data-automation-id attribute value.
 * Workday uses these as stable identifiers across locales.
 */
function findByAutomationId(id: string): HTMLInputElement | null {
  // The actual <input> may be nested inside the shadow component
  const wrapper = deepQuery<HTMLElement>(document, `[data-automation-id="${id}"]`)
  if (!wrapper) return null

  // Try the wrapper itself first
  if (wrapper instanceof HTMLInputElement) return wrapper

  // Otherwise find the input within it (could be in a shadow root)
  const nested = deepQuery<HTMLInputElement>(wrapper, "input")
  return nested
}

/**
 * Find a Workday select/listbox by automation ID.
 */
function findSelectByAutomationId(id: string): HTMLSelectElement | null {
  const wrapper = deepQuery<HTMLElement>(document, `[data-automation-id="${id}"]`)
  if (!wrapper) return null
  if (wrapper instanceof HTMLSelectElement) return wrapper
  return deepQuery<HTMLSelectElement>(wrapper, "select")
}

/**
 * Find a Workday text input by its label text, using aria associations
 * inside shadow DOM.
 */
function findByLabel(labelText: string): HTMLInputElement | null {
  const normLabel = labelText.toLowerCase().trim()

  // Collect all inputs from the entire shadow DOM tree
  const inputs = deepQueryAll<HTMLInputElement>(document, "input")

  for (const input of inputs) {
    // Check aria-label
    const ariaLabel = input.getAttribute("aria-label")
    if (ariaLabel && ariaLabel.toLowerCase().trim() === normLabel) return input

    // Check aria-labelledby
    const labelledBy = input.getAttribute("aria-labelledby")
    if (labelledBy) {
      for (const refId of labelledBy.split(/\s+/)) {
        const refEl = document.getElementById(refId)
        if (refEl?.textContent?.trim().toLowerCase() === normLabel) return input
      }
    }

    // Check explicit label
    if (input.id) {
      const labelEl = document.querySelector<HTMLLabelElement>(
        `label[for="${CSS.escape(input.id)}"]`
      )
      if (labelEl?.textContent?.trim().toLowerCase() === normLabel) return input
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Fill
// ---------------------------------------------------------------------------

/**
 * Fill Workday-specific fields using automation IDs and label-based lookup.
 * Workday's SPA re-renders aggressively; we dispatch events after each fill
 * to trigger Workday's internal React state update cycle.
 */
export function fill(profile: Profile): void {
  try {
    // --- Personal information ---

    // First name (Workday automation ID)
    const firstNameEl =
      findByAutomationId("legalNameSection_firstName") ??
      findByAutomationId("firstName") ??
      findByLabel("first name")
    if (firstNameEl) setValue(firstNameEl, profile.firstName)

    // Last name
    const lastNameEl =
      findByAutomationId("legalNameSection_lastName") ??
      findByAutomationId("lastName") ??
      findByLabel("last name")
    if (lastNameEl) setValue(lastNameEl, profile.lastName)

    // Email
    const emailEl =
      findByAutomationId("email") ??
      findByAutomationId("emailAddress") ??
      findByLabel("email address") ??
      findByLabel("email")
    if (emailEl) setValue(emailEl, profile.email)

    // Phone
    const phoneEl =
      findByAutomationId("phone") ??
      findByAutomationId("phoneNumber") ??
      findByLabel("phone number") ??
      findByLabel("mobile phone")
    if (phoneEl) setValue(phoneEl, profile.phone)

    // Address / location
    const cityEl =
      findByAutomationId("city") ??
      findByAutomationId("addressCity") ??
      findByLabel("city")
    if (cityEl) setValue(cityEl, profile.location)

    // --- Professional ---

    // LinkedIn
    if (profile.linkedin) {
      const linkedinEl =
        findByAutomationId("linkedIn") ??
        findByAutomationId("linkedInProfile") ??
        findByLabel("linkedin url") ??
        findByLabel("linkedin profile url")
      if (linkedinEl) setValue(linkedinEl, profile.linkedin)
    }

    // Portfolio / website
    if (profile.portfolio) {
      const websiteEl =
        findByAutomationId("website") ??
        findByAutomationId("portfolioUrl") ??
        findByLabel("website") ??
        findByLabel("portfolio url")
      if (websiteEl) setValue(websiteEl, profile.portfolio)
    }

    // Current title
    const titleEl =
      findByAutomationId("jobTitle") ??
      findByAutomationId("currentJobTitle") ??
      findByLabel("current job title") ??
      findByLabel("job title")
    if (titleEl) setValue(titleEl, profile.currentTitle)

    // Current company
    const companyEl =
      findByAutomationId("currentCompany") ??
      findByAutomationId("companyName") ??
      findByLabel("current company") ??
      findByLabel("company")
    if (companyEl) setValue(companyEl, profile.currentCompany)

    // Years of experience
    const yoeEl =
      findByAutomationId("yearsExperience") ??
      findByAutomationId("totalYearsOfExperience") ??
      findByLabel("years of experience")
    if (yoeEl) setValue(yoeEl, profile.yearsExperience.toString())

    // Salary expectation
    const salaryEl =
      findByAutomationId("desiredSalary") ??
      findByAutomationId("salaryExpectation") ??
      findByLabel("desired salary") ??
      findByLabel("salary expectation")
    if (salaryEl) setValue(salaryEl, profile.salaryExpectation)

    // Notice period
    const noticeEl =
      findByAutomationId("noticePeriod") ??
      findByAutomationId("availableStartDate") ??
      findByLabel("notice period") ??
      findByLabel("when can you start")
    if (noticeEl) setValue(noticeEl, profile.noticePeriod)

    // --- Dropdowns ---

    // Work authorisation
    const workAuthSelect =
      findSelectByAutomationId("workAuthorization") ??
      findSelectByAutomationId("visaStatus")
    if (workAuthSelect) setSelectValue(workAuthSelect, profile.workAuth)

    // Remote preference
    const remoteSelect =
      findSelectByAutomationId("workArrangement") ??
      findSelectByAutomationId("workMode")
    if (remoteSelect) setSelectValue(remoteSelect, profile.remotePreference)

    // --- Resume file input ---
    const resumeEl = deepQuery<HTMLInputElement>(
      document,
      'input[type="file"][data-automation-id*="resume"], input[type="file"][data-automation-id*="Resume"]'
    )
    if (resumeEl) {
      resumeEl.dataset.phaselyResumeTarget = "true"
    }
  } catch (err) {
    console.error("[Phasely] workday adapter fill failed:", err)
  }
}
