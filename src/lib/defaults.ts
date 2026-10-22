import type { ExtensionSettings } from "@/lib/types";

/**
 * Default extension settings — single source of truth shared between
 * the service worker and the Options page.
 */
export const DEFAULT_SETTINGS: ExtensionSettings = {
  geminiModel: "gemini-3-flash-preview",
  autoSubmit: false,
  confirmBeforeSubmit: true,

  // Knockout guard on by default — a wrong work-auth answer is an instant
  // auto-reject, so the safe default is to make the user look at it.
  blockSubmitOnUnconfirmedKnockouts: true,

  ghostJobWarnings: true,

  trackApplications: true,
  followUpDays: 7,
};
