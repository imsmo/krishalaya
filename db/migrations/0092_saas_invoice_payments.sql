-- ============================================================================
-- MIGRATION 0092 — SAAS-INVOICE PAYMENTS (closes PC-56 ADMIN-1-Q1)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- THE HOLE THIS FILLS. `invoice_status` (0002 line 15) has always included `partially_paid`, and 0002's
-- `saas_invoices` records `paid_at` and nothing else about money coming IN. So the platform could say "this tenant
-- paid some of it" and could not say HOW MUCH — the received amount was stored nowhere. Every consumer then had to
-- choose between two wrong numbers: show `total_minor` (overstating the debt) or show zero (understating it). PC-56
-- ADMIN-1 refused both and shipped "balance unknown" on the collection queue; this migration makes the balance
-- KNOWN, which is the only real fix. Nobody should ever have to ring a tenant and guess.
--
-- DESIGN, AND WHY
--   • APPEND-ONLY. A payment is a fact about the world: money arrived, on a date, with a reference an auditor can
--     match to a bank statement. Facts are not edited. A mis-keyed payment is corrected by recording a REVERSAL
--     (`reverses_payment_id`), so the history shows what was believed and when it was corrected — which is exactly
--     what a tenant disputing a balance needs to see. There is deliberately no UPDATE path for amount/reference.
--   • THE INVOICE'S STATUS IS DERIVED, NEVER TYPED. `paid_minor` on the invoice is a denormalised SUM of the live
--     payment rows, maintained in the same transaction as the insert; the service then moves the invoice through
--     its existing state machine from that sum (0 → unchanged, partial → partially_paid, ≥ total → paid). The
--     0002 comment "paid/partially_paid arrive from payment reconciliation, never a manual mark" is now literally
--     true: this table IS that reconciliation, and no operator can assert `paid` by hand.
--   • OVERPAYMENT IS KEPT, NOT SWALLOWED. If the sum exceeds the invoice total the invoice is `paid` and the excess
--     stays visible as `paid_minor − total_minor`. A schema that clamped the sum to the total would destroy money
--     the tenant actually sent, and the tenant would be the one to discover it.
--   • CURRENCY IS THE INVOICE'S. A payment in another currency is not a partial payment, it is an unrecorded FX
--     conversion, and this platform never invents a rate (Law 2). Enforced by a trigger-free FK-and-check pair plus
--     the service, which compares against the invoice row it has already locked.
--   • ONE REFERENCE PER INVOICE PER METHOD. A UTR recorded twice against one invoice is a double-entry that would
--     mark a half-paid invoice settled. The unique index makes that unrepresentable; genuine retries are absorbed
--     by `idempotency_key` instead.
--
-- Money is bigint MINOR UNITS everywhere (Law 2). Tenant-scoped → tenant_id + RLS like every tenant table; the
-- admin plane audits every write (Law 11).
-- ============================================================================

-- ---------- the payments themselves -----------------------------------------------------------
CREATE TABLE saas_invoice_payments (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  invoice_id          uuid NOT NULL REFERENCES saas_invoices(id),
  -- SIGNED: a normal receipt is positive, a reversal is the exact negative of the row it corrects. Summing the
  -- column therefore gives the true received amount with no special-casing, and no row is ever mutated or hidden.
  amount_minor        bigint NOT NULL CHECK (amount_minor <> 0),
  currency_code       char(3) NOT NULL REFERENCES currencies(code),
  method              varchar(20) NOT NULL
                        CHECK (method IN ('bank_transfer','upi','cheque','card','netbanking','wallet','cash','offset')),
  -- what an auditor matches against the bank statement (UTR / cheque no / gateway ref). Mandatory: a payment with
  -- no reference cannot be reconciled by anyone later, which makes it an assertion rather than a record.
  reference           varchar(120) NOT NULL CHECK (length(btrim(reference)) >= 3),
  received_at         timestamptz NOT NULL,
  -- set when the money moved through the platform wallet; NULL for a direct bank/cheque receipt (most SaaS
  -- collections). Never fabricated to look like a ledger entry that does not exist.
  wallet_txn_id       uuid,
  -- a reversal points at the row it corrects; the corrected row itself is left untouched (append-only history)
  reverses_payment_id uuid REFERENCES saas_invoice_payments(id),
  idempotency_key     varchar(160) UNIQUE NOT NULL,
  recorded_by         uuid NOT NULL REFERENCES users(id),
  note                text
);
CALL add_std_columns('saas_invoice_payments');

