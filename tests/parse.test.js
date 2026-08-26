import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSearchTimelineResponse, ApiError } from '../src/parse.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/search-timeline-sample.json', import.meta.url))
);

test('parses tweets from a sample response', () => {
  const { tweets, bottomCursor } = parseSearchTimelineResponse(fixture);
  assert.equal(tweets.length, 2);
  assert.deepEqual(tweets[0], {
    id_str: '1708275709268152401',
    created_at: 'Sun Oct 01 00:20:41 +0000 2023',
    full_text: 'In college, I ran 3 dropshipping stores',
    favorite_count: 7,
    retweet_count: 0,
    reply_count: 0,
    quote_count: 0,
    lang: 'en',
    conversation_id_str: '1708275709268152401',
  });
  assert.equal(bottomCursor, 'BOTTOMCURSORVALUE');
});

test('returns empty tweets and null cursor when instructions missing', () => {
  const { tweets, bottomCursor } = parseSearchTimelineResponse({ data: {} });
  assert.deepEqual(tweets, []);
  assert.equal(bottomCursor, null);
});

test('throws ApiError when response has an errors array', () => {
  assert.throws(
    () => parseSearchTimelineResponse({ errors: [{ message: 'Rate limit exceeded' }] }),
    ApiError
  );
});
