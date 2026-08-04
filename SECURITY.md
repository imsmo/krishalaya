# Security Policy

## Reporting a vulnerability
Email **security@krishalaya.example** (PGP key on request). Do not open public issues for
vulnerabilities. We acknowledge within 72 hours. See `security/bug-bounty-policy.md`.

## Scope & controls
- Multi-tenant isolation enforced by Postgres RLS (`FORCE ROW LEVEL SECURITY`) + app-level
  tenant filters, verified by a CI merge gate.
- Money handled only by `apps/wallet-service` (append-only, hash-chained ledger).
- PII tokenised in external vaults; only last-4 + vault refs stored (`security/data-classification.md`).
- Admin surface: FIDO2 + IP allowlist + JIT elevation (`security/admin-access-policy.md`).
- Secrets via AWS Secrets Manager; never in code or env files committed to git.

Supporting docs live in `security/` (threat-model, incident-response-plan, key-management,
dpdp-dpia-template, pentest-scope, access-review-quarterly).
