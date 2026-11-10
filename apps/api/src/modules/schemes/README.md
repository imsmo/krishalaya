# Government Schemes & DBT (M17) — scheme-application engine

Farmers browse the scheme catalogue, run an explainable eligibility check, and apply; a government officer
verifies and decides; observed DBT credits are recorded. Built to the platform laws. Gated by the
**`schemes`** feature flag (default OFF).

## Money path (Law 2 — wallet boundary only)
The single in-platform money move is the **optional processing fee** on submit: applicant `userMain` →
tenant `main`, `txnType 'service_fee'` (`schemefee:<applicationId>`), zero-sum + idempotent. Schemes with
`processing_fee_minor = 0` (most) move no money. **The DBT benefit itself never flows through our wallet** —
it is credited to the beneficiary's bank by the government PFMS; `dbt_transfers` only RECORDS the confirmed
credit (`pfms_ref`) for the dashboard.

## Explainable eligibility (PRD right-to-explanation)
`Scheme.evaluate(profile)` is a pure, deterministic check of the applicant's attributes against the scheme's
machine-readable `eligibility_rules` (roles / landholding_max_acres / gender / age), returning
`{ eligible, reasons[] }`. Unknown rule keys are ignored (forward-safe). The AI confidence score + a richer
rule DSL are deferred. **C-4 (PC-56 GOV-2a):** there is no AI checker and no confidence on this platform today —
`scheme_applications.eligibility_check` is never written by any code (always NULL); 0011's column comment "AI checker
output + confidence" is false and is corrected in 0240's header and column comment.

## Lifecycle (Law 5 — `domain/scheme-application.state.ts`)
`draft → submitted → under_verification → (clarification_needed ↔ under_verification) → approved → disbursed
→ closed`; `under_verification → rejected → appealed → under_verification`. The application snapshots the
scheme's **rule version** at filing (integrity, PRD R18). Every transition appends a row to the partitioned
`scheme_application_events` audit trail. No version columns on the rows → mutations lock **FOR UPDATE**.

**Who checks and decides (PC-56 GOV-2a, GOV-2 Q2-A):** the government AUTHORITY that runs the scheme —
`POST /v1/gov/applications/:id/act` (modules/gov-console; 0240's `gov_application_act`): verify / clarify by an officer
or head, approve / reject by a head who did not check it, never by the applicant or the assister (CHECKs on the row);
a rejection needs a listed code and a sentence; approval carries no amount. The organisation's own
`verify` / `approve` / `reject` / `close` here are CLOSED (`SCHEME_DECISIONS_ARE_THE_AUTHORITYS`, 403, every caller).
`clarify`, the field visits and the DBT record are unchanged (GOV-3 / GOV-4 own the last two).

## Endpoints
- `GET /v1/schemes/authorities` · `GET /v1/schemes[?categoryId&activeOnly]` · `GET /v1/schemes/:id` — read-only catalogue.
- `POST /v1/schemes/:id/eligibility` — explainable eligibility check (any authenticated user).
- `POST /v1/schemes/applications` (apply, idempotent, `scheme.apply`) · `GET` (?box=mine|queue|all) · `GET /:id`
  · `POST /:id/submit` (idempotent — collects fee) · `POST /:id/{resubmit,appeal}` (applicant)
  · `POST /:id/{verify,clarify,approve,reject,close}` (`scheme.process`) · `POST /:id/dbt` (record) · `GET /:id/dbt`.

## Threats considered
- **No cross-party IDOR**: applications, DBT records and (since PC-56 HOTFIX-15 — survey GOV-1 C-11/F-3; until then this line was false of
  them: `GET /:id/field-visits` had no permission and no party check) field visits 404 for anyone but the applicant or a `scheme.process`
  holder; `box=queue|all` requires `scheme.process`.
- **Schemes/authorities are read-only here**: GLOBAL reference data authored on the admin/platform surface (Law 11).
- **Anti-mass-assignment**: zod `.strict()`; the scheme version + processing fee are server-derived; the
  applicant is `ctx.userId` (never client-supplied).
- **Money safety**: the processing fee is zero-sum + idempotent; no-fee schemes move no money; DBT recording
  moves NO wallet money (observational only). Audit rows on approve/reject/DBT-record.
- **AuthZ throws**: `scheme.apply` (apply/submit/resubmit/appeal), `scheme.process` (verify/clarify/approve/
  reject/close/DBT). Tenant_id + RLS everywhere (integration proves cross-tenant denial); keyset + partition-pruned reads.

## Events (outbox, Law 4)
`schemes.application_submitted/verifying/clarification_needed/approved/rejected/disbursed/closed/appealed`,
`schemes.dbt_recorded`.

## Scope & deferrals
**In scope:** scheme + authority browse, eligibility checker, applications (apply→submit→verify→clarify→approve/reject→disburse→close, +appeal) with audit trail + processing-fee collection, observed DBT-credit recording.
**Deferred (schema in 0011 / admin & platform surface):** authoring schemes + authorities (admin, Law 11),
PFMS sync + rule-refresh + stuck-escalation + window-open-alert jobs, AI eligibility confidence (none exists — C-4), the full
rule DSL, deeper ambassador-assisted attribution.

## Tests
- `__tests__/schemes-domain.spec.ts` — application state machine, eligibility evaluator (pass/fail/forward-safe), application + DBT invariants.
- `__tests__/scheme-application.service.spec.ts` — submit processing-fee zero-sum legs (fee + zero-fee paths) + audit event.
- `__tests__/scheme-authority.service.spec.ts` — eligibility delegation + typed 404.
- `__tests__/tenant-isolation.spec.ts` — SQL contract (tenant_id, FOR UPDATE, event append, keyset queue, partition-pruned DBT, global reference reads).
- `__tests__/schemes.integration.spec.ts` — real Postgres: eligibility → apply → submit [fee] → verify → approve → DBT record → disbursed → RLS.

> No Postgres in the sandbox, so the live RLS / processing-fee / partition assertions run on the first CI run with a service container.
