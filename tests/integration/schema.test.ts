import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations, migrateDown, migrateUp, migrationStatus } from '@/db/migrate';
import { ADDR, connect, HASH, migrationsDir, one, resetSchema, TEST_DATABASE_URL } from './helpers';

const d = describe.skipIf(!TEST_DATABASE_URL);

d('migrations', () => {
  let client: Client;
  beforeAll(async () => {
    client = await connect();
  });
  afterAll(async () => {
    await client.end();
  });

  it('up is idempotent, down reverses everything, up works again', async () => {
    const migrations = loadMigrations(migrationsDir);
    await migrateDown(client, migrations, migrations.length);
    expect(await migrateUp(client, migrations)).toEqual(migrations.map((m) => m.version));
    expect(await migrateUp(client, migrations)).toEqual([]);
    const tables = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'",
    );
    for (const t of [
      'merchants',
      'api_keys',
      'orders',
      'payment_transactions',
      'chain_events',
      'webhook_endpoints',
      'webhook_deliveries',
      'idempotency_keys',
      'audit_logs',
      'indexer_checkpoints',
      'operators',
      'operator_sessions',
    ]) {
      expect(tables.rows.map((r) => r.tablename)).toContain(t);
    }
    expect(await migrateDown(client, migrations, migrations.length)).toHaveLength(
      migrations.length,
    );
    const left = await client.query(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'",
    );
    expect(left.rows[0]).toEqual({ n: 0 });
    await migrateUp(client, migrations);
    expect((await migrationStatus(client, migrations)).every((s) => s.applied)).toBe(true);
  });

  it('detects a migration modified after being applied', async () => {
    const migrations = loadMigrations(migrationsDir);
    await migrateUp(client, migrations);
    const tampered = migrations.map((m, i) => (i === 0 ? { ...m, checksum: 'deadbeef' } : m));
    await expect(migrateUp(client, tampered)).rejects.toThrow(/modified/);
  });

  it('rolls back a failing migration atomically', async () => {
    const migrations = loadMigrations(migrationsDir);
    await resetSchema(client);
    const broken = [
      ...migrations,
      {
        version: migrations.length + 1,
        name: 'broken',
        checksum: 'x',
        down: 'SELECT 1',
        up: 'CREATE TABLE t_half (id int); SELECT 1/0;',
      },
    ];
    await expect(migrateUp(client, broken)).rejects.toThrow();
    const res = await client.query("SELECT to_regclass('t_half') AS t");
    expect(res.rows[0]).toEqual({ t: null });
    expect(
      (await client.query('SELECT max(version)::int AS v FROM schema_migrations')).rows[0],
    ).toEqual({ v: migrations.length });
  });
});

