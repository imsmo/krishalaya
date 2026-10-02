-- ==================================================================================================================
-- MIGRATION 0189 — PC-56 TENANT-11d · REQUIREMENTS — A BUYER'S NEED FILLED BY SEVERAL MEMBERS, EACH WITH THEIR OWN YES
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0005, 0014, 0044, 0128, 0175, 0186–0188 are applied; nothing
-- here edits them.)
-- ==================================================================================================================
--
-- FOUNDER DECISION (brief_t11d.md, 2026-10-02): LINKED RESPONSES, ONE ORDER PER MEMBER, PER-MEMBER CONSENT BEFORE SEND.
--
-- What the survey proved at d0f4afe (survey_t11.md §1a, §1b): one response per seller and the responder had to own the
-- listing, so the canon's core act — "17 + 23 = 40 qtl, two members fill it exactly … sends as two linked responses" — was
-- unrepresentable (F-11); accepting ONE response fulfilled the whole requirement and the order handler made ONE order per
-- requirement, in the LISTING's unit, from a JS float (F-11, F-27d); a shortlist set `partially_matched` (a response status
-- leaking into the requirement); tenant_admin could not post a requirement at all and nobody could post for a named buyer
-- (F-8); support staff could accept a quote for a buyer — which creates the buyer's order — with no consent (F-10, F-20);
-- the expiry and reminder jobs had no caller and would have claimed `requirement_responses` as kv_relay, which has no grant
-- (F-1, F-9); create / close / submit / shortlist / reject wrote no audit (F-24); the cursors were milliseconds (F-25); the
-- seller-side list filtered after LIMIT (F-27c); the "Responses" column read a count the API never sent (F-14).
--
-- WHAT THIS FILE DOES
--   189.1  `requirements` — the number `REQ-<mmdd>-<nn>` (trigger, per tenant per India day, as 0187's JOB numbers); the
--          fulfilled QUANTITY (the lifecycle runs on it now, not on a shortlist); who posted it when the buyer desk posted it
--          for a named buyer, and that buyer's recorded consent; the close record (who, when, why).
--   189.2  `requirement_consents` — every on-behalf yes, append-only: the buyer's yes to a post or to an accept / shortlist /
--          reject the desk performs for them; each member's yes to the exact quantity and price of THEIR line before a pooled
--          quote is sent (canon W132: "their produce, their yes").
--   189.3  `requirement_response_groups` — the desk's pooled quote: draft → consent_pending → submitted → accepted | rejected
--          | withdrawn, the total quantity, the blended price (computed, floor) and the 48 h validity once sent.
--   189.4  `requirement_group_lines` — the draft lines (one per member per group): the member's listing, quantity, price and
--          the consent recorded against exactly those figures. Drafts are server rows (canon W132 "Your draft response is
--          kept" is true because of this table, and only because of it).
--   189.5  `requirement_responses` — `group_id` (the linked responses a group sent), `consent_id` (the member's yes), the
--          accepted quantity (a buyer may accept part of a quote), who accepted and with whose consent, and `order_id` (the
--          one order created for THIS response — the orders handler's idempotency anchor; orders is partitioned, no FK).
--   189.6  PERMISSIONS (also seed 0004) — `requirement.desk` (tenant_admin, fpo_coordinator): post AS a named buyer with the
--          buyer's consent, run the member-stock response groups, act for the buyer only with the buyer's consent for that act.
--   189.7  NOTIFICATION CATALOGUE — `requirement.group_quoted` (the buyer is told a pooled quote arrived; templates in seed
--          core/0007).
--   189.8  Indexes (the µs keyset lists, the need-by sort, the status counts).
--
-- WHAT THIS FILE DOES NOT DO (named)
--   • `requirement_responses.ai_match_score` (0005) stays UNWRITTEN. The member-stock match is a rule (same product, else
--     same category; same unit; available ≥ 1; price ascending, then distance when both pincodes carry coordinates). No AI
--     score exists and none is faked; the console prints "AI score not yet available".
--   • No "demand map" table. No cross-tenant response: `requirement_responses.tenant_id` is NOT NULL under tenant RLS, so a
--     "federation-open" requirement visible to another tenant's members is impossible by construction — the console says so.
--   • No money moves in this module. Each accepted response becomes its own order (orders' QuoteAcceptedHandler), and that
--     order settles its own farmer directly, exactly as every order does today.
--
-- RLS DECISION: three new tables, all tenant tables (tenant_id NOT NULL): ENABLE + FORCE + the 0175 split (SELECT / INSERT
-- WITH CHECK / UPDATE USING + WITH CHECK bound to the tenant, an admin-realm policy TO kv_admin). No grant to kv_relay
-- anywhere; REVOKE ALL from kv_relay on each new table. The expiry and reminder jobs read only `tenants` as kv_relay (granted
-- since 0014) and claim per tenant inside kv_app's unit of work.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 189.1  requirements — NUMBER, FULFILLED QUANTITY, POSTED-BY-THE-DESK, CLOSE RECORD
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS req_no             varchar(24);
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS fulfilled_quantity numeric(14,3) NOT NULL DEFAULT 0;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS posted_by          uuid REFERENCES users(id);
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS post_consent_id    uuid;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS closed_at          timestamptz;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS closed_by          uuid REFERENCES users(id);
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS close_reason       text;

ALTER TABLE requirements DROP CONSTRAINT IF EXISTS ck_req_fulfilled_qty;
ALTER TABLE requirements ADD CONSTRAINT ck_req_fulfilled_qty CHECK (fulfilled_quantity >= 0);
-- The desk never posts for a buyer without the buyer's recorded yes: posted_by and the consent travel together.
ALTER TABLE requirements DROP CONSTRAINT IF EXISTS ck_req_posted_by_consent;
ALTER TABLE requirements ADD CONSTRAINT ck_req_posted_by_consent CHECK ((posted_by IS NULL) = (post_consent_id IS NULL));
ALTER TABLE requirements DROP CONSTRAINT IF EXISTS ck_req_posted_by_not_buyer;
ALTER TABLE requirements ADD CONSTRAINT ck_req_posted_by_not_buyer CHECK (posted_by IS NULL OR posted_by <> buyer_user_id);
ALTER TABLE requirements DROP CONSTRAINT IF EXISTS ck_req_close_whole;
ALTER TABLE requirements ADD CONSTRAINT ck_req_close_whole CHECK (
  (closed_at IS NULL AND closed_by IS NULL AND close_reason IS NULL) OR (closed_at IS NOT NULL AND closed_by IS NOT NULL));
ALTER TABLE requirements DROP CONSTRAINT IF EXISTS ck_req_close_reason_len;
ALTER TABLE requirements ADD CONSTRAINT ck_req_close_reason_len CHECK (close_reason IS NULL OR length(close_reason) BETWEEN 3 AND 300);

COMMENT ON COLUMN requirements.fulfilled_quantity IS
  'PC-56 TENANT-11d (0189, F-11): the quantity buyers have ACCEPTED against this requirement, in its own unit. The lifecycle runs on it: 0 < fulfilled < quantity → partially_matched; fulfilled ≥ quantity → fulfilled. A shortlist no longer moves the requirement (it is a response status only).';
COMMENT ON COLUMN requirements.posted_by IS
  'PC-56 TENANT-11d (0189, F-8 / A3): the requirement.desk user who posted this requirement FOR the named buyer (buyer_user_id), with the buyer''s recorded consent (post_consent_id → requirement_consents act=post). NULL = the buyer posted it themself.';
COMMENT ON COLUMN requirements.close_reason IS
  'PC-56 TENANT-11d (0189, F-10 / F-24): why it was closed, verbatim. A moderator close must give one (3–300 chars); a buyer''s own close may.';

-- THE REQUIREMENT NUMBER. `REQ-<mmdd>-<nn>` (canon W131 "REQ-0711-08"): the India calendar day the requirement was posted and
-- its sequence that day within the tenant (two digits, three past 99). The canon's format carries no year, so — as 0187's
-- JOB numbers — the count is per tenant per mmdd ACROSS years: next year's 11 July continues from this year's last number and
-- a number never repeats. Assigned BY TRIGGER at INSERT (only when the writer did not supply one), serialised per (tenant,
-- mmdd) by a transaction-scoped advisory lock; the unique index is the second wall.
CREATE OR REPLACE FUNCTION assign_requirement_no() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d      date := ((COALESCE(NEW.created_at, now())) AT TIME ZONE 'Asia/Kolkata')::date;
  prefix text := 'REQ-' || to_char(d, 'MMDD') || '-';
  n      integer;
BEGIN
  IF NEW.req_no IS NOT NULL AND NEW.req_no <> '' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('requirement_no:' || NEW.tenant_id::text || ':' || prefix));
  SELECT COALESCE(max(substring(req_no FROM length(prefix) + 1)::integer), 0) + 1 INTO n
    FROM requirements
   WHERE tenant_id = NEW.tenant_id AND req_no LIKE prefix || '%' AND substring(req_no FROM length(prefix) + 1) ~ '^[0-9]+$';
  NEW.req_no := prefix || lpad(n::text, 2, '0');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_req_assign_no ON requirements;
CREATE TRIGGER trg_req_assign_no BEFORE INSERT ON requirements FOR EACH ROW EXECUTE FUNCTION assign_requirement_no();

-- Rows written before 0189 are numbered in posting order, per tenant per India day.
WITH numbered AS (
  SELECT id, 'REQ-' || to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'MMDD') || '-' ||
         lpad(row_number() OVER (PARTITION BY tenant_id, to_char((created_at AT TIME ZONE 'Asia/Kolkata')::date, 'MMDD') ORDER BY created_at, id)::text, 2, '0') AS no
    FROM requirements WHERE req_no IS NULL
)
UPDATE requirements r SET req_no = numbered.no FROM numbered WHERE numbered.id = r.id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_req_tenant_no ON requirements (tenant_id, req_no);

-- Rows accepted before 0189 counted as a whole fulfilment: their accepted quote's quantity is the fulfilled quantity.
UPDATE requirements r
   SET fulfilled_quantity = COALESCE((SELECT sum(x.quantity) FROM requirement_responses x
                                       WHERE x.requirement_id = r.id AND x.tenant_id = r.tenant_id AND x.status = 'accepted'), 0)
 WHERE r.fulfilled_quantity = 0 AND EXISTS (SELECT 1 FROM requirement_responses x WHERE x.requirement_id = r.id AND x.status = 'accepted');

-- ------------------------------------------------------------------------------------------------------------------
-- 189.2  requirement_consents — EVERY ON-BEHALF YES, APPEND-ONLY
-- ------------------------------------------------------------------------------------------------------------------
-- act:     post      — the buyer's yes to the desk posting this requirement in their name;
--          quote     — a member's yes to THEIR line of a pooled quote: this listing, this quantity, this price per unit;
--          shortlist / accept / reject — the buyer's yes to the desk performing that decision for them.
-- channel: otp / voice / written are recorded by the desk (voice and written carry their evidence media; an OTP is the
--          verification itself); `app` is the member or buyer saying yes themself in their own app — only ever recorded
--          by that person (recorded_by = member_user_id).
CREATE TABLE IF NOT EXISTS requirement_consents (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  requirement_id   uuid NOT NULL REFERENCES requirements(id),
  act              varchar(10) NOT NULL CHECK (act IN ('post', 'quote', 'shortlist', 'accept', 'reject')),
  member_user_id   uuid NOT NULL REFERENCES users(id),
  group_id         uuid,
  line_id          uuid,
  response_id      uuid REFERENCES requirement_responses(id),
  listing_id       uuid REFERENCES listings(id),
  quantity         numeric(14,3),
  price_minor      bigint,
  channel          varchar(10) NOT NULL CHECK (channel IN ('otp', 'voice', 'written', 'app')),
  media_id         uuid,
  note             text CHECK (note IS NULL OR length(note) <= 500),
  recorded_by      uuid NOT NULL REFERENCES users(id),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rqc_evidence CHECK (channel IN ('otp', 'app') OR media_id IS NOT NULL),
  CONSTRAINT ck_rqc_app_is_self CHECK (channel <> 'app' OR recorded_by = member_user_id),
  -- a member's yes to a line names the exact figures it was given to
  CONSTRAINT ck_rqc_quote_whole CHECK (act <> 'quote' OR (group_id IS NOT NULL AND line_id IS NOT NULL AND listing_id IS NOT NULL
                                                           AND quantity IS NOT NULL AND quantity > 0 AND price_minor IS NOT NULL AND price_minor > 0)),
  -- a decision the desk performs for the buyer names the response (or the group) it decides
  CONSTRAINT ck_rqc_decision_target CHECK (act NOT IN ('shortlist', 'accept', 'reject') OR response_id IS NOT NULL OR group_id IS NOT NULL)
);
COMMENT ON TABLE requirement_consents IS
  'PC-56 TENANT-11d (0189, F-20): the recorded yes behind every act performed on someone''s behalf on a requirement — the buyer''s for a desk post or a desk decision (shortlist / accept / reject), each member''s for their line of a pooled quote (listing, quantity, price exactly). voice / written carry evidence media; otp is the verification itself; app is the person themself in their own app. Append-only by trigger.';

CREATE OR REPLACE FUNCTION requirement_consents_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'requirement_consents is append-only — a recorded consent is never edited or removed (PC-56 TENANT-11d, 0189)'
    USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_rqc_append_only ON requirement_consents;
CREATE TRIGGER trg_rqc_append_only BEFORE UPDATE OR DELETE ON requirement_consents FOR EACH ROW EXECUTE FUNCTION requirement_consents_append_only();
DROP TRIGGER IF EXISTS trg_rqc_no_truncate ON requirement_consents;
CREATE TRIGGER trg_rqc_no_truncate BEFORE TRUNCATE ON requirement_consents FOR EACH STATEMENT EXECUTE FUNCTION requirement_consents_append_only();

ALTER TABLE requirement_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirement_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rqc_read ON requirement_consents;
DROP POLICY IF EXISTS rqc_insert_own ON requirement_consents;
DROP POLICY IF EXISTS rqc_admin_realm ON requirement_consents;
CREATE POLICY rqc_read        ON requirement_consents FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY rqc_insert_own  ON requirement_consents FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY rqc_admin_realm ON requirement_consents FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON requirement_consents FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON requirement_consents TO kv_app;
GRANT SELECT ON requirement_consents TO kv_readonly;

ALTER TABLE requirements DROP CONSTRAINT IF EXISTS fk_req_post_consent;
ALTER TABLE requirements ADD CONSTRAINT fk_req_post_consent FOREIGN KEY (post_consent_id) REFERENCES requirement_consents(id) DEFERRABLE INITIALLY DEFERRED;

-- ------------------------------------------------------------------------------------------------------------------
-- 189.3  requirement_response_groups — THE DESK'S POOLED QUOTE
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS requirement_response_groups (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id),
  requirement_id           uuid NOT NULL REFERENCES requirements(id),
  created_by               uuid NOT NULL REFERENCES users(id),
  status                   varchar(16) NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'consent_pending', 'submitted', 'accepted', 'rejected', 'withdrawn')),
  line_count               integer NOT NULL DEFAULT 0 CHECK (line_count >= 0),
  total_quantity           numeric(14,3) NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
  total_value_minor        bigint NOT NULL DEFAULT 0 CHECK (total_value_minor >= 0),
  blended_price_minor      bigint CHECK (blended_price_minor IS NULL OR blended_price_minor > 0),
  blended_remainder_minor  bigint NOT NULL DEFAULT 0 CHECK (blended_remainder_minor >= 0),
  valid_until              timestamptz,
  sent_at                  timestamptz,
  sent_by                  uuid REFERENCES users(id),
  decided_at               timestamptz,
  decided_by               uuid REFERENCES users(id),
  decision_consent_id      uuid REFERENCES requirement_consents(id),
  withdraw_reason          text CHECK (withdraw_reason IS NULL OR length(withdraw_reason) BETWEEN 3 AND 300),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rrg_sent_whole CHECK ((sent_at IS NULL) = (sent_by IS NULL) AND (sent_at IS NULL) = (valid_until IS NULL)),
  CONSTRAINT ck_rrg_sent_status CHECK (status IN ('draft', 'consent_pending', 'withdrawn') OR sent_at IS NOT NULL),
  CONSTRAINT ck_rrg_blend CHECK ((line_count = 0) = (blended_price_minor IS NULL)),
  CONSTRAINT ck_rrg_decided CHECK (status NOT IN ('accepted', 'rejected') OR (decided_at IS NOT NULL AND decided_by IS NOT NULL))
);
COMMENT ON TABLE requirement_response_groups IS
  'PC-56 TENANT-11d (0189, F-11, founder decision LINKED RESPONSES): the buyer desk''s pooled quote on a requirement from several members'' stock. draft → consent_pending (a line lacks its member''s yes) ↔ draft → submitted (send: one requirement_responses row per line, group_id set, in one transaction, refused while any member has not consented) → accepted | rejected (the buyer) | withdrawn (the desk). blended_price_minor = floor(Σ qty×price ÷ Σ qty) in integer thousandths; blended_remainder_minor = total_value − floor(blended × Σ qty), printed beside it.';

