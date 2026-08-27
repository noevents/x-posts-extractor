import { readFile, appendFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function loadExistingTweets(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    const tweets = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      tweets.push(JSON.parse(line));
    }
    return tweets;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function loadExistingIds(filePath) {
  const tweets = await loadExistingTweets(filePath);
  return new Set(tweets.map((t) => t.id_str));
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
