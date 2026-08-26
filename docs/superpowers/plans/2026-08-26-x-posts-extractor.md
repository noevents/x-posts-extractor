# X Posts Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node CLI that pulls an X account's posts via the internal `SearchTimeline` GraphQL endpoint into JSONL, with human-like pacing/backoff, plus a one-off `find-streak` helper to locate a daily-posting streak.

**Architecture:** A pure-function core (URL building, response parsing, pacing math, streak detection) wrapped by an async-generator (`paginateSearchTimeline`) that owns retry/backoff/pacing and cursor pagination. Two thin CLI subcommands (`fetch`, `find-streak`) consume that generator — `fetch` writes deduped JSONL + resume state, `find-streak` collects into memory and reports the longest consecutive-day run.

**Tech Stack:** Node.js 18+, built-in `fetch`/`node:test`/`node:assert`/`util.parseArgs`, `dotenv` (only dependency).

## Global Constraints

- Node >= 18, ESM (`"type": "module"` in package.json).
- Zero dependencies besides `dotenv`.
- Base delay between requests: 2–4s randomized (`2 + rng() * 2` seconds).
- Batch pause every 20–30 requests (randomized threshold), pause 30–60s (randomized).
- 429/403 → exponential backoff from 30s, doubling, capped at 10 minutes, max 5 retries, then stop.
- Empty or repeated `Bottom` cursor → stop cleanly, no error.
- Default `QUERY_ID` = `hyPfJYJ_XAtDYoslQc-Rgg`; on 404 raise a `QueryIdStaleError` with re-extraction instructions.
- `x-csrf-token` header must equal `CT0` — derived, never a separate config value.
- Output JSONL fields per tweet: `id_str, created_at, full_text, favorite_count, retweet_count, reply_count, quote_count, lang, conversation_id_str`.
- `.gitignore` must cover: `.env`, `data/`, `*.state.json`, `curl_private`.
- Tests run via `node --test`, no test framework dependency.

---

## File Structure

```
package.json
.gitignore
.env.example
bin/cli.js                 CLI entry: arg parsing + wiring (fetch, find-streak)
src/query.js                buildRawQuery, buildSearchTimelineUrl
src/parse.js                parseSearchTimelineResponse, ApiError
src/pacing.js                delay/backoff pure functions, sleep
src/store.js                 JSONL read/append, state sidecar read/write
src/config.js                 loadConfig, buildHeaders, ConfigError
src/client.js                  paginateSearchTimeline generator, QueryIdStaleError, RetriesExhaustedError
src/streak.js                   findLongestStreak
src/cli-args.js                  parseCliArgs (pure, testable arg parsing used by bin/cli.js)
tests/query.test.js
tests/parse.test.js
tests/pacing.test.js
tests/store.test.js
tests/config.test.js
tests/client.test.js
tests/streak.test.js
tests/cli-args.test.js
tests/fixtures/search-timeline-sample.json
README.md
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Modify: `.gitignore`
- Create: `.env.example`

**Interfaces:**
- Produces: `dotenv` available as a dependency for later tasks; `node --test` runnable via `npm test`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "x-posts-extractor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "dotenv": "^16.4.5"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` written, exit code 0.

- [ ] **Step 3: Extend `.gitignore`**

Append to the existing `.gitignore` (currently just `*_private`) so it reads:

```
*_private
.env
data/
*.state.json
node_modules/
```

- [ ] **Step 4: Write `.env.example`**

```
# Copy to .env and fill in from your browser session (x.com, logged in):
# DevTools > Application > Cookies > x.com
AUTH_TOKEN=
CT0=

# Optional overrides — only set these if the tool errors out saying they're stale.
# BEARER=
# QUERY_ID=
# CLIENT_TRANSACTION_ID=
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example
git commit -m "Scaffold x-posts-extractor project"
```

---

### Task 2: Query builder

**Files:**
- Create: `src/query.js`
- Test: `tests/query.test.js`

**Interfaces:**
- Produces: `buildRawQuery({ username, since, until }) -> string`, `buildSearchTimelineUrl({ queryId, username, since, until, cursor, pageSize=20 }) -> string`.

- [ ] **Step 1: Write the failing test**

