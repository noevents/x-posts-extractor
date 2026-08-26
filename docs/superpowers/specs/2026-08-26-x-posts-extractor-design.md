# X Posts Extractor — Design

## Goal
A Node CLI to extract posts from an X (Twitter) account via the internal `SearchTimeline` GraphQL endpoint, for offline reading/analysis of a specific account's posting history — including finding a specific ~30-day daily-posting streak from late 2023 without manually bisecting the web UI's `until:` date.

## Data contract (confirmed via manual fetch)
- Endpoint: `GET https://x.com/i/api/graphql/<QUERY_ID>/SearchTimeline`
- `<QUERY_ID>` (currently `hyPfJYJ_XAtDYoslQc-Rgg`) is unstable and can change without notice.
- `variables.rawQuery` supports `from:<username>` plus optional `since:YYYY-MM-DD` / `until:YYYY-MM-DD`.
- Response path: `data.search_by_raw_query.search_timeline.timeline.instructions[0].entries[]`.
- Each entry is either:
  - `TimelineTimelineItem` → tweet at `content.itemContent.tweet_results.result`, fields of interest under `.legacy`: `id_str, created_at, full_text, favorite_count, retweet_count, reply_count, quote_count, lang, conversation_id_str, entities`.
  - `TimelineTimelineCursor` with `cursorType: Top|Bottom` and a `value` string. The `Bottom` cursor's `value` is passed as `variables.cursor` to fetch the next page.
- Pagination ends when the `Bottom` cursor is empty or repeats across requests (stale cursor).
- Auth: `authorization` bearer token (public, static, safe to hardcode), `cookie` (`auth_token`, `ct0`), and `x-csrf-token` (must equal the `ct0` cookie value).

## CLI

### `fetch` — everyday use
```
node bin/cli.js fetch --username <name> [--count 5] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--out data/<name>.jsonl]
```
- Builds `rawQuery` from `username` + optional `since`/`until`.
- Paginates via `Bottom` cursor until `count` tweets collected or cursor is empty/repeats.
- Appends new tweets to the output JSONL, deduping on `id_str` against what's already in the file (safe to re-run/resume).
- Writes a `.state.json` sidecar (last cursor, last run timestamp) next to the output file for resuming an interrupted run.

### `find-streak` — one-off helper, not run as part of normal `fetch` usage
```
node bin/cli.js find-streak --username <name> --since YYYY-MM-DD --until YYYY-MM-DD
```
- Fetches the given window directly into memory (does not touch the main JSONL output).
- Groups tweets by calendar date, finds the longest run of consecutive days with ≥1 post, prints that date range.
- Purpose: locate the exact 30-day streak once, to know where to start a real `fetch` pull with `--since`.

## Auth & secrets
- `.env` (gitignored) holds `AUTH_TOKEN`, `CT0`. `BEARER` and `QUERY_ID` are optional overrides with hardcoded defaults in code.
- `.env.example` committed as a template with placeholder values.
- `curl_private` added to `.gitignore` (already covered by existing `*_private` pattern) and never read into committed code.
- `x-csrf-token` header is derived from `CT0` in code, not stored twice.

## Handling endpoint instability
- `QUERY_ID` is a constant with a documented override via `.env`.
- On a 404 from the SearchTimeline path, the tool prints an explicit error: the query ID is likely stale, with instructions to extract a fresh one from browser devtools (Network tab → find a `SearchTimeline` request → copy the id from the URL) and set `QUERY_ID` in `.env`.

## Pacing & backoff
- Base delay between requests: 2–4s, randomized per request (not fixed).
- Every 20–30 requests (randomized), pause 30–60s (randomized) — a "breather" pattern.
- On HTTP 429/403: exponential backoff starting at 30s, doubling, capped at ~10 minutes, max 5 retries; if exhausted, stop and exit — progress is already safe because tweets are appended incrementally and the cursor sidecar is written after each page.
- On empty or repeated (stale) cursor: stop cleanly, no error.

## Storage format
JSONL, one flattened tweet object per line:
```json
{"id_str":"...","created_at":"...","full_text":"...","favorite_count":0,"retweet_count":0,"reply_count":0,"quote_count":0,"lang":"en","conversation_id_str":"..."}
```
Flattened (not the raw nested API blob, which is mostly UI/badge/grok cruft) — still trivial to pipe: `jq`, pandas (`read_json(lines=True)`), or DuckDB (`read_json_auto` reads JSONL natively) all consume it directly without conversion.

## Out of scope
- No browser automation / auto-refresh of `QUERY_ID` or `x-client-transaction-id` — manual re-extraction is acceptable at this usage volume.
- No database, no web UI — CLI + JSONL is sufficient for the stated goal (read/analyze, pipe elsewhere later).