-- The status moves only along its edges; a sent group''s figures are frozen.
CREATE OR REPLACE FUNCTION requirement_response_groups_moves() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.requirement_id <> OLD.requirement_id OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'requirement_response_groups: identity is fixed (0189)' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status IN ('draft', 'consent_pending') AND NEW.status IN ('draft', 'consent_pending', 'submitted', 'withdrawn'))
    OR (OLD.status = 'submitted' AND NEW.status IN ('accepted', 'rejected', 'withdrawn'))) THEN
    RAISE EXCEPTION 'requirement_response_groups: % → % is not an edge (0189)', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  IF OLD.status NOT IN ('draft', 'consent_pending') AND (
       NEW.line_count <> OLD.line_count OR NEW.total_quantity <> OLD.total_quantity OR NEW.total_value_minor <> OLD.total_value_minor
    OR NEW.blended_price_minor IS DISTINCT FROM OLD.blended_price_minor OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
    OR NEW.sent_at IS DISTINCT FROM OLD.sent_at) THEN
    RAISE EXCEPTION 'requirement_response_groups: a sent group''s figures are frozen (0189)' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_rrg_moves ON requirement_response_groups;
CREATE TRIGGER trg_rrg_moves BEFORE UPDATE ON requirement_response_groups FOR EACH ROW EXECUTE FUNCTION requirement_response_groups_moves();

