import type { ExtensionSettings } from "@/lib/types";

/**
 * Default extension settings — single source of truth shared between
 * the service worker and the Options page.
 */
export const DEFAULT_SETTINGS: ExtensionSettings = {
  geminiModel: "gemini-1.5-flash",
  autoSubmit: false,
  confirmBeforeSubmit: true,
};
