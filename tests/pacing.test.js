import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickBaseDelayMs,
  pickBatchPauseThreshold,
  pickBatchPauseMs,
  backoffDelayMs,
  MAX_RETRIES,
} from '../src/pacing.js';

test('pickBaseDelayMs stays within 4000-7000ms', () => {
  assert.equal(pickBaseDelayMs(() => 0), 4000);
  assert.equal(pickBaseDelayMs(() => 0.999999), 7000);
});

test('pickBatchPauseThreshold stays within 8-12', () => {
  assert.equal(pickBatchPauseThreshold(() => 0), 8);
  assert.equal(pickBatchPauseThreshold(() => 0.999999), 12);
});

test('pickBatchPauseMs stays within 60000-120000ms', () => {
  assert.equal(pickBatchPauseMs(() => 0), 60000);
  assert.equal(pickBatchPauseMs(() => 0.999999), 120000);
});

test('backoffDelayMs doubles from 60s and caps at 15 minutes', () => {
  assert.equal(backoffDelayMs(1), 60_000);
  assert.equal(backoffDelayMs(2), 120_000);
  assert.equal(backoffDelayMs(3), 240_000);
  assert.equal(backoffDelayMs(4), 480_000);
  assert.equal(backoffDelayMs(5), 900_000);
  assert.equal(backoffDelayMs(6), 900_000);
  assert.equal(backoffDelayMs(10), 900_000);
});

test('MAX_RETRIES is 6', () => {
  assert.equal(MAX_RETRIES, 6);
});
