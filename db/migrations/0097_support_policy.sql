-- ============================================================================
-- MIGRATION 0097 — SUPPORT POLICY (closes PC-56 ADMIN-2-Q2 + ADMIN-2-Q4)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- THE HOLE THIS FILLS, IN ONE SENTENCE: today an SLA breach does nothing. The targets exist (a code constant in
-- apps/api's support-ticket entity, mirrored in admin-api's domain/sla.ts) and they are applied to every ticket the
-- moment it opens — but when one is missed, no one is paged. The ADMIN-2 console had to say so in words on the
-- escalation screen. This migration is the object that makes the promise real.
--
-- WHY ONE TABLE AND NOT FOUR. The canon shows W054 (escalation matrix) and W057 (routing, hours, after-hours, AI-assist
-- policy, live languages) as separate screens. They are not separate DECISIONS: "we answer P0 in 15 minutes, we page the
-- support head at breach, we are open 09:00-21:00 IST, and after hours only P0 wakes anyone" is a single operating
-- policy, and splitting it across four tables would guarantee they drift into contradiction — an escalation chain that
-- pages someone at 03:00 while the hours table says the desk is shut. One row is one coherent promise.
--
-- PUBLISH, NEVER EDIT — the same law as the dunning ladder (0094), for the same reason: six months from now the only
-- defensible answer to "why was my P1 not escalated?" is the policy that was active then. A change is a NEW VERSION.
--
-- SLA TARGETS LIVE HERE NOW, BUT THE CODE CONSTANT STAYS AUTHORITATIVE UNTIL A VERSION IS PUBLISHED. That is deliberate:
-- this migration seeds v1 from the constant, so nothing changes on the day it applies. If the seeded row were absent,
-- a deploy would silently switch every ticket's SLA to whatever a table defaulted to.
-- ============================================================================

CREATE TYPE support_escalation_channel AS ENUM ('email', 'sms', 'whatsapp', 'call', 'in_app', 'pager');

CREATE TABLE support_policies (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  version             integer NOT NULL UNIQUE,
  name                varchar(120) NOT NULL,
  is_active           boolean NOT NULL DEFAULT false,
  effective_from      date NOT NULL,

  -- ---- hours (W057) ----
  -- IST hours as whole numbers, because "we are open 09:00-21:00" is a rule and storing it as timestamps would drift
  -- with anybody's daylight-saving reasoning later. open == close would mean a zero-length day, so it is refused.
  open_hour_ist       smallint NOT NULL DEFAULT 9  CHECK (open_hour_ist BETWEEN 0 AND 23),
  close_hour_ist      smallint NOT NULL DEFAULT 21 CHECK (close_hour_ist BETWEEN 1 AND 24),
  -- which severities wake somebody OUTSIDE those hours. Empty = nothing does, which is a legitimate (and safe) policy
  -- for a desk that has no night shift — but it must be stated, not inferred from a missing row.
  after_hours_severities varchar(2)[] NOT NULL DEFAULT '{P0}',

  -- ---- routing (W057) ----
  -- 'round_robin' spreads load; 'least_loaded' favours the shortest queue; 'manual' means a human triages. Named
  -- strategies rather than a rules engine: a rules engine in an admin form is a support ticket generator.
  routing_strategy    varchar(20) NOT NULL DEFAULT 'least_loaded'
                        CHECK (routing_strategy IN ('round_robin', 'least_loaded', 'manual')),
  -- languages the desk can actually answer in. NOT a copy of the platform's registry: a language can be live in the
  -- product while the desk has nobody who speaks it, and pretending otherwise routes a farmer to silence.
  desk_languages      varchar(8)[] NOT NULL DEFAULT '{en,hi,gu}',

  -- ---- AI assist (W057) ----
  -- 'off' | 'suggest' (an agent sees a draft) | 'auto_reply' (it answers alone). Default 'suggest': a platform that
  -- auto-answers questions about somebody's money before a human has read them is not a support desk.
  ai_assist_mode      varchar(12) NOT NULL DEFAULT 'suggest'
                        CHECK (ai_assist_mode IN ('off', 'suggest', 'auto_reply')),
  -- severities the AI may NEVER answer alone, whatever the mode. P0 is here by default and removing it should feel
  -- like a decision.
  ai_excluded_severities varchar(2)[] NOT NULL DEFAULT '{P0,P1}',

  notes               text
);
CALL add_std_columns('support_policies');
-- exactly one active version
CREATE UNIQUE INDEX uq_support_policy_active ON support_policies ((is_active)) WHERE is_active AND deleted_at IS NULL;
ALTER TABLE support_policies ADD CONSTRAINT ck_support_policy_hours CHECK (close_hour_ist > open_hour_ist);

