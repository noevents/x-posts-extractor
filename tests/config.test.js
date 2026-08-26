import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, buildHeaders, ConfigError } from '../src/config.js';

test('loadConfig throws ConfigError when AUTH_TOKEN or CT0 missing', () => {
  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => loadConfig({ AUTH_TOKEN: 'x' }), ConfigError);
});

test('loadConfig applies defaults for bearer and queryId', () => {
  const config = loadConfig({ AUTH_TOKEN: 'tok', CT0: 'csrf' });
  assert.equal(config.authToken, 'tok');
  assert.equal(config.ct0, 'csrf');
  assert.equal(config.queryId, 'hyPfJYJ_XAtDYoslQc-Rgg');
  assert.equal(config.clientTransactionId, undefined);
  assert.ok(config.bearer.length > 0);
});

test('loadConfig respects overrides', () => {
  const config = loadConfig({
    AUTH_TOKEN: 'tok',
    CT0: 'csrf',
    QUERY_ID: 'CUSTOM',
    BEARER: 'CUSTOMBEARER',
    CLIENT_TRANSACTION_ID: 'TXID',
  });
  assert.equal(config.queryId, 'CUSTOM');
  assert.equal(config.bearer, 'CUSTOMBEARER');
  assert.equal(config.clientTransactionId, 'TXID');
});

test('buildHeaders derives x-csrf-token from ct0 and omits optional header when unset', () => {
  const config = loadConfig({ AUTH_TOKEN: 'tok', CT0: 'csrf' });
  const headers = buildHeaders(config);
  assert.equal(headers['x-csrf-token'], 'csrf');
  assert.match(headers.cookie, /auth_token=tok/);
  assert.match(headers.cookie, /ct0=csrf/);
  assert.equal('x-client-transaction-id' in headers, false);
});

test('buildHeaders includes x-client-transaction-id when set', () => {
  const config = loadConfig({ AUTH_TOKEN: 'tok', CT0: 'csrf', CLIENT_TRANSACTION_ID: 'TXID' });
  const headers = buildHeaders(config);
  assert.equal(headers['x-client-transaction-id'], 'TXID');
});
