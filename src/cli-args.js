import { parseArgs } from 'node:util';

const USAGE = `Usage:
  cli.js fetch --username <name> [--count 5] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--out data/<name>.jsonl] [--user-id <id>]
  cli.js find-streak --username <name> --since YYYY-MM-DD --until YYYY-MM-DD [--user-id <id>] [--out data/<name>.jsonl]

--user-id switches from the (incomplete) search-based fetch to the account's
full timeline, which actually backfills. Get it from DevTools > Network on the
target profile: any UserOriginalsTimeline/UserTweets request's variables.userId.`;

export function parseCliArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) throw new Error(USAGE);

  if (command === 'fetch') {
    const { values } = parseArgs({
      args: rest,
      options: {
        username: { type: 'string' },
        count: { type: 'string', default: '5' },
        since: { type: 'string' },
        until: { type: 'string' },
        out: { type: 'string' },
        'user-id': { type: 'string' },
      },
    });
    if (!values.username) throw new Error('--username is required\n\n' + USAGE);
    return {
      command: 'fetch',
      options: {
        username: values.username,
        count: Number(values.count),
        since: values.since,
        until: values.until,
        out: values.out || `data/${values.username}.jsonl`,
        ...(values['user-id'] && { userId: values['user-id'] }),
      },
    };
  }

  if (command === 'find-streak') {
    const { values } = parseArgs({
      args: rest,
      options: {
        username: { type: 'string' },
        since: { type: 'string' },
        until: { type: 'string' },
        'user-id': { type: 'string' },
        out: { type: 'string' },
      },
    });
    if (!values.username) throw new Error('--username is required\n\n' + USAGE);
    if (!values.since || !values.until) {
      throw new Error('--since and --until are required\n\n' + USAGE);
    }
    return {
      command: 'find-streak',
      options: {
        username: values.username,
        since: values.since,
        until: values.until,
        out: values.out || `data/${values.username}.jsonl`,
        ...(values['user-id'] && { userId: values['user-id'] }),
      },
    };
  }

  throw new Error(`Unknown command "${command}"\n\n${USAGE}`);
}
