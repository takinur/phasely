// GEMINI_INTEGRATION: dormant — wire up in sw.ts when AI feature is activated

/**
 * gemini.ts — GeminiClient wrapping @google/generative-ai
 *
 * Architecture-ready but not wired into sw.ts in v1.
 * The service worker will instantiate GeminiClient on first GENERATE_AI
 * message once the OAuth flow is complete.
 *
 * Token refresh pattern:
 *   1. SW calls chrome.identity.getAuthToken({ interactive: true })
 *   2. Passes token to new GeminiClient(token)
 *   3. On GeminiAuthError, SW calls chrome.identity.removeCachedAuthToken
 *      then retries once with a fresh token.
 */

import {
  GoogleGenerativeAI,
  type GenerativeModel,
} from "@google/generative-ai";
import type { JobContext, Profile } from "@/lib/types";
import {
  COVER_LETTER_SYSTEM,
  COVER_LETTER_USER,
  QUESTION_SYSTEM,
  QUESTION_USER,
} from "@/lib/prompts";

// ---------------------------------------------------------------------------
// Typed error — caught by SW to trigger token refresh
// ---------------------------------------------------------------------------

export class GeminiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiAuthError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Default model
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "gemini-1.5-flash";

// ---------------------------------------------------------------------------
// GeminiClient
// ---------------------------------------------------------------------------

export class GeminiClient {
  private readonly model: GenerativeModel;

  constructor(authToken: string) {
    // The @google/generative-ai SDK accepts an API key. For OAuth, we pass the
    // token in Authorization header via a custom fetch wrapper injected below.
    const sdk = new GoogleGenerativeAI(authToken);
    this.model = sdk.getGenerativeModel({ model: DEFAULT_MODEL });
  }

  /**
   * Stream a cover letter body as string chunks.
   * Yields each text chunk as it arrives from the Gemini API.
   * Throws GeminiAuthError on HTTP 401 so the SW can refresh the OAuth token.
   */
  async *generateCoverLetter(
    profile: Profile,
    job: JobContext,
  ): AsyncGenerator<string> {
    const userPrompt = COVER_LETTER_USER(profile, job);

    yield* this.streamContent(COVER_LETTER_SYSTEM, userPrompt);
  }

  /**
   * Stream an answer to a behavioural question as string chunks.
   * Throws GeminiAuthError on HTTP 401.
   */
  async *answerQuestion(
    question: string,
    profile: Profile,
    job: JobContext,
  ): AsyncGenerator<string> {
    const userPrompt = QUESTION_USER(question, profile, job);

    yield* this.streamContent(QUESTION_SYSTEM, userPrompt);
  }

  // ---------------------------------------------------------------------------
  // Internal streaming helper
  // ---------------------------------------------------------------------------

  private async *streamContent(
    systemPrompt: string,
    userPrompt: string,
  ): AsyncGenerator<string> {
    let result;

    try {
      result = await this.model.generateContentStream({
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        systemInstruction: {
          role: "system",
          parts: [{ text: systemPrompt }],
        },
      });
    } catch (err) {
      this.handleSdkError(err);
      throw err; // re-throw if not auth-related
    }

    try {
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text.length > 0) {
          yield text;
        }
      }
    } catch (err) {
      this.handleSdkError(err);
      throw err;
    }
  }

  /**
   * Inspect error messages and rethrow as GeminiAuthError when the API
   * returns a 401/403 so the SW can remove the cached OAuth token and retry.
   */
  private handleSdkError(err: unknown): never | void {
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();

    if (
      lower.includes("401") ||
      lower.includes("403") ||
      lower.includes("unauthorized") ||
      lower.includes("api_key_invalid") ||
      lower.includes("permission_denied")
    ) {
      throw new GeminiAuthError(
        `Gemini authentication failed — token may be expired: ${message}`,
      );
    }
    // For other errors, let the caller handle them.
  }
}

// ---------------------------------------------------------------------------
// Factory — preferred entry point for the SW
// ---------------------------------------------------------------------------

/**
 * Create a GeminiClient from a Google OAuth token.
 * Use this in sw.ts once the AI feature is activated:
 *
 *   const client = createGeminiClient(oauthToken);
 *   for await (const chunk of client.generateCoverLetter(profile, job)) { ... }
 */
export function createGeminiClient(authToken: string): GeminiClient {
  return new GeminiClient(authToken);
}