ALTER TABLE requirement_response_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirement_response_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rrg_read ON requirement_response_groups;
DROP POLICY IF EXISTS rrg_insert_own ON requirement_response_groups;
DROP POLICY IF EXISTS rrg_update_own ON requirement_response_groups;
DROP POLICY IF EXISTS rrg_admin_realm ON requirement_response_groups;
CREATE POLICY rrg_read        ON requirement_response_groups FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY rrg_insert_own  ON requirement_response_groups FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY rrg_update_own  ON requirement_response_groups FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY rrg_admin_realm ON requirement_response_groups FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON requirement_response_groups FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON requirement_response_groups TO kv_app;
GRANT UPDATE (status, line_count, total_quantity, total_value_minor, blended_price_minor, blended_remainder_minor, valid_until,
              sent_at, sent_by, decided_at, decided_by, decision_consent_id, withdraw_reason, updated_at) ON requirement_response_groups TO kv_app;
GRANT SELECT ON requirement_response_groups TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 189.4  requirement_group_lines — THE DRAFT LINES (one per member per group)
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS requirement_group_lines (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  group_id         uuid NOT NULL REFERENCES requirement_response_groups(id),
  requirement_id   uuid NOT NULL REFERENCES requirements(id),
  seller_user_id   uuid NOT NULL REFERENCES users(id),
  listing_id       uuid NOT NULL REFERENCES listings(id),
  quantity         numeric(14,3) NOT NULL CHECK (quantity > 0),
  price_minor      bigint NOT NULL CHECK (price_minor > 0),
  status           varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed', 'sent')),
  consent_id       uuid REFERENCES requirement_consents(id),
  response_id      uuid REFERENCES requirement_responses(id),
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  removed_at       timestamptz,
  CONSTRAINT ck_rgl_sent_whole CHECK ((status = 'sent') = (response_id IS NOT NULL)),
  CONSTRAINT ck_rgl_sent_consented CHECK (status <> 'sent' OR consent_id IS NOT NULL),
  CONSTRAINT ck_rgl_removed CHECK ((status = 'removed') = (removed_at IS NOT NULL))
);
-- One live line per member per group (a member's second listing is the same member's line, edited).
CREATE UNIQUE INDEX IF NOT EXISTS uq_rgl_member ON requirement_group_lines (group_id, seller_user_id) WHERE status <> 'removed';
COMMENT ON TABLE requirement_group_lines IS
  'PC-56 TENANT-11d (0189, F-11 / F-20): one member''s line of a pooled quote while the desk assembles it — the member''s published listing, the quantity (≤ available when added and again when sent) and the price per unit (prefilled from the listing, editable). consent_id is the member''s yes to EXACTLY these figures: editing quantity or price clears it (trigger), so a changed line needs a new yes. Sent lines are frozen and point at the response they became.';

