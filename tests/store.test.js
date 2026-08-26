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
