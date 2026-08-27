// src/cli-runner.js
// Testable implementations of the CLI commands, kept separate from bin/cli.js
// so they can be exercised without spawning a real process.
import { paginateSearchTimeline, paginateUserTimeline } from './client.js';
import { loadExistingIds, loadExistingTweets, appendTweets, loadState, saveState } from './store.js';
import { findLongestStreak, toDateStr } from './streak.js';

function paginate(options, config, deps, startCursor) {
  const { fetchImpl, sleepImpl, rng, log, getTransactionId } = deps;
  if (options.userId) {
    return paginateUserTimeline({
      userId: options.userId,
      config,
      fetchImpl,
      sleepImpl,
      rng,
      log,
      startCursor,
      getTransactionId,
    });
  }
  return paginateSearchTimeline({
    username: options.username,
    since: options.since,
    until: options.until,
    config,
    fetchImpl,
    sleepImpl,
    rng,
    log,
    startCursor,
    getTransactionId,
  });
}

function withinRange(dateStr, since, until) {
  return (!since || dateStr >= since) && (!until || dateStr <= until);
}

export async function runFetch(options, config, deps = {}) {
  const { log = (msg) => console.error(msg) } = deps;
  deps = { ...deps, log };
  const stateFile = options.out.replace(/\.jsonl$/, '') + '.state.json';
  const existingIds = await loadExistingIds(options.out);
  let collected = 0;

  const state = await loadState(stateFile);
  const startCursor = state && state.cursor ? state.cursor : undefined;

  const gen = paginate(options, config, deps, startCursor);

  // Tracks the cursor that was used to *request* the page currently being
  // processed (as opposed to page.cursor, which points at the *next* page).
  // Needed so that when a page gets truncated by the --count budget, we can
  // persist a resume point that re-fetches this same page next run instead
  // of skipping past it and losing the untruncated leftover tweets.
  let requestCursor = startCursor;

  let pageNum = 0;
  for await (const page of gen) {
    pageNum++;
    const inRange = page.tweets.filter((t) => withinRange(toDateStr(t.created_at), options.since, options.until));
    const newTweetsAll = inRange.filter((t) => !existingIds.has(t.id_str));
    const remaining = Math.max(0, options.count - collected);
    const newTweets = newTweetsAll.slice(0, remaining);
    const truncated = newTweetsAll.length > remaining;
    for (const t of newTweets) existingIds.add(t.id_str);
    await appendTweets(options.out, newTweets);
    const resumeCursor = truncated ? requestCursor : page.cursor;
    await saveState(stateFile, { cursor: resumeCursor, lastRunAt: new Date().toISOString() });
    collected += newTweets.length;
    requestCursor = page.cursor;
    log(
      `[fetch] Page ${pageNum}: ${page.tweets.length} tweets on page, ${inRange.length} in range, ${newTweets.length} new -> collected ${collected}/${options.count}`
    );
    if (collected >= options.count) break;

    // options.userId's timeline is strictly reverse-chronological (unlike
    // search, it has no server-side since: cutoff), so once a page's oldest
    // tweet predates `since` there's nothing relevant left further back.
    const oldest = page.tweets[page.tweets.length - 1];
    if (options.since && oldest && toDateStr(oldest.created_at) < options.since) {
      log(`[fetch] Oldest tweet on page (${toDateStr(oldest.created_at)}) is before --since (${options.since}), stopping`);
      break;
    }
  }

  log(`Done. Wrote ${collected} new tweets to ${options.out}`);
  return { collected };
}

export async function runFindStreak(options, config, deps = {}) {
  const { log = (msg) => console.error(msg) } = deps;
  deps = { ...deps, log };

  // Resume support: if a prior run got cut off (e.g. RetriesExhaustedError
  // from a 429), re-running the exact same command picks up from the cursor
  // it stopped at instead of re-fetching everything from scratch. Requires
  // --out (set by default from --username) so there's a state file to resume from.
  const stateFile = options.out ? options.out.replace(/\.jsonl$/, '') + '.state.json' : null;
  const state = stateFile ? await loadState(stateFile) : null;
  const startCursor = state && state.cursor ? state.cursor : undefined;
  if (startCursor) log(`[find-streak] Resuming from saved cursor (previous run stopped early)`);

  const existingTweets = options.out ? await loadExistingTweets(options.out) : [];
  const existingIds = new Set(existingTweets.map((t) => t.id_str));
  const tweets = existingTweets.filter((t) => withinRange(toDateStr(t.created_at), options.since, options.until));

  const gen = paginate(options, config, deps, startCursor);

  let pageNum = 0;
  for await (const page of gen) {
    pageNum++;
    const inRange = page.tweets.filter((t) => withinRange(toDateStr(t.created_at), options.since, options.until));
    const newTweets = inRange.filter((t) => !existingIds.has(t.id_str));
    for (const t of newTweets) existingIds.add(t.id_str);
    tweets.push(...newTweets);

    if (options.out) {
      await appendTweets(options.out, newTweets);
      await saveState(stateFile, { cursor: page.cursor, lastRunAt: new Date().toISOString() });
    }

    log(
      `[find-streak] Page ${pageNum}: ${page.tweets.length} tweets on page, ${inRange.length} in range, ${newTweets.length} new -> ${tweets.length} in range so far`
    );

    const oldest = page.tweets[page.tweets.length - 1];
    if (options.since && oldest && toDateStr(oldest.created_at) < options.since) {
      log(`[find-streak] Oldest tweet on page (${toDateStr(oldest.created_at)}) is before --since (${options.since}), stopping`);
      break;
    }
  }

  log(`Fetched ${tweets.length} tweets in range (including any already stored)`);

  const streak = findLongestStreak(tweets);
  if (!streak) {
    console.log('No tweets found in that window.');
    return null;
  }
  console.log(`Longest daily streak: ${streak.startDate} to ${streak.endDate} (${streak.days} days)`);
  return streak;
}
