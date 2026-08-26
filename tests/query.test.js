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
