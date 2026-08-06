-- ============================================================================
-- MIGRATION 0101 — PLATFORM REPLIES TO A FARMER (closes PC-56 ADMIN-2-Q3's reply half)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- THIS WAVE WAS DEFERRED TWICE ON PURPOSE, AND THE SURVEY CHANGED THE ANSWER BOTH TIMES. The queued shape was "admin-api
-- enqueues an intent; the tenant realm posts the message through its own service, so the notification fan-out happens".
-- That is right about the fan-out and wrong about the message, for a reason that only shows up in the schema:
--
--   conversation_participants.user_id REFERENCES users(id), and messages.sender_user_id is a tenant user.
--   MessageService.post() refuses a non-participant (404, deliberately, to avoid an IDOR).
--
-- A PLATFORM OPERATOR HAS NO users ROW IN THE TENANT. So posting a conversation message from the oversight plane needs
-- one of three things, and all three are worse than the problem:
--   (a) INVENT A PLATFORM ACCOUNT INSIDE EVERY TENANT'S USER TABLE — a cross-tenant identity, which is precisely what the
--       two-realm split exists to prevent. It would also appear in that tenant's own user administration screens.
--   (b) POST AS THE ASSIGNED AGENT — the record would then say a person wrote words they never wrote. Not a shortcut, a
--       forgery.
--   (c) ADD THE ADMIN AS A PARTICIPANT AD HOC — same as (a) plus a stranger in the farmer's thread.
--
-- SO A PLATFORM REPLY IS NOT A DESK REPLY, AND THIS TABLE REFUSES TO LET IT PRETEND TO BE ONE. It reaches the farmer
-- through the NOTIFICATION SPINE — the same rail tenant broadcasts use (0048) — attributed to the platform, because that
-- is who is speaking. The farmer gets a real message from Krishalaya rather than an impersonation of their FPO's desk.
--
-- AND THE TENANT'S DESK CAN SEE IT (kv_app SELECT, RLS-scoped). That grant is the point, not an afterthought: the
-- platform speaking directly to a tenant's farmer behind that tenant's back would be a trust incident, whatever the
-- content. They can read it and they cannot alter it.
--
-- THE ROW IS BOTH THE COMMAND AND THE RECORD. It starts `queued` — admin-api writes it and nothing has been sent — and
-- the executor in apps/api settles it. Nothing anywhere says "sent" until the spine accepted it, which is the same law
-- ADMIN-1e applied to scheduled reports and ADMIN-2b to escalation steps.
--
-- WHY NOT outbox_events, WHICH THE PANEL SUGGESTED. The outbox is an EVENT log: every row means "this already happened",
-- and Law 4 says events are written in the same transaction as the state change they describe. An admin-api row would be
-- a COMMAND with no corresponding state change, which quietly changes what the log means for all fifteen modules that
-- consume it. Worse, a handler that refuses marks the event `failed` in a table the admin realm does not read — so the
-- operator would see nothing and assume delivery. That is exactly the failure mode ADMIN-2b refused for pager steps.
-- ============================================================================

CREATE TYPE support_platform_reply_status AS ENUM (
  'queued',      -- admin-api has recorded the intent. NOTHING has been sent.
  'delivered',   -- the notification spine accepted a per-recipient notification. A real delivery.
  'refused',     -- it cannot be sent, and the reason is recorded (no requester, ticket closed, tenant gone)
  'failed'       -- an unexpected error; retryable, with the detail kept
);

CREATE TABLE support_platform_replies (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  ticket_id       uuid NOT NULL REFERENCES support_tickets(id),
  -- the platform operator who wrote it. NOT a tenant user — that is the whole point of this table.
  author_admin_id uuid NOT NULL,

  -- WHAT WAS SAID. Kept verbatim and never edited: this is a message sent to a person about their money.
  body            text NOT NULL CHECK (length(btrim(body)) >= 20),
  -- the language it was WRITTEN in. Required, not defaulted: the notification spine renders per language, and a reply
  -- composed in English and delivered under a Hindi template would be a message the farmer cannot read wearing a label
  -- saying they can.
  language_code   varchar(8) NOT NULL REFERENCES languages(code),

  status          support_platform_reply_status NOT NULL DEFAULT 'queued',
  -- WHY it was not sent. Required for the non-delivering states (see the CHECK) so a refusal is never a silent nothing.
  detail          text,

  -- the recipient, resolved AT SEND TIME by the executor and recorded here. Stored because the ticket's requester could
  -- in principle change, and "who did we actually tell" must stay answerable from this row alone.
  recipient_user_id uuid REFERENCES users(id),
  notification_event_code varchar(80) REFERENCES notification_events(code),

  queued_at       timestamptz NOT NULL DEFAULT now(),
  settled_at      timestamptz,
  -- how many times the executor has tried. Bounded retries: a reply that cannot be delivered after a few attempts is a
  -- fact for a human, not a loop.
  attempts        smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- the idempotency key the executor passes down, so a retry cannot deliver twice
  idempotency_key varchar(120) NOT NULL
);
CALL add_std_columns('support_platform_replies');

-- Anything that did not reach the farmer must explain itself. `queued` is exempt: it has not been tried yet.
ALTER TABLE support_platform_replies ADD CONSTRAINT ck_platform_reply_detail CHECK (
  status IN ('queued', 'delivered') OR length(btrim(COALESCE(detail, ''))) >= 3
);
-- A settled row has a settle time; a queued one does not.
ALTER TABLE support_platform_replies ADD CONSTRAINT ck_platform_reply_settled CHECK (
  (status = 'queued' AND settled_at IS NULL) OR (status <> 'queued' AND settled_at IS NOT NULL)
);
-- A delivered row names who it reached. Without this, `delivered` could mean "we think so".
ALTER TABLE support_platform_replies ADD CONSTRAINT ck_platform_reply_recipient CHECK (
  status <> 'delivered' OR recipient_user_id IS NOT NULL
);

CREATE UNIQUE INDEX uq_platform_reply_idem ON support_platform_replies (idempotency_key) WHERE deleted_at IS NULL;
-- the executor's claim scan: oldest queued first, so a farmer is not left waiting behind newer traffic
CREATE INDEX idx_platform_reply_queued ON support_platform_replies (queued_at)
  WHERE status = 'queued' AND deleted_at IS NULL;
CREATE INDEX idx_platform_reply_ticket ON support_platform_replies (tenant_id, ticket_id, queued_at DESC);
-- retryable failures, for the operator's "what is stuck" view
CREATE INDEX idx_platform_reply_failed ON support_platform_replies (queued_at DESC)
  WHERE status = 'failed' AND deleted_at IS NULL;

-- ---------- RLS: the tenant may READ what the platform said to their farmer ----------
-- Deliberate, and the opposite of 0100's coaching records. A coaching note is the platform's private judgement about a
-- tenant's staff. This is a MESSAGE THE PLATFORM SENT TO THAT TENANT'S FARMER, and a tenant discovering months later
-- that the platform had been talking to their members without their knowledge would be a worse breach of trust than
-- anything the message could contain. So: readable, never writable.
ALTER TABLE support_platform_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_platform_replies FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'support_platform_replies' AND policyname = 'p_tenant_support_platform_replies') THEN
    EXECUTE 'CREATE POLICY p_tenant_support_platform_replies ON support_platform_replies
               USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)';
  END IF;
