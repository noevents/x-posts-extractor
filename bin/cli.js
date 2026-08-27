#!/usr/bin/env node
// bin/cli.js
import 'dotenv/config';
import { parseCliArgs } from '../src/cli-args.js';
import { loadConfig, ConfigError } from '../src/config.js';
import { QueryIdStaleError, RetriesExhaustedError } from '../src/client.js';
import { ApiError } from '../src/parse.js';
import { runFetch, runFindStreak } from '../src/cli-runner.js';
import { createTransactionIdGenerator } from '../src/transaction.js';

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
    const getTransactionId = await createTransactionIdGenerator();
    if (command === 'fetch') await runFetch(options, config, { getTransactionId });
    else await runFindStreak(options, config, { getTransactionId });
  } catch (err) {
    if (err instanceof QueryIdStaleError || err instanceof RetriesExhaustedError || err instanceof ApiError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
