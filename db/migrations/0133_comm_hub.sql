-- ============================================================================
-- MIGRATION 0133 — THE COMMUNICATION HUB'S TWO MISSING FACTS (PC-56 ADMIN-SWEEP-b2, W050 + W2099–W2101)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE CHANNEL-IDENTITY DECISION, WRITTEN WHERE IT CANNOT BE LOST
-- ---------------------------------------------------------------------------
-- W050's own mechanism line: "Channel identity linking: phone number is the join key." Joining a person across
-- tenants in a god-mode console is a PII decision with a cross-tenant blast radius — which is why ADMIN-SWEEP-b's
-- survey made it this wave's precondition. The decision:
--
--   **THE JOIN KEY IS `users.id`, AND THE PHONE IS ONLY ITS PROOF.** `users.phone` is UNIQUE NOT NULL and global
--   (0003) — identity on this platform is already platform-wide, one row per phone. So "phone is the join key" is
--   satisfied by joining support threads on `requester_user_id`, and NO new linkage table, phone index or search
--   path is created by this migration. What the dangerous reading would add — a free-text phone search sweeping
--   every tenant's people — is REFUSED: the hub takes no phone input anywhere, and prints the phone masked
--   (core/pii/mask.ts) with the existing per-field reveal disciplines applying downstream. A future inbound
--   WhatsApp/SMS identity (when a provider exists — see below) resolves to a users row THROUGH the unique phone at
--   ingestion time, in one place, rather than by ad-hoc joins in console queries.
--
-- AND THE HONESTY LINE THIS SCHEMA MUST NOT CROSS: W050 draws "app chat · WhatsApp · IVR callbacks · SMS replies in
-- one queue". `support_tickets.channel` is CALLER-DECLARED metadata (apps/api accepts it at open; no provider ever
-- sets it), `apps/whatsapp-bot` and `apps/ivr-ussd-gateway` are intentional GA-deferred stubs that exit(1), the
-- MSG91/Twilio wiring is OTP-only, and no inbound-message controller exists. This migration therefore adds NO
-- whatsapp/sms/ivr message tables — a schema for messages nothing can receive would be the empty-appeals shape
-- again. The hub is honest over what exists: tickets and their in-app threads, channel shown as DECLARED.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 133.1  WHO IS WORKING A TICKET, IN THE PLATFORM REALM
-- ---------------------------------------------------------------------------
-- "Next in queue" needs a claim, and `assignee_user_id` cannot carry it: that column is FK'd to `users` and belongs
-- to the TENANT desk's agents; a platform operator is not a users row (0110's reasoning, the same one that dropped
-- appeals' reviewer FKs). Two realms, two columns — and the queue can now distinguish "a tenant agent owns this"
-- from "a platform operator picked it up", which were previously the same NULL.
ALTER TABLE support_tickets ADD COLUMN claimed_by_admin_id uuid;
ALTER TABLE support_tickets ADD COLUMN claimed_at timestamptz;
-- a claim is a pair: both set or neither (a claim with no timestamp cannot age; a timestamp with no owner is noise)
ALTER TABLE support_tickets ADD CONSTRAINT chk_tickets_claim_pair
  CHECK ((claimed_by_admin_id IS NULL) = (claimed_at IS NULL));

-- The pull queue: open, unclaimed by the platform, worst first-response deadline first. Partial, so the index
-- stays the size of the backlog rather than the archive.
CREATE INDEX idx_tickets_hub_queue ON support_tickets (sla_first_response_due, created_at, id)
  WHERE status NOT IN ('resolved', 'closed') AND claimed_by_admin_id IS NULL AND deleted_at IS NULL;
-- "My load: N open" — an agent's claimed-and-unresolved count must be an index lookup, not a scan.
CREATE INDEX idx_tickets_hub_claimed ON support_tickets (claimed_by_admin_id)
  WHERE status NOT IN ('resolved', 'closed') AND claimed_by_admin_id IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 133.2  "TAKE A BREAK 🌾" — presence as a recorded fact, not a UI mood
-- ---------------------------------------------------------------------------
-- W050's inbox-zero state offers a break; the claim path must REFUSE an operator who is on one (a queue that hands
-- work to somebody who said "not now" teaches people not to say it). One row per operator; absence means available,
-- so the table stays the size of the exceptions.
CREATE TABLE support_hub_presence (
  admin_id   uuid PRIMARY KEY,                       -- platform operator; no FK — operators are not users rows
  status     varchar(12) NOT NULL CHECK (status IN ('available', 'break')),
  since      timestamptz NOT NULL DEFAULT now()
);
CALL add_std_columns('support_hub_presence');

-- Platform-realm state: the tenant realm has no business reading who is on a break in the god-mode console.
REVOKE ALL ON support_hub_presence FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON support_hub_presence TO kv_admin;
GRANT SELECT ON support_hub_presence TO kv_readonly;

COMMENT ON TABLE support_hub_presence IS
  'W050 "Take a break": platform support operators'' availability. Absence = available. The hub''s claim path refuses an operator on break; flipping it is audited (support.hub_break / support.hub_available).';
COMMENT ON COLUMN support_tickets.claimed_by_admin_id IS
  'W050 "Next in queue": the PLATFORM operator working this ticket. Deliberately not assignee_user_id — that FK belongs to the tenant desk''s agents; platform operators are not users rows (0110''s reasoning).';
