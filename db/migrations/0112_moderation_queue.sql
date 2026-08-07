-- ============================================================================
-- MIGRATION 0112 — A MODERATION DECISION THAT ACTUALLY DOES SOMETHING (PC-56 ADMIN-5f)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT: "REMOVED" REMOVED NOTHING
-- ---------------------------------------------------------------------------
-- `POST /v1/ai/moderation/reports/:id/handle` with `action: 'removed'` writes `moderation_reports.action_taken =
-- 'removed'`, emits `ai.moderation_actioned` on the outbox, and returns 200. **NO LISTINGS HANDLER SUBSCRIBES TO THAT
-- EVENT.** `Listing.hide()` exists and its only caller anywhere is a unit test. There is no hide route, no moderate
-- route, and no service method on the listing path.
--
-- So a moderator reviews a fraudulent listing, marks it removed, sees a success state — and the listing stays
-- published and purchasable. The report queue says the marketplace was cleaned and the marketplace was not touched.
-- That is the same shape of lie as ADMIN-5's completed-but-unerased request and ADMIN-5c's notified-but-unfiled
-- breach, and it is the third time the pattern has appeared: **a status column recording an act that no code
-- performs.**
--
-- ---------------------------------------------------------------------------
-- AND W090's ENTIRE QUEUE HAD NO BACKING STATE
-- ---------------------------------------------------------------------------
-- W090 lists "14 held listings" and annotates itself: "'held' is a listing-lifecycle state (listings module) — not a
-- moderation_reports enum". `listing_status` (0005) is
-- draft|pending_approval|published|paused|sold_out|expired|rejected|hidden|archived. **There is no `held`.** No
-- migration adds one, nothing sets one, and there is no `held_at`, `hold_reason` or SLA column anywhere.
--
-- The canon told us exactly where the state belonged and it was never built, so the screen has been a list with no
-- list behind it. Note that `hidden` is NOT a substitute: hidden is a seller's own choice and a permanent-ish state,
-- and W090's whole argument is that a hold is TEMPORARY and reversible — "Hold fast, remove slow — a held listing is
-- reversible, a wrong removal costs a farmer income."
--
-- ---------------------------------------------------------------------------
-- AND A PLATFORM OPERATOR COULD NOT BE RECORDED AS HANDLING A REPORT
-- ---------------------------------------------------------------------------
-- `moderation_reports.handled_by uuid REFERENCES users(id)` — the FARMER/tenant-user table. That column is right for
-- the tenant's own desk, which handles reports through apps/api under `content.moderate`. It cannot hold a platform
-- operator: admin-api authenticates from a self-contained JWT with no database identity.
--
-- ADMIN-2d hit this exactly and its answer is the template. The wrong fixes were enumerated there and they are the
-- same three here: invent a platform account inside every tenant's user table (a cross-tenant identity, which the
-- two-realm split exists to prevent); record the tenant's moderator instead (a forgery); or drop the FK (which would
-- also stop the tenant column meaning what it means). The right fix is a SECOND column and a separate record: both
-- kinds of handler are real, they are different people in different realms, and a decided report now names exactly
-- one of them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE `held` LISTING STATE
-- ---------------------------------------------------------------------------
-- ADD VALUE is additive and idempotent and does not rewrite the table. The value is ONLY ADDED here and never USED in
-- this migration, which is what makes it safe inside the runner's single transaction on PostgreSQL 12+ — Postgres
-- forbids using a new enum value in the transaction that adds it. Exactly the shape and the reasoning of 0046.
ALTER TYPE listing_status ADD VALUE IF NOT EXISTS 'held';

-- CONSEQUENCE, STATED SO IT IS NOT REDISCOVERED: no CHECK and no partial index in this file may mention 'held'. The
-- pairing constraints below are written against the hold COLUMNS instead, which is a weaker guarantee in one respect
-- (a row could carry hold metadata while not being held) and a sufficient one in the direction that matters (a held
-- listing cannot be missing its reason, because the service writes both in one statement and the columns are paired).
-- A `WHERE status = 'held'` index is named as ADMIN-5f follow-up debt rather than smuggled in.

