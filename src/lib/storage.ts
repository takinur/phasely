/**
 * storage.ts — AES-GCM encrypted chrome.storage helpers
 *
 * Key lifecycle:
 *   - On first use, generate a random AES-GCM-256 key.
 *   - Export as JWK and persist to chrome.storage.local under __enc_key.
 *   - On subsequent calls, import from storage.
 *   - No module-level key cache — MV3 service workers have no guaranteed
 *     persistent module state, so we always go through storage.
 */

import type { ExtensionSettings, Profile } from "@/lib/types";

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

const KEY_ENC_KEY = "__enc_key";
const KEY_PROFILE = "profile";
const KEY_SETTINGS = "settings";

// ---------------------------------------------------------------------------
// Key derivation / management
// ---------------------------------------------------------------------------

/**
 * Retrieve or generate the device-bound AES-GCM-256 encryption key.
 * Never cached in memory — always round-trips through chrome.storage so
 * the service worker can be terminated and restarted safely.
 */
export async function getKey(): Promise<CryptoKey> {
  try {
    const stored = await storageGet<JsonWebKey>(KEY_ENC_KEY);

    if (stored !== null) {
      return await crypto.subtle.importKey(
        "jwk",
        stored,
        { name: "AES-GCM", length: 256 },
        false, // not extractable after import — only the stored JWK is the source of truth
        ["encrypt", "decrypt"],
      );
    }

    // First use — generate a fresh key
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true, // must be extractable so we can export it for storage
      ["encrypt", "decrypt"],
    );

    const jwk = await crypto.subtle.exportKey("jwk", key);
    await storageSet(KEY_ENC_KEY, jwk);

    // Re-import as non-extractable for actual use
    return await crypto.subtle.importKey(
      "jwk",
      jwk,
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
): Promise<{ iv: string; data: string }> {
  try {
    const key = await getKey();
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
export async function decryptData(iv: string, data: string): Promise<string> {
  try {
    const key = await getKey();
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
export async function setProfileData(profileJson: string): Promise<void> {
  try {
    const encrypted = await encryptData(profileJson);
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
export async function getProfileData(): Promise<string | null> {
  try {
    const stored = await storageGet<{ iv: string; data: string }>(KEY_PROFILE);
    if (stored === null) return null;
    return await decryptData(stored.iv, stored.data);
  } catch (err) {
    console.error("[Phasely] getProfileData failed:", err);
    throw err;
  }
}

/**
 * Convenience wrapper: encrypt and store a typed Profile object.
 */
export async function setProfile(profile: Profile): Promise<void> {
  await setProfileData(JSON.stringify(profile));
}

/**
 * Convenience wrapper: retrieve and deserialise a typed Profile object.
 */
export async function getProfile(): Promise<Profile | null> {
  const json = await getProfileData();
  if (json === null) return null;
  return JSON.parse(json) as Profile;
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

/**
 * Encrypt and persist a settings object.
 */
export async function setSettings(settings: ExtensionSettings): Promise<void> {
  try {
    const encrypted = await encryptData(JSON.stringify(settings));
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
export async function getSettings(): Promise<ExtensionSettings | null> {
  try {
    const stored = await storageGet<{ iv: string; data: string }>(KEY_SETTINGS);
    if (stored === null) return null;
    const json = await decryptData(stored.iv, stored.data);
    return JSON.parse(json) as ExtensionSettings;
  } catch (err) {
    console.error("[Phasely] getSettings failed:", err);
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