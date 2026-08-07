-- ============================================================================
-- MIGRATION 0109 — A BREACH NOTIFICATION THAT CANNOT CLAIM WHAT NOBODY DID (PC-56 ADMIN-5c)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT, AND IT IS THE SAME FAMILY AS ADMIN-5's ERASURE
-- ---------------------------------------------------------------------------
-- W043 states the rule plainly: "Moving to notified requires all three ticked + DPO sign-off — recorded immutably."
-- The three are a Data Protection Board filing, a message to every affected principal in their language, and a briefing
-- to the tenant admin.
--
-- WHAT THE CODE ACTUALLY DOES: `BreachResponseConsoleService.update` with `action: 'notify'` requires that the request
-- body contains two strings — `regulatorNotifiedAt` and `principalsNotifiedAt` — and then sets the status to `notified`.
-- An operator TYPES TWO DATES and the breach register states that the Data Protection Board was notified.
--
-- No filing reference. No count of principals reached. No channel. No DPO. Nothing that anybody could check, and
-- nothing that would stop the two dates being typed by the same person who declared the breach, five minutes later, to
-- clear the row off their screen.
--
-- Under DPDP a breach notification is a statutory act with a clock on it. A register that records it on the strength of
-- two typed timestamps is the same shape of lie as an erasure marked complete while every row still exists — and it is
-- WORSE in one respect: an unerased farmer can still be erased later, but a notification window that closed while the
-- register said it was met cannot be reopened.
--
-- ---------------------------------------------------------------------------
-- THE FIX: EVIDENCE PER STEP, AND A SIGN-OFF BY SOMEBODY ELSE
-- ---------------------------------------------------------------------------
-- `breach_notification_steps` records each of the three required acts as it happens, append-only, each carrying the
-- thing that makes it checkable — the portal filing reference, the number of principals reached and over which channel,
-- the name of the tenant contact briefed. `notified` is then refused unless all three exist AND a DPO who is not the
-- person who declared the breach has signed off.
--
-- Today that means a breach CANNOT be moved to `notified` without doing the work, which is the point. The console shows
-- the checklist with the outstanding steps where the button used to be.
--
-- A STEP MAY ALSO BE RECORDED AS NOT-APPLICABLE, and that is deliberate rather than a loophole. A breach of synthetic
-- staging data affects zero principals and has no tenant: forcing a fabricated "notified 0 principals" row would teach
-- operators to type something untrue to get past a gate. `not_applicable` requires its own reason and is visible in the
-- register as exactly what it is.
-- ============================================================================

CREATE TABLE breach_notification_steps (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  breach_id     uuid NOT NULL REFERENCES data_breaches(id),
  -- The three acts W043 lists, and nothing else. A free-text step would let a fourth be invented to satisfy a count.
  step          varchar(24) NOT NULL CHECK (step IN ('board_filing', 'principals_notified', 'tenant_briefed')),
  outcome       varchar(16) NOT NULL CHECK (outcome IN ('done', 'not_applicable', 'retracted')),
  -- What makes the claim checkable. For a board filing this is the portal acknowledgement number; for principals it is
  -- the channel; for a tenant briefing it is who was briefed. NULL only when the step is not applicable.
  evidence_ref  varchar(200),
  -- How many people were actually reached. NULL is NOT zero: null means nobody counted, zero means we counted and the
  -- answer was none. On a breach notification those are very different statements.
  reached_count bigint CHECK (reached_count IS NULL OR reached_count >= 0),
  channel       varchar(40),
  note          text,
  performed_by  uuid NOT NULL,
  performed_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- A completed step must carry its evidence. This is the constraint that stops the whole table becoming three
  -- checkboxes with nothing behind them — which is exactly what the two typed timestamps were.
  CONSTRAINT ck_bns_done_has_evidence CHECK (
    outcome <> 'done' OR (evidence_ref IS NOT NULL AND length(trim(evidence_ref)) > 0)
  ),
  -- A not-applicable step must say why. "Not applicable" without a reason is indistinguishable from skipping.
  CONSTRAINT ck_bns_na_has_note CHECK (
    outcome <> 'not_applicable' OR (note IS NOT NULL AND length(trim(note)) > 0)
  )
);

-- One live record per (breach, step). A correction is a `retracted` row followed by a new one, so the history of what
-- was claimed and withdrawn survives — on a statutory notification, a retracted claim is itself a fact somebody may
-- need to explain.
CREATE UNIQUE INDEX uq_bns_step ON breach_notification_steps (breach_id, step) WHERE outcome <> 'retracted';
CREATE INDEX idx_bns_breach ON breach_notification_steps (breach_id, performed_at DESC);

COMMENT ON TABLE breach_notification_steps IS
  'Append-only evidence for the three DPDP notification acts W043 requires. A breach cannot move to `notified` unless all three have a row and a DPO other than the person who declared it has signed off. Before 0109 the status was set on the strength of two timestamps an operator typed.';

REVOKE ALL ON breach_notification_steps FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON breach_notification_steps TO kv_admin;
GRANT SELECT ON breach_notification_steps TO kv_readonly;

