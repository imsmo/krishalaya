# Contributing to Krishalaya

## Golden rule
`apps/api/src/modules/listings` is the reference implementation. Every new module/feature
must match its structure, patterns, and test bar. When in doubt, make it look like listings.
Obey `CLAUDE.md` (the 10 Laws). See `MODULE_STATUS.md` for what's built.

## Workflow
1. One module/feature per branch: `feat/<module>` or `core/<area>`.
2. Open a PR using the template; CI (`.github/workflows/api-ci.yml`) must be green.
3. The PR must satisfy the Definition of Done (see `Krishalaya_Build_and_Command_Playbook.md` §4).

## Local setup
```bash
pnpm install
cp .env.example .env
docker compose -f apps/api/docker-compose.dev.yml up -d
cd apps/api && pnpm typecheck && pnpm test:unit && pnpm build
```

## Definition of Done (merge gate)
- Tenant isolation: `tenant_id` in every query + RLS; tested in CI.
- Money is `bigint` minor units, isolated in wallet-service (Law 2).
- Writes: one ACID tx (UnitOfWork) + outbox-in-tx + idempotency + quota + enforced authz.
- Reads: replica/read-model (CQRS), never the write primary.
- Typed errors with stable codes. Zod validation. URI-versioned endpoints.
- Tests: unit + tenant-isolation + integration (real Postgres, RLS) — all green.
- `pnpm typecheck`, `pnpm test`, `pnpm build` pass. No inline `require()`. No float money.
