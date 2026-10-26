import { afterAll, describe, expect, it, vi } from 'vitest';
import { createPool } from '@/db/pool';
import { checkReadiness } from '@/lib/readiness';
import { loadMigrations, migrateDown } from '@/db/migrate';
import { connect, migrationsDir, resetSchema, TEST_DATABASE_URL } from './helpers';

const d = describe.skipIf(!TEST_DATABASE_URL);

d('readiness', () => {
  const pool = createPool(TEST_DATABASE_URL ?? '');
  afterAll(async () => {
    await pool.end();
  });

  it('is ready when migrated, not ready when schema is missing', async () => {
    const client = await connect();
    try {
      await resetSchema(client);
      expect(await checkReadiness(pool)).toEqual({
        ready: true,
        checks: { database: 'ok', migrations: 'ok' },
      });
      await migrateDown(client, loadMigrations(migrationsDir), 1);
      expect((await checkReadiness(pool)).checks).toEqual({ database: 'ok', migrations: 'fail' });
    } finally {
      await resetSchema(client);
      await client.end();
    }
  });

  it('reports database failure without leaking connection details', async () => {
    const bad = createPool('postgres://nobody:leakedpw@127.0.0.1:1/none');
    const result = await checkReadiness(bad);
    await bad.end();
    expect(result).toEqual({ ready: false, checks: { database: 'fail', migrations: 'fail' } });
    expect(JSON.stringify(result)).not.toContain('leakedpw');
  });
});

describe('health routes', () => {
  it('GET /health returns ok and the testnet marker', async () => {
    vi.stubEnv('APP_ENV', 'local');
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/x');
    vi.stubEnv('CHAIN_ID', '31337');
    const { resetEnvCache } = await import('@/config/env');
    resetEnvCache();
    const { GET } = await import('@/app/api/v1/health/route');
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', network: 'testnet', chainId: 31337 });
    expect(res.headers.get('cache-control')).toBe('no-store');
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it('GET /ready returns a generic 503 body when configuration is invalid', async () => {
    vi.stubEnv('APP_ENV', 'local');
    vi.stubEnv('DATABASE_URL', 'mysql://secret-host-name/x');
    vi.stubEnv('CHAIN_ID', '31337');
    const { resetEnvCache } = await import('@/config/env');
    resetEnvCache();
    const { GET } = await import('@/app/api/v1/ready/route');
    const res = await GET();
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(text).not.toContain('secret-host-name');
    expect(JSON.parse(text)).toMatchObject({ error: { code: 'not_ready' } });
    vi.unstubAllEnvs();
    resetEnvCache();
  });
});
