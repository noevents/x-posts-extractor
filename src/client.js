import { buildSearchTimelineUrl, buildUserOriginalsTimelineUrl } from './query.js';
import { parseSearchTimelineResponse, parseUserTimelineResponse, ApiError } from './parse.js';
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

async function* paginateTimeline({
  endpointName,
  queryId,
  buildUrl,
  parseResponse,
  config,
  fetchImpl = fetch,
  sleepImpl = sleep,
  rng = Math.random,
  log = () => {},
  startCursor,
  getTransactionId,
}) {
  const headers = buildHeaders(config);
  const transactionPath = `/i/api/graphql/${queryId}/${endpointName}`;
  let cursor = startCursor;
  let requestCount = 0; // requests since the last batch pause
  let totalRequests = 0; // requests for this whole pagination run
  let totalTweets = 0;
  let rateLimitHits = 0;
  const startedAt = Date.now();
  const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  let nextPauseAt = pickBatchPauseThreshold(rng);

  while (true) {
    const url = buildUrl(cursor);

    let page = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      totalRequests++;
      log(
        `[${endpointName}] Request #${totalRequests} (attempt ${attempt}/${MAX_RETRIES}), elapsed ${elapsed()}, cursor=${
          cursor ? cursor.slice(0, 16) + '…' : '(start)'
        }`
      );
      if (getTransactionId) {
        headers['x-client-transaction-id'] = await getTransactionId('GET', transactionPath);
      }
      const res = await fetchImpl(url, { headers });

      if (res.status === 404) {
        throw new QueryIdStaleError(
          `${endpointName} endpoint returned 404 for query id "${queryId}". It has likely gone stale — open x.com, run the equivalent action, find the ${endpointName} request in DevTools > Network, and update the corresponding query id in .env.`
        );
      }

      if (res.status === 429 || res.status === 403) {
        rateLimitHits++;
        if (attempt === MAX_RETRIES) {
          throw new RetriesExhaustedError(
            `Gave up after ${MAX_RETRIES} retries (last status ${res.status}). Hit rate limits ${rateLimitHits} time(s) across ${totalRequests} requests over ${elapsed()}. Progress so far is saved.`
          );
        }
        const delay = backoffDelayMs(attempt);
        const retryAt = new Date(Date.now() + delay).toLocaleTimeString();
        log(
          `[${endpointName}] Rate limited (${res.status}), this is hit #${rateLimitHits} so far. Retry ${attempt}/${MAX_RETRIES} in ${(
            delay / 1000
          ).toFixed(0)}s (at ${retryAt})`
        );
        await sleepImpl(delay);
        continue;
      }

      if (res.status < 200 || res.status >= 300) {
        throw new ApiError(`Unexpected HTTP status ${res.status} from ${endpointName}`);
      }

      let json;
      try {
        json = await res.json();
      } catch (err) {
        throw new ApiError(`Failed to parse response as JSON (status ${res.status}): ${err.message}`);
      }
      page = parseResponse(json);
      break;
    }

    requestCount++;
    totalTweets += page.tweets.length;
    log(
      `[${endpointName}] Page received: ${page.tweets.length} tweets (total so far: ${totalTweets}, requests so far: ${totalRequests}, elapsed ${elapsed()})`
    );

    if (cursor !== undefined && page.bottomCursor === cursor) {
      log(`[${endpointName}] Stopping pagination: cursor did not advance (${cursor})`);
      return;
    }

    yield { tweets: page.tweets, cursor: page.bottomCursor };

    if (!page.bottomCursor) {
      log(`[${endpointName}] Stopping pagination: no bottom cursor returned`);
      return;
    }
    cursor = page.bottomCursor;

    if (requestCount >= nextPauseAt) {
      const pause = pickBatchPauseMs(rng);
      log(`[${endpointName}] Batch pause: ${(pause / 1000).toFixed(0)}s after ${requestCount} requests`);
      await sleepImpl(pause);
      requestCount = 0;
      nextPauseAt = pickBatchPauseThreshold(rng);
    } else {
      const delay = pickBaseDelayMs(rng);
      log(`[${endpointName}] Waiting ${(delay / 1000).toFixed(1)}s before next request`);
      await sleepImpl(delay);
    }
  }
}

export function paginateSearchTimeline({
  username,
  since,
  until,
  config,
  fetchImpl,
  sleepImpl,
  rng,
  log,
  startCursor,
  getTransactionId,
}) {
  return paginateTimeline({
    endpointName: 'SearchTimeline',
    queryId: config.queryId,
    buildUrl: (cursor) => buildSearchTimelineUrl({ queryId: config.queryId, username, since, until, cursor }),
    parseResponse: parseSearchTimelineResponse,
    config,
    fetchImpl,
    sleepImpl,
    rng,
    log,
    startCursor,
    getTransactionId,
  });
}

// Paginates an account's full original-tweets timeline (no replies/retweets),
// which — unlike SearchTimeline's since:/until: search — actually backfills
// through an account's whole history instead of stopping after a couple pages.
// Requires the numeric userId (not username): grab it from any
// UserOriginalsTimeline/UserTweets request's `variables.userId` in
// DevTools > Network while viewing the target profile.
export function paginateUserTimeline({
  userId,
  config,
  fetchImpl,
  sleepImpl,
  rng,
  log,
  startCursor,
  getTransactionId,
}) {
  return paginateTimeline({
    endpointName: 'UserOriginalsTimeline',
    queryId: config.userTimelineQueryId,
    buildUrl: (cursor) => buildUserOriginalsTimelineUrl({ queryId: config.userTimelineQueryId, userId, cursor }),
    parseResponse: parseUserTimelineResponse,
    config,
    fetchImpl,
    sleepImpl,
    rng,
    log,
    startCursor,
    getTransactionId,
  });
}
