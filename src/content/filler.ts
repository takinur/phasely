/**
 * filler.ts — writes profile values into DOM elements and fires the full
 * suite of synthetic events required by React, Vue, and Angular.
 *
 * CRITICAL: Direct `.value = x` assignment is silent on modern SPA-driven
 * ATS platforms. We must go through the nativeInputValueSetter to trigger
 * the framework's internal change detection.
 */

import type { DetectedField, Profile } from "@/lib/types"

// ---------------------------------------------------------------------------
// Debug utility
// ---------------------------------------------------------------------------

function debug(msg: string, ...args: unknown[]): void {
  if (import.meta.env.DEV) {
    console.debug(`[Phasely] ${msg}`, ...args)
  }
}

// ---------------------------------------------------------------------------
// Native value setter (React compatibility)
// ---------------------------------------------------------------------------

/**
 * Grab the native setter from HTMLInputElement.prototype and
 * HTMLTextAreaElement.prototype once so we can reuse them.
 *
 * React (and some Vue builds) overwrites element.value with a custom
 * property descriptor. To trigger their internal synthetic event system
 * we must call the *original* prototype setter, which causes the tracked
 * value to update before we dispatch our events.
 */
const nativeInputDescriptor = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value"
)

const nativeTextAreaDescriptor = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "value"
)

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function dispatchInputEvents(el: HTMLElement): void {
  // InputEvent for "input" (carries inputType info, expected by some frameworks)
  el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }))
  // Plain Event for "change" and "blur"
  el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }))
  el.dispatchEvent(new Event("blur", { bubbles: true, cancelable: true }))
}

// ---------------------------------------------------------------------------
// Setters
// ---------------------------------------------------------------------------

/**
 * Set the value of an input or textarea element using the native setter,
 * then dispatch input/change/blur so SPA frameworks detect the change.
 */
export function setValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  try {
    const descriptor =
      el instanceof HTMLTextAreaElement
        ? nativeTextAreaDescriptor
        : nativeInputDescriptor

    if (descriptor?.set) {
      descriptor.set.call(el, value)
    } else {
      // Fallback: direct assignment (works on non-React pages)
      el.value = value
    }

    dispatchInputEvents(el)
    debug(`setValue: set "${el.name || el.id}" = "${value}"`)
  } catch (err) {
    console.error("[Phasely] setValue failed:", err)
  }
}

/**
 * Set a <select> element's value by matching option text or value attribute,
 * case-insensitively.
 */
export function setSelectValue(el: HTMLSelectElement, value: string): void {
  try {
    const normalValue = value.trim().toLowerCase()
    let matched = false

    for (const option of Array.from(el.options)) {
      const optionText = option.text.trim().toLowerCase()
      const optionValue = option.value.trim().toLowerCase()
      if (optionText === normalValue || optionValue === normalValue) {
        el.value = option.value
        matched = true
        break
      }
    }

    if (!matched) {
      // Partial match fallback: pick the first option that contains the value
      for (const option of Array.from(el.options)) {
        const optionText = option.text.trim().toLowerCase()
        if (optionText.includes(normalValue) || normalValue.includes(optionText)) {
          el.value = option.value
          matched = true
          break
        }
      }
    }

    if (matched) {
      dispatchInputEvents(el)
      debug(`setSelectValue: set "${el.name || el.id}" = "${value}"`)
    } else {
      debug(`setSelectValue: no matching option for "${value}" in "${el.name || el.id}"`)
    }
  } catch (err) {
    console.error("[Phasely] setSelectValue failed:", err)
  }
}

/**
 * Set a checkbox input's checked state.
 */
export function setCheckbox(el: HTMLInputElement, value: boolean): void {
  try {
    if (el.checked === value) return
    el.checked = value
    dispatchInputEvents(el)
    debug(`setCheckbox: set "${el.name || el.id}" = ${value}`)
  } catch (err) {
    console.error("[Phasely] setCheckbox failed:", err)
  }
}

/**
 * Select the radio button from a group whose value or associated label
 * text matches the provided value string (case-insensitive).
 */
