/**
 * submitter.ts — detects the submit/apply button on a job application page
 * and fires it, with optional confirmation and post-submit success detection.
 */

import type { ExtensionSettings } from "@/lib/types"

// ---------------------------------------------------------------------------
// Debug utility
// ---------------------------------------------------------------------------

function debug(msg: string, ...args: unknown[]): void {
  if (import.meta.env.DEV) {
    console.debug(`[Phasely] ${msg}`, ...args)
  }
}

// ---------------------------------------------------------------------------
// Button detection
// ---------------------------------------------------------------------------

const SUBMIT_TEXT_PATTERN = /submit|apply|send\s+application|next/i

/**
 * Check whether a button-like element looks like a submit/apply action
 * based on its visible text content.
 */
function isSubmitLike(el: HTMLElement): boolean {
  const text = (el.textContent ?? "").trim()
  return SUBMIT_TEXT_PATTERN.test(text)
}

/**
 * Find the most likely submit/apply button on the page.
 *
 * Search order (highest to lowest priority):
 *   1. <button type="submit"> or <input type="submit">
 *   2. <button> with matching text
 *   3. [role=button] with matching text
 *   4. <a> styled as a button with matching text (some ATSs use anchor tags)
 */
export function findSubmitButton(): HTMLElement | null {
  // 1. Explicit type=submit (most reliable)
  const explicitSubmit = document.querySelector<HTMLElement>(
    'button[type="submit"], input[type="submit"]'
  )
  if (explicitSubmit && !isHiddenEl(explicitSubmit)) {
    debug("findSubmitButton: found explicit [type=submit]")
    return explicitSubmit
  }

  // 2. <button> elements with submit-like text
  const buttons = Array.from(document.querySelectorAll<HTMLElement>("button"))
  for (const btn of buttons) {
    if (!isHiddenEl(btn) && isSubmitLike(btn)) {
      debug(`findSubmitButton: found <button> "${btn.textContent?.trim()}"`)
      return btn
    }
  }

  // 3. [role=button] with submit-like text
  const roleButtons = Array.from(
    document.querySelectorAll<HTMLElement>('[role="button"]')
  )
  for (const btn of roleButtons) {
    if (!isHiddenEl(btn) && isSubmitLike(btn)) {
      debug(`findSubmitButton: found [role=button] "${btn.textContent?.trim()}"`)
      return btn
    }
  }

  // 4. Anchor tags acting as buttons
  const anchors = Array.from(document.querySelectorAll<HTMLElement>("a"))
  for (const a of anchors) {
    if (!isHiddenEl(a) && isSubmitLike(a)) {
      debug(`findSubmitButton: found <a> "${a.textContent?.trim()}"`)
      return a
    }
  }

  debug("findSubmitButton: no submit button found")
  return null
}

/** Lightweight visibility check for submit button candidates. */
function isHiddenEl(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  return style.display === "none" || style.visibility === "hidden"
}

// ---------------------------------------------------------------------------
// Success detection
// ---------------------------------------------------------------------------

const SUCCESS_PATTERN =
  /thank\s+you|application\s+(received|submitted)|we.ll\s+be\s+in\s+touch|successfully\s+submitted|application\s+complete/i

/**
 * Check whether the current page state indicates a successful submission.
 * Looks at:
 *   1. The page's visible text content for success phrases.
 *   2. Elements with common success-indicator roles (alert, status).
 */
function detectSuccess(): boolean {
  // Check visible body text
  const bodyText = document.body?.innerText ?? ""
  if (SUCCESS_PATTERN.test(bodyText)) return true

  // Check ARIA live regions / alert roles
  const liveRegions = document.querySelectorAll<HTMLElement>(
    '[role="alert"], [role="status"], [aria-live]'
  )
  for (const region of Array.from(liveRegions)) {
    if (SUCCESS_PATTERN.test(region.textContent ?? "")) return true
  }

  return false
}

/**
 * Wait for a URL change or a success message to appear on the page.
 * Resolves true on success, false on timeout (5 seconds).
 */
async function waitForSuccess(originalUrl: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const deadline = Date.now() + timeoutMs
    const intervalId = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(intervalId)
        resolve(false)
        return
      }

      // URL changed after submission
      if (window.location.href !== originalUrl) {
        clearInterval(intervalId)
        // Give the new page a moment to render its content
        setTimeout(() => resolve(detectSuccess() || true), 500)
        return
      }

      // Success message appeared in-place (SPA pattern)
      if (detectSuccess()) {
        clearInterval(intervalId)
        resolve(true)
      }
    }, 250)
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find and click the submit button, respecting the confirmBeforeSubmit
 * setting. After clicking, polls for a success state for up to 5 seconds.
 *
 * Returns a result object rather than throwing so callers can surface
 * the outcome in the popup UI.
 */
export async function submitForm(
  settings: Pick<ExtensionSettings, "confirmBeforeSubmit">
): Promise<{ success: boolean; message: string }> {
  try {
    const button = findSubmitButton()

    if (!button) {
      return { success: false, message: "No submit button found on this page." }
    }

    if (settings.confirmBeforeSubmit) {
      const confirmed = window.confirm(
        "Phasely: Submit this application now?"
      )
      if (!confirmed) {
        return { success: false, message: "Submission cancelled by user." }
      }
    }

    const originalUrl = window.location.href

    debug(`submitForm: clicking "${button.textContent?.trim()}"`)
    button.click()

    const succeeded = await waitForSuccess(originalUrl)

    if (succeeded) {
      debug("submitForm: success state detected")
      return { success: true, message: "Application submitted successfully." }
    }

    // We still clicked — caller can decide how to surface this ambiguity
    return {
      success: true,
      message: "Submit button clicked. Success state could not be confirmed.",
    }
  } catch (err) {
    console.error("[Phasely] submitForm failed:", err)
    return { success: false, message: "An error occurred during submission." }
  }
}