END $$;

-- ---------- grants (the 0014/0018 default-privileges trap) --------------------------------------
-- Every new table silently arrives kv_app-INSERTable / kv_relay-writable, so revoke first, then grant precisely.
REVOKE ALL ON support_platform_replies FROM kv_app, kv_relay;

-- THE TENANT API: SELECT ONLY. It may show the desk what the platform told their farmer; it may not write, edit or
-- delete. There is no policy for INSERT/UPDATE above either, so this is two locks on the same door.
GRANT SELECT ON support_platform_replies TO kv_app;

-- ADMIN-API: enqueues and reads outcomes. No UPDATE — the admin realm records the intent and then finds out what
-- happened; it does not get to declare its own message delivered.
GRANT SELECT, INSERT ON support_platform_replies TO kv_admin;

-- THE EXECUTOR (kv_relay, BYPASSRLS): claims and settles. It never inserts — a reply must originate from a person.
GRANT SELECT, UPDATE ON support_platform_replies TO kv_relay;

GRANT SELECT ON support_platform_replies TO kv_readonly;

-- ---------- the notification event this rail uses ----------
-- REFERENCE DATA, and it lives HERE rather than in db/seeds because the executor is fail-closed: NotificationService
-- .fanout() looks the code up and returns silently if it is absent ("never spam an uncatalogued event"). If this row
-- were only in a seed file, a deployment that skipped seeds would accept replies, mark them delivered, and tell nobody
-- — the precise silent-failure this whole wave is about. A migration cannot be skipped.
--
-- 'important', not 'critical': a platform support reply matters and it is not an OTP. `user_can_opt_out` is FALSE —
-- a person who raised a support ticket about their own money has asked to be answered, and letting a stale preference
-- swallow the answer would be the platform hiding behind a checkbox. Not batchable: a reply is not digest material.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable)
VALUES ('support.platform_reply', 'Reply from Krishalaya support', 'important', '["inapp","push","sms"]', false, false)
ON CONFLICT (code) DO NOTHING;

