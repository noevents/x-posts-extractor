// src/cli-runner.js
// Testable implementations of the CLI commands, kept separate from bin/cli.js
// so they can be exercised without spawning a real process.
import { paginateSearchTimeline } from './client.js';
import { loadExistingIds, appendTweets, loadState, saveState } from './store.js';
import { findLongestStreak } from './streak.js';

export async function runFetch(options, config, deps = {}) {
  const { fetchImpl, sleepImpl, rng, log = (msg) => console.error(msg) } = deps;
  const stateFile = options.out.replace(/\.jsonl$/, '') + '.state.json';
  const existingIds = await loadExistingIds(options.out);
  let collected = 0;

  const state = await loadState(stateFile);
  const startCursor = state && state.cursor ? state.cursor : undefined;

  const gen = paginateSearchTimeline({
    username: options.username,
    since: options.since,
    until: options.until,
    config,
    fetchImpl,
    sleepImpl,
    rng,
    log,
    startCursor,
  });

  for await (const page of gen) {
    const newTweetsAll = page.tweets.filter((t) => !existingIds.has(t.id_str));
    const remaining = Math.max(0, options.count - collected);
    const newTweets = newTweetsAll.slice(0, remaining);
    for (const t of newTweets) existingIds.add(t.id_str);
    await appendTweets(options.out, newTweets);
    await saveState(stateFile, { cursor: page.cursor, lastRunAt: new Date().toISOString() });
    collected += newTweets.length;
    log(`Collected ${collected}/${options.count} tweets...`);
    if (collected >= options.count) break;
  }

  log(`Done. Wrote ${collected} new tweets to ${options.out}`);
  return { collected };
}

export async function runFindStreak(options, config, deps = {}) {
  const { fetchImpl, sleepImpl, rng, log = (msg) => console.error(msg) } = deps;
  const tweets = [];

  const gen = paginateSearchTimeline({
    username: options.username,
    since: options.since,
    until: options.until,
    config,
    fetchImpl,
    sleepImpl,
    rng,
    log,
  });

  for await (const page of gen) tweets.push(...page.tweets);

  const streak = findLongestStreak(tweets);
  if (!streak) {
    console.log('No tweets found in that window.');
    return null;
  }
  console.log(`Longest daily streak: ${streak.startDate} to ${streak.endDate} (${streak.days} days)`);
  return streak;
}
