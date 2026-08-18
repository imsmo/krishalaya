# Production DB bootstrap runbook (P0-5)

Bring a fresh production database fully up — migrated, partitioned, role-logged-in, seeded with **reference data
only** (never demo), and RLS-verified — with one fail-closed, idempotent command. Run after `terraform apply`
(P0-1) created the Aurora cluster and the app roles exist NOLOGIN from the migrations.

> Money/PII safety: the app connects as the least-privilege `kv_app` role (RLS-bound, non-superuser). Migrations +
> seeds run as the Aurora **master/owner**. Demo data is impossible in production (the seed runner skips it under
> `NODE_ENV=production`, even if `--demo` is passed).

---

## One command

```bash
cd <repo-root>
PROJECT=krishalaya-prod REGION=ap-south-1 \
WRITER_HOST=$(terraform -chdir=infra/terraform/envs/prod output -raw aurora_writer_endpoint) \
MASTER_SECRET_ARN=$(terraform -chdir=infra/terraform/envs/prod output -raw aurora_master_secret_arn) \
  ./db/prod/apply.sh
```

Prereqs: `aws` CLI v2 (auth'd), `node`, `psql`, repo deps installed (`pnpm install`), and the app-role password
secrets created (P0-2 / SECRETS-RUNBOOK §1a: `krishalaya-prod/db/{kv_app,kv_wallet,kv_relay}_password`).

## What it does (each step is idempotent; stops on first failure)

| # | Step | Command (under the hood) | Proves |
|---|------|--------------------------|--------|
> **PC-56 TENANT-4d-5 — READ THIS BEFORE TRUSTING STEP ORDER.** Migrate (step 1) runs before Seed (step 4),
> and migrations 0057 onwards insert rows whose parents are seeded — so on a truly empty database the chain
> halted at 0057 and **migrations 0057-0149 had never been applied anywhere.** The minimal reference data those
> migrations depend on is now guaranteed by `db/migrations/0056a_reference_data_the_chain_depends_on.sql`, which
> runs inside step 1; the seeds remain the owners of the full catalogues. If you add a migration that inserts a
> row whose parent lives in `db/seeds/`, add the parent to 0056a — `tenant4d5-chain-repair.spec.ts` will fail if
> you do not. The counts in this table are the state at 0150 and drift as migrations are added.

| 1 | **Migrate** | `node db/scripts/migrate.js` (owner conn) | all 151 migrations applied; re-run = no-op (checksum-guarded) |
| 2 | **Partitions** | `node db/scripts/ensure-partitions.js` | partition runway so partitioned inserts don't fail |
| 3 | **Role logins** | `db/prod/create-roles.sh` | kv_app/kv_wallet/kv_relay get LOGIN with **strong** SM passwords (refuses weak/dev) |
| 4 | **Seed reference** | `NODE_ENV=production node db/scripts/seed.js` | core/rules/catalogue lookups loaded; **demo skipped** |
| 5 | **RLS gate** | `node db/scripts/verify-rls-coverage.js` | zero tenant tables without a FORCED RLS policy (exit 1 otherwise) |
| 6 | **kv_app probe** | `psql` as kv_app | app role connects, is **not** superuser and **not** BYPASSRLS |

A failure at any step aborts with a non-zero exit and a `FATAL:` line — nothing half-applies silently.

## After it succeeds
- Build each service's `DATABASE_URL` from the SM role passwords (SECRETS-RUNBOOK §1b) and deploy (DEPLOY-RUNBOOK).
- The DB is ready for real traffic. **Do not** run `seed.js --demo` against prod (it's blocked anyway).

## CI gate (already in place)
`.github/workflows/db-migrate.yml` applies every migration to a throwaway Postgres on any `db/**` change, proves
idempotency (re-run = no-op), and loads the core/rules/catalogue seeds — catching a broken migration before it can
reach staging/production. This runbook is the controlled application of that same, CI-proven schema to prod.

## Rollback / recovery
- A bad migration: migrations are forward-only; restore from Aurora PITR (APPLY-RUNBOOK §6) to just before the run,
  fix the migration, re-run. Never edit an applied migration in place.
- `verify-rls-coverage` failing means a new tenant table shipped without RLS — fix the migration (add
  `ENABLE ROW LEVEL SECURITY` + `FORCE` + policy), never open prod with the gap.

## Done when
`apply.sh` exits 0: prod is migrated + partitioned + seeded (reference only) + RLS-covered, and the final probe
confirms `kv_app` connects as a least-privilege, RLS-bound role (not owner/superuser).
