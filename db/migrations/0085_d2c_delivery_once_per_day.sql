-- ============================================================================
-- MIGRATION 0085 — ONE D2C DELIVERY PER SUBSCRIPTION PER DAY (PC-55 A5)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- WHY THIS EXISTS (found while building A5's scheduler): 0009 created d2c_deliveries PARTITION BY RANGE (due_on)
-- with PRIMARY KEY (id, due_on) and an index on (subscription_id, due_on DESC) — but NO UNIQUENESS on
-- (subscription_id, due_on). A cadence job that materialises "tomorrow's drops" every few minutes across N pods
-- MUST be idempotent, and the only trustworthy place for that guarantee is the database: without this index a
-- re-run (or two pods racing a tick) could create two 'scheduled' rows for the same household on the same
-- morning — and a monthly postpaid statement counts DELIVERED drops, so a duplicate is a DOUBLE CHARGE to a
-- family buying milk. That is precisely the class of bug Rule Zero forbids shipping.
--
-- The unique index includes due_on because Postgres requires a partitioned table's unique index to contain the
-- partition key; that is also exactly the natural business key ("one drop per subscription per day"), so the
-- constraint and the domain rule are the same statement. It is what makes the scheduler's
-- `INSERT … ON CONFLICT (subscription_id, due_on) DO NOTHING` safe.
-- ============================================================================

CREATE UNIQUE INDEX uq_d2c_deliveries_sub_day ON d2c_deliveries (subscription_id, due_on);
