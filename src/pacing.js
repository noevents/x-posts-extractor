export function pickBaseDelayMs(rng = Math.random) {
  return Math.round((2 + rng() * 2) * 1000);
}

export function pickBatchPauseThreshold(rng = Math.random) {
  return 20 + Math.floor(rng() * 11);
}

export function pickBatchPauseMs(rng = Math.random) {
  return Math.round((30 + rng() * 30) * 1000);
}

export const MAX_RETRIES = 5;

export function backoffDelayMs(attempt) {
  const delay = 30_000 * 2 ** (attempt - 1);
  return Math.min(delay, 600_000);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
