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
