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
