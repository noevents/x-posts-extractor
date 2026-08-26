import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFetch, runFindStreak } from '../src/cli-runner.js';
import { ApiError } from '../src/parse.js';

const config = { authToken: 'tok', ct0: 'csrf', bearer: 'b', queryId: 'QID' };

async function tmpDir() {
  return mkdtemp(path.join(tmpdir(), 'xpe-cli-'));
}

function pageBody(ids, bottomCursor) {
  return {
    data: {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [
              {
                type: 'TimelineAddEntries',
                entries: [
                  ...ids.map((id) => ({
                    entryId: `tweet-${id}`,
                    content: {
                      __typename: 'TimelineTimelineItem',
                      itemContent: {
                        tweet_results: {
                          result: {
                            legacy: {
                              id_str: id,
                              created_at: 'Sun Oct 01 00:20:41 +0000 2023',
                              full_text: `text ${id}`,
                              favorite_count: 0,
                              retweet_count: 0,
                              reply_count: 0,
                              quote_count: 0,
                              lang: 'en',
                              conversation_id_str: id,
                            },
                          },
                        },
                      },
                    },
                  })),
                  {
                    entryId: 'cursor-bottom',
                    content: { __typename: 'TimelineTimelineCursor', cursorType: 'Bottom', value: bottomCursor },
                  },
                ],
              },
            ],
          },
        },
      },
    },
  };
}

function jsonResponse(status, body) {
  return { status, json: async () => body };
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

test('runFetch writes new tweets and caps output at --count per run', async () => {
  const dir = await tmpDir();
  const out = path.join(dir, 'joe.jsonl');
  const responses = [jsonResponse(200, pageBody(['1', '2', '3', '4', '5', '6', '7', '8'], null))];
  const fetchImpl = async () => responses.shift();
  const sleepImpl = async () => {};

  const result = await runFetch(
    { username: 'joe', count: 5, out },
    config,
    { fetchImpl, sleepImpl, rng: () => 0, log: () => {} }
  );

  assert.equal(result.collected, 5);
  const content = await readFile(out, 'utf8');
  const lines = content.trim().split('\n');
  assert.equal(lines.length, 5);
  assert.deepEqual(
    lines.map((l) => JSON.parse(l).id_str),
    ['1', '2', '3', '4', '5']
  );
});

test('re-running runFetch against an existing output file dedupes', async () => {
  const dir = await tmpDir();
  const out = path.join(dir, 'joe.jsonl');

  const firstResponses = [jsonResponse(200, pageBody(['1', '2'], null))];
  await runFetch(
    { username: 'joe', count: 5, out },
    config,
    { fetchImpl: async () => firstResponses.shift(), sleepImpl: async () => {}, rng: () => 0, log: () => {} }
  );

  const secondResponses = [jsonResponse(200, pageBody(['1', '2', '3'], null))];
  const result = await runFetch(
    { username: 'joe', count: 5, out },
    config,
    { fetchImpl: async () => secondResponses.shift(), sleepImpl: async () => {}, rng: () => 0, log: () => {} }
  );

  assert.equal(result.collected, 1);
  const content = await readFile(out, 'utf8');
  const lines = content.trim().split('\n');
  assert.deepEqual(
    lines.map((l) => JSON.parse(l).id_str).sort(),
    ['1', '2', '3']
  );
});

test('runFetch propagates ApiError from a failing fetchImpl as a rejected promise', async () => {
  const dir = await tmpDir();
  const out = path.join(dir, 'joe.jsonl');
  const fetchImpl = async () => jsonResponse(500, {});
  const sleepImpl = async () => {};

  await assert.rejects(async () => {
    await runFetch({ username: 'joe', count: 5, out }, config, { fetchImpl, sleepImpl, rng: () => 0, log: () => {} });
  }, ApiError);
});

test('runFindStreak writes no files and returns the correct streak', async () => {
  const dir = await tmpDir();
  const responses = [
    jsonResponse(
      200,
      (() => {
        const body = pageBody(['1', '2'], null);
        body.data.search_by_raw_query.search_timeline.timeline.instructions[0].entries[0].content.itemContent.tweet_results.result.legacy.created_at =
          'Mon Oct 02 00:20:41 +0000 2023';
        body.data.search_by_raw_query.search_timeline.timeline.instructions[0].entries[1].content.itemContent.tweet_results.result.legacy.created_at =
          'Tue Oct 03 00:20:41 +0000 2023';
        return body;
      })()
    ),
  ];
  const fetchImpl = async () => responses.shift();
  const sleepImpl = async () => {};

  const streak = await runFindStreak(
    { username: 'joe', since: '2023-10-01', until: '2023-10-10' },
    config,
    { fetchImpl, sleepImpl, rng: () => 0, log: () => {} }
  );

  assert.ok(streak);
  assert.equal(streak.days, 2);
  assert.equal(await fileExists(path.join(dir, 'joe.jsonl')), false);
  assert.equal(await fileExists(path.join(dir, 'joe.state.json')), false);
});
