#!/usr/bin/env node
// bin/cli.js
import 'dotenv/config';
import { parseCliArgs } from '../src/cli-args.js';
import { loadConfig, ConfigError } from '../src/config.js';
import { paginateSearchTimeline, QueryIdStaleError, RetriesExhaustedError } from '../src/client.js';
import { loadExistingIds, appendTweets, loadState, saveState } from '../src/store.js';
import { findLongestStreak } from '../src/streak.js';

async function runFetch(options, config) {
  const stateFile = options.out.replace(/\.jsonl$/, '') + '.state.json';
  const existingIds = await loadExistingIds(options.out);
  let collected = 0;

  const gen = paginateSearchTimeline({
    username: options.username,
    since: options.since,
    until: options.until,
    config,
    log: (msg) => console.error(msg),
  });

  for await (const page of gen) {
    const newTweets = page.filter((t) => !existingIds.has(t.id_str));
    for (const t of newTweets) existingIds.add(t.id_str);
    await appendTweets(options.out, newTweets);
    await saveState(stateFile, { lastRunAt: new Date().toISOString() });
    collected += newTweets.length;
    console.error(`Collected ${collected}/${options.count} tweets...`);
    if (collected >= options.count) break;
  }

  console.error(`Done. Wrote ${collected} new tweets to ${options.out}`);
}

async function runFindStreak(options, config) {
  const tweets = [];
  const gen = paginateSearchTimeline({
    username: options.username,
    since: options.since,
    until: options.until,
    config,
    log: (msg) => console.error(msg),
  });

  for await (const page of gen) tweets.push(...page);

  const streak = findLongestStreak(tweets);
  if (!streak) {
    console.log('No tweets found in that window.');
    return;
  }
  console.log(`Longest daily streak: ${streak.startDate} to ${streak.endDate} (${streak.days} days)`);
}

async function main() {
  let command, options;
  try {
    ({ command, options } = parseCliArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  try {
    if (command === 'fetch') await runFetch(options, config);
    else await runFindStreak(options, config);
  } catch (err) {
    if (err instanceof QueryIdStaleError || err instanceof RetriesExhaustedError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

main();
