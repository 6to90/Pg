import { Client } from 'pg';
import { join } from 'node:path';
import { loadMigrations, migrateDown, migrateUp } from '@/db/migrate';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const migrationsDir = join(import.meta.dirname, '..', '..', 'src', 'db', 'migrations');

/** Refuse to run destructive test setup against anything not named *_test. */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test'))
    throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test');
}

export async function connect(): Promise<Client> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  assertTestDatabase(TEST_DATABASE_URL);
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  return client;
}

export async function resetSchema(client: Client): Promise<void> {
  const migrations = loadMigrations(migrationsDir);
  await migrateDown(client, migrations, migrations.length);
  await migrateUp(client, migrations);
}

export const ADDR = (n: number): string => `0x${n.toString(16).padStart(40, '0')}`;
export const HASH = (n: number): string => `0x${n.toString(16).padStart(64, '0')}`;

/** Returns the single expected row or fails the test. */
export function one<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('expected a row');
  return row;
}
