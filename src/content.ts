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
import type { Profile, ExtensionSettings } from "./lib/types"

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
  ): true => {
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

    ;(async () => {
      try {
        switch (msg.type) {
          case "DETECT_FIELDS": {
            const profile = msg.profile as Profile | undefined
            const fields = profile ? detectFields(profile) : []
            const jobContext = scrapeJobContext()
            sendResponse({ ok: true, fields, jobContext })
            break
          }

          case "FILL_ALL": {
            const profile = msg.profile as Profile
            const fields = detectFields(profile)
            const fileFields = fields.filter((f) => f.fieldType === "file")
            const nonFileFields = fields.filter((f) => f.fieldType !== "file")

            for (const field of nonFileFields) {
              fillField(field, profile)
            }

            if (fileFields.length > 0) {
              const resumeRes = await new Promise<{
                ok: boolean
                resume: { base64: string; filename: string; mimeType: string } | null
              }>((resolve, reject) => {
                chrome.runtime.sendMessage({ type: "GET_RESUME" }, (response) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message))
                  } else {
                    resolve(response)
                  }
                })
              })

              if (resumeRes.ok && resumeRes.resume) {
                const { base64, filename, mimeType } = resumeRes.resume
                const binary = atob(base64)
                const bytes = new Uint8Array(binary.length)
                for (let i = 0; i < binary.length; i++) {
                  bytes[i] = binary.charCodeAt(i)
                }
                const blob = new Blob([bytes], { type: mimeType })
                for (const field of fileFields) {
                  fillFile(field.element as HTMLInputElement, blob, filename)
                }
              }
            }

            sendResponse({ ok: true })
            break
          }

          case "FILL_ONLY": {
            const profile = msg.profile as Profile
            const keys = new Set(msg.fields as string[])
            const fields = detectFields(profile).filter((f) => keys.has(f.profileKey))
            for (const field of fields) {
              fillField(field, profile)
            }
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
            sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` })
        }
      } catch (err) {
        console.error("[Phasely] content onMessage error:", err)
        sendResponse({ ok: false, error: String(err) })
      }
    })()

    return true
  },
)
