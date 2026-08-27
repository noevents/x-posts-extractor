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
  assert.deepEqual(options, { username: 'joe', since: '2023-08-01', until: '2024-02-01', out: 'data/joe.jsonl' });
});

test('find-streak: throws when --since or --until missing', () => {
  assert.throws(() => parseCliArgs(['find-streak', '--username', 'joe']), /--since and --until are required/);
});

test('throws on missing or unknown command', () => {
  assert.throws(() => parseCliArgs([]), /Usage:/);
  assert.throws(() => parseCliArgs(['bogus']), /Unknown command/);
});