-- ---------------------------------------------------------------------------
-- THE DPO SIGN-OFF
-- ---------------------------------------------------------------------------
ALTER TABLE data_breaches
  ADD COLUMN dpo_signed_off_by uuid,
  ADD COLUMN dpo_signed_off_at timestamptz,
  ADD COLUMN dpo_note text;

-- The person who DECLARED the breach cannot be the one who signs off that it was properly notified. The platform's
-- FIFTH maker-checker constraint (after billing adjustments, scheme versions, DSR countersign and consent versions) and
-- deliberately the same idiom, including both NULL escapes — see core/approval/two-person-rule.ts, which documents why
-- dropping them breaks every backfilled row.
ALTER TABLE data_breaches ADD CONSTRAINT ck_breach_signoff_ne_opener CHECK (
  dpo_signed_off_by IS NULL OR opened_by IS NULL OR dpo_signed_off_by <> opened_by
);
ALTER TABLE data_breaches ADD CONSTRAINT ck_breach_signoff_pair CHECK (
  (dpo_signed_off_by IS NULL) = (dpo_signed_off_at IS NULL)
);

-- ---------------------------------------------------------------------------
-- `affected_data` WAS CATEGORIES-ONLY BY CONVENTION. NOW BY CONSTRAINT.
-- ---------------------------------------------------------------------------
-- The column's comment says "categories only, e.g. 'phone,email' — NO raw PII", and nothing enforced it. This is the one
-- screen on the platform where pasting raw PII would be most damaging: a breach register is read by regulators, shared
-- with tenants, and exported — and the natural thing for somebody documenting a leak at 22:40 is to paste the affected
-- values.
--
-- The check is deliberately narrow and shape-based rather than clever: no '@' (an email address), and no run of six or
-- more digits (a phone number, an Aadhaar fragment, an account number). "phone, email, session_token" passes; a pasted
-- +919812345210 does not. NOT VALID for the same reason as 0108's channel checks — this runs on a founder's staging box
-- and a validating scan that aborts the migration over one legacy row helps nobody.
ALTER TABLE data_breaches ADD CONSTRAINT ck_breach_affected_data_categories CHECK (
  affected_data !~ '@' AND affected_data !~ '[0-9]{6,}'
) NOT VALID;

-- ---------------------------------------------------------------------------
-- THE GRANT THE README CLAIMED AND THE DATABASE DID NOT
-- ---------------------------------------------------------------------------
-- `compliance-ops`'s own README says `data_breaches` is "operated ONLY by kv_admin". 0034 created the table with no
-- bespoke grant, so it inherited `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE TO kv_app` from 0014 — the
-- tenant-facing role has always been able to write to the breach register. Nothing does, but "nothing does" is a fact
-- about today's code and the README described it as a fact about the database. Making the two agree:
REVOKE ALL ON data_breaches FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON data_breaches TO kv_admin;
GRANT SELECT ON data_breaches TO kv_readonly;

-- The register's own reads: newest first, and the 72-hour window needs detection times.
CREATE INDEX idx_breaches_open_clock ON data_breaches (detected_at DESC)
  WHERE status IN ('open', 'contained') AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- `data_export_jobs` — THE STATUSES WERE A COMMENT
-- ---------------------------------------------------------------------------
-- 0015 documents 'queued|running|completed|failed|expired' and 'tenant_full_export|user_dpdp_export|tenant_offboard'
-- in comments; only `approval_status` (added by 0034) ever had a CHECK. A typo in `status` therefore produces a job the
-- runnable-partial-index silently never picks up — a queued export that waits for ever, which on a DPDP portability
-- request is a statutory deadline missed by a spelling mistake.
ALTER TABLE data_export_jobs ADD CONSTRAINT ck_export_job_status CHECK (
  status IN ('queued', 'running', 'completed', 'failed', 'expired')
) NOT VALID;
ALTER TABLE data_export_jobs ADD CONSTRAINT ck_export_job_kind CHECK (
  job_kind IN ('tenant_full_export', 'user_dpdp_export', 'tenant_offboard', 'regulator_export')
) NOT VALID;

-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT ADDED
-- ---------------------------------------------------------------------------
--   • NO WATERMARK COLUMN. W045 and W018 both promise "every download watermarked per user". A column on the JOB cannot
--     carry that — a watermark is a property of a DOWNLOAD, and one job may be fetched many times. What this wave does
--     instead is put the mark IN the file: every receipted export now carries a preamble naming the receipt id, the
--     requester and the generation time, so the artefact itself says who pulled it. A per-download table is the right
--     answer for the ASYNC job path and is named as ADMIN-5c debt rather than created empty.
--   • NO SIGNING KEY, AND THEREFORE NO SIGNED REGULATOR EXPORT (W018). The screen promises SHA-256 signed exports with a
--     manifest verifiable at a public URL. This wave adds the DIGEST — the receipt now records a content hash, which the
--     law has promised on five surfaces since ADMIN-1d and never carried — but a digest is not a signature. Signing
--     needs a private key, a rotation policy and a public verification endpoint, all of which are founder-physical
--     decisions like the Razorpay keys and the DLT ids. Named, with an owner, rather than approximated: an export that
--     looks signed and is not is worse than one that admits it is only checksummed.
