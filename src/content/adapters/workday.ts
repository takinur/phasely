import type { Profile } from "@/lib/types"
import { setValue, setSelectValue } from "@/content/filler"

export function detect(): boolean {
  const host = document.location.hostname
  if (host.includes("workday.com")) return true
  if (host.includes("myworkdayjobs.com")) return true
  return false
}

function deepQueryAll<T extends HTMLElement>(
  root: Document | Element | ShadowRoot,
  selector: string
): T[] {
  const results: T[] = []

  const found = Array.from((root as Element).querySelectorAll<T>(selector))
  results.push(...found)

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

function deepQuery<T extends HTMLElement>(
  root: Document | Element | ShadowRoot,
  selector: string
): T | null {
  const results = deepQueryAll<T>(root, selector)
  return results[0] ?? null
}

function findByAutomationId(id: string): HTMLInputElement | null {
  const wrapper = deepQuery<HTMLElement>(document, `[data-automation-id="${id}"]`)
  if (!wrapper) return null

  if (wrapper instanceof HTMLInputElement) return wrapper

  const nested = deepQuery<HTMLInputElement>(wrapper, "input")
  return nested
}

function findSelectByAutomationId(id: string): HTMLSelectElement | null {
  const wrapper = deepQuery<HTMLElement>(document, `[data-automation-id="${id}"]`)
  if (!wrapper) return null
  if (wrapper instanceof HTMLSelectElement) return wrapper
  return deepQuery<HTMLSelectElement>(wrapper, "select")
}

function findByLabel(labelText: string): HTMLInputElement | null {
  const normLabel = labelText.toLowerCase().trim()

  const inputs = deepQueryAll<HTMLInputElement>(document, "input")

  for (const input of inputs) {
    const ariaLabel = input.getAttribute("aria-label")
    if (ariaLabel && ariaLabel.toLowerCase().trim() === normLabel) return input

    const labelledBy = input.getAttribute("aria-labelledby")
    if (labelledBy) {
      for (const refId of labelledBy.split(/\s+/)) {
        const refEl = document.getElementById(refId)
        if (refEl?.textContent?.trim().toLowerCase() === normLabel) return input
      }
    }

    if (input.id) {
      const labelEl = document.querySelector<HTMLLabelElement>(
        `label[for="${CSS.escape(input.id)}"]`
      )
      if (labelEl?.textContent?.trim().toLowerCase() === normLabel) return input
    }
  }

  return null
}

export function fill(profile: Profile): void {
  try {
    const firstNameEl =
      findByAutomationId("legalNameSection_firstName") ??
      findByAutomationId("firstName") ??
      findByLabel("first name")
    if (firstNameEl) setValue(firstNameEl, profile.firstName)

    const lastNameEl =
      findByAutomationId("legalNameSection_lastName") ??
      findByAutomationId("lastName") ??
      findByLabel("last name")
    if (lastNameEl) setValue(lastNameEl, profile.lastName)

    const emailEl =
      findByAutomationId("email") ??
      findByAutomationId("emailAddress") ??
      findByLabel("email address") ??
      findByLabel("email")
    if (emailEl) setValue(emailEl, profile.email)

    const phoneEl =
      findByAutomationId("phone") ??
      findByAutomationId("phoneNumber") ??
      findByLabel("phone number") ??
      findByLabel("mobile phone")
    if (phoneEl) setValue(phoneEl, profile.phone)

    const cityEl =
      findByAutomationId("city") ??
      findByAutomationId("addressCity") ??
      findByLabel("city")
    if (cityEl) setValue(cityEl, profile.location)

    if (profile.linkedin) {
      const linkedinEl =
        findByAutomationId("linkedIn") ??
        findByAutomationId("linkedInProfile") ??
        findByLabel("linkedin url") ??
        findByLabel("linkedin profile url")
      if (linkedinEl) setValue(linkedinEl, profile.linkedin)
    }

    if (profile.portfolio) {
      const websiteEl =
        findByAutomationId("website") ??
        findByAutomationId("portfolioUrl") ??
        findByLabel("website") ??
        findByLabel("portfolio url")
      if (websiteEl) setValue(websiteEl, profile.portfolio)
    }

    const titleEl =
      findByAutomationId("jobTitle") ??
      findByAutomationId("currentJobTitle") ??
      findByLabel("current job title") ??
      findByLabel("job title")
    if (titleEl) setValue(titleEl, profile.currentTitle)

    const companyEl =
      findByAutomationId("currentCompany") ??
      findByAutomationId("companyName") ??
      findByLabel("current company") ??
      findByLabel("company")
    if (companyEl) setValue(companyEl, profile.currentCompany)

    const yoeEl =
      findByAutomationId("yearsExperience") ??
      findByAutomationId("totalYearsOfExperience") ??
      findByLabel("years of experience")
    if (yoeEl) setValue(yoeEl, profile.yearsExperience.toString())

    const salaryEl =
      findByAutomationId("desiredSalary") ??
      findByAutomationId("salaryExpectation") ??
      findByLabel("desired salary") ??
      findByLabel("salary expectation")
    if (salaryEl) setValue(salaryEl, profile.salaryExpectation)

    const noticeEl =
      findByAutomationId("noticePeriod") ??
      findByAutomationId("availableStartDate") ??
      findByLabel("notice period") ??
      findByLabel("when can you start")
    if (noticeEl) setValue(noticeEl, profile.noticePeriod)

    const workAuthSelect =
      findSelectByAutomationId("workAuthorization") ??
      findSelectByAutomationId("visaStatus")
    if (workAuthSelect) setSelectValue(workAuthSelect, profile.workAuth)

    const remoteSelect =
      findSelectByAutomationId("workArrangement") ??
      findSelectByAutomationId("workMode")
    if (remoteSelect) setSelectValue(remoteSelect, profile.remotePreference)

    const resumeEl = deepQuery<HTMLInputElement>(
      document,
      'input[type="file"][data-automation-id*="resume"], input[type="file"][data-automation-id*="Resume"]'
    )
    if (resumeEl) {
      resumeEl.dataset.phaselyResumeTarget = "true"
    }
  } catch (err) {
    console.error("[Phasely] adapter fill failed:", err)
  }
}
