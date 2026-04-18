/**
 * detector.ts — scans the active page DOM for fillable form fields,
 * scores each against FIELD_MAP keys, and returns DetectedField[] sorted
 * by confidence descending.
 *
 * Shadow DOM traversal is supported for Workday compatibility.
 * Hidden fields (display:none, visibility:hidden, type=hidden) are skipped.
 */

import { FIELD_MAP } from "@/lib/fieldMap"
import { scoreField } from "@/lib/fuzzyMatch"
import type { DetectedField, JobContext, Profile } from "@/lib/types"

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function debug(msg: string, ...args: unknown[]): void {
  if (import.meta.env.DEV) {
    console.debug(`[Phasely] ${msg}`, ...args)
  }
}

/** AI-only profile keys that need text generation rather than direct fill. */
const AI_KEYS = new Set(["coverLetter", "additionalInfo"])

/** Infer the DetectedField.fieldType from a DOM element. */
function inferFieldType(el: HTMLElement): DetectedField["fieldType"] {
  if (el.tagName === "TEXTAREA") return "textarea"
  if (el.tagName === "SELECT") return "select"
  if (el.getAttribute("contenteditable") === "true") return "contenteditable"
  if (el instanceof HTMLInputElement && el.type === "file") return "file"
  return "input"
}

/**
 * Return true if the element is invisible / non-interactive and should be
 * skipped. We check:
 *   - input[type=hidden]
 *   - computed display:none
 *   - computed visibility:hidden
 *   - the element or any ancestor has display:none (offsetParent === null covers most cases)
 */
function isHidden(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && el.type === "hidden") return true

  // offsetParent is null when element (or ancestor) has display:none
  // For fixed/sticky positioned elements offsetParent is also null,
  // so we fall back to a style check to avoid false positives.
  if (el.offsetParent === null) {
    const style = window.getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden") return true
  }

  const style = window.getComputedStyle(el)
  return style.display === "none" || style.visibility === "hidden"
}

/**
 * Extract all text signals from a DOM element that help identify what
 * profile field it corresponds to. Returns a deduplicated array of strings.
 */