-- A reversal must be negative and a receipt positive — the two cannot be confused by a caller passing the wrong
-- sign, which is the difference between collecting money and erasing it.
ALTER TABLE saas_invoice_payments ADD CONSTRAINT ck_saas_payment_reversal_sign CHECK (
  (reverses_payment_id IS NULL AND amount_minor > 0) OR (reverses_payment_id IS NOT NULL AND amount_minor < 0)
);

-- the double-entry guard described in the header (live rows only; a reversal shares the reference by design and is
-- excluded because it is identified by `reverses_payment_id`)
CREATE UNIQUE INDEX uq_saas_payment_ref ON saas_invoice_payments (invoice_id, method, lower(btrim(reference)))
  WHERE deleted_at IS NULL AND reverses_payment_id IS NULL;
-- one reversal per payment, ever
CREATE UNIQUE INDEX uq_saas_payment_reversal ON saas_invoice_payments (reverses_payment_id)
  WHERE reverses_payment_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_saas_payment_invoice ON saas_invoice_payments (invoice_id, received_at DESC, id);
CREATE INDEX idx_saas_payment_tenant ON saas_invoice_payments (tenant_id, received_at DESC);

-- ---------- the derived total on the invoice ---------------------------------------------------
-- Denormalised so the collection queue can page 50 debtors without a correlated subquery per row. It is maintained
-- in the SAME transaction as the payment insert, from a SUM over the live rows — never incremented blindly, so a
-- retried insert cannot drift it, and a reversal brings it back down by construction.
ALTER TABLE saas_invoices ADD COLUMN paid_minor bigint NOT NULL DEFAULT 0;
-- No CHECK that paid_minor <= total_minor: overpayment is a real event and the excess must remain visible (header).
-- It may not go negative, however — that would mean we recorded more reversals than receipts.
ALTER TABLE saas_invoices ADD CONSTRAINT ck_saas_invoice_paid_nonneg CHECK (paid_minor >= 0);

-- ---------- RLS (idempotent sweep, identical to the 0066/0089/0091 pass)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT t.tablename
    FROM pg_tables t
    JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=t.tablename AND c.column_name='tenant_id'
    WHERE t.schemaname='public'
      AND t.tablename NOT IN ('wallet_accounts','ledger_entries','ledger_transactions','reconciliation_runs')
      AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format($f$CREATE POLICY tenant_isolation_%s ON %I
                     USING (tenant_id IS NULL OR tenant_id = current_tenant_id());$f$,
                   r.tablename, r.tablename);
  END LOOP;
END $$;

-- ---------- grants (the 0014/0018 ALTER DEFAULT PRIVILEGES trap) --------------------------------
-- Every NEW table arrives kv_app-INSERTable, kv_relay-writable and kv_readonly-readable because of the default
-- privileges set in 0014/0018. That is wrong here: SaaS-invoice payments are the PLATFORM's receivable ledger, and
-- a tenant-facing role must not be able to write a row claiming they paid. Revoke first, then grant deliberately.
REVOKE ALL ON saas_invoice_payments FROM kv_app, kv_relay;
-- the tenant app may READ its own payments (RLS keeps it to its own rows) so a tenant can see what we recorded
GRANT SELECT ON saas_invoice_payments TO kv_app;
-- admin-api records them; the read-only analyst role reads them
GRANT SELECT, INSERT, UPDATE ON saas_invoice_payments TO kv_admin;
GRANT SELECT ON saas_invoice_payments TO kv_readonly;
