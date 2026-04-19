/**
 * content.ts — MV3 content script entry point.
 *
 * Registers the chrome.runtime.onMessage listener that the service worker
 * forwards messages to via chrome.tabs.sendMessage.
 *
 * All heavy logic lives in src/content/. This file is the thin routing layer.
 */

import { detectFields, scrapeJobContext } from "./content/detector"
import { fillField, fillFile } from "./content/filler"
import { submitForm } from "./content/submitter"
import type { DetectedField, Profile, ExtensionSettings } from "./lib/types"

// Re-export modules so the entry point doubles as a barrel (used by tests).
export * from "./content/detector"
export * from "./content/filler"
export * from "./content/submitter"

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message) ||
      typeof (message as Record<string, unknown>).type !== "string"
    ) {
      sendResponse({ ok: false, error: "Invalid message shape" })
      return true
    }

    const msg = message as { type: string } & Record<string, unknown>
    const contentMessageTypes = new Set(["DETECT_FIELDS", "FILL_ALL", "FILL_ONLY", "FILL_AI_TEXT", "GET_JOB_CONTEXT", "SUBMIT"])
    if (!contentMessageTypes.has(msg.type)) {
      return false
    }

    ;(async () => {
      try {
        switch (msg.type) {
          case "GET_JOB_CONTEXT": {
            const jobContext = scrapeJobContext()
            sendResponse({ ok: true, jobContext })
            break
          }

          case "DETECT_FIELDS": {
            const profile = msg.profile as Profile | undefined
            const fields = profile ? detectFields(profile) : []
            const jobContext = scrapeJobContext()
            sendResponse({ ok: true, fields, jobContext })
            break
          }

          case "FILL_ALL": {
            // H2: validate profile shape before trusting the cast
            if (
              typeof msg.profile !== "object" ||
              msg.profile === null ||
              typeof (msg.profile as Record<string, unknown>).firstName !== "string"
            ) {
              sendResponse({ ok: false, error: "FILL_ALL: invalid profile" })
              break
            }
            const profile = msg.profile as Profile
            const resume = msg.resume as { base64: string; filename: string; mimeType: string } | null
            const fields = detectFields(profile)

            for (const field of fields) {
              if (field.fieldType === "file") {
                if (resume) {
                  // M3: guard against malformed base64
                  try {
                    const binary = atob(resume.base64)
                    const bytes = new Uint8Array(binary.length)
                    for (let i = 0; i < binary.length; i++) {
                      bytes[i] = binary.charCodeAt(i)
                    }
                    const blob = new Blob([bytes], { type: resume.mimeType })
                    fillFile(field.element as HTMLInputElement, blob, resume.filename)
                  } catch {
                    console.warn("[Phasely] Skipping file field — invalid base64 in stored resume")
                  }
                }
              } else {
                fillField(field)
              }
            }

            sendResponse({ ok: true })
            break
          }

          case "FILL_ONLY": {
            // H2: validate profile shape
            if (
              typeof msg.profile !== "object" ||
              msg.profile === null ||
              typeof (msg.profile as Record<string, unknown>).firstName !== "string"
            ) {
              sendResponse({ ok: false, error: "FILL_ONLY: invalid profile" })
              break
            }
            const profile = msg.profile as Profile
            const keys = new Set(Array.isArray(msg.fields) ? (msg.fields as string[]) : [])
            const fields = detectFields(profile).filter((f) => keys.has(f.profileKey))
            for (const field of fields) {
              fillField(field)
            }
            sendResponse({ ok: true })
            break
          }

          case "FILL_AI_TEXT": {
            // Fill a single AI-generated value into the matching field on the page.
            // The SW generates the text and sends it here to inject into the DOM.
            // H2: validate profile shape
            if (
              typeof msg.profile !== "object" ||
              msg.profile === null ||
              typeof (msg.profile as Record<string, unknown>).firstName !== "string"
            ) {
              sendResponse({ ok: false, error: "FILL_AI_TEXT: invalid profile" })
              break
            }
            const profile = msg.profile as Profile
            const key = msg.key as string
            const value = msg.value as string

            // Primary: look for the field the detector matched to this AI key.
            const fields = detectFields(profile)
            let target = fields.find((f: DetectedField) => f.profileKey === key && f.isAiField)

            // Fallback: when no labelled AI field is found, pick the largest
            // visible textarea on the page — almost always the cover letter box.
            if (!target) {
              const allTextareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea"))
              const visible = allTextareas.filter((el) => {
                if (el.offsetParent === null) return false
                const style = window.getComputedStyle(el)
                return style.display !== "none" && style.visibility !== "hidden"
              })
              // Pick the one with the most rows / largest scrollHeight as a proxy for "cover letter box".
              const largest = visible.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
              if (largest) {
                target = {
                  element: largest,
                  profileKey: key,
                  confidence: 0.5,
                  currentValue: largest.value,
                  suggestedValue: value,
                  isAiField: true,
                  fieldType: "textarea",
                }
              }
            }

            if (!target) {
              sendResponse({ ok: false, error: `No cover letter field found on this page.` })
              break
            }

            // isAiField must be false here — fillField skips AI fields by design
            // (they normally need generation). We already have the generated value,
            // so we override the flag to force a direct write.
            fillField({ ...target, suggestedValue: value, isAiField: false })
            sendResponse({ ok: true })
            break
          }

          case "SUBMIT": {
            // submitForm needs settings — default to confirmBeforeSubmit: true
            // when called without settings so the user always sees the dialog.
            const settings = (msg.settings as Pick<ExtensionSettings, "confirmBeforeSubmit">) ?? {
              confirmBeforeSubmit: true,
            }
            const result = await submitForm(settings)
            sendResponse({ ok: result.success, message: result.message })
            break
          }

          default:
            return
        }
      } catch (err) {
        console.error("[Phasely] content onMessage error:", err)
        sendResponse({ ok: false, error: String(err) })
      }
    })()

    return true
  },
)
