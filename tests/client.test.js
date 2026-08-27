import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateSearchTimeline, QueryIdStaleError, RetriesExhaustedError } from '../src/client.js';
import { ApiError } from '../src/parse.js';

const config = { authToken: 'tok', ct0: 'csrf', bearer: 'b', queryId: 'QID' };

function jsonResponse(status, body) {
  return { status, json: async () => body };
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

async function collect(gen) {
  const pages = [];
  for await (const page of gen) pages.push(page);
  return pages;
}

test('paginates until bottom cursor is null', async () => {
  const responses = [
    jsonResponse(200, pageBody(['1', '2'], 'CURSOR_A')),
    jsonResponse(200, pageBody(['3'], null)),
  ];
  const fetchImpl = async () => responses.shift();
  const sleeps = [];
  const sleepImpl = async (ms) => sleeps.push(ms);

  const pages = await collect(
    paginateSearchTimeline({ username: 'joe', config, fetchImpl, sleepImpl, rng: () => 0 })
  );

  assert.deepEqual(pages.map((p) => p.tweets.map((t) => t.id_str)), [['1', '2'], ['3']]);
  assert.ok(sleeps.length >= 1);
});

test('stops when bottom cursor repeats', async () => {
  const responses = [
    jsonResponse(200, pageBody(['1'], 'SAME')),
    jsonResponse(200, pageBody(['2'], 'SAME')),
  ];
  const fetchImpl = async () => responses.shift();
  const sleepImpl = async () => {};

  const pages = await collect(
    paginateSearchTimeline({ username: 'joe', config, fetchImpl, sleepImpl, rng: () => 0 })
  );

  assert.deepEqual(pages.map((p) => p.tweets.map((t) => t.id_str)), [['1']]);
});

test('retries on 429 with backoff then succeeds', async () => {
  const responses = [
    jsonResponse(429, {}),
    jsonResponse(429, {}),
    jsonResponse(200, pageBody(['1'], null)),
  ];
  const fetchImpl = async () => responses.shift();
  const sleeps = [];
  const sleepImpl = async (ms) => sleeps.push(ms);

  const pages = await collect(
    paginateSearchTimeline({ username: 'joe', config, fetchImpl, sleepImpl, rng: () => 0 })
  );

  assert.deepEqual(pages.map((p) => p.tweets.map((t) => t.id_str)), [['1']]);
  assert.deepEqual(sleeps.slice(0, 2), [60_000, 120_000]);
});

test('throws RetriesExhaustedError after MAX_RETRIES 429s', async () => {
  const fetchImpl = async () => jsonResponse(429, {});
  const sleepImpl = async () => {};

  await assert.rejects(async () => {
    await collect(paginateSearchTimeline({ username: 'joe', config, fetchImpl, sleepImpl, rng: () => 0 }));
  }, RetriesExhaustedError);
});

test('throws QueryIdStaleError on 404', async () => {
  const fetchImpl = async () => jsonResponse(404, {});
  const sleepImpl = async () => {};

  await assert.rejects(async () => {
    await collect(paginateSearchTimeline({ username: 'joe', config, fetchImpl, sleepImpl, rng: () => 0 }));
  }, QueryIdStaleError);
});

test('throws ApiError on unexpected status (e.g. 500)', async () => {
  const fetchImpl = async () => jsonResponse(500, {});
  const sleepImpl = async () => {};

  await assert.rejects(async () => {
    await collect(paginateSearchTimeline({ username: 'joe', config, fetchImpl, sleepImpl, rng: () => 0 }));
  }, ApiError);
});

test('throws ApiError when response body is not valid JSON', async () => {
  const fetchImpl = async () => ({
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  });
  const sleepImpl = async () => {};

  await assert.rejects(async () => {
    await collect(paginateSearchTimeline({ username: 'joe', config, fetchImpl, sleepImpl, rng: () => 0 }));
  }, ApiError);
});

test('uses startCursor as the cursor on the very first request', async () => {
  const responses = [jsonResponse(200, pageBody(['1'], null))];
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return responses.shift();
  };
  const sleepImpl = async () => {};

  await collect(
    paginateSearchTimeline({
      username: 'joe',
      config,
      fetchImpl,
      sleepImpl,
      rng: () => 0,
      startCursor: 'RESUME_CURSOR',
    })
  );

  assert.ok(urls[0].includes('RESUME_CURSOR'), `expected first URL to include startCursor, got: ${urls[0]}`);
});