```js
// tests/query.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRawQuery, buildSearchTimelineUrl } from '../src/query.js';

test('buildRawQuery: username only', () => {
  assert.equal(buildRawQuery({ username: 'JosephKChoi' }), 'from:JosephKChoi');
});

test('buildRawQuery: with since and until', () => {
  assert.equal(
    buildRawQuery({ username: 'JosephKChoi', since: '2023-08-01', until: '2023-10-01' }),
    'from:JosephKChoi since:2023-08-01 until:2023-10-01'
  );
});

test('buildSearchTimelineUrl: embeds queryId in path', () => {
  const url = buildSearchTimelineUrl({ queryId: 'ABC123', username: 'joe' });
  assert.ok(url.startsWith('https://x.com/i/api/graphql/ABC123/SearchTimeline?'));
});

test('buildSearchTimelineUrl: variables include rawQuery and pageSize as count', () => {
  const url = buildSearchTimelineUrl({ queryId: 'ABC123', username: 'joe', pageSize: 20 });
  const params = new URL(url).searchParams;
  const variables = JSON.parse(params.get('variables'));
  assert.equal(variables.rawQuery, 'from:joe');
  assert.equal(variables.count, 20);
  assert.equal('cursor' in variables, false);
});

test('buildSearchTimelineUrl: includes cursor when provided', () => {
  const url = buildSearchTimelineUrl({ queryId: 'ABC123', username: 'joe', cursor: 'CURSORVAL' });
  const variables = JSON.parse(new URL(url).searchParams.get('variables'));
  assert.equal(variables.cursor, 'CURSORVAL');
});

test('buildSearchTimelineUrl: features param is present and parseable', () => {
  const url = buildSearchTimelineUrl({ queryId: 'ABC123', username: 'joe' });
  const features = JSON.parse(new URL(url).searchParams.get('features'));
  assert.equal(typeof features.rweb_video_screen_enabled, 'boolean');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/query.test.js`
Expected: FAIL — `src/query.js` does not exist.

- [ ] **Step 3: Write implementation**

```js
// src/query.js
const FEATURES = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  rweb_conversational_replies_downvote_enabled: false,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

export function buildRawQuery({ username, since, until }) {
  let q = `from:${username}`;
  if (since) q += ` since:${since}`;
  if (until) q += ` until:${until}`;
  return q;
}

export function buildSearchTimelineUrl({ queryId, username, since, until, cursor, pageSize = 20 }) {
  const variables = {
    rawQuery: buildRawQuery({ username, since, until }),
    count: pageSize,
    querySource: 'typed_query',
    product: 'Latest',
    withGrokTranslatedBio: false,
    withQuickPromoteEligibilityTweetFields: false,
  };
  if (cursor) variables.cursor = cursor;

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(FEATURES),
  });

  return `https://x.com/i/api/graphql/${queryId}/SearchTimeline?${params.toString()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/query.test.js`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/query.js tests/query.test.js
