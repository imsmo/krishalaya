-- ============================================================================
-- MIGRATION 0096 — SUPPORT MACROS / CANNED RESPONSES (PC-56 ADMIN-2, canon W053)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- WHY THIS TABLE EARNS ITS PLACE. A support desk answering the same twelve questions in three languages either has
-- macros or it has agents retyping — and retyped answers drift, so two farmers asking the same question get different
-- promises about when their payout will arrive. A macro is how a platform keeps its answers consistent, and consistency
-- about money is a trust property, not a productivity one.
--
-- DESIGN, AND WHY
--   • BODIES ARE PER LANGUAGE, in a child table. The canon's list shows a "Languages" column for a reason: an agent
--     replying to a Gujarati farmer needs the Gujarati text, and a macro that existed only in English would be pasted
--     in English. A jsonb blob of languages would have made "which macros lack Hindi?" an un-indexable question.
--   • USAGE IS RECORDED, NOT COUNTED IN A COLUMN. `support_macro_uses` is one row per insertion, so "used 30d" is a
--     bounded COUNT over a window rather than a lifetime counter that can only ever grow. It also makes the canon's
--     "CSAT after use" answerable: join the use to the ticket's own csat_score. A denormalised counter could not.
--   • PLATFORM-SCOPED (no tenant_id, no RLS). These are OUR support answers, used across every tenant. A per-tenant
--     macro is a different feature; conflating them would put cross-tenant text behind a tenant policy.
--   • `slug` IS THE TYPED SHORTCUT (the canon shows `/payout-verify-wait`). Unique, lower-case, and validated in the
--     service — an agent types it mid-sentence, so it must be predictable.
--   • ARCHIVE, NEVER DELETE. A macro that was used on a ticket must stay readable, or the ticket's history becomes a
--     reply nobody can account for. `is_active` hides it from the picker; the row survives.
-- ============================================================================

CREATE TABLE support_macros (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug          varchar(60) NOT NULL UNIQUE,           -- '/payout-verify-wait' → stored without the slash
  title         varchar(150) NOT NULL,
  category_id   uuid REFERENCES lookup_values(id),     -- lookup 'ticket_category', so macros filter like tickets do
  is_active     boolean NOT NULL DEFAULT true,
  notes         text
);
CALL add_std_columns('support_macros');
-- the picker's read: active macros, alphabetical by shortcut (which is how an agent remembers them)
CREATE INDEX idx_support_macros_active ON support_macros (slug) WHERE is_active AND deleted_at IS NULL;
CREATE INDEX idx_support_macros_category ON support_macros (category_id) WHERE deleted_at IS NULL;

CREATE TABLE support_macro_bodies (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  macro_id      uuid NOT NULL REFERENCES support_macros(id) ON DELETE CASCADE,
  language_code varchar(8) NOT NULL,                   -- matches the platform's language registry (en/hi/gu live)
  body          text NOT NULL CHECK (length(btrim(body)) >= 5),
  UNIQUE (macro_id, language_code)
);
CALL add_std_columns('support_macro_bodies');

CREATE TABLE support_macro_uses (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  macro_id      uuid NOT NULL REFERENCES support_macros(id),
  ticket_id     uuid NOT NULL REFERENCES support_tickets(id),
  language_code varchar(8) NOT NULL,
  used_by       uuid NOT NULL REFERENCES users(id),
  used_at       timestamptz NOT NULL DEFAULT now()
);
CALL add_std_columns('support_macro_uses');
-- the 30-day count and the CSAT-after-use join
CREATE INDEX idx_macro_uses_macro ON support_macro_uses (macro_id, used_at DESC);
CREATE INDEX idx_macro_uses_ticket ON support_macro_uses (ticket_id);

-- ---------- grants (the 0014/0018 default-privileges trap) --------------------------------------
-- Macros are platform content, so no RLS — but the defaults would let a tenant-facing role WRITE the platform's own
-- support answers. Revoke, then grant: the tenant API reads them (agents work in that realm and record a use),
-- admin-api authors them.
REVOKE ALL ON support_macros, support_macro_bodies, support_macro_uses FROM kv_app, kv_relay;
GRANT SELECT ON support_macros, support_macro_bodies TO kv_app;
-- recording a use is a write the agent tool makes, so kv_app may INSERT there and nowhere else
GRANT SELECT, INSERT ON support_macro_uses TO kv_app;
GRANT SELECT, INSERT, UPDATE ON support_macros, support_macro_bodies, support_macro_uses TO kv_admin;
GRANT SELECT ON support_macros, support_macro_bodies, support_macro_uses TO kv_readonly;
