import { Pool, type PoolClient } from 'pg';
import { getEnv } from '@/config/env';

const globalForPool = globalThis as unknown as { __gatewayPool?: Pool };

export function getPool(): Pool {
  globalForPool.__gatewayPool ??= createPool(getEnv().DATABASE_URL);
  return globalForPool.__gatewayPool;
}

export function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
  });
  // An idle-client error must not crash the process or leak connection details.
  pool.on('error', () => undefined);
  return pool;
}

/** Runs `fn` in a transaction; rolls back on any error. */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
