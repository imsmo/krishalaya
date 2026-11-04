# Agri-Fintech (M19) — lending spine

Farmers browse partner loan products, apply, get approved (with an anti-predatory cooling-off window), and
receive funds in their wallet; they repay until the loan closes. Built to the platform laws. Gated by the
**`fintech`** feature flag (default OFF).

## The money path (Law 2 — wallet boundary only)
- **disburse** (`approved → disbursed`, lender): opens a servicing loan and credits the borrower — tenant
  `main` → borrower `userMain`, `txnType 'loan_disbursement'` (`loan-disburse:<loanId>`), zero-sum + idempotent.
- **repay** (borrower): borrower `userMain` → tenant `main`, `txnType 'loan_repayment'` (`loan-repay:<repaymentId>`);
  the outstanding is reduced (exact bigint) and the loan **closes** when it reaches zero.

**Lender model:** the FPO/tenant is the on-platform lender of record (wallet-native, proven). Bank/NBFC
**partner-rail** disbursement (real RBI money) is the deferred, RBI/partner-gated path; `financial_partners`
+ `loan_products` are GLOBAL reference data authored on the admin/platform surface (Law 11), read-only here.

## Anti-predatory cooling-off (PRD §59.4)
Approval opens a cooling-off window (`cooling_off_until`, default 24h). Disbursal is **blocked** until it
elapses (`COOLING_OFF_ACTIVE`), and the applicant may **withdraw** any time before disbursal. Approved amount
can never exceed the requested amount; the requested amount must be within the product's `[min,max]`.

## Lifecycle (Law 5 — `domain/*.state.ts`)
- **Application**: `submitted → under_review → approved → disbursed` (+ reject from review; withdraw before disbursal).
- **Loan**: `active ↔ overdue`; `active|overdue → closed` (fully repaid) | `written_off`.
  *Corrected by PC-56 PARTNER-5a (survey C-6 / C-7):* the machine allows `active ↔ overdue`, but **nothing drives it** —
  `Loan.markOverdue()` / `cure()` have no caller and no job exists, so no loan becomes `overdue` except by hand-written SQL.
  `restructured` is written by **no path** today: restructure activation is refused by name (`RESTRUCTURE_ACTIVATION_NOT_LIVE`, 409),
  and a write-off is refused by name too (`WRITE_OFF_NOT_LIVE`, 409); `accepted` is refused from every session
  (`RESTRUCTURE_ACCEPTANCE_NOT_LIVE`, 409), so no restructure progresses past `mediation`. The repay route debits the caller's own
  wallet only (`LOAN_REPAY_OWN_WALLET_ONLY`, 403); the milk-bill deduction is unchanged.
- No version columns → mutations lock **FOR UPDATE**. `loan_repayments` is partitioned by `created_at` (Law 8).

## Endpoints
- `GET /v1/fintech/partners[/:id]` · `GET /v1/fintech/loan-products[/:id]` — read-only reference browse.
- `POST /v1/fintech/loan-applications` (apply, idempotent, `loan.borrow`) · `GET` (?box=mine|review|all) · `GET /:id`
  · `POST /:id/withdraw` (borrower) · `POST /:id/{review,approve,reject}` (`loan.manage`) · `POST /:id/disburse` (idempotent, `loan.manage`).
- `GET /v1/fintech/loans` (?box=mine|all) · `GET /:id` · `GET /:id/repayments` · `POST /:id/repay` (idempotent, `loan.borrow`).

## Threats considered
- **No cross-party IDOR**: applications/loans/repayments 404 for non-owners; `box=review|all` requires `loan.manage`.
- **Anti over-lending**: approved ≤ requested; requested within product `[min,max]`; over-repayment rejected;
  cooling-off blocks premature disbursal (fail-closed).
- **Anti-mass-assignment**: zod `.strict()`; amounts are bigint minor-unit strings; the application's partner
  is derived from the (global) product, never client-supplied.
- **Money safety**: disbursement + repayment are zero-sum + idempotent; no-overdraw means the FPO pool must
  hold the funds and the borrower must hold the repayment; audit rows on approve/reject/disburse/repay.
- **AuthZ throws**: `loan.borrow` (apply/repay/withdraw), `loan.manage` (review/approve/reject/disburse).
  Tenant_id + RLS everywhere (integration proves cross-tenant denial); keyset pagination with max `LIMIT`.

## Events (outbox, Law 4)
`fintech.loan_application_submitted/reviewing/approved/rejected/withdrawn`, `fintech.loan_disbursed`,
`fintech.loan_repaid`, `fintech.loan_closed`.

## Scope & deferrals
**In scope:** partner + loan-product browse, loan applications (apply→review→approve→disburse), loans (servicing), repayments + disbursement/repayment money paths.
**Deferred (schema in 0011 / admin surface, RBI/partner-gated):** credit scoring + consent (bureau),
insurance (products/policies/claims), BNPL input financing, finance groups (SHG/JLG internal book),
NWR-pledge collateral, origination-fee revenue leg, EMI schedule generation, parametric triggers,
bank/NBFC partner-rail disbursement, and all jobs (EMI reminders, default early-warning, partner SLA).
*(PC-56 PARTNER-5a, C-6: "default early-warning" includes the overdue flip itself — with no job, `overdue` has no driver, so every arrears
figure on both planes is zero for that reason as well as for the missing due date.)*

## Tests
- `__tests__/fintech-domain.spec.ts` — application + loan state machines, cooling-off gate, approved≤requested, repayment/outstanding math + close-at-zero.
- `__tests__/loan-application.service.spec.ts` — disburse zero-sum tenant→borrower legs; cooling-off blocks disbursal (no money moved).
- `__tests__/financial-partner.service.spec.ts` — read-only browse + typed 404s.
- `__tests__/tenant-isolation.spec.ts` — SQL contract (tenant_id, FOR UPDATE [OF a + product JOIN], keyset, partition-pruned repayments, global reference reads).
- `__tests__/fintech.integration.spec.ts` — real Postgres: apply → approve → **disburse [wallet]** → **repay → close [wallet]** → over-repay rejected → RLS.

> No Postgres in the sandbox, so the live RLS / disbursement + repayment assertions run on the first CI run with a service container.
