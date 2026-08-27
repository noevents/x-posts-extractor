// Widened from 2-4s: the tighter pacing was still tripping 429s in practice.
export function pickBaseDelayMs(rng = Math.random) {
  return Math.round((4 + rng() * 3) * 1000);
}

// Pause more often (was 20-30 requests) so we back off before a rate limit hits.
export function pickBatchPauseThreshold(rng = Math.random) {
  return 8 + Math.floor(rng() * 5);
}

// Longer batch pauses (was 30-60s).
export function pickBatchPauseMs(rng = Math.random) {
  return Math.round((60 + rng() * 60) * 1000);
}

export const MAX_RETRIES = 6;

// Starts at 60s (was 30s) and caps at 15min (was 10min), giving 429s more
// room to clear before we give up.
export function backoffDelayMs(attempt) {
  const delay = 60_000 * 2 ** (attempt - 1);
  return Math.min(delay, 900_000);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
