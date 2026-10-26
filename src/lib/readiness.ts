import type { Pool } from 'pg';
import { EXPECTED_SCHEMA_VERSION } from '@/db/schema-version';

export type CheckResult = 'ok' | 'fail';
export interface Readiness {
  ready: boolean;
  checks: { database: CheckResult; migrations: CheckResult };
}

/** Checks DB connectivity and that the schema is at least the version this build expects. */
export async function checkReadiness(pool: Pool): Promise<Readiness> {
  const checks: Readiness['checks'] = { database: 'fail', migrations: 'fail' };
  try {
    await pool.query('SELECT 1');
    checks.database = 'ok';
    const res = await pool.query<{ v: number | null }>(
      'SELECT max(version) AS v FROM schema_migrations',
    );
    if ((res.rows[0]?.v ?? 0) >= EXPECTED_SCHEMA_VERSION) checks.migrations = 'ok';
  } catch {
    // Details are intentionally dropped: callers only learn which check failed.
  }
  return { ready: checks.database === 'ok' && checks.migrations === 'ok', checks };
}
