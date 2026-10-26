import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';

/** Arbitrary constant; serializes concurrent migrators. */
const ADVISORY_LOCK_ID = 727_001;
const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.(up|down)\.sql$/;

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
  checksum: string;
}

export interface MigrationStatus {
  version: number;
  name: string;
  applied: boolean;
  appliedAt: Date | null;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export function loadMigrations(dir: string): Migration[] {
  const parts = new Map<number, { name: string; up?: string; down?: string }>();
  for (const file of readdirSync(dir).sort()) {
    const m = FILE_RE.exec(file);
    if (!m) {
      if (file.endsWith('.sql')) throw new MigrationError(`Unrecognized migration file: ${file}`);
      continue;
    }
    const version = Number(m[1]);
    const name = m[2] as string;
    const kind = m[3] as 'up' | 'down';
    const entry = parts.get(version) ?? { name };
    if (entry.name !== name) throw new MigrationError(`Version ${version} has conflicting names`);
    entry[kind] = readFileSync(join(dir, file), 'utf8');
    parts.set(version, entry);
  }
  const versions = [...parts.keys()].sort((a, b) => a - b);
  return versions.map((version, i) => {
    const entry = parts.get(version);
    if (version !== i + 1)
      throw new MigrationError(`Migration versions must be contiguous from 1; got ${version}`);
    if (entry?.up === undefined || entry.down === undefined) {
      throw new MigrationError(`Migration ${version} needs both .up.sql and .down.sql`);
    }
    return {
      version,
      name: entry.name,
      up: entry.up,
      down: entry.down,
      checksum: createHash('sha256').update(entry.up).digest('hex'),
    };
  });
}

async function ensureTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    integer PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

interface AppliedRow {
  version: number;
  name: string;
  checksum: string;
  applied_at: Date;
}

async function applied(client: Client): Promise<AppliedRow[]> {
  const res = await client.query<AppliedRow>(
    'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
  );
  return res.rows;
}

async function withLock<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);
  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
  }
}

async function runInTransaction(
  client: Client,
  sql: string,
  after: () => Promise<void>,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await after();
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

/** Applies all pending migrations; each runs in its own transaction. Returns applied versions. */
export async function migrateUp(
  client: Client,
  migrations: readonly Migration[],
): Promise<number[]> {
  return withLock(client, async () => {
    await ensureTable(client);
    const done = new Map((await applied(client)).map((r) => [r.version, r]));
    for (const row of done.values()) {
      const m = migrations.find((x) => x.version === row.version);
      if (!m)
        throw new MigrationError(`Database has unknown migration ${row.version} (${row.name})`);
      if (m.checksum !== row.checksum) {
        throw new MigrationError(
          `Migration ${row.version} (${row.name}) was modified after being applied`,
        );
      }
    }
    const ran: number[] = [];
    for (const m of migrations) {
      if (done.has(m.version)) continue;
      await runInTransaction(client, m.up, async () => {
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [m.version, m.name, m.checksum],
        );
      });
      ran.push(m.version);
    }
    return ran;
  });
}

/** Rolls back the most recent `steps` migrations. Destructive: callers must confirm. */
export async function migrateDown(
  client: Client,
  migrations: readonly Migration[],
  steps = 1,
): Promise<number[]> {
  return withLock(client, async () => {
    await ensureTable(client);
    const rows = (await applied(client)).sort((a, b) => b.version - a.version).slice(0, steps);
    const rolled: number[] = [];
    for (const row of rows) {
      const m = migrations.find((x) => x.version === row.version);
      if (!m) throw new MigrationError(`No down migration for applied version ${row.version}`);
      await runInTransaction(client, m.down, async () => {
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [row.version]);
      });
      rolled.push(row.version);
    }
    return rolled;
  });
}

export async function migrationStatus(
  client: Client,
  migrations: readonly Migration[],
): Promise<MigrationStatus[]> {
  await ensureTable(client);
  const done = new Map((await applied(client)).map((r) => [r.version, r]));
  return migrations.map((m) => ({
    version: m.version,
    name: m.name,
    applied: done.has(m.version),
    appliedAt: done.get(m.version)?.applied_at ?? null,
  }));
}