function extractSignals(el: HTMLElement): string[] {
  const signals: string[] = []

  // 1. name attribute (most reliable on standard forms)
  const name = el.getAttribute("name")
  if (name) signals.push(name)

  // 2. id
  const id = el.id
  if (id) signals.push(id)

  // 3. placeholder
  const placeholder = el.getAttribute("placeholder")
  if (placeholder) signals.push(placeholder)

  // 4. aria-label
  const ariaLabel = el.getAttribute("aria-label")
  if (ariaLabel) signals.push(ariaLabel)

  // 5. autocomplete value
  const autocomplete = el.getAttribute("autocomplete")
  if (autocomplete && autocomplete !== "off" && autocomplete !== "on") {
    signals.push(autocomplete)
  }

  // 6. Explicit <label for="...">
  if (id) {
    const labelEl = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`)
    if (labelEl?.textContent) signals.push(labelEl.textContent.trim())
  }

  // 7. aria-labelledby — may reference multiple IDs
  const labelledBy = el.getAttribute("aria-labelledby")
  if (labelledBy) {
    for (const refId of labelledBy.split(/\s+/)) {
      const refEl = document.getElementById(refId)
      if (refEl?.textContent) signals.push(refEl.textContent.trim())
    }
  }

  // 8. Closest wrapping <label> (implicit association)
  const closestLabel = el.closest("label")
  if (closestLabel?.textContent) signals.push(closestLabel.textContent.trim())

  // 9. Preceding sibling text node / element (common in custom form UIs)
  let prev = el.previousElementSibling
  let tries = 0
  while (prev && tries < 3) {
    const text = (prev as HTMLElement).textContent?.trim()
    if (text && text.length < 120) {
      signals.push(text)
      break
    }
    prev = prev.previousElementSibling
    tries++
  }

  // 10. Parent element's text content minus any child input text
  //     Useful for div-wrapped label patterns
  const parent = el.parentElement
  if (parent) {
    const parentText = Array.from(parent.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim() ?? "")
      .join(" ")
      .trim()
    if (parentText && parentText.length < 120) signals.push(parentText)
  }

  // Deduplicate and filter empties
  return [...new Set(signals.filter((s) => s.length > 0))]
}

/**
 * Given an element and its signals, find the best-matching FIELD_MAP key
 * and return [key, score]. Returns ["", 0] if nothing scores above 0.
 */
function bestMatch(signals: string[]): { key: string; score: number } {
  let bestKey = ""
  let bestScore = 0

  for (const key of Object.keys(FIELD_MAP)) {
    const s = scoreField(signals, key)
    if (s > bestScore) {
      bestScore = s
      bestKey = key
    }
  }

  return { key: bestKey, score: bestScore }
}

/**
 * Resolve the current value of any fillable element to a string.
 */
function currentValueOf(el: HTMLElement): string {
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return el.value
  }
  return el.textContent ?? ""
}

/**
 * Look up a profile value by its FIELD_MAP key. Returns an empty string
 * when the key has no mapping or the value is missing.
 */
function profileValueFor(key: string, profile: Profile): string {
  if (!key) return ""

  // Typed key access: profile is strongly typed so we need a safe cast here.
  // We know all FIELD_MAP keys correspond to Profile fields.
  const val = (profile as unknown as Record<string, unknown>)[key]

  if (val === undefined || val === null) return ""
  if (typeof val === "boolean") return val.toString()
  if (typeof val === "number") return val.toString()
  if (typeof val === "string") return val
  if (Array.isArray(val)) return val.join(", ")
  return ""
}

// ---------------------------------------------------------------------------
// Shadow DOM traversal
// ---------------------------------------------------------------------------

/**
 * Collect all fillable elements from a root node, recursing into any
 * shadow roots found along the way (Workday compatibility).
 */
function collectElements(root: Document | ShadowRoot | Element): HTMLElement[] {
  const results: HTMLElement[] = []

  const walker = document.createTreeWalker(
    root as Node,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        const el = node as HTMLElement
        // Recurse into shadow roots after collection
        const tag = el.tagName?.toUpperCase()
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          el.getAttribute("contenteditable") === "true"
        ) {
          return NodeFilter.FILTER_ACCEPT
        }
        return NodeFilter.FILTER_SKIP
      },
    }
  )

  let node: Node | null = walker.nextNode()
  while (node) {
    results.push(node as HTMLElement)
    node = walker.nextNode()
  }

  // Now recurse into any shadow roots encountered in the entire subtree.
  // Document, ShadowRoot, and Element all have querySelectorAll.
  const allElements = Array.from(root.querySelectorAll("*"))

  for (const el of allElements) {
    const shadow = (el as HTMLElement).shadowRoot
    if (shadow) {
      const shadowResults = collectElements(shadow)
      results.push(...shadowResults)
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Job context scraping
// ---------------------------------------------------------------------------

/**
 * Attempt to extract structured job context (title, company, location,
 * description, url) from the current page.
 *
 * Strategy (best-effort, graceful degradation):
 *   1. JSON-LD structured data (most reliable — Greenhouse, Lever, many ATS)
 *   2. Open Graph / meta tags
 *   3. Common CSS class / data-attribute patterns used by major ATSs
 *   4. Page title heuristic as last resort
 *
 * Returns null if we cannot extract enough signal to build a useful context.
 */
export function scrapeJobContext(): JobContext | null {
  try {
    const url = window.location.href

    // --- 1. JSON-LD (schema.org/JobPosting) ---
    const jsonLdScripts = Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')
    )
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent ?? "")
        const entries = Array.isArray(data) ? data : [data]
        for (const entry of entries) {
          if (entry["@type"] === "JobPosting") {
            const title = (entry.title ?? entry.name ?? "").trim()
            const company =
              (entry.hiringOrganization?.name ?? entry.hiringOrganization ?? "").toString().trim()
            const location =
              typeof entry.jobLocation === "object"
                ? (
                    entry.jobLocation?.address?.addressLocality ??
                    entry.jobLocation?.address?.addressRegion ??
                    ""
                  ).trim()
                : String(entry.jobLocation ?? "").trim()
            const description = (entry.description ?? "")
              .replace(/<[^>]+>/g, " ")   // strip any embedded HTML
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 4000)             // cap at 4 k chars for AI context

            if (title || company) {
              debug("scrapeJobContext: found JSON-LD JobPosting")
              return { title, company, location, description, url }
            }
          }
        }
      } catch {
        // malformed JSON-LD — skip
      }
    }

    // --- 2. Open Graph / meta tags ---
    const ogTitle =
      document
        .querySelector<HTMLMetaElement>('meta[property="og:title"]')
        ?.content?.trim() ?? ""
    const ogDescription =
      document
        .querySelector<HTMLMetaElement>('meta[property="og:description"]')
        ?.content?.trim() ?? ""
    const metaDescription =
      document
        .querySelector<HTMLMetaElement>('meta[name="description"]')
        ?.content?.trim() ?? ""

    // --- 3. ATS-specific DOM patterns ---

    /** Helper: first non-empty text content from a list of selectors. */
    function firstText(...selectors: string[]): string {
      for (const sel of selectors) {
        const el = document.querySelector<HTMLElement>(sel)
        const text = el?.textContent?.trim() ?? ""
        if (text) return text
      }
      return ""
    }

    const domTitle = firstText(
      // Greenhouse
      "[data-qa='job-title']",
      ".job-post__heading",
      // Lever
      ".posting-headline h2",
      ".posting-title h2",
      // Workday
      "[data-automation-id='jobPostingHeader']",
      // iCIMS
      ".iCIMS_Header h1",
      // SmartRecruiters
      ".job-title h1",
      // Generic fallbacks
      "h1.job-title",
      "h1[class*='title']",
      "h1",
    )

    const domCompany = firstText(
      // Greenhouse
      "[data-qa='company-name']",
      ".company-name",
      // Lever
      ".main-header-logo img[alt]",     // alt attribute used below
      ".posting-categories .location",
      // Workday
      "[data-automation-id='company-name']",
      // SmartRecruiters
      ".company-name",
      // Generic
      "[class*='company']",
    )

    // Lever stores company name in the logo alt
    const leverLogoEl = document.querySelector<HTMLImageElement>(".main-header-logo img")
    const leverCompany = leverLogoEl?.alt?.trim() ?? ""

    const domLocation = firstText(
      "[data-qa='job-location']",
      ".posting-categories .location",
      "[data-automation-id='locations']",
      ".iCIMS_InfoMsg",
      ".job-location",
      "[class*='location']",
    )

    // Job description body — scrape the largest text block as fallback
    const descriptionEl = document.querySelector<HTMLElement>(
      "[data-qa='job-description'], .posting-description, " +
      "[data-automation-id='jobPostingDescription'], .job-description, " +
      ".iCIMS_JobContent, #job-description, .description"
    )
    const domDescription = descriptionEl
      ? descriptionEl.innerText.replace(/\s+/g, " ").trim().slice(0, 4000)
      : ""

    // --- 4. Page title heuristic ---
    const pageTitle = document.title.trim()

    // Assemble best-effort result
    const title = domTitle || ogTitle || pageTitle
    const company = domCompany || leverCompany
    const location = domLocation
    const description = domDescription || ogDescription || metaDescription

    if (!title && !company && !description) {
      debug("scrapeJobContext: insufficient signals, returning null")
      return null
    }

    debug("scrapeJobContext: assembled from DOM/meta signals")
    return { title, company, location, description, url }
  } catch (err) {
    console.error("[Phasely] scrapeJobContext failed:", err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Detect response shape
// ---------------------------------------------------------------------------

export interface DetectFieldsResult {
  fields: DetectedField[]
  jobContext: JobContext | null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan the entire page (including shadow roots) for fillable fields,
 * score each against FIELD_MAP, and return DetectedField[] sorted by
 * confidence descending.
 *
 * @param profile — the user's parsed Profile. Needed to populate suggestedValue.
 */
export function detectFields(profile: Profile): DetectedField[] {
  const elements = collectElements(document)

  debug(`detectFields: found ${elements.length} candidate elements before filtering`)

  const results: DetectedField[] = []

  for (const el of elements) {
    if (isHidden(el)) continue

    const signals = extractSignals(el)
    if (signals.length === 0) continue

    const { key, score } = bestMatch(signals)

    // Only include fields that have at least some match signal
    if (score === 0 || key === "") continue

    const fieldType = inferFieldType(el)
    const suggestedValue = profileValueFor(key, profile)

    const detected: DetectedField = {
      element: el,
      profileKey: key,
      confidence: score,
      currentValue: currentValueOf(el),
      suggestedValue,
      isAiField: AI_KEYS.has(key),
      fieldType,
    }

    results.push(detected)
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence)

  debug(`detectFields: returning ${results.length} matched fields`)

  return results
}
