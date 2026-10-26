# Crypto Payment Gateway (testnet MVP)

> **TESTNET ONLY.** Test tokens have no monetary value. This repository contains no mainnet
> support and no way to enable it. Nothing here has been legally reviewed (see
> `planning/05-legal-review-checklist.md`); do not use it with real funds or customers.

The product name is configurable (`PRODUCT_NAME`). Design documents are in `planning/`.

## Current implementation status (Phase 1 of 8)

| Area                                                                                         | Status                                  |
| -------------------------------------------------------------------------------------------- | --------------------------------------- |
| Project scaffold: Next.js 16 (App Router), TypeScript strict, ESLint, Prettier, Vitest       | Done                                    |
| Environment validation (Zod); non-testnet chain ids and non-local/testnet `APP_ENV` rejected | Done                                    |
| PostgreSQL pool, SQL migrations with rollback, full core schema                              | Done                                    |
| `GET /api/v1/health` (liveness), `GET /api/v1/ready` (DB + schema version)                   | Done                                    |
| Log redaction, fixed-shape error responses                                                   | Done                                    |
| Solidity contracts (Foundry)                                                                 | **Not started** (Phase 2)               |
| Order API, API keys, idempotency, state machine                                              | **Not started** (Phase 3)               |
| Blockchain indexer, reorg handling                                                           | **Not started** (Phase 4)               |
| Webhooks, outbox dispatcher, SSRF guard                                                      | **Not started** (Phase 5; tables exist) |
| Dashboard, operator login (Argon2id, sessions)                                               | **Not started** (Phase 6; tables exist) |
| E2E tests, security review, OpenAPI                                                          | **Not started** (Phase 7)               |
| Anything verified on a real testnet                                                          | **Nothing yet** (Phase 8)               |

The schema also contains tables for later phases; they have constraints but no application code.

## Requirements

- Node.js >= 22, npm
- PostgreSQL 16 (local)

## Setup

```bash
npm install
cp .env.example .env        # then edit; .env is git-ignored and must never be committed
```

Create a local database and a non-superuser role (example; choose your own password):

```bash
sudo -u postgres psql -c "CREATE ROLE gw_app LOGIN PASSWORD 'change-me'"
sudo -u postgres psql -c "CREATE DATABASE gw_dev OWNER gw_app"
sudo -u postgres psql -c "CREATE DATABASE gw_test OWNER gw_app"
```

(Role names starting with `pg_` are reserved by PostgreSQL.)

### Environment variables

| Variable               | Required     | Notes                                                                                                           |
| ---------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`              | yes          | `local` or `testnet`. Anything else (e.g. `production`) aborts startup.                                         |
| `DATABASE_URL`         | yes          | `postgres://...`                                                                                                |
| `CHAIN_ID`             | yes          | `31337` (local Anvil) or `84532` (Base Sepolia). Anything else is rejected. `APP_ENV=testnet` requires `84532`. |
| `RPC_URL`              | no (Phase 4) | `http(s)`; `APP_ENV=testnet` requires `https`.                                                                  |
| `CONFIRMATIONS`        | no           | Default `12`, range 1-1000. A block count is a policy knob, not a finality guarantee.                           |
| `PRODUCT_NAME`         | no           | Display name.                                                                                                   |
| `LOG_LEVEL`            | no           | Default `info`.                                                                                                 |
| `TEST_DATABASE_URL`    | tests        | Integration tests only. The database name **must end in `_test`**; tests drop and recreate the schema there.    |
| `MIGRATE_DATABASE_URL` | no           | Overrides `DATABASE_URL` for the migration CLI (e.g. a separate migrator role).                                 |

Invalid configuration fails fast with messages that never include the offending values.

## Database migrations

Files live in `src/db/migrations/NNNN_name.up.sql` / `.down.sql` (contiguous, both required).
Each runs in its own transaction; applied migrations are checksummed, and editing one after it
was applied is an error. A session-level advisory lock serializes concurrent runs.

```bash
npm run db:migrate                          # apply pending migrations
npm run db:status
npm run db:rollback -- --confirm            # roll back the latest migration (drops data!)
npm run db:rollback -- --confirm --steps=2
```

Rollback refuses to run without `--confirm`. Down migrations are destructive; take a
`pg_dump -Fc` first on any database you care about. Production-style setups should use a
separate migrator role (DDL) and a least-privilege application role.

When you add a migration, bump `EXPECTED_SCHEMA_VERSION` in `src/db/schema-version.ts`
(a unit test enforces that it matches the newest file); `/api/v1/ready` fails if the DB is behind.

## Run

```bash
npm run dev                  # http://localhost:3000
curl -i localhost:3000/api/v1/health
curl -i localhost:3000/api/v1/ready
```

## Checks

```bash
npm run typecheck
npm run lint
npm run format
npm test                     # unit + integration (integration is skipped without TEST_DATABASE_URL)
```

Integration tests need a running PostgreSQL and `TEST_DATABASE_URL`. If it is unset those
tests are **skipped**, not passed; check the summary line.

## Security notes (current)

- Amounts: integers in token base units, `NUMERIC(78,0)` in SQL (guarded `< 2^256`, computed with
  `numeric` arithmetic, not floating point), `bigint` in code, strings in the API. `parseFloat` is lint-banned.
- Chain ids are restricted to testnets in code **and** in DB `CHECK` constraints.
- `audit_logs` is append-only (triggers block UPDATE/DELETE/TRUNCATE).
- Order `invoice_id` is a server-generated 32-byte random value (unique, unguessable); chain,
  gateway, token, recipient and amount are snapshotted on the order and never updated.
- Secrets: only `.env.example` is committed. `.env*`, keys and keystores are git-ignored.
- Logs redact authorization headers, cookies, passwords, API keys, private keys, `DATABASE_URL`, `RPC_URL`.

## Known risks and incomplete items

- Foundry could not be installed in the current cloud environment (network policy returned 403 for
  `foundry.paradigm.xyz` and `github.com` release downloads). Phase 2 needs those hosts allowed,
  or an alternative toolchain.
- Nothing in this repo has been run against a real network. Base Sepolia behavior (finality tags,
  public RPC rate limits) is unverified.
- `invoiceId` front-running by someone who has seen it can still consume an invoice with a wrong
  amount (funds go to the merchant; the order becomes `underpaid`). To be covered by Phase 3-4 tests.
- No authentication or authorization code exists yet; do not expose this server beyond localhost.
- Dependency note: `eslint-config-next` was not installed because it does not yet declare support
  for ESLint 10; linting uses `typescript-eslint` only (no Next-specific rules).
- No legal review has been done.
