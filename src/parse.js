export class ApiError extends Error {}

function pushTweetFromItemContent(tweets, itemContent) {
  const legacy = itemContent?.tweet_results?.result?.legacy;
  if (!legacy) return;
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

function extractTweetsAndCursor(instructions) {
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
    if (content?.__typename === 'TimelineTimelineModule') {
      // Self-thread entries (e.g. UserOriginalsTimeline's "VerticalConversation"
      // modules) nest each tweet under items[].item.itemContent instead of
      // directly on content.itemContent.
      for (const moduleItem of content.items ?? []) {
        pushTweetFromItemContent(tweets, moduleItem?.item?.itemContent);
      }
      continue;
    }
    pushTweetFromItemContent(tweets, content?.itemContent);
  }

  return { tweets, bottomCursor };
}

export function parseSearchTimelineResponse(json) {
  if (json?.errors?.length) {
    throw new ApiError(json.errors.map((e) => e.message).join('; '));
  }

  const instructions =
    json?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ?? [];
  return extractTweetsAndCursor(instructions);
}

export function parseUserTimelineResponse(json) {
  if (json?.errors?.length) {
    throw new ApiError(json.errors.map((e) => e.message).join('; '));
  }

  const instructions = json?.data?.user?.result?.timeline?.timeline?.instructions ?? [];
  return extractTweetsAndCursor(instructions);
}
