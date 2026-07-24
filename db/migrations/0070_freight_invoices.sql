-- ============================================================================
-- MIGRATION 0070 — FREIGHT INVOICES (DELTA-034, DEV-05)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (verbatim, DESIGN_DRIVEN_SCHEMA_BACKLOG.md): "`freight_invoices` table (carrier billing headers +
-- line-to-shipment matching)". Canon detail (read directly, W241-tenant-freight-invoices.html):
--   • Backend-pending banner: "freight_invoices table (carrier billing headers + line-to-shipment matching) —
--     today 3PL invoices reconcile against shipments.charge_minor manually."
--   • List columns: Received date | Invoice no (+ period + shipment count) | Carrier | Billed | Expected
--     (Σ charge_minor) | Recon status badge | action. Three concrete rows: a carrier invoice with a variance
--     ("+₹2,320 over — 4 lines disputed"), an exact-match carrier invoice, and an OWN-FLEET cost note ("internal
--     cost note · fuel + wages... booked to ops", explicitly "not billed" — a cost centre, not a carrier bill).
--   • Warning banner: "Carrier invoices pay from the tenant wallet through the normal rails (maker-checker above
--     ₹25,000) — freight is money like all money"; "payment holds until recon closes — disputed lines never block
--     the clean ones" → recon must be tracked at the LINE level (line-to-shipment matching, per the filed shape's
--     own words), not just a header rollup, so disputed lines can be isolated from clean ones without blocking
--     payment on the whole invoice. This is why the table pair below is header + lines, not a single flat table.
--   • W242 (freight recon detail, not itself a DELTA row but the drill-down this header links to) shows recon
--     evidence against `shipment_events`, "foots to the rupee," "fast-pay-clean-is-policy" — confirms the line
--     table needs its own dispute lifecycle independent of the header's overall status.
--
-- FK-TARGET VERIFICATION: carrier = `logistics_partners` (0007_logistics.sql, NOT partitioned — a real FK is
-- safe and used below). `shipments` (0007) IS partitioned with a composite `(id, created_at)` PK — the migration's
-- own comment on `delivery_routes.route_id` documents that "cross-partition FKs to it are avoided platform-wide —
-- app-validated"; `freight_invoice_lines.shipment_id` below follows that exact same precedent (plain uuid, no FK).
--
-- MONEY (Law 2): every amount column is `bigint` minor units + explicit `currency_code`. `variance_minor` on both
-- tables is a Postgres `GENERATED ALWAYS AS (...) STORED` column (billed − expected) — always consistent with its
-- inputs by construction, never a value the app could drift out of sync by forgetting to recompute.
--
-- RLS DECISION: TENANT-SCOPED, RLS ON via the idempotent pass below — both tables carry `tenant_id NOT NULL`
-- (a freight invoice belongs to exactly one tenant's logistics operation), matching the `trade_invoices`/
-- `settlement_statements` precedent (0006_money.sql) for invoice-header-shaped tenant tables.
--
-- PARTITION CONSIDERATION: NOT partitioned. Freight invoices land in monthly carrier billing cycles ("3 of 3
-- invoices (Jun cycle)" — the canon's own footer count) — bounded, low-frequency-per-tenant volume, the same
-- shape as `trade_invoices`/`settlement_statements` (0006, both non-partitioned), not a per-transaction event
-- stream. `freight_invoice_lines` is bounded by shipment count per invoice (tens to low hundreds, per the canon's
-- own "86 shipments" example) — still invoice-cycle-bounded, not partitioned.
--
-- APPEND-ONLY: NOT LEDGER-class. Both tables carry mutable lifecycle status (`recon_status`, `dispute_status`,
-- resolution fields) by design — same as `insurance_claims`/`trade_invoices`, which are also mutable
-- status-bearing records, not ledgers. Standard `kv_app` SELECT/INSERT/UPDATE grants apply (no REVOKE needed).
-- ============================================================================

CREATE TABLE freight_invoices (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  carrier_id        uuid NOT NULL REFERENCES logistics_partners(id),   -- 3PL, or the tenant's own-fleet logistics_partners row (partner_kind='tenant_fleet')
  invoice_no        varchar(60) NOT NULL,        -- 'DLV-INV-0726-41' / tenant-generated ref for own-fleet cost notes
  source_kind       varchar(20) NOT NULL DEFAULT 'carrier_invoice'
                    CHECK (source_kind IN ('carrier_invoice','own_fleet_cost_note')),
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  shipment_count    integer NOT NULL DEFAULT 0,
  billed_minor      bigint NOT NULL,
  expected_minor    bigint NOT NULL DEFAULT 0,    -- cached Σ charge_minor rollup from freight_invoice_lines at last recon pass
  variance_minor    bigint GENERATED ALWAYS AS (billed_minor - expected_minor) STORED,
  currency_code     char(3) NOT NULL DEFAULT 'INR',
  recon_status      varchar(20) NOT NULL DEFAULT 'pending'
                    CHECK (recon_status IN ('pending','exact_match','variance_open','disputed_lines','reconciled','booked_ops')),
  invoice_media_id  uuid REFERENCES media_assets(id),   -- uploaded carrier invoice document
  received_at       timestamptz NOT NULL DEFAULT now(),
  reconciled_at     timestamptz,
  payment_hold      boolean NOT NULL DEFAULT true,      -- "payment holds until recon closes"
  payout_id         uuid REFERENCES payouts(id),        -- released via the normal payout rails once recon closes (no new money primitive)
  CHECK (period_end >= period_start)
);
CALL add_std_columns('freight_invoices');
CREATE UNIQUE INDEX uq_freight_invoices_no ON freight_invoices(tenant_id, invoice_no) WHERE deleted_at IS NULL;
CREATE INDEX idx_freight_invoices_status ON freight_invoices(tenant_id, recon_status, received_at DESC);
CREATE INDEX idx_freight_invoices_carrier ON freight_invoices(carrier_id, received_at DESC);

CREATE TABLE freight_invoice_lines (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  invoice_id      uuid NOT NULL REFERENCES freight_invoices(id),
  shipment_id     uuid,           -- app-validated against shipments.id — no FK (shipments is partitioned with a
                                  -- composite PK; cross-partition FKs to it are avoided platform-wide, see 0007's
                                  -- own comment on delivery_routes.route_id)
  billed_minor    bigint NOT NULL,
  expected_minor  bigint NOT NULL,   -- shipments.charge_minor snapshot at match time
  variance_minor  bigint GENERATED ALWAYS AS (billed_minor - expected_minor) STORED,
  dispute_status  varchar(12) NOT NULL DEFAULT 'none' CHECK (dispute_status IN ('none','disputed','resolved')),
  dispute_reason  text,
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES users(id)
);
CALL add_std_columns('freight_invoice_lines');
CREATE INDEX idx_freight_invoice_lines_invoice ON freight_invoice_lines(tenant_id, invoice_id);
CREATE INDEX idx_freight_invoice_lines_shipment ON freight_invoice_lines(tenant_id, shipment_id);
CREATE INDEX idx_freight_invoice_lines_disputed ON freight_invoice_lines(tenant_id, invoice_id) WHERE dispute_status = 'disputed';

-- RLS — re-run the idempotent tenant-isolation pass for the two new tenant tables.
DO $$
DECLARE r record;
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