-- ---------------------------------------------------------------------------
-- 2. THE HOLD, AS A RECORD AND NOT JUST A STATUS
-- ---------------------------------------------------------------------------
-- Shaped on `account_freeze_orders` (0033), which is the established precedent for the god-mode plane changing a
-- tenant-owned row: apply the change AND record the order, in one transaction, so "who did this and why" survives
-- independently of the current state.
CREATE TABLE listing_moderation_orders (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  listing_id    uuid NOT NULL REFERENCES listings(id),
  -- `hold` is reversible and fast. `release` undoes it. `remove` is the irreversible one and is why the maker-checker
  -- below exists.
  action        varchar(10) NOT NULL CHECK (action IN ('hold', 'release', 'remove')),
  -- W090's source chips. Free text would let a fourth source be invented to justify a hold.
  source        varchar(24) NOT NULL CHECK (source IN ('fraud_flag', 'reported', 'regulated_category', 'spot_audit')),
  -- The originating report or AI-review row, when there is one. No FK: the reference may be a `moderation_reports`
  -- id, an `ai_review_queue` id or neither (a spot audit), and a polymorphic FK is not available.
  source_ref    uuid,
  -- WHY. Sent to the farmer, so it is the sentence they read about their own produce.
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 20),

  -- The value at stake AT DECISION TIME, in minor units. Denormalised deliberately: `price_minor` and
  -- `quantity_available` both move, and the maker-checker threshold must be judged against the figure the operator
  -- was shown rather than whatever the listing says next week.
  value_at_stake_minor bigint NOT NULL CHECK (value_at_stake_minor >= 0),

  actor_admin_id uuid NOT NULL,      -- bare uuid: a platform operator, not a tenant user (see the header)
  -- The NINTH maker-checker site. W090: "removals of value ≥ ₹1,00,000 are maker-checker."
  checker_admin_id uuid,
  checked_at    timestamptz,
  checker_note  text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_lmo_maker_ne_checker CHECK (
    checker_admin_id IS NULL OR actor_admin_id IS NULL OR checker_admin_id <> actor_admin_id
  ),
  CONSTRAINT ck_lmo_check_pair CHECK ((checker_admin_id IS NULL) = (checked_at IS NULL)),
  -- A hold or a release is one operator's call — W090's argument is that a slow hold is itself harm, and a perishable
  -- crop cannot wait for a second signature to be protected. A REMOVE at or above the threshold cannot be.
  CONSTRAINT ck_lmo_removal_checked CHECK (
    action <> 'remove' OR value_at_stake_minor < 10000000 OR checker_admin_id IS NOT NULL
  )
);
CREATE INDEX idx_lmo_listing ON listing_moderation_orders (listing_id, created_at DESC);
CREATE INDEX idx_lmo_queue ON listing_moderation_orders (action, created_at DESC);

COMMENT ON TABLE listing_moderation_orders IS
  'Append-only record of platform moderation acts on a listing (W090/W091). The order is written in the same transaction as the listing status change, so who held or removed a listing and why survives independently of the current state. Removals at or above ₹1,00,000 of value at stake require a second operator (ck_lmo_removal_checked) — the platform''s NINTH maker-checker site.';
COMMENT ON COLUMN listing_moderation_orders.value_at_stake_minor IS
  'Value at stake in minor units AT DECISION TIME. Denormalised on purpose: price and quantity both move, and the maker-checker threshold must be judged against the figure the operator actually saw.';

-- The hold's own state on the listing, which is what the queue reads and pages a lead on.
ALTER TABLE listings
  ADD COLUMN held_at          timestamptz,
  -- W090: "Hold SLA 4h: the farmer's produce is perishable and priced by the hour — a slow hold is itself harm.
  -- Queue pages the lead at 3h." Stored rather than computed so the queue can ORDER BY it and an index can serve it.
  ADD COLUMN hold_sla_due_at  timestamptz,
  ADD COLUMN hold_order_id    uuid REFERENCES listing_moderation_orders(id);

-- Paired: a held listing carries its deadline and its order. Written against the COLUMNS rather than the status,
-- because the status value cannot be named in this transaction.
ALTER TABLE listings ADD CONSTRAINT ck_listing_hold_pair CHECK (
  (held_at IS NULL) = (hold_sla_due_at IS NULL)
) NOT VALID;
ALTER TABLE listings ADD CONSTRAINT ck_listing_hold_order CHECK (
  held_at IS NULL OR hold_order_id IS NOT NULL
) NOT VALID;

