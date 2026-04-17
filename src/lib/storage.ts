/**
 * storage.ts — AES-GCM encrypted chrome.storage helpers
 *
 * Key lifecycle:
 *   - On first use, create and persist a random KDF salt.
 *   - Derive an AES-GCM-256 key on demand using PBKDF2.
 *   - No raw encryption key material is ever persisted to storage.
 */

import type { ExtensionSettings, Profile, StoredData, StoredResume } from "@/lib/types";

// ---------------------------------------------------------------------------
// Chrome storage promise wrappers
// ---------------------------------------------------------------------------

function storageGet<T>(key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(key, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const value = (result as Record<string, unknown>)[key];
        resolve(value !== undefined ? (value as T) : null);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function storageSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

function storageClear(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Internal storage keys
// ---------------------------------------------------------------------------

const KEY_KDF_SALT = "__kdf_salt";
const KEY_PROFILE = "profile";
const KEY_RESUME = "resume";
const KEY_SETTINGS = "settings";
const KDF_ITERATIONS = 310_000;

// ---------------------------------------------------------------------------
// Key derivation / management
// ---------------------------------------------------------------------------

/**
 * Derive a device-bound AES-GCM-256 key using PBKDF2.
 * No raw key is stored; only a random salt is persisted.
 */
export async function getKey(passphrase?: string): Promise<CryptoKey> {
  try {
    const encoder = new TextEncoder();
    const salt = await getOrCreateKdfSalt();
    const normalizedPassphrase = passphrase?.trim() ?? "";
    const secret = `${chrome.runtime.id}:${normalizedPassphrase}`;

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );

    return await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: KDF_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } catch (err) {
    console.error("[Phasely] getKey failed:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Core encrypt / decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a UTF-8 plaintext string.
 * Returns base64-encoded iv and ciphertext as separate fields so the caller
 * can store them however it likes.
 */
export async function encryptData(
  plaintext: string,
  passphrase?: string,
): Promise<{ iv: string; data: string }> {
  try {
    const key = await getKey(passphrase);
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12)).slice();

    const cipherBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(plaintext),
    );

    return {
      iv: bufferToBase64(iv),
      data: bufferToBase64(new Uint8Array(cipherBuffer)),
    };
  } catch (err) {
    console.error("[Phasely] encryptData failed:", err);
    throw err;
  }
}

/**
 * Decrypt a base64 iv + ciphertext pair produced by encryptData.
 */
export async function decryptData(
  iv: string,
  data: string,
  passphrase?: string,
): Promise<string> {
  try {
    const key = await getKey(passphrase);
    const decoder = new TextDecoder();

    const plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBuffer(iv) },
      key,
      base64ToBuffer(data),
    );

    return decoder.decode(plainBuffer);
  } catch (err) {
    console.error("[Phasely] decryptData failed:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

/**
 * Encrypt and persist the profile JSON string to chrome.storage.local.
 * The caller is responsible for serialising Profile → JSON before calling.
 */
export async function setProfileData(
  profileJson: string,
  passphrase?: string,
): Promise<void> {
  try {
    const encrypted = await encryptData(profileJson, passphrase);
    await storageSet(KEY_PROFILE, encrypted);
  } catch (err) {
    console.error("[Phasely] setProfileData failed:", err);
    throw err;
  }
}

/**
 * Retrieve and decrypt the profile JSON string.
 * Returns null if no profile has been stored yet.
 * The caller is responsible for deserialising JSON → Profile.
 */
export async function getProfileData(passphrase?: string): Promise<string | null> {
  try {
    const stored = await storageGet<{ iv: string; data: string }>(KEY_PROFILE);
    if (stored === null) return null;
    return await decryptData(stored.iv, stored.data, passphrase);
  } catch (err) {
    console.error("[Phasely] getProfileData failed:", err);
    throw err;
  }
}

/**
 * Convenience wrapper: encrypt and store a typed Profile object.
 */
export async function setProfile(
  profile: Profile,
  passphrase?: string,
): Promise<void> {
  await setProfileData(JSON.stringify(profile), passphrase);
}

/**
 * Convenience wrapper: retrieve and deserialise a typed Profile object.
 */
export async function getProfile(passphrase?: string): Promise<Profile | null> {
  const json = await getProfileData(passphrase);
  if (json === null) return null;
  const parsed = parseJsonSafe(json);
  if (!isProfile(parsed)) {
    console.error("[Phasely] getProfile invalid profile shape in storage");
    return null;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

/**
 * Encrypt and persist a settings object.
 */
export async function setSettings(
  settings: ExtensionSettings,
  passphrase?: string,
): Promise<void> {
  try {
    const encrypted = await encryptData(JSON.stringify(settings), passphrase);
    await storageSet(KEY_SETTINGS, encrypted);
  } catch (err) {
    console.error("[Phasely] setSettings failed:", err);
    throw err;
  }
}

/**
 * Retrieve and decrypt the settings object.
 * Returns null if settings have never been saved.
 */
export async function getSettings(
  passphrase?: string,
): Promise<ExtensionSettings | null> {
  try {
    const stored = await storageGet<{ iv: string; data: string }>(KEY_SETTINGS);
    if (stored === null) return null;
    const json = await decryptData(stored.iv, stored.data, passphrase);
    const parsed = parseJsonSafe(json);
    if (!isExtensionSettings(parsed)) {
      console.error("[Phasely] getSettings invalid settings shape in storage");
      return null;
    }
    return parsed;
  } catch (err) {
    console.error("[Phasely] getSettings failed:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Resume helpers
// ---------------------------------------------------------------------------

/**
 * Encrypt and persist a resume blob.
 * The caller must convert the File/Blob to base64 before calling.
 */
export async function setResume(
  resume: StoredResume,
  passphrase?: string,
): Promise<void> {
  try {
    const encrypted = await encryptData(JSON.stringify(resume), passphrase);
    await storageSet(KEY_RESUME, encrypted);
  } catch (err) {
    console.error("[Phasely] setResume failed:", err);
    throw err;
  }
}

/**
 * Retrieve and decrypt the stored resume.
 * Returns null if no resume has been uploaded yet.
 */
export async function getResume(passphrase?: string): Promise<StoredResume | null> {
  try {
    const stored = await storageGet<{ iv: string; data: string }>(KEY_RESUME);
    if (stored === null) return null;
    const json = await decryptData(stored.iv, stored.data, passphrase);
    const parsed = parseJsonSafe(json);
    if (!isStoredResume(parsed)) {
      console.error("[Phasely] getResume: invalid shape in storage");
      return null;
    }
    return parsed;
  } catch (err) {
    console.error("[Phasely] getResume failed:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Gemini token helpers
// ---------------------------------------------------------------------------

const KEY_GEMINI_TOKEN = "geminiToken";

/**
 * Encrypt and persist the Google OAuth token.
 */
export async function setGeminiToken(token: string): Promise<void> {
  try {
    const encrypted = await encryptData(token);
    await storageSet(KEY_GEMINI_TOKEN, encrypted);
  } catch (err) {
    console.error("[Phasely] setGeminiToken failed:", err);
    throw err;
  }
}

/**
 * Retrieve and decrypt the Google OAuth token.
 * Returns null if not yet stored.
 */
export async function getGeminiToken(): Promise<string | null> {
  try {
    const stored = await storageGet<{ iv: string; data: string }>(KEY_GEMINI_TOKEN);
    if (stored === null) return null;
    return await decryptData(stored.iv, stored.data);
  } catch (err) {
    console.error("[Phasely] getGeminiToken failed:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Generic typed get / set — keyed on StoredData
// ---------------------------------------------------------------------------

/**
 * Retrieve and decrypt any top-level StoredData key.
 * Returns null when the key has never been written.
 */
export async function get<T extends StoredData[keyof StoredData]>(
  key: keyof StoredData,
): Promise<T | null> {
  try {
    const stored = await storageGet<{ iv: string; data: string }>(key);
    if (stored === null) return null;
    const json = await decryptData(stored.iv, stored.data);
    return parseJsonSafe(json) as T | null;
  } catch (err) {
    console.error(`[Phasely] get("${key}") failed:`, err);
    throw err;
  }
}

/**
 * Encrypt and persist any top-level StoredData key.
 */
export async function set<T extends StoredData[keyof StoredData]>(
  key: keyof StoredData,
  value: T,
): Promise<void> {
  try {
    const encrypted = await encryptData(JSON.stringify(value));
    await storageSet(key, encrypted);
  } catch (err) {
    console.error(`[Phasely] set("${key}") failed:`, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Wipe
// ---------------------------------------------------------------------------

/**
 * Clear all extension storage, including the encryption key.
 * The next call to getKey() will generate a fresh key, making all
 * previously stored ciphertext permanently unrecoverable.
 */
export async function wipeAll(): Promise<void> {
  try {
    await storageClear();
  } catch (err) {
    console.error("[Phasely] wipeAll failed:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Base64 utilities (no external deps, works in both SW and page contexts)
// ---------------------------------------------------------------------------

function bufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer.slice(); // slice() narrows buffer type to ArrayBuffer
}

async function getOrCreateKdfSalt(): Promise<Uint8Array<ArrayBuffer>> {
  const existingSalt = await storageGet<string>(KEY_KDF_SALT);
  if (typeof existingSalt === "string" && existingSalt.length > 0) {
    return base64ToBuffer(existingSalt);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16)).slice();
  await storageSet(KEY_KDF_SALT, bufferToBase64(salt));
  return salt;
}

function parseJsonSafe(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEducation(value: unknown): value is { degree: string; institution: string; year: number } {
  if (!isRecord(value)) return false;
  return (
    typeof value.degree === "string" &&
    typeof value.institution === "string" &&
    typeof value.year === "number"
  );
}

function isProfile(value: unknown): value is Profile {
  if (!isRecord(value)) return false;

  return (
    typeof value.firstName === "string" &&
    typeof value.lastName === "string" &&
    typeof value.email === "string" &&
    typeof value.phone === "string" &&
    typeof value.location === "string" &&
    (value.linkedin === undefined || typeof value.linkedin === "string") &&
    (value.github === undefined || typeof value.github === "string") &&
    (value.portfolio === undefined || typeof value.portfolio === "string") &&
    typeof value.workAuth === "string" &&
    typeof value.noticePeriod === "string" &&
    typeof value.salaryExpectation === "string" &&
    typeof value.willingToRelocate === "boolean" &&
    typeof value.remotePreference === "string" &&
    typeof value.currentTitle === "string" &&
    typeof value.currentCompany === "string" &&
    typeof value.yearsExperience === "number" &&
    isStringArray(value.skills) &&
    Array.isArray(value.education) &&
    value.education.every((item) => isEducation(item)) &&
    typeof value.referencesAvailable === "boolean" &&
    typeof value.rawMarkdown === "string"
  );
}

function isStoredResume(value: unknown): value is StoredResume {
  if (!isRecord(value)) return false;
  return (
    typeof value.base64 === "string" &&
    typeof value.filename === "string" &&
    typeof value.mimeType === "string"
  );
}

function isExtensionSettings(value: unknown): value is ExtensionSettings {
  if (!isRecord(value)) return false;

  const isGeminiModel =
    value.geminiModel === "gemini-1.5-flash" ||
    value.geminiModel === "gemini-1.5-pro";
  const isProvider =
    value.preferredAiProvider === "gemini" || value.preferredAiProvider === "claude";

  return (
    isGeminiModel &&
    typeof value.autoSubmit === "boolean" &&
    typeof value.confirmBeforeSubmit === "boolean" &&
    (value.claudeApiKey === undefined || typeof value.claudeApiKey === "string") &&
    isProvider
  );
}