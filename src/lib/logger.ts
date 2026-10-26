import pino from 'pino';

/** Paths whose values must never reach logs. Wildcards cover one nesting level. */
export const REDACT_PATHS = [
  'authorization',
  'headers.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.authorization',
  '*.password',
  '*.apiKey',
  '*.secret',
  '*.privateKey',
  '*.sessionToken',
  '*.DATABASE_URL',
  '*.RPC_URL',
  'password',
  'apiKey',
  'secret',
  'privateKey',
  'sessionToken',
  'DATABASE_URL',
  'RPC_URL',
];

export function createLogger(
  level: string = process.env.LOG_LEVEL ?? 'info',
  destination?: pino.DestinationStream,
) {
  return pino(
    { level, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' }, base: { service: 'gateway' } },
    destination,
  );
}

export const logger = createLogger();