-- The queue: worst-first by deadline, and only rows actually on hold. Indexed on `held_at IS NOT NULL` rather than
-- `status = 'held'` for the enum reason above — and it is the better predicate anyway, because it stays correct if a
-- listing is archived while held.
CREATE INDEX idx_listings_held_queue ON listings (hold_sla_due_at, id)
  WHERE held_at IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. A REPORT A PLATFORM OPERATOR CAN HANDLE
-- ---------------------------------------------------------------------------
ALTER TABLE moderation_reports ADD COLUMN handled_by_admin_id uuid;   -- bare: the other realm has no users row

-- A DECIDED REPORT NAMES EXACTLY ONE HANDLER. Not "at least one" — a row naming both would be two people claiming
-- the same decision, and the queue would have no answer to "who dismissed this".
ALTER TABLE moderation_reports ADD CONSTRAINT ck_modreport_one_handler CHECK (
  status = 'open'
  OR (handled_by IS NULL) <> (handled_by_admin_id IS NULL)
) NOT VALID;
-- NOT VALID: `handle()` has been settable since 0013 and a legacy or fixture row may be actioned with neither. The
-- constraint governs what can be written from now on; a validating scan that aborts the migration over one seeded row
-- helps nobody. Same reasoning as 0108/0109/0110.

-- W092's queue is cross-tenant and ordered by age against a 4-hour SLA. `idx_modreports_open` is
-- `(tenant_id) WHERE status='open'` (0013) and `idx_modreports_keyset` is tenant-first (0029) — both begin with
-- tenant_id, so neither serves a PLATFORM queue that spans tenants. This one does.
CREATE INDEX idx_modreports_platform_queue ON moderation_reports (created_at, id)
  WHERE status = 'open' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. THE DECISION NOTICE — W089's SECOND PRINCIPLE, WITH SOMETHING BEHIND IT
-- ---------------------------------------------------------------------------
-- W089: "Every action explains itself in the farmer's language + appeal path in one tap." W091: "Decision note (sent
-- to farmer in Gujarati + appeal path)". W092: "Reporters hear back on every report — even dismissals get a
-- respectful explanation."
--
-- Those are DELIVERIES, and a moderation console that recorded them as done because a row was written would be the
-- ADMIN-2b pager mistake again. This table is the ADMIN-2d rail: admin-api writes `queued` and nothing has been sent;
-- the executor in apps/api settles it through the notification spine, which is the same rail tenant broadcasts use
-- and is attributed to the platform, because that is who is speaking.
CREATE TABLE moderation_action_notices (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  -- Exactly one origin: a listing order or a report decision.
  order_id        uuid REFERENCES listing_moderation_orders(id),
  report_id       uuid REFERENCES moderation_reports(id),
  -- WHO is being told, and the two are different people owed different things: the person acted against is owed the
  -- reason and the appeal path; the person who reported is owed an outcome.
  recipient_kind  varchar(16) NOT NULL CHECK (recipient_kind IN ('subject_owner', 'reporter')),
  recipient_user_id uuid REFERENCES users(id),

  body            text NOT NULL CHECK (length(btrim(body)) >= 20),
  -- Required and never defaulted, for the reason 0101 gives: a note composed in English and delivered under a
  -- Gujarati template is a message the farmer cannot read wearing a label saying they can.
  language_code   varchar(8) NOT NULL REFERENCES languages(code),
  -- W089: the appeal path is part of the message, not a footer somebody may forget. Recorded so an appeal reviewer
  -- can see what the person was actually told they could do.
  appeal_path     varchar(200) NOT NULL,

  status          varchar(12) NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'delivered', 'refused', 'failed')),
  detail          text,
  notification_event_code varchar(80) REFERENCES notification_events(code),
  queued_at       timestamptz NOT NULL DEFAULT now(),
  settled_at      timestamptz,
  attempts        smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  idempotency_key varchar(120) NOT NULL UNIQUE,

  CONSTRAINT ck_man_one_origin CHECK ((order_id IS NULL) <> (report_id IS NULL)),
  -- Anything that did not reach somebody explains itself. `queued` is exempt: it has not been tried.
  CONSTRAINT ck_man_detail CHECK (status IN ('queued', 'delivered') OR length(btrim(COALESCE(detail, ''))) >= 3),
  CONSTRAINT ck_man_settled CHECK ((status = 'queued') = (settled_at IS NULL)),
  -- `delivered` names who it reached. Without this it could mean "we think so".
  CONSTRAINT ck_man_recipient CHECK (status <> 'delivered' OR recipient_user_id IS NOT NULL)
);
CALL add_std_columns('moderation_action_notices');
CREATE INDEX idx_man_pending ON moderation_action_notices (queued_at) WHERE status IN ('queued', 'failed');
CREATE INDEX idx_man_order ON moderation_action_notices (order_id, created_at DESC);

