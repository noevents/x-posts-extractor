const DEFAULT_QUERY_ID = 'hyPfJYJ_XAtDYoslQc-Rgg';
const DEFAULT_USER_TIMELINE_QUERY_ID = 'jcbfqPu_2XMNOwVyGypRhw';
const DEFAULT_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

export class ConfigError extends Error {}

export function loadConfig(env = process.env) {
  const authToken = env.AUTH_TOKEN;
  const ct0 = env.CT0;
  if (!authToken || !ct0) {
    throw new ConfigError(
      'Missing AUTH_TOKEN and/or CT0. Copy .env.example to .env and fill in values from your browser session (x.com DevTools > Application > Cookies).'
    );
  }
  return {
    authToken,
    ct0,
    bearer: env.BEARER || DEFAULT_BEARER,
    queryId: env.QUERY_ID || DEFAULT_QUERY_ID,
    userTimelineQueryId: env.USER_TIMELINE_QUERY_ID || DEFAULT_USER_TIMELINE_QUERY_ID,
    clientTransactionId: env.CLIENT_TRANSACTION_ID || undefined,
  };
}

export function buildHeaders(config) {
  const headers = {
    accept: '*/*',
    'content-type': 'application/json',
    authorization: `Bearer ${config.bearer}`,
    cookie: `auth_token=${config.authToken}; ct0=${config.ct0}`,
    'x-csrf-token': config.ct0,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-client-language': 'en',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    referer: 'https://x.com/',
  };
  if (config.clientTransactionId) {
    headers['x-client-transaction-id'] = config.clientTransactionId;
  }
  return headers;
}