-- ---------- the SLA targets, per severity, per version ----------
CREATE TABLE support_policy_slas (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  policy_id             uuid NOT NULL REFERENCES support_policies(id) ON DELETE CASCADE,
  severity              varchar(2) NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
  first_response_minutes integer NOT NULL CHECK (first_response_minutes BETWEEN 1 AND 43200),
  resolution_minutes     integer NOT NULL CHECK (resolution_minutes BETWEEN 1 AND 43200),
  UNIQUE (policy_id, severity)
);
CALL add_std_columns('support_policy_slas');
-- resolution cannot be sooner than first response: a promise to fix it before answering is not a promise
ALTER TABLE support_policy_slas ADD CONSTRAINT ck_policy_sla_order CHECK (resolution_minutes >= first_response_minutes);

-- ---------- the escalation chain: WHO is paged, and WHEN ----------
CREATE TABLE support_policy_escalations (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  policy_id     uuid NOT NULL REFERENCES support_policies(id) ON DELETE CASCADE,
  severity      varchar(2) NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
  -- minutes AFTER the breach. 0 is the breach itself (the canon's "At breach" column), then +30, +120, …
  after_minutes integer NOT NULL CHECK (after_minutes BETWEEN 0 AND 10080),
  channel       support_escalation_channel NOT NULL,
  -- a ROLE, not a person: naming a person means the chain breaks the day they leave, and it will not be noticed until
  -- the next breach at 02:00. Resolved to people at page time by whatever on-call rail exists.
  target_role   varchar(60) NOT NULL CHECK (length(btrim(target_role)) >= 2),
  notes         text,
  UNIQUE (policy_id, severity, after_minutes, channel)
);
CALL add_std_columns('support_policy_escalations');
CREATE INDEX idx_policy_escalations_lookup ON support_policy_escalations (policy_id, severity, after_minutes);

-- ---------- seed v1 FROM THE CODE CONSTANT, so nothing changes on the day this applies ----------
INSERT INTO support_policies (version, name, is_active, effective_from, notes)
VALUES (1, 'Seeded from code (PRD §50)', true, CURRENT_DATE,
        'Seeded by 0097 from SLA_MINUTES in apps/api support-ticket.entity (mirrored in admin-api domain/sla.ts) so this migration changes no ticket''s targets. The ESCALATION CHAIN below is new: before it, a breach paged nobody.');

INSERT INTO support_policy_slas (policy_id, severity, first_response_minutes, resolution_minutes)
SELECT p.id, s.sev, s.fr, s.res
FROM support_policies p,
     (VALUES ('P0', 15, 240), ('P1', 60, 480), ('P2', 240, 1440), ('P3', 480, 4320))
       AS s(sev, fr, res)
WHERE p.version = 1;

-- A DELIBERATELY CONSERVATIVE first chain: P0 and P1 page a human, P2/P3 raise an in-app signal for the desk lead. No
-- 'pager' rows are seeded — wiring a pager is an on-call decision with a named owner, not a migration default.
INSERT INTO support_policy_escalations (policy_id, severity, after_minutes, channel, target_role, notes)
SELECT p.id, e.sev, e.mins, e.chan::support_escalation_channel, e.role, e.note
FROM support_policies p,
     (VALUES
        ('P0', 0,   'call',   'support_head',  'a P0 breach is a person ringing another person'),
        ('P0', 30,  'call',   'head_of_ops',   NULL),
        ('P1', 0,   'sms',    'support_lead',  NULL),
        ('P1', 120, 'call',   'support_head',  NULL),
        ('P2', 0,   'in_app', 'support_lead',  'visible on the SLA board; nobody is woken for a P2'),
        ('P3', 0,   'in_app', 'support_lead',  NULL)
     ) AS e(sev, mins, chan, role, note)
WHERE p.version = 1;

-- ---------- grants (the 0014/0018 default-privileges trap) --------------------------------------
-- Platform policy, so no RLS — but the defaults would let a tenant-facing role rewrite the platform's own SLA promises.
-- Revoke, then grant: admin-api authors, the tenant API reads (it computes a ticket's SLA at open), the worker reads
-- (it will page from the chain).
REVOKE ALL ON support_policies, support_policy_slas, support_policy_escalations FROM kv_app, kv_relay;
GRANT SELECT ON support_policies, support_policy_slas, support_policy_escalations TO kv_app;
GRANT SELECT ON support_policies, support_policy_slas, support_policy_escalations TO kv_relay;
GRANT SELECT, INSERT, UPDATE ON support_policies, support_policy_slas, support_policy_escalations TO kv_admin;
GRANT SELECT ON support_policies, support_policy_slas, support_policy_escalations TO kv_readonly;
