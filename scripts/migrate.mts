import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { loadMigrations, migrateDown, migrateUp, migrationStatus } from '../src/db/migrate.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const [command, ...flags] = process.argv.slice(2);
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL (or MIGRATE_DATABASE_URL) is required');
  process.exit(1);
}

const migrations = loadMigrations(join(import.meta.dirname, '..', 'src', 'db', 'migrations'));
const client = new Client({ connectionString: url });

try {
  await client.connect();
  if (command === 'up') {
    const ran = await migrateUp(client, migrations);
    console.log(ran.length ? `Applied migrations: ${ran.join(', ')}` : 'Database is up to date');
  } else if (command === 'down') {
    // Rollback drops tables and their data, so it must be requested explicitly.
    if (!flags.includes('--confirm')) {
      console.error('Refusing to roll back without --confirm (this drops tables and data).');
      process.exit(2);
    }
    const stepsFlag = flags.find((f) => f.startsWith('--steps='));
    const steps = stepsFlag ? Number(stepsFlag.slice('--steps='.length)) : 1;
    if (!Number.isInteger(steps) || steps < 1)
      throw new Error('--steps must be a positive integer');
    const rolled = await migrateDown(client, migrations, steps);
    console.log(rolled.length ? `Rolled back: ${rolled.join(', ')}` : 'Nothing to roll back');
  } else if (command === 'status') {
    for (const s of await migrationStatus(client, migrations)) {
      console.log(
        `${String(s.version).padStart(4, '0')} ${s.name} ${s.applied ? `applied ${s.appliedAt?.toISOString() ?? ''}` : 'PENDING'}`,
      );
    }
  } else {
    console.error('Usage: migrate.ts <up|down [--confirm] [--steps=N]|status>');
    process.exit(1);
  }
} catch (err) {
  // Print the message only: connection errors can embed host details, never the password.
  console.error(`Migration failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