CREATE OR REPLACE FUNCTION requirement_group_lines_moves() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.group_id <> OLD.group_id OR NEW.requirement_id <> OLD.requirement_id
     OR NEW.seller_user_id <> OLD.seller_user_id OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'requirement_group_lines: identity is fixed (0189)' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'active' AND (NEW.status <> OLD.status OR NEW.quantity <> OLD.quantity OR NEW.price_minor <> OLD.price_minor
       OR NEW.listing_id <> OLD.listing_id OR NEW.consent_id IS DISTINCT FROM OLD.consent_id) THEN
    RAISE EXCEPTION 'requirement_group_lines: a % line is frozen (0189)', OLD.status USING ERRCODE = '23514';
  END IF;
  -- the member said yes to these figures; different figures are not what they said yes to
  IF NEW.consent_id IS NOT DISTINCT FROM OLD.consent_id AND OLD.consent_id IS NOT NULL
     AND (NEW.quantity <> OLD.quantity OR NEW.price_minor <> OLD.price_minor OR NEW.listing_id <> OLD.listing_id) THEN
    NEW.consent_id := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_rgl_moves ON requirement_group_lines;
CREATE TRIGGER trg_rgl_moves BEFORE UPDATE ON requirement_group_lines FOR EACH ROW EXECUTE FUNCTION requirement_group_lines_moves();

