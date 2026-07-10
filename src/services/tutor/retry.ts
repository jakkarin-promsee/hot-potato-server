// Transient network/service failures (dropped socket on a flaky link, Gemini
// briefly overloaded, rate limit). These are worth retrying; anything else is not.
export const isTransientAIError = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network|timeout|503|429|overloaded|unavailable/i.test(
    msg,
  );
};

// Wrap generateContent so a transient network blip becomes a silent retry
// instead of a failed answer for the student.
export async function generateWithRetry<T>(
  call: () => Promise<T>,
  tries = 5,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await call();
    } catch (error) {
      last = error;
      if (attempt === tries || !isTransientAIError(error)) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `Gemini transient error (attempt ${attempt}/${tries}), retrying: ${msg}`,
      );
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw last;
}
