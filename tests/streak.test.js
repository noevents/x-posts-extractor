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