ALTER TABLE requirement_group_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirement_group_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rgl_read ON requirement_group_lines;
DROP POLICY IF EXISTS rgl_insert_own ON requirement_group_lines;
DROP POLICY IF EXISTS rgl_update_own ON requirement_group_lines;
DROP POLICY IF EXISTS rgl_admin_realm ON requirement_group_lines;
CREATE POLICY rgl_read        ON requirement_group_lines FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY rgl_insert_own  ON requirement_group_lines FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY rgl_update_own  ON requirement_group_lines FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY rgl_admin_realm ON requirement_group_lines FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON requirement_group_lines FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON requirement_group_lines TO kv_app;
GRANT UPDATE (listing_id, quantity, price_minor, status, consent_id, response_id, updated_at, removed_at) ON requirement_group_lines TO kv_app;
GRANT SELECT ON requirement_group_lines TO kv_readonly;

ALTER TABLE requirement_consents DROP CONSTRAINT IF EXISTS fk_rqc_group;
ALTER TABLE requirement_consents ADD CONSTRAINT fk_rqc_group FOREIGN KEY (group_id) REFERENCES requirement_response_groups(id);
ALTER TABLE requirement_consents DROP CONSTRAINT IF EXISTS fk_rqc_line;
ALTER TABLE requirement_consents ADD CONSTRAINT fk_rqc_line FOREIGN KEY (line_id) REFERENCES requirement_group_lines(id);