d('schema constraints', () => {
  let client: Client;
  let merchantId: string;
  beforeAll(async () => {
    client = await connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await resetSchema(client);
    merchantId = one(
      (
        await client.query<{ id: string }>(
          'INSERT INTO merchants (name, recipient_address) VALUES ($1, $2) RETURNING id',
          ['m1', ADDR(0xaa)],
        )
      ).rows,
    ).id;
    await client.query(
      'INSERT INTO tokens (chain_id, address, symbol, decimals) VALUES (31337, $1, $2, 6)',
      [ADDR(0x70), 'T6USD'],
    );
  });

  async function insertOrder(
    over: Partial<{
      merchantOrderId: string;
      invoice: string;
      amount: string;
      chain: number;
      token: string;
      status: string;
    }> = {},
  ) {
    return client.query<{ id: string }>(
      `INSERT INTO orders (merchant_id, merchant_order_id, invoice_id, chain_id, gateway_address, token_address,
         token_decimals, currency, recipient_address, amount_atomic, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,6,'T6USD',$7,$8,$9, now() + interval '1 hour') RETURNING id`,
      [
        merchantId,
        over.merchantOrderId ?? 'o-1',
        over.invoice ?? HASH(1),
        over.chain ?? 31337,
        ADDR(0x90),
        over.token ?? ADDR(0x70),
        ADDR(0xaa),
        over.amount ?? '1000000',
        over.status ?? 'pending',
      ],
    );
  }

  it('stores uint256-max amounts exactly (no float rounding)', async () => {
    const max = ((1n << 256n) - 1n).toString();
    await insertOrder({ amount: max });
    const row = await client.query<{ a: string }>('SELECT amount_atomic::text AS a FROM orders');
    expect(row.rows[0]?.a).toBe(max);
  });

  it('rejects zero, negative, fractional-truncated and overflow amounts', async () => {
    await expect(insertOrder({ amount: '0' })).rejects.toThrow(/check/);
    await expect(insertOrder({ amount: '-5' })).rejects.toThrow(/check/);
    await expect(insertOrder({ amount: (1n << 256n).toString() })).rejects.toThrow(/check/);
  });

  it('enforces invoice_id global uniqueness and per-merchant merchant_order_id uniqueness', async () => {
    await insertOrder();
    await expect(insertOrder({ merchantOrderId: 'o-2' })).rejects.toThrow(/orders_invoice_id_key/);
    await expect(insertOrder({ invoice: HASH(2) })).rejects.toThrow(
      /orders_merchant_id_merchant_order_id_key/,
    );
    const other = one(
      (
        await client.query<{ id: string }>(
          'INSERT INTO merchants (name, recipient_address) VALUES ($1,$2) RETURNING id',
          ['m2', ADDR(0xbb)],
        )
      ).rows,
    ).id;
    await expect(
      client.query(
        `INSERT INTO orders (merchant_id, merchant_order_id, invoice_id, chain_id, gateway_address, token_address,
           token_decimals, currency, recipient_address, amount_atomic, expires_at)
         VALUES ($1,'o-1',$2,31337,$3,$4,6,'T6USD',$5,1, now())`,
        [other, HASH(3), ADDR(0x90), ADDR(0x70), ADDR(0xbb)],
      ),
    ).resolves.toBeDefined();
  });

  it('rejects mainnet chain ids, unknown tokens, malformed hex and unknown statuses', async () => {
    await expect(insertOrder({ chain: 1, invoice: HASH(5) })).rejects.toThrow(/check/);
    await expect(insertOrder({ chain: 8453, invoice: HASH(6) })).rejects.toThrow(/check/);
    await expect(insertOrder({ token: ADDR(0x71), invoice: HASH(7) })).rejects.toThrow(
      /foreign key/,
    );
    await expect(insertOrder({ invoice: '0xABC', merchantOrderId: 'x' })).rejects.toThrow(/check/);
    await expect(insertOrder({ invoice: HASH(8), status: 'paid' })).rejects.toThrow(/check/);
    await expect(
      client.query(
        'INSERT INTO tokens (chain_id, address, symbol, decimals) VALUES (1, $1, $2, 6)',
        [ADDR(0x72), 'USDT'],
      ),
    ).rejects.toThrow(/check/);
  });

  it('prevents duplicate chain logs and more than one live transaction per order', async () => {
    const orderId = one((await insertOrder()).rows).id;
    const insertTx = (tx: number, idx: number, status = 'observed') =>
      client.query(
        `INSERT INTO payment_transactions (order_id, chain_id, tx_hash, log_index, block_number, block_hash,
           payer_address, token_address, recipient_address, amount_atomic, status)
         VALUES ($1,31337,$2,$3,10,$4,$5,$6,$7,1000000,$8)`,
        [orderId, HASH(tx), idx, HASH(99), ADDR(0xcc), ADDR(0x70), ADDR(0xaa), status],
      );
    await insertTx(10, 0);
    await expect(insertTx(10, 0, 'orphaned')).rejects.toThrow(
      /payment_transactions_chain_id_tx_hash_log_index_key/,
    );
    await expect(insertTx(11, 0)).rejects.toThrow(/one_live_per_order/);
    await expect(insertTx(12, 0, 'orphaned')).resolves.toBeDefined();
  });

  it('prevents duplicate chain_events rows', async () => {
    const ins = () =>
      client.query(
        `INSERT INTO chain_events (chain_id, contract_address, tx_hash, log_index, block_number, block_hash, event_name)
         VALUES (31337,$1,$2,0,1,$3,'PaymentReceived')`,
        [ADDR(0x90), HASH(1), HASH(2)],
      );
    await ins();
    await expect(ins()).rejects.toThrow(/chain_events_chain_id_tx_hash_log_index_key/);
  });

  it('makes audit_logs append-only', async () => {
    await client.query("INSERT INTO audit_logs (actor_type, action) VALUES ('system', 'test')");
    await expect(client.query("UPDATE audit_logs SET action = 'x'")).rejects.toThrow(/append-only/);
    await expect(client.query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
    await expect(client.query('TRUNCATE audit_logs')).rejects.toThrow(/append-only/);
  });

  it('enforces idempotency key uniqueness per merchant and bumps updated_at', async () => {
    const ins = () =>
      client.query(
        "INSERT INTO idempotency_keys (merchant_id, key, request_hash, expires_at) VALUES ($1,'k','h', now() + interval '1 day')",
        [merchantId],
      );
    await ins();
    await expect(ins()).rejects.toThrow(/idempotency_keys_merchant_id_key_key/);
    const before = one(
      (await client.query<{ u: Date }>('SELECT updated_at AS u FROM merchants')).rows,
    ).u;
    await client.query('SELECT pg_sleep(0.01)');
    await client.query("UPDATE merchants SET name = 'renamed'");
    const after = one(
      (await client.query<{ u: Date }>('SELECT updated_at AS u FROM merchants')).rows,
    ).u;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});
