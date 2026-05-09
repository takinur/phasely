import type { Profile } from "@/lib/types"
import { setValue, setSelectValue } from "@/content/filler"

export function detect(): boolean {
  const host = document.location.hostname

  if (host.includes("lever.co")) return true
  if (host.includes("jobs.lever.co")) return true

  const meta = document.querySelector<HTMLMetaElement>('meta[name="lever-job-posting"]')
  if (meta) return true

  const embeddedScript = document.querySelector('script[src*="lever.co"]')
  if (embeddedScript) return true

  return false
}

export function fill(profile: Profile): void {
  try {
    const fullNameEl = document.querySelector<HTMLInputElement>(
      'input[name="name"], input[id="name"]'
    )
    if (fullNameEl) {
      setValue(fullNameEl, `${profile.firstName} ${profile.lastName}`.trim())
    } else {
      const firstEl = document.querySelector<HTMLInputElement>(
        'input[name="first_name"], input[id="first_name"]'
      )
      if (firstEl) setValue(firstEl, profile.firstName)

      const lastEl = document.querySelector<HTMLInputElement>(
        'input[name="last_name"], input[id="last_name"]'
      )
      if (lastEl) setValue(lastEl, profile.lastName)
    }

    const emailEl = document.querySelector<HTMLInputElement>(
      'input[name="email"], input[id="email"]'
    )
    if (emailEl) setValue(emailEl, profile.email)

    const phoneEl = document.querySelector<HTMLInputElement>(
      'input[name="phone"], input[id="phone"]'
    )
    if (phoneEl) setValue(phoneEl, profile.phone)

    const orgEl = document.querySelector<HTMLInputElement>(
      'input[name="org"], input[name="company"], input[id="org"]'
    )
    if (orgEl) setValue(orgEl, profile.currentCompany)

    const linkedinEl = document.querySelector<HTMLInputElement>(
      'input[name="urls[LinkedIn]"], input[name="linkedin"]'
    )
    if (linkedinEl && profile.linkedin) setValue(linkedinEl, profile.linkedin)

    const githubEl = document.querySelector<HTMLInputElement>(
      'input[name="urls[GitHub]"], input[name="github"]'
    )
    if (githubEl && profile.github) setValue(githubEl, profile.github)

    const portfolioEl = document.querySelector<HTMLInputElement>(
      'input[name="urls[Portfolio]"], input[name="urls[Other Website]"], input[name="website"]'
    )
    if (portfolioEl && profile.portfolio) setValue(portfolioEl, profile.portfolio)

    const locationEl = document.querySelector<HTMLInputElement>(
      'input[name="location"], input[id="location"]'
    )
    if (locationEl) setValue(locationEl, profile.location)

    const workAuthSelect = document.querySelector<HTMLSelectElement>(
      'select[name="eeo[workAuthorization]"], select[name="work_authorization"]'
    )
    if (workAuthSelect) setSelectValue(workAuthSelect, profile.workAuth)

    const salaryEl = document.querySelector<HTMLInputElement>(
      'input[name="salary"], input[name="salary_expectation"]'
    )
    if (salaryEl) setValue(salaryEl, profile.salaryExpectation)

    const resumeEl = document.querySelector<HTMLInputElement>(
      'input[type="file"][name="resume"], input[type="file"][id*="resume"]'
    )
    if (resumeEl) {
      resumeEl.dataset.phaselyResumeTarget = "true"
    }
  } catch (err) {
    console.error("[Phasely] adapter fill failed:", err)
  }
}
