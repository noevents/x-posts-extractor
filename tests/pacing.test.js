import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickBaseDelayMs,
  pickBatchPauseThreshold,
  pickBatchPauseMs,
  backoffDelayMs,
  MAX_RETRIES,
} from '../src/pacing.js';

test('pickBaseDelayMs stays within 2000-4000ms', () => {
  assert.equal(pickBaseDelayMs(() => 0), 2000);
  assert.equal(pickBaseDelayMs(() => 0.999999), 4000);
});

test('pickBatchPauseThreshold stays within 20-30', () => {
  assert.equal(pickBatchPauseThreshold(() => 0), 20);
  assert.equal(pickBatchPauseThreshold(() => 0.999999), 30);
});

test('pickBatchPauseMs stays within 30000-60000ms', () => {
  assert.equal(pickBatchPauseMs(() => 0), 30000);
  assert.equal(pickBatchPauseMs(() => 0.999999), 60000);
});

test('backoffDelayMs doubles from 30s and caps at 10 minutes', () => {
  assert.equal(backoffDelayMs(1), 30_000);
  assert.equal(backoffDelayMs(2), 60_000);
  assert.equal(backoffDelayMs(3), 120_000);
  assert.equal(backoffDelayMs(4), 240_000);
  assert.equal(backoffDelayMs(5), 480_000);
  assert.equal(backoffDelayMs(6), 600_000);
  assert.equal(backoffDelayMs(10), 600_000);
});

test('MAX_RETRIES is 5', () => {
  assert.equal(MAX_RETRIES, 5);
});