COMMENT ON TABLE moderation_action_notices IS
  'Decision notices owed to a farmer whose listing was held or removed and to a reporter awaiting an outcome (W089/W091/W092). admin-api writes `queued` and NOTHING has been sent; the apps/api executor settles it through the notification spine. Nothing here says delivered until the spine accepted it — the same law ADMIN-1e applied to scheduled reports and ADMIN-2b to escalation steps.';

-- ---------------------------------------------------------------------------
-- 5. GRANTS — written at creation time
-- ---------------------------------------------------------------------------
REVOKE ALL ON listing_moderation_orders, moderation_action_notices FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON listing_moderation_orders TO kv_admin;
GRANT SELECT, INSERT, UPDATE ON moderation_action_notices TO kv_admin;
-- kv_app READS the orders and SETTLES the notices, and the asymmetry is the whole point. The tenant realm must be
-- able to show a seller why their listing is held — a hold the farmer cannot see the reason for is the trust failure
-- W091's "farmer sees 'under review' honestly — with ETA" exists to prevent — and it must never be able to write an
-- order. The notice executor lives in apps/api, so it needs UPDATE there and only there.
GRANT SELECT ON listing_moderation_orders TO kv_app;
GRANT SELECT, UPDATE ON moderation_action_notices TO kv_app;
GRANT SELECT ON listing_moderation_orders, moderation_action_notices TO kv_readonly;
-- No DELETE for anybody. A moderation decision that can be deleted is a moderation decision an appeal cannot examine.

-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT ADDED
-- ---------------------------------------------------------------------------
--   • NO CHECK OR INDEX MENTIONING `'held'`. Postgres forbids using an enum value in the transaction that adds it
--     (0046 hit the same wall and declined the same index). `ck_listing_hold_pair` is written against the columns and
--     `idx_listings_held_queue` is predicated on `held_at IS NOT NULL`, which is the better predicate anyway — it
--     stays correct if a listing is archived while held. A `status = 'held'` cross-check is ADMIN-5f follow-up debt.
--
--   • NO CHECK ON `moderation_reports.status` / `action_taken` / `subject_type`, still. ADMIN-5d recorded the reason
--     and it has not changed: the app's own DTO accepts SEVEN subject types (`listing, review, message, user,
--     resource, channel, live_session`) against the four the column comment names, so a CHECK written from the
--     comment would reject rows the platform currently produces. Which list is right is a product decision about what
--     may be reported — it is now the only thing left open on this table, and it is named as ADMIN-5f-Q1 rather than
--     guessed at by a migration.
--
--   • NO AUTOMATIC RELEASE ON SLA EXPIRY. W090 says the queue pages the lead at 3h; it does NOT say a hold lapses at
--     4h, and auto-releasing would be the platform quietly un-protecting a marketplace because nobody looked. The
--     breach is surfaced, never acted on. (And the platform still cannot page anybody — 0098's ladder delivers in-app
--     only — so "pages the lead" is an in-app attention item and the console says so.)
--
--   • NO risk_event ON HOLD. W091's remove dialog says a removal "logs a risk_event (fake_listing, weight −40)
--     against the seller", and the service does exactly that on REMOVE. It is deliberately not done on a HOLD: a hold
--     is reversible and frequently wrong by design ("hold fast, remove slow"), and scoring somebody down for being
--     briefly suspected would make the risk ladder a record of how often operators looked at you. ADMIN-5d already
--     recorded that nothing reads a band, so the event is written for the day something does.