-- ------------------------------------------------------------------------------------------------------------------
-- 189.5  requirement_responses — LINKED, CONSENTED, ACCEPTED BY QUANTITY, ONE ORDER EACH
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE requirement_responses ADD COLUMN IF NOT EXISTS group_id            uuid REFERENCES requirement_response_groups(id);
ALTER TABLE requirement_responses ADD COLUMN IF NOT EXISTS consent_id          uuid REFERENCES requirement_consents(id);
ALTER TABLE requirement_responses ADD COLUMN IF NOT EXISTS accepted_quantity   numeric(14,3);
ALTER TABLE requirement_responses ADD COLUMN IF NOT EXISTS accepted_at         timestamptz;
ALTER TABLE requirement_responses ADD COLUMN IF NOT EXISTS accepted_by         uuid REFERENCES users(id);
ALTER TABLE requirement_responses ADD COLUMN IF NOT EXISTS decision_consent_id uuid REFERENCES requirement_consents(id);
ALTER TABLE requirement_responses ADD COLUMN IF NOT EXISTS order_id            uuid;          -- orders is partitioned (no FK), as order_items
ALTER TABLE requirement_responses ADD COLUMN IF NOT EXISTS submitted_by        uuid REFERENCES users(id);

ALTER TABLE requirement_responses DROP CONSTRAINT IF EXISTS ck_rr_group_consent;
-- a linked response exists only because its member said yes
ALTER TABLE requirement_responses ADD CONSTRAINT ck_rr_group_consent CHECK (group_id IS NULL OR consent_id IS NOT NULL);
ALTER TABLE requirement_responses DROP CONSTRAINT IF EXISTS ck_rr_accepted_qty;
ALTER TABLE requirement_responses ADD CONSTRAINT ck_rr_accepted_qty CHECK (accepted_quantity IS NULL OR (accepted_quantity > 0 AND accepted_quantity <= quantity));
ALTER TABLE requirement_responses DROP CONSTRAINT IF EXISTS ck_rr_accepted_whole;
ALTER TABLE requirement_responses ADD CONSTRAINT ck_rr_accepted_whole CHECK ((accepted_quantity IS NULL) = (accepted_at IS NULL)) NOT VALID;
ALTER TABLE requirement_responses DROP CONSTRAINT IF EXISTS ck_rr_order_accepted;
ALTER TABLE requirement_responses ADD CONSTRAINT ck_rr_order_accepted CHECK (order_id IS NULL OR status = 'accepted');
-- A response accepted before 0189 has no recorded accepted quantity; it was a whole acceptance.
UPDATE requirement_responses SET accepted_quantity = quantity, accepted_at = updated_at WHERE status = 'accepted' AND accepted_quantity IS NULL;
ALTER TABLE requirement_responses VALIDATE CONSTRAINT ck_rr_accepted_whole;

