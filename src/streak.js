export function toDateStr(createdAt) {
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