-- ---------- THE TEMPLATES, AND WHY THEY ARE NOT OPTIONAL ----------
-- READING THE SPINE CLOSELY TURNED UP THE WORST BUG THIS WAVE COULD HAVE SHIPPED. In
-- NotificationService.dispatchOne():
--
--     const rendered = template ? template.render(a.payload) : { subject: null, body: '' };
--
-- With no template row, a notification is created and delivered WITH AN EMPTY BODY. The farmer would get a genuine
-- notification from Krishalaya containing nothing, the row here would say `delivered`, and the operator would believe
-- their reply had been read. Not a crash, not a log line — a real message with the words removed. So the templates ship
-- in this migration alongside the event, for the same reason the event does: a seed can be skipped, a migration cannot.
--
-- THE TEMPLATE IS A CARRIER, NOT A REWRITE. Its body is `{{body}}` plus the minimum framing needed for the farmer to
-- know who is speaking and about which ticket. The operator's words pass through verbatim — a template that summarised
-- or truncated a support reply would be the platform editing an answer about somebody's money after a human approved it.
--
-- FALLBACK_LANGS in the service is ['en', 'hi'], so English and Hindi rows are what make delivery safe for a language
-- with no row of its own. Gujarati is seeded too because it is a launch language (0096's macro set uses en/hi/gu).
-- A language without a row falls back to English rather than to an empty string — degraded, and readable.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active)
SELECT v.event_code, v.channel, v.language_code, NULL, v.subject, v.body, v.ref, true
FROM (VALUES
  -- in-app: the farmer is already in the product; the whole reply is shown
  ('support.platform_reply', 'inapp', 'en', 'Krishalaya support replied to ticket {{ticketNo}}',
   '{{body}}', NULL),
  ('support.platform_reply', 'inapp', 'hi', 'Krishalaya support ne ticket {{ticketNo}} par jawab diya',
   '{{body}}', NULL),
  ('support.platform_reply', 'inapp', 'gu', 'Krishalaya support e ticket {{ticketNo}} par jawab aapyo',
   '{{body}}', NULL),
  -- push: a title plus the reply. The body is not truncated here — the transport decides what fits, and a template that
  -- pre-truncated would cut the message for devices that had room for it.
  ('support.platform_reply', 'push', 'en', 'Krishalaya support · {{ticketNo}}', '{{body}}', NULL),
  ('support.platform_reply', 'push', 'hi', 'Krishalaya support · {{ticketNo}}', '{{body}}', NULL),
  ('support.platform_reply', 'push', 'gu', 'Krishalaya support · {{ticketNo}}', '{{body}}', NULL),
  -- SMS: DLT-registered in India, so the provider template reference is REQUIRED and the wording cannot drift from what
  -- was registered. Marked INACTIVE below until a real DLT id exists — see the note after this insert.
  ('support.platform_reply', 'sms', 'en', NULL,
   'Krishalaya support replied to your ticket {{ticketNo}}. Open the app to read it.', 'DLT_SUPPORT_REPLY_EN'),
  ('support.platform_reply', 'sms', 'hi', NULL,
   'Krishalaya support ne aapke ticket {{ticketNo}} ka jawab diya hai. App me padhein.', 'DLT_SUPPORT_REPLY_HI'),
  ('support.platform_reply', 'sms', 'gu', NULL,
   'Krishalaya support e tamara ticket {{ticketNo}} no jawab aapyo chhe. App ma vancho.', 'DLT_SUPPORT_REPLY_GU')
) AS v(event_code, channel, language_code, subject, body, ref)
WHERE EXISTS (SELECT 1 FROM languages l WHERE l.code = v.language_code)
ON CONFLICT DO NOTHING;

-- THE SMS ROWS ARE DEACTIVATED UNTIL A REAL DLT ID EXISTS. In India a transactional SMS template must be registered
-- with the DLT registry before it can be sent, and `DLT_SUPPORT_REPLY_*` are placeholders, not registrations. Leaving
-- them active would mean the platform believing it had texted a farmer while the aggregator silently rejected the send.
-- The reply is still DELIVERED by the in-app and push rows, so the farmer is answered; SMS turns on with one UPDATE the
-- day the DLT ids are issued (founder-key list, alongside the email/voice provider gap from ADMIN-1e and ADMIN-2b).
UPDATE notification_templates SET is_active = false
 WHERE event_code = 'support.platform_reply' AND channel = 'sms'
   AND provider_template_ref LIKE 'DLT_SUPPORT_REPLY_%';

-- The SMS channel therefore stays out of the event's default channels: an event advertising a channel whose every
-- template is inactive reads as cover the platform does not have.
UPDATE notification_events SET default_channels = '["inapp","push"]'
 WHERE code = 'support.platform_reply';