-- One order per response, written once.
CREATE OR REPLACE FUNCTION requirement_responses_order_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'requirement_responses.order_id is written once (0189)' USING ERRCODE = '23514';
  END IF;
  IF OLD.accepted_quantity IS NOT NULL AND NEW.accepted_quantity IS DISTINCT FROM OLD.accepted_quantity THEN
    RAISE EXCEPTION 'requirement_responses.accepted_quantity is written once (0189)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_rr_order_once ON requirement_responses;
CREATE TRIGGER trg_rr_order_once BEFORE UPDATE ON requirement_responses FOR EACH ROW EXECUTE FUNCTION requirement_responses_order_once();

COMMENT ON COLUMN requirement_responses.group_id IS
  'PC-56 TENANT-11d (0189, F-11): the pooled quote (requirement_response_groups) this response was sent as part of — one response per member, linked. NULL = a seller''s own quote.';
COMMENT ON COLUMN requirement_responses.accepted_quantity IS
  'PC-56 TENANT-11d (0189, A2): how much of this quote the buyer accepted (≤ quantity; a partial accept is a smaller number). It is the order''s quantity and what requirements.fulfilled_quantity counts.';
COMMENT ON COLUMN requirement_responses.order_id IS
  'PC-56 TENANT-11d (0189, founder decision ONE ORDER PER MEMBER): the order orders'' QuoteAcceptedHandler created for THIS accepted response (quantity = accepted_quantity, unit = the requirement''s, price = quoted). Written once; the handler''s idempotency anchor.';
COMMENT ON COLUMN requirement_responses.ai_match_score IS
  'Reserved (0005). UNWRITTEN — PC-56 TENANT-11d (0189): no AI ranking service exists; the member-stock match is rule-based and says so. Never fake a score here.';

-- ------------------------------------------------------------------------------------------------------------------
-- 189.6  PERMISSIONS — rows here AND in seed 0004
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('requirement.desk', 'Buyer desk: post for a named buyer and decide their quotes with their consent; respond with member stock after each member''s consent', 'M12')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE p.code = 'requirement.desk' AND r.code IN ('tenant_admin', 'fpo_coordinator')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 189.7  NOTIFICATION CATALOGUE (templates: seed core/0007, above the version backfill)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('requirement.group_quoted', 'A pooled quote from member stock arrived on your requirement', 'important', '["push","inapp"]', true, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 189.8  INDEXES
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_req_tenant_recent  ON requirements (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_req_tenant_status  ON requirements (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_req_tenant_need_by ON requirements (tenant_id, need_by, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rr_requirement     ON requirement_responses (tenant_id, requirement_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_rr_group           ON requirement_responses (group_id) WHERE group_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rr_order     ON requirement_responses (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rrg_requirement    ON requirement_response_groups (tenant_id, requirement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rgl_group          ON requirement_group_lines (tenant_id, group_id, status);
CREATE INDEX IF NOT EXISTS idx_rqc_requirement    ON requirement_consents (tenant_id, requirement_id, recorded_at DESC);