export function setRadio(els: HTMLInputElement[], value: string): void {
  try {
    const normalValue = value.trim().toLowerCase()
    let matched = false

    for (const radio of els) {
      const radioValue = radio.value.trim().toLowerCase()

      // Try matching by value attribute first
      let isMatch = radioValue === normalValue

      // Fall back to label text if available
      if (!isMatch && radio.id) {
        const labelEl = document.querySelector<HTMLLabelElement>(
          `label[for="${CSS.escape(radio.id)}"]`
        )
        if (labelEl?.textContent) {
          isMatch = labelEl.textContent.trim().toLowerCase() === normalValue
        }
      }

      if (!isMatch) {
        const closestLabel = radio.closest("label")
        if (closestLabel?.textContent) {
          isMatch = closestLabel.textContent.trim().toLowerCase() === normalValue
        }
      }

      if (isMatch) {
        radio.checked = true
        dispatchInputEvents(radio)
        matched = true
        debug(`setRadio: selected value "${radio.value}" in group "${radio.name}"`)
        break
      }
    }

    if (!matched) {
      debug(`setRadio: no radio matched "${value}" in group "${els[0]?.name ?? "unknown"}"`)
    }
  } catch (err) {
    console.error("[Phasely] setRadio failed:", err)
  }
}

/**
 * Attach a file to an <input type="file"> element via DataTransfer.
 * The blob is expected to come from extension storage (base64 decoded
 * before being passed here).
 */
export function setFile(el: HTMLInputElement, blob: Blob, filename: string): void {
  try {
    const file = new File([blob], filename, { type: blob.type || "application/pdf" })
    const dt = new DataTransfer()
    dt.items.add(file)
    el.files = dt.files
    dispatchInputEvents(el)
    debug(`setFile: attached "${filename}" to file input "${el.name || el.id}"`)
  } catch (err) {
    console.error("[Phasely] setFile failed:", err)
  }
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

/**
 * Fill a single DetectedField using the appropriate setter.
 * Never throws — errors are caught and logged with the [Phasely] prefix.
 */
export function fillField(field: DetectedField, _profile: Profile): void {
  try {
    const { element, fieldType, suggestedValue, profileKey } = field

    // Skip AI fields — those require generation, not direct fill
    if (field.isAiField) {
      debug(`fillField: skipping AI field "${profileKey}"`)
      return
    }

    if (!suggestedValue && fieldType !== "file") {
      debug(`fillField: no suggestedValue for "${profileKey}", skipping`)
      return
    }

    switch (fieldType) {
      case "input": {
        const inputEl = element as HTMLInputElement

        // Checkbox: profile keys like willingToRelocate / referencesAvailable
        if (inputEl.type === "checkbox") {
          const boolVal = suggestedValue === "true" || suggestedValue === "1"
          setCheckbox(inputEl, boolVal)
          return
        }

        // Radio buttons — caller should handle grouping; single-element path
        if (inputEl.type === "radio") {
          setRadio([inputEl], suggestedValue)
          return
        }

        // File input
        if (inputEl.type === "file") {
          // The resume blob must be fetched from storage by the caller and
          // passed separately. We cannot retrieve it here (no fetch in
          // content scripts). This case is handled by fillFile() in the
          // message handler.
          debug(`fillField: file input for "${profileKey}" — requires blob from storage`)
          return
        }

        setValue(inputEl, suggestedValue)
        break
      }

      case "textarea": {
        setValue(element as HTMLTextAreaElement, suggestedValue)
        break
      }

      case "select": {
        setSelectValue(element as HTMLSelectElement, suggestedValue)
        break
      }

      case "contenteditable": {
        // contenteditable divs don't have .value; set textContent instead
        // then dispatch the required events.
        try {
          element.textContent = suggestedValue
          dispatchInputEvents(element)
          debug(`fillField: set contenteditable "${profileKey}" = "${suggestedValue}"`)
        } catch (err) {
          console.error("[Phasely] fillField contenteditable failed:", err)
        }
        break
      }

      case "file": {
        debug(`fillField: file fieldType for "${profileKey}" — requires blob from storage`)
        break
      }

      default: {
        debug(`fillField: unknown fieldType for "${profileKey}"`)
        break
      }
    }
  } catch (err) {
    console.error("[Phasely] fillField failed for key", field.profileKey, err)
  }
}

/**
 * Fill a file input element with a resume blob retrieved from storage.
 * Called separately from fillField because content scripts cannot fetch
 * the blob themselves — it must be passed in from the message handler.
 */
export function fillFile(el: HTMLInputElement, blob: Blob, filename: string): void {
  setFile(el, blob, filename)
}
