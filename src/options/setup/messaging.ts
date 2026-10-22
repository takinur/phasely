/**
 * messaging.ts — single chrome.runtime.sendMessage wrapper for the Options page.
 *
 * Extracted so the setup wizard and the rest of the Options page share one
 * implementation (and one timeout policy) instead of each rolling their own.
 * All persistence still goes through the service worker — the Options page
 * never touches chrome.storage directly.
 */

import type { ExtensionSettings } from "@/lib/types";

export type OptionsMessage =
  | { type: "GET_PROFILE" }
  | { type: "SAVE_PROFILE"; markdown: string }
  | { type: "GET_RESUME" }
  | { type: "SAVE_RESUME"; base64: string; filename: string; mimeType: string }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: ExtensionSettings }
  | { type: "GET_GEMINI_MODELS" }
  | { type: "SAVE_GEMINI_API_KEY"; apiKey: string }
  | { type: "WIPE_DATA" };

export function sendMsg<T = unknown>(
  payload: OptionsMessage,
  timeoutMs = 20_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Request timed out — please try again"));
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(payload, (response: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      settled = true;
      clearTimeout(timer);
      console.error("[Phasely] sendMessage failed:", err);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
