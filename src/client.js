import { buildSearchTimelineUrl } from './query.js';
import { parseSearchTimelineResponse, ApiError } from './parse.js';
import { buildHeaders } from './config.js';
import {
  pickBaseDelayMs,
  pickBatchPauseThreshold,
  pickBatchPauseMs,
  backoffDelayMs,
  MAX_RETRIES,
  sleep,
} from './pacing.js';

export class QueryIdStaleError extends Error {}
export class RetriesExhaustedError extends Error {}

export async function* paginateSearchTimeline({
  username,
  since,
  until,
  config,
  fetchImpl = fetch,
  sleepImpl = sleep,
  rng = Math.random,
  log = () => {},
  startCursor,
}) {
  const headers = buildHeaders(config);
  let cursor = startCursor;
  let requestCount = 0;
  let nextPauseAt = pickBatchPauseThreshold(rng);

  while (true) {
    const url = buildSearchTimelineUrl({ queryId: config.queryId, username, since, until, cursor });

    let page = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetchImpl(url, { headers });

      if (res.status === 404) {
        throw new QueryIdStaleError(
          `SearchTimeline endpoint returned 404 for query id "${config.queryId}". It has likely gone stale — open x.com, run a search, find the SearchTimeline request in DevTools > Network, and set QUERY_ID in .env to the id from its URL path.`
        );
      }

      if (res.status === 429 || res.status === 403) {
        if (attempt === MAX_RETRIES) {
          throw new RetriesExhaustedError(
            `Gave up after ${MAX_RETRIES} retries (last status ${res.status}). Progress so far is saved.`
          );
        }
        const delay = backoffDelayMs(attempt);
        log(`Rate limited (${res.status}), retry ${attempt}/${MAX_RETRIES} in ${delay}ms`);
        await sleepImpl(delay);
        continue;
      }

      if (res.status < 200 || res.status >= 300) {
        throw new ApiError(`Unexpected HTTP status ${res.status} from SearchTimeline`);
      }

      let json;
      try {
        json = await res.json();
      } catch (err) {
        throw new ApiError(`Failed to parse response as JSON (status ${res.status}): ${err.message}`);
      }
      page = parseSearchTimelineResponse(json);
      break;
    }

    requestCount++;

    if (cursor !== undefined && page.bottomCursor === cursor) {
      return;
    }

    yield { tweets: page.tweets, cursor: page.bottomCursor };

    if (!page.bottomCursor) {
      return;
    }
    cursor = page.bottomCursor;

    if (requestCount >= nextPauseAt) {
      const pause = pickBatchPauseMs(rng);
      log(`Batch pause: ${pause}ms after ${requestCount} requests`);
      await sleepImpl(pause);
      requestCount = 0;
      nextPauseAt = pickBatchPauseThreshold(rng);
    } else {
      await sleepImpl(pickBaseDelayMs(rng));
    }
  }
}
