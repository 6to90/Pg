import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@/lib/logger';

describe('logger redaction', () => {
  it('redacts credentials and connection strings', () => {
    let out = '';
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const log = createLogger('info', sink);
    log.info(
      {
        req: { headers: { authorization: 'Bearer pk_test_SECRETKEY', cookie: 'sid=SESSIONVALUE' } },
        config: { DATABASE_URL: 'postgres://u:DBPASS@h/db', RPC_URL: 'https://rpc/KEY123' },
        user: { password: 'hunter2', apiKey: 'APIKEYVALUE', privateKey: '0xPRIVATE' },
      },
      'test',
    );
    for (const secret of [
      'SECRETKEY',
      'SESSIONVALUE',
      'DBPASS',
      'KEY123',
      'hunter2',
      'APIKEYVALUE',
      '0xPRIVATE',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[REDACTED]');
  });
});
