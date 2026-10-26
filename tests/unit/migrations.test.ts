import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMigrations, MigrationError } from '@/db/migrate';
import { EXPECTED_SCHEMA_VERSION } from '@/db/schema-version';

const realDir = join(import.meta.dirname, '..', '..', 'src', 'db', 'migrations');

function tmpDirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

describe('migration files', () => {
  it('every migration has up and down and versions are contiguous', () => {
    const migrations = loadMigrations(realDir);
    expect(migrations.length).toBeGreaterThan(0);
    migrations.forEach((m, i) => {
      expect(m.version).toBe(i + 1);
      expect(m.down.trim().length).toBeGreaterThan(0);
    });
  });

  it('EXPECTED_SCHEMA_VERSION matches the newest migration', () => {
    const migrations = loadMigrations(realDir);
    expect(migrations.at(-1)?.version).toBe(EXPECTED_SCHEMA_VERSION);
  });

  it('rejects a migration without a down file', () => {
    const dir = tmpDirWith({ '0001_a.up.sql': 'SELECT 1;' });
    expect(() => loadMigrations(dir)).toThrow(MigrationError);
  });

  it('rejects gaps and unrecognized sql files', () => {
    const gap = tmpDirWith({ '0002_a.up.sql': 'SELECT 1;', '0002_a.down.sql': 'SELECT 1;' });
    expect(() => loadMigrations(gap)).toThrow(/contiguous/);
    const bad = tmpDirWith({ 'oops.sql': 'SELECT 1;' });
    expect(() => loadMigrations(bad)).toThrow(/Unrecognized/);
  });
});
