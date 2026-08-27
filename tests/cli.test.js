import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFetch, runFindStreak } from '../src/cli-runner.js';
import { ApiError } from '../src/parse.js';
import { RetriesExhaustedError } from '../src/client.js';

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

test('runFetch does not lose leftover tweets when a page is truncated by --count', async () => {
  const dir = await tmpDir();
  const out = path.join(dir, 'joe.jsonl');

  // Page 1 has 8 tweets and a bottom cursor pointing at page 2.
  // Page 2 has different tweets, so if we mistakenly resumed from page 2's
  // cursor, the test would surface tweets ['9','10'] instead of the leftover
  // ['6','7','8'] from page 1.
  function fetchImplFor(page1Cursor) {
    return async (url) => {
      if (url.includes(page1Cursor)) {
        return jsonResponse(200, pageBody(['9', '10'], null));
      }
      return jsonResponse(200, pageBody(['1', '2', '3', '4', '5', '6', '7', '8'], page1Cursor));
    };
  }

  const first = await runFetch(
    { username: 'joe', count: 5, out },
    config,
    { fetchImpl: fetchImplFor('CURSOR_PAGE_2'), sleepImpl: async () => {}, rng: () => 0, log: () => {} }
  );
  assert.equal(first.collected, 5);

  // Second run with a budget matching exactly the page-1 leftovers should
  // re-fetch page 1 (not jump to page 2), dedupe the 5 already-written
  // tweets, and pick up the leftover 3 -- and nothing from page 2.
  const second = await runFetch(
    { username: 'joe', count: 3, out },
    config,
    { fetchImpl: fetchImplFor('CURSOR_PAGE_2'), sleepImpl: async () => {}, rng: () => 0, log: () => {} }
  );
  assert.equal(second.collected, 3);

  const content = await readFile(out, 'utf8');
  const lines = content.trim().split('\n');
  assert.deepEqual(
    lines.map((l) => JSON.parse(l).id_str).sort((a, b) => a - b),
    ['1', '2', '3', '4', '5', '6', '7', '8']
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

function withCreatedAt(body, entryIndex, createdAt) {
  body.data.search_by_raw_query.search_timeline.timeline.instructions[0].entries[
    entryIndex
  ].content.itemContent.tweet_results.result.legacy.created_at = createdAt;
  return body;
}

test('runFindStreak persists progress and resumes after RetriesExhaustedError', async () => {
  const dir = await tmpDir();
  const out = path.join(dir, 'joe.jsonl');
  const options = { username: 'joe', since: '2023-10-01', until: '2023-10-10', out };

  const page1 = withCreatedAt(
    withCreatedAt(pageBody(['1', '2'], 'CURSOR1'), 0, 'Mon Oct 02 00:20:41 +0000 2023'),
    1,
    'Tue Oct 03 00:20:41 +0000 2023'
  );
  const firstRunResponses = [
    jsonResponse(200, page1),
    ...Array(6).fill(null).map(() => jsonResponse(429, {})),
  ];
  const firstFetchImpl = async () => firstRunResponses.shift();

  await assert.rejects(
    async () =>
      runFindStreak(options, config, { fetchImpl: firstFetchImpl, sleepImpl: async () => {}, rng: () => 0, log: () => {} }),
    RetriesExhaustedError
  );

  // Progress from the successful first page must already be on disk.
  const storedAfterFailure = (await readFile(out, 'utf8')).trim().split('\n').map((l) => JSON.parse(l).id_str);
  assert.deepEqual(storedAfterFailure.sort(), ['1', '2']);
  const state = JSON.parse(await readFile(path.join(dir, 'joe.state.json'), 'utf8'));
  assert.equal(state.cursor, 'CURSOR1');

  // Re-running should resume from CURSOR1 rather than refetching page 1.
  const page2 = withCreatedAt(pageBody(['3'], null), 0, 'Wed Oct 04 00:20:41 +0000 2023');
  const requestedCursors = [];
  const secondFetchImpl = async (url) => {
    requestedCursors.push(new URL(url).searchParams.get('variables'));
    return jsonResponse(200, page2);
  };

  const streak = await runFindStreak(options, config, {
    fetchImpl: secondFetchImpl,
    sleepImpl: async () => {},
    rng: () => 0,
    log: () => {},
  });

  assert.ok(JSON.parse(requestedCursors[0]).cursor === 'CURSOR1');
  assert.ok(streak);
  assert.equal(streak.days, 3);
  assert.equal(streak.startDate, '2023-10-02');
  assert.equal(streak.endDate, '2023-10-04');

  const storedAfterResume = (await readFile(out, 'utf8')).trim().split('\n').map((l) => JSON.parse(l).id_str);
  assert.deepEqual(storedAfterResume.sort(), ['1', '2', '3']);
});