git commit -m "Add SearchTimeline query builder"
```

---

### Task 3: Response parser

**Files:**
- Create: `src/parse.js`
- Create: `tests/fixtures/search-timeline-sample.json`
- Test: `tests/parse.test.js`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `parseSearchTimelineResponse(json) -> { tweets: Array<{id_str, created_at, full_text, favorite_count, retweet_count, reply_count, quote_count, lang, conversation_id_str}>, bottomCursor: string|null }`, `class ApiError extends Error`.

- [ ] **Step 1: Write the fixture**

```json
// tests/fixtures/search-timeline-sample.json
{
  "data": {
    "search_by_raw_query": {
      "search_timeline": {
        "timeline": {
          "instructions": [
            {
              "type": "TimelineAddEntries",
              "entries": [
                {
                  "entryId": "tweet-1708275709268152401",
                  "content": {
                    "__typename": "TimelineTimelineItem",
                    "itemContent": {
                      "__typename": "TimelineTweet",
                      "tweet_results": {
                        "result": {
                          "__typename": "Tweet",
                          "rest_id": "1708275709268152401",
                          "legacy": {
                            "id_str": "1708275709268152401",
                            "created_at": "Sun Oct 01 00:20:41 +0000 2023",
                            "full_text": "In college, I ran 3 dropshipping stores",
                            "favorite_count": 7,
                            "retweet_count": 0,
                            "reply_count": 0,
                            "quote_count": 0,
                            "lang": "en",
                            "conversation_id_str": "1708275709268152401"
                          }
                        }
                      }
                    }
                  }
                },
                {
                  "entryId": "tweet-1707918005899071957",
                  "content": {
                    "__typename": "TimelineTimelineItem",
                    "itemContent": {
                      "__typename": "TimelineTweet",
                      "tweet_results": {
                        "result": {
                          "__typename": "Tweet",
                          "rest_id": "1707918005899071957",
                          "legacy": {
                            "id_str": "1707918005899071957",
                            "created_at": "Sat Sep 30 01:12:05 +0000 2023",
                            "full_text": "Second sample tweet",
                            "favorite_count": 2,
                            "retweet_count": 1,
                            "reply_count": 0,
                            "quote_count": 0,
                            "lang": "en",
                            "conversation_id_str": "1707918005899071957"
                          }
                        }
                      }
                    }
                  }
                },
                {
                  "entryId": "cursor-top-9223372036854775807",
                  "content": {
                    "__typename": "TimelineTimelineCursor",
                    "cursorType": "Top",
                    "value": "TOPCURSORVALUE"
                  }
                },
                {
                  "entryId": "cursor-bottom-0",
                  "content": {
                    "__typename": "TimelineTimelineCursor",
                    "cursorType": "Bottom",
                    "value": "BOTTOMCURSORVALUE"
                  }
                }
              ]
            }
          ]
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

```js
// tests/parse.test.js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/parse.test.js`
Expected: FAIL — `src/parse.js` does not exist.

- [ ] **Step 4: Write implementation**

```js
// src/parse.js
export class ApiError extends Error {}

export function parseSearchTimelineResponse(json) {
  if (json?.errors?.length) {
    throw new ApiError(json.errors.map((e) => e.message).join('; '));
  }

  const instructions =
    json?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ?? [];
  const addEntries = instructions.find((i) => i.type === 'TimelineAddEntries');
  const entries = addEntries?.entries ?? [];

  const tweets = [];
  let bottomCursor = null;

  for (const entry of entries) {
    const content = entry.content;
    if (content?.__typename === 'TimelineTimelineCursor') {
      if (content.cursorType === 'Bottom') bottomCursor = content.value ?? null;
      continue;
    }
    const legacy = content?.itemContent?.tweet_results?.result?.legacy;
    if (!legacy) continue;
    tweets.push({
      id_str: legacy.id_str,
      created_at: legacy.created_at,
      full_text: legacy.full_text,
      favorite_count: legacy.favorite_count,
      retweet_count: legacy.retweet_count,
      reply_count: legacy.reply_count,
      quote_count: legacy.quote_count,
      lang: legacy.lang,
      conversation_id_str: legacy.conversation_id_str,
    });
  }

  return { tweets, bottomCursor };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/parse.test.js`
Expected: PASS, 3/3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/parse.js tests/parse.test.js tests/fixtures/search-timeline-sample.json
git commit -m "Add SearchTimeline response parser"
```

---

### Task 4: Pacing and backoff

**Files:**
- Create: `src/pacing.js`
- Test: `tests/pacing.test.js`

**Interfaces:**
- Produces: `pickBaseDelayMs(rng)`, `pickBatchPauseThreshold(rng)`, `pickBatchPauseMs(rng)`, `backoffDelayMs(attempt)`, `MAX_RETRIES`, `sleep(ms)`.

- [ ] **Step 1: Write the failing test**

```js
// tests/pacing.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickBaseDelayMs,
  pickBatchPauseThreshold,
  pickBatchPauseMs,
  backoffDelayMs,
  MAX_RETRIES,
} from '../src/pacing.js';

test('pickBaseDelayMs stays within 2000-4000ms', () => {
  assert.equal(pickBaseDelayMs(() => 0), 2000);
  assert.equal(pickBaseDelayMs(() => 0.999999), 4000);
});

test('pickBatchPauseThreshold stays within 20-30', () => {
  assert.equal(pickBatchPauseThreshold(() => 0), 20);
  assert.equal(pickBatchPauseThreshold(() => 0.999999), 30);
});

test('pickBatchPauseMs stays within 30000-60000ms', () => {
  assert.equal(pickBatchPauseMs(() => 0), 30000);
  assert.equal(pickBatchPauseMs(() => 0.999999), 60000);
});

test('backoffDelayMs doubles from 30s and caps at 10 minutes', () => {
  assert.equal(backoffDelayMs(1), 30_000);
  assert.equal(backoffDelayMs(2), 60_000);
  assert.equal(backoffDelayMs(3), 120_000);
  assert.equal(backoffDelayMs(4), 240_000);
  assert.equal(backoffDelayMs(5), 480_000);
  assert.equal(backoffDelayMs(6), 600_000);
  assert.equal(backoffDelayMs(10), 600_000);
});

test('MAX_RETRIES is 5', () => {
  assert.equal(MAX_RETRIES, 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pacing.test.js`
Expected: FAIL — `src/pacing.js` does not exist.

- [ ] **Step 3: Write implementation**

```js
// src/pacing.js
export function pickBaseDelayMs(rng = Math.random) {
  return Math.round((2 + rng() * 2) * 1000);
}

export function pickBatchPauseThreshold(rng = Math.random) {
  return 20 + Math.floor(rng() * 11);
}

export function pickBatchPauseMs(rng = Math.random) {
  return Math.round((30 + rng() * 30) * 1000);
}

export const MAX_RETRIES = 5;

export function backoffDelayMs(attempt) {
  const delay = 30_000 * 2 ** (attempt - 1);
  return Math.min(delay, 600_000);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/pacing.test.js`
Expected: PASS, 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/pacing.js tests/pacing.test.js
git commit -m "Add pacing and backoff calculators"
```

---

### Task 5: JSONL store and resume state

**Files:**
- Create: `src/store.js`
- Test: `tests/store.test.js`

**Interfaces:**
- Produces: `loadExistingIds(filePath) -> Promise<Set<string>>`, `appendTweets(filePath, tweets) -> Promise<number>`, `loadState(stateFilePath) -> Promise<object|null>`, `saveState(stateFilePath, state) -> Promise<void>`.

- [ ] **Step 1: Write the failing test**

```js
// tests/store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadExistingIds, appendTweets, loadState, saveState } from '../src/store.js';

async function tmpFile(name) {
  const dir = await mkdtemp(path.join(tmpdir(), 'xpe-'));
  return path.join(dir, name);
}

test('loadExistingIds returns empty set for missing file', async () => {
  const file = await tmpFile('out.jsonl');
  const ids = await loadExistingIds(file);
  assert.deepEqual([...ids], []);
});

test('appendTweets writes JSONL lines and creates parent dir', async () => {
  const file = await tmpFile('nested/out.jsonl');
  const count = await appendTweets(file, [{ id_str: '1', full_text: 'a' }, { id_str: '2', full_text: 'b' }]);
  assert.equal(count, 2);
  const content = await readFile(file, 'utf8');
  const lines = content.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { id_str: '1', full_text: 'a' });
});

test('loadExistingIds reads ids back after appendTweets', async () => {
  const file = await tmpFile('out.jsonl');
  await appendTweets(file, [{ id_str: '1' }, { id_str: '2' }]);
  const ids = await loadExistingIds(file);
  assert.deepEqual([...ids].sort(), ['1', '2']);
});

test('appendTweets is a no-op for an empty array', async () => {
  const file = await tmpFile('out.jsonl');
  const count = await appendTweets(file, []);
  assert.equal(count, 0);
  const ids = await loadExistingIds(file);
  assert.deepEqual([...ids], []);
});

test('saveState/loadState round-trip, loadState returns null when missing', async () => {
  const file = await tmpFile('state.json');
  assert.equal(await loadState(file), null);
  await saveState(file, { cursor: 'ABC' });
  assert.deepEqual(await loadState(file), { cursor: 'ABC' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/store.test.js`
Expected: FAIL — `src/store.js` does not exist.

- [ ] **Step 3: Write implementation**

```js
// src/store.js
import { readFile, appendFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function loadExistingIds(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    const ids = new Set();
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      ids.add(JSON.parse(line).id_str);
    }
    return ids;
  } catch (err) {
    if (err.code === 'ENOENT') return new Set();
    throw err;
  }
}

export async function appendTweets(filePath, tweets) {
  if (tweets.length === 0) return 0;
  await mkdir(path.dirname(filePath), { recursive: true });
  const lines = tweets.map((t) => JSON.stringify(t)).join('\n') + '\n';
  await appendFile(filePath, lines, 'utf8');
  return tweets.length;
}

export async function loadState(stateFilePath) {
  try {
    const content = await readFile(stateFilePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function saveState(stateFilePath, state) {
  await mkdir(path.dirname(stateFilePath), { recursive: true });
  await writeFile(stateFilePath, JSON.stringify(state), 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/store.test.js`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store.js tests/store.test.js
git commit -m "Add JSONL store and resume state"
```

---

### Task 6: Config loading

**Files:**
- Create: `src/config.js`
- Test: `tests/config.test.js`

**Interfaces:**
- Produces: `loadConfig(env=process.env) -> {authToken, ct0, bearer, queryId, clientTransactionId}`, `class ConfigError extends Error`, `buildHeaders(config) -> object`.

- [ ] **Step 1: Write the failing test**

```js
// tests/config.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, buildHeaders, ConfigError } from '../src/config.js';

test('loadConfig throws ConfigError when AUTH_TOKEN or CT0 missing', () => {
  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => loadConfig({ AUTH_TOKEN: 'x' }), ConfigError);
});

test('loadConfig applies defaults for bearer and queryId', () => {
  const config = loadConfig({ AUTH_TOKEN: 'tok', CT0: 'csrf' });
  assert.equal(config.authToken, 'tok');
  assert.equal(config.ct0, 'csrf');
  assert.equal(config.queryId, 'hyPfJYJ_XAtDYoslQc-Rgg');
  assert.equal(config.clientTransactionId, undefined);
  assert.ok(config.bearer.length > 0);
});

test('loadConfig respects overrides', () => {
  const config = loadConfig({
    AUTH_TOKEN: 'tok',
    CT0: 'csrf',
    QUERY_ID: 'CUSTOM',
    BEARER: 'CUSTOMBEARER',
    CLIENT_TRANSACTION_ID: 'TXID',
  });
  assert.equal(config.queryId, 'CUSTOM');
  assert.equal(config.bearer, 'CUSTOMBEARER');
  assert.equal(config.clientTransactionId, 'TXID');
});

test('buildHeaders derives x-csrf-token from ct0 and omits optional header when unset', () => {
  const config = loadConfig({ AUTH_TOKEN: 'tok', CT0: 'csrf' });
  const headers = buildHeaders(config);
  assert.equal(headers['x-csrf-token'], 'csrf');
  assert.match(headers.cookie, /auth_token=tok/);
  assert.match(headers.cookie, /ct0=csrf/);
  assert.equal('x-client-transaction-id' in headers, false);
});

test('buildHeaders includes x-client-transaction-id when set', () => {
  const config = loadConfig({ AUTH_TOKEN: 'tok', CT0: 'csrf', CLIENT_TRANSACTION_ID: 'TXID' });
  const headers = buildHeaders(config);
  assert.equal(headers['x-client-transaction-id'], 'TXID');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/config.test.js`
Expected: FAIL — `src/config.js` does not exist.

- [ ] **Step 3: Write implementation**

```js
// src/config.js
const DEFAULT_QUERY_ID = 'hyPfJYJ_XAtDYoslQc-Rgg';
const DEFAULT_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

export class ConfigError extends Error {}

export function loadConfig(env = process.env) {
  const authToken = env.AUTH_TOKEN;
  const ct0 = env.CT0;
  if (!authToken || !ct0) {
    throw new ConfigError(
      'Missing AUTH_TOKEN and/or CT0. Copy .env.example to .env and fill in values from your browser session (x.com DevTools > Application > Cookies).'
    );
  }
  return {
    authToken,
    ct0,
    bearer: env.BEARER || DEFAULT_BEARER,
    queryId: env.QUERY_ID || DEFAULT_QUERY_ID,
    clientTransactionId: env.CLIENT_TRANSACTION_ID || undefined,
  };
}

export function buildHeaders(config) {
  const headers = {
    accept: '*/*',
    'content-type': 'application/json',
    authorization: `Bearer ${config.bearer}`,
    cookie: `auth_token=${config.authToken}; ct0=${config.ct0}`,
    'x-csrf-token': config.ct0,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-client-language': 'en',
  };
  if (config.clientTransactionId) {
    headers['x-client-transaction-id'] = config.clientTransactionId;
  }
  return headers;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/config.test.js`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/config.js tests/config.test.js
git commit -m "Add config loading and header building"
```

---

### Task 7: Pagination client with retry/backoff/pacing

**Files:**
- Create: `src/client.js`
- Test: `tests/client.test.js`

**Interfaces:**
- Consumes: `buildSearchTimelineUrl` from `src/query.js`, `parseSearchTimelineResponse`/`ApiError` from `src/parse.js`, `buildHeaders` from `src/config.js`, pacing functions from `src/pacing.js`.
- Produces: `async function* paginateSearchTimeline({username, since, until, config, fetchImpl, sleepImpl, rng, log}) -> AsyncGenerator<Array<tweet>>`, `class QueryIdStaleError extends Error`, `class RetriesExhaustedError extends Error`.

- [ ] **Step 1: Write the failing test**

```js
// tests/client.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateSearchTimeline, QueryIdStaleError, RetriesExhaustedError } from '../src/client.js';

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

  assert.deepEqual(pages.map((p) => p.map((t) => t.id_str)), [['1', '2'], ['3']]);
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

  assert.deepEqual(pages.map((p) => p.map((t) => t.id_str)), [['1']]);
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

  assert.deepEqual(pages.map((p) => p.map((t) => t.id_str)), [['1']]);
  assert.deepEqual(sleeps.slice(0, 2), [30_000, 60_000]);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/client.test.js`
Expected: FAIL — `src/client.js` does not exist.

- [ ] **Step 3: Write implementation**

```js
// src/client.js
import { buildSearchTimelineUrl } from './query.js';
import { parseSearchTimelineResponse } from './parse.js';
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
}) {
  const headers = buildHeaders(config);
  let cursor;
  let lastCursor = null;
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

      const json = await res.json();
      page = parseSearchTimelineResponse(json);
      break;
    }

    requestCount++;
    yield page.tweets;

    if (!page.bottomCursor || page.bottomCursor === lastCursor) {
      return;
    }
    lastCursor = page.bottomCursor;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/client.test.js`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/client.js tests/client.test.js
git commit -m "Add pagination client with retry, backoff, and pacing"
```

---

### Task 8: Streak detection

**Files:**
- Create: `src/streak.js`
- Test: `tests/streak.test.js`

**Interfaces:**
- Produces: `findLongestStreak(tweets: Array<{created_at: string}>) -> {startDate: string, endDate: string, days: number} | null`.

- [ ] **Step 1: Write the failing test**

```js
// tests/streak.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { findLongestStreak } from '../src/streak.js';

function tw(dateStr) {
  return { created_at: `${dateStr}T12:00:00Z` };
}

test('returns null for empty input', () => {
  assert.equal(findLongestStreak([]), null);
});

test('single day is a streak of 1', () => {
  const result = findLongestStreak([tw('2023-10-01')]);
  assert.deepEqual(result, { startDate: '2023-10-01', endDate: '2023-10-01', days: 1 });
});

test('finds the longest run of consecutive days across a gap', () => {
  const tweets = [
    tw('2023-09-01'),
    tw('2023-09-03'),
    tw('2023-09-04'),
    tw('2023-09-05'),
    tw('2023-09-10'),
  ];
  const result = findLongestStreak(tweets);
  assert.deepEqual(result, { startDate: '2023-09-03', endDate: '2023-09-05', days: 3 });
});

test('multiple tweets on the same day count once', () => {
  const tweets = [tw('2023-09-01'), tw('2023-09-01'), tw('2023-09-02')];
  const result = findLongestStreak(tweets);
  assert.deepEqual(result, { startDate: '2023-09-01', endDate: '2023-09-02', days: 2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/streak.test.js`
Expected: FAIL — `src/streak.js` does not exist.

- [ ] **Step 3: Write implementation**

```js
// src/streak.js
function toDateStr(createdAt) {
  return new Date(createdAt).toISOString().slice(0, 10);
}

export function findLongestStreak(tweets) {
  const days = [...new Set(tweets.map((t) => toDateStr(t.created_at)))].sort();
  if (days.length === 0) return null;

  let bestStart = days[0];
  let bestEnd = days[0];
  let bestLen = 1;
  let curStart = days[0];
  let curLen = 1;

  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]);
    const cur = new Date(days[i]);
    const diffDays = Math.round((cur - prev) / 86_400_000);

    if (diffDays === 1) {
      curLen++;
    } else {
      curStart = days[i];
      curLen = 1;
    }

    if (curLen > bestLen) {
      bestLen = curLen;
      bestStart = curStart;
      bestEnd = days[i];
    }
  }

  return { startDate: bestStart, endDate: bestEnd, days: bestLen };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/streak.test.js`
Expected: PASS, 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/streak.js tests/streak.test.js
git commit -m "Add longest daily-streak detector"
```

---

### Task 9: CLI argument parsing

**Files:**
- Create: `src/cli-args.js`
- Test: `tests/cli-args.test.js`

**Interfaces:**
- Produces: `parseCliArgs(argv: string[]) -> {command: 'fetch', options: {username, count, since, until, out}} | {command: 'find-streak', options: {username, since, until}}`. Throws `Error` with a usage message on invalid input.

- [ ] **Step 1: Write the failing test**

```js
// tests/cli-args.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../src/cli-args.js';

test('fetch: defaults count=5 and derives out path from username', () => {
  const { command, options } = parseCliArgs(['fetch', '--username', 'JosephKChoi']);
  assert.equal(command, 'fetch');
  assert.equal(options.username, 'JosephKChoi');
  assert.equal(options.count, 5);
  assert.equal(options.since, undefined);
  assert.equal(options.until, undefined);
  assert.equal(options.out, 'data/JosephKChoi.jsonl');
});

test('fetch: accepts overrides', () => {
  const { options } = parseCliArgs([
    'fetch', '--username', 'joe', '--count', '50', '--since', '2023-09-01', '--until', '2023-10-01', '--out', 'data/custom.jsonl',
  ]);
  assert.equal(options.count, 50);
  assert.equal(options.since, '2023-09-01');
  assert.equal(options.until, '2023-10-01');
  assert.equal(options.out, 'data/custom.jsonl');
});

test('fetch: throws when --username missing', () => {
  assert.throws(() => parseCliArgs(['fetch']), /--username is required/);
});

test('find-streak: requires username, since, until', () => {
  const { command, options } = parseCliArgs([
    'find-streak', '--username', 'joe', '--since', '2023-08-01', '--until', '2024-02-01',
  ]);
  assert.equal(command, 'find-streak');
  assert.deepEqual(options, { username: 'joe', since: '2023-08-01', until: '2024-02-01' });
});

test('find-streak: throws when --since or --until missing', () => {
  assert.throws(() => parseCliArgs(['find-streak', '--username', 'joe']), /--since and --until are required/);
});

test('throws on missing or unknown command', () => {
  assert.throws(() => parseCliArgs([]), /Usage:/);
  assert.throws(() => parseCliArgs(['bogus']), /Unknown command/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cli-args.test.js`
Expected: FAIL — `src/cli-args.js` does not exist.

- [ ] **Step 3: Write implementation**

```js
// src/cli-args.js
import { parseArgs } from 'node:util';

const USAGE = `Usage:
  cli.js fetch --username <name> [--count 5] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--out data/<name>.jsonl]
  cli.js find-streak --username <name> --since YYYY-MM-DD --until YYYY-MM-DD`;

export function parseCliArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) throw new Error(USAGE);

  if (command === 'fetch') {
    const { values } = parseArgs({
      args: rest,
      options: {
        username: { type: 'string' },
        count: { type: 'string', default: '5' },
        since: { type: 'string' },
        until: { type: 'string' },
        out: { type: 'string' },
      },
    });
    if (!values.username) throw new Error('--username is required\n\n' + USAGE);
    return {
      command: 'fetch',
      options: {
        username: values.username,
        count: Number(values.count),
        since: values.since,
        until: values.until,
        out: values.out || `data/${values.username}.jsonl`,
      },
    };
  }

  if (command === 'find-streak') {
    const { values } = parseArgs({
      args: rest,
      options: {
        username: { type: 'string' },
        since: { type: 'string' },
        until: { type: 'string' },
      },
    });
    if (!values.username) throw new Error('--username is required\n\n' + USAGE);
    if (!values.since || !values.until) {
      throw new Error('--since and --until are required\n\n' + USAGE);
    }
    return {
      command: 'find-streak',
      options: { username: values.username, since: values.since, until: values.until },
    };
  }

  throw new Error(`Unknown command "${command}"\n\n${USAGE}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cli-args.test.js`
Expected: PASS, 6/6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli-args.js tests/cli-args.test.js
git commit -m "Add CLI argument parsing"
```

---

### Task 10: CLI wiring and README

**Files:**
- Create: `bin/cli.js`
- Create: `README.md`

**Interfaces:**
- Consumes: `parseCliArgs` from `src/cli-args.js`; `loadConfig`, `ConfigError` from `src/config.js`; `paginateSearchTimeline`, `QueryIdStaleError`, `RetriesExhaustedError` from `src/client.js`; `loadExistingIds`, `appendTweets`, `loadState`, `saveState` from `src/store.js`; `findLongestStreak` from `src/streak.js`.
- Produces: the runnable CLI (`node bin/cli.js ...`).

- [ ] **Step 1: Write `bin/cli.js`**

```js
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
```

- [ ] **Step 2: Manual smoke test — bad input paths**

Run: `node bin/cli.js` (no `.env` set up yet)
Expected: prints usage error (`Usage:`) and exits 1 — no crash/stack trace.

Run: `cp .env.example .env` then edit `.env` with dummy values `AUTH_TOKEN=dummy`, `CT0=dummy`, then run `node bin/cli.js fetch --username test`.
Expected: makes a real request with dummy creds, X returns an auth error (likely a non-200/HTML/JSON error), the process should not crash uncaught — if it does throw unhandled, fix `runFetch`/`main` error handling before proceeding.

- [ ] **Step 3: Manual smoke test — real credentials**

Fill `.env` with real `AUTH_TOKEN`/`CT0` values (from the working `curl_private` session).
Run: `node bin/cli.js fetch --username JosephKChoi --count 5`
Expected: `data/JosephKChoi.jsonl` created with 5 lines, each valid JSON with the documented fields; console shows progress lines on stderr.

Run again: `node bin/cli.js fetch --username JosephKChoi --count 5`
Expected: no duplicate lines appended (dedupe working) — `wc -l data/JosephKChoi.jsonl` still shows the same count unless new tweets were posted.

- [ ] **Step 4: Write `README.md`**

```markdown
# x-posts-extractor

Pull an X (Twitter) account's posts into JSONL via the internal `SearchTimeline` endpoint, for offline reading and analysis.

## Setup

1. `npm install`
2. `cp .env.example .env`
3. Log into x.com in your browser, open DevTools > Application > Cookies, and copy:
   - `auth_token` → `AUTH_TOKEN` in `.env`
   - `ct0` → `CT0` in `.env`

## Usage

Fetch the 5 most recent posts from an account (default):

    node bin/cli.js fetch --username JosephKChoi

Fetch more, or a specific date window:

    node bin/cli.js fetch --username JosephKChoi --count 200 --since 2023-09-01 --until 2023-11-01

Output is written to `data/<username>.jsonl` (override with `--out`), one JSON object per line:

    {"id_str":"...","created_at":"...","full_text":"...","favorite_count":0,"retweet_count":0,"reply_count":0,"quote_count":0,"lang":"en","conversation_id_str":"..."}

Re-running `fetch` is safe — it dedupes against what's already in the output file.

### Finding a posting streak

One-off helper — not part of normal `fetch` usage — to locate the longest run of consecutive days with a post in a given window, e.g. to find where a "30 days straight" streak started:

    node bin/cli.js find-streak --username JosephKChoi --since 2023-08-01 --until 2024-02-01

Prints the date range, which you then feed into `fetch --since ...` to pull that period for real.

## When it breaks: the query ID went stale

X's internal GraphQL `SearchTimeline` query ID changes periodically. If the tool errors with a message about a 404 / stale query ID:

1. Open x.com, run any search.
2. In DevTools > Network, find a request named `SearchTimeline`.
3. Copy the id from its URL path: `.../graphql/<QUERY_ID>/SearchTimeline`.
4. Set `QUERY_ID=<that id>` in `.env`.

If requests start failing consistently even with a fresh query ID, the `x-client-transaction-id` header may also need refreshing — copy it from the same DevTools request and set `CLIENT_TRANSACTION_ID` in `.env`.

## Pacing

Requests are paced to resemble manual browsing: randomized 2–4s delays, a 30–60s pause every 20–30 requests, and exponential backoff (capped at 10 minutes, 5 retries) on rate-limit responses. On repeated failure the tool stops — progress already written to the JSONL file is preserved.

## Tests

    npm test
```

- [ ] **Step 5: Commit**

```bash
git add bin/cli.js README.md
git commit -m "Wire up CLI commands and add README"
```

---

## Post-plan verification

After Task 10, run the full suite once more and confirm no regressions:

```bash
npm test
```

Expected: all tests across `tests/*.test.js` pass.
