import type { Profile } from "@/lib/types"
import { setValue, setSelectValue } from "@/content/filler"

export function detect(): boolean {
  const host = document.location.hostname
  if (host.includes("greenhouse.io")) return true

  const meta = document.querySelector<HTMLMetaElement>('meta[name="greenhouse-job-post"]')
  if (meta) return true

  try {
    if (window.parent !== window) {
      const parentHost = window.parent.location.hostname
      if (parentHost.includes("greenhouse.io")) return true
    }
  } catch {
    /* */
  }

  return false
}

export function fill(profile: Profile): void {
  try {
    const firstNameEl = document.querySelector<HTMLInputElement>(
      'input[name="first_name"]'
    )
    if (firstNameEl) setValue(firstNameEl, profile.firstName)

    const lastNameEl = document.querySelector<HTMLInputElement>(
      'input[name="last_name"]'
    )
    if (lastNameEl) setValue(lastNameEl, profile.lastName)

    const emailEl = document.querySelector<HTMLInputElement>('input[name="email"]')
    if (emailEl) setValue(emailEl, profile.email)

    const phoneEl = document.querySelector<HTMLInputElement>('input[name="phone"]')
    if (phoneEl) setValue(phoneEl, profile.phone)

    const linkedinEl = document.querySelector<HTMLInputElement>(
      'input[name="linkedin_profile_url"], input[name="linkedin"]'
    )
    if (linkedinEl && profile.linkedin) setValue(linkedinEl, profile.linkedin)

    const websiteEl = document.querySelector<HTMLInputElement>(
      'input[name="website"], input[name="portfolio"]'
    )
    if (websiteEl && profile.portfolio) setValue(websiteEl, profile.portfolio)

    const locationEl = document.querySelector<HTMLInputElement>(
      'input[name="location"], input[name="city"]'
    )
    if (locationEl) setValue(locationEl, profile.location)

    const workAuthSelect = document.querySelector<HTMLSelectElement>(
      'select[name="work_authorization"], select[name="visa_status"]'
    )
    if (workAuthSelect) setSelectValue(workAuthSelect, profile.workAuth)

    const relocateSelect = document.querySelector<HTMLSelectElement>(
      'select[name="relocate"], select[name="willing_to_relocate"]'
    )
    if (relocateSelect) {
      setSelectValue(relocateSelect, profile.willingToRelocate ? "Yes" : "No")
    }

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
