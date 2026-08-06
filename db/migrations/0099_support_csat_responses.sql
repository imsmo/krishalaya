-- ============================================================================
-- MIGRATION 0099 — CSAT RESPONSE LEDGER + LEAD REVIEW (closes PC-56 ADMIN-2-Q1)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ADMIN-2 REPORTED THAT THE VERBATIM COLUMN HAD NOTHING BEHIND IT. That was true and it was the smaller half of the
-- problem. Verifying the write path for this wave turned up something worse:
--
--   support_tickets.csat_score (0012) is a SINGLE OVERWRITABLE COLUMN, and
--   apps/api/src/modules/support/domain/support-ticket.entity.ts:58 CLEARS IT ON REOPEN.
--
-- So a farmer rates their ticket 1, the desk reopens the ticket, and the rating is GONE — not archived, not superseded,
-- deleted. The worst rating on the platform is the one most likely to be followed by a reopen, which means the ratings
-- the desk most needs to learn from are the ones it systematically destroys. Every CSAT number ADMIN-2 put on screen was
-- computed over the survivors. No screen could have shown this; the column simply reads null.
--
-- THIS TABLE IS THEREFORE AN APPEND-ONLY LEDGER, not a comment field bolted onto the old design:
--   • ONE ROW PER RATING. A re-rating after a reopen is a NEW row. Nothing is ever overwritten and nothing is deleted,
--     so "how did this ticket's rating change after we reopened it?" becomes answerable — and it is one of the more
--     useful questions a support lead can ask.
--   • THE COMMENT LIVES HERE, with the LANGUAGE it was written in. A verbatim without its language cannot be routed to
--     somebody who can read it, and this platform's whole premise is that a farmer writes in their own language.
--   • rated_at IS RECORDED. ADMIN-2's CSAT screen had to caveat that its "When" column was really the resolution time
--     because no rating timestamp existed. Now it is the rating time.
--
-- support_tickets.csat_score IS KEPT AND KEPT CORRECT. Five call sites read it (the tenant repo's projection, the
-- oversight rollups, the macro CSAT join). Removing it would be a wide breaking change for no gain, so the write path
-- re-derives it from the ledger IN THE SAME TRANSACTION: it means "the latest rating", the ledger means "every rating".
-- A denormalised column that can disagree with its ledger is a bug waiting to happen, so the direction of derivation is
-- stated here and enforced in one place (SupportTicketService.submitCsat).
-- ============================================================================

CREATE TABLE support_csat_responses (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  ticket_id     uuid NOT NULL REFERENCES support_tickets(id),
  -- WHO rated. The requester by rule (the service refuses anybody else), recorded so a rating can be traced to a person
  -- when a lead follows one up — and so a ledger row is never anonymous hearsay about an agent.
  respondent_user_id uuid REFERENCES users(id),
  score         smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  -- THE VERBATIM. Nullable: a score with no words is the common case and must not be forced into an empty string,
  -- because '' and "they did not write anything" are different facts and only one of them is true here.
  comment       text CHECK (comment IS NULL OR length(btrim(comment)) >= 1),
  -- the language the comment was WRITTEN in, not the tenant's default. Null when there is no comment.
  comment_language varchar(8),
  -- WHEN the rating was given. Not the resolution time, which is what ADMIN-2's screen had to show instead.
  rated_at      timestamptz NOT NULL DEFAULT now(),
  -- the ticket's status at the moment of rating, copied: a 5 given on a resolved ticket and a 5 given on a reopened one
  -- are different signals, and the ticket's status will keep moving after this row is written.
  ticket_status varchar(24) NOT NULL,
  -- which agent was assigned when the rating landed. Copied for the same reason: reassignment later must not silently
  -- re-attribute somebody else's rating.
  rated_agent_user_id uuid REFERENCES users(id)
);
CALL add_std_columns('support_csat_responses');

-- A rating is not idempotent by (ticket, respondent) — that is the POINT of the ledger, since a re-rating after a reopen
-- is a new row. It IS deduped per rating occasion: one row per (ticket, respondent, ticket_status) stops a double-tap on
-- a flaky connection creating two identical ratings, while still allowing a genuine re-rating once the ticket has moved.
CREATE UNIQUE INDEX uq_csat_response_occasion ON support_csat_responses
  (ticket_id, respondent_user_id, ticket_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_csat_response_ticket ON support_csat_responses (tenant_id, ticket_id, rated_at DESC);
-- the desk lead's two questions: "what came in recently" and "what did people WRITE"
CREATE INDEX idx_csat_response_recent ON support_csat_responses (tenant_id, rated_at DESC);
CREATE INDEX idx_csat_response_verbatim ON support_csat_responses (tenant_id, rated_at DESC)
  WHERE comment IS NOT NULL AND deleted_at IS NULL;
-- a comment must carry the language it is written in, or it cannot be routed to somebody who can read it
ALTER TABLE support_csat_responses ADD CONSTRAINT ck_csat_comment_language CHECK (
  (comment IS NULL AND comment_language IS NULL) OR (comment IS NOT NULL AND comment_language IS NOT NULL)
);

-- ---------- the LEAD REVIEW of a rating ----------
-- The canon's W2121-25 flow is a lead working through low scores. Reviewing is a JUDGEMENT and judgements are
-- append-only for the same reason ratings are: "we looked at this and decided the agent was not at fault" must survive
-- the next person who disagrees, or the record becomes whatever the last editor thought.
CREATE TABLE support_csat_reviews (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  response_id   uuid NOT NULL REFERENCES support_csat_responses(id),
  -- platform-side reviewer (admin realm). NOT a tenant user: this is the platform's oversight of a tenant's desk.
  reviewer_admin_id uuid NOT NULL,
  -- what the reviewer CONCLUDED. A named verdict rather than free text alone, so "how many low scores were actually the
  -- agent's fault?" is answerable without reading four hundred paragraphs.
  verdict       varchar(24) NOT NULL CHECK (verdict IN (
                  'agent_at_fault',        -- the desk handled it badly
                  'process_at_fault',      -- the agent did what the process said; the process is wrong
                  'product_at_fault',      -- nothing support could have done; the product failed
                  'outside_our_control',   -- a provider, a bank, the weather
                  'rating_mistaken',       -- the farmer rated the wrong thing (recorded, never used to delete a rating)
                  'needs_more_info')),
  -- the finding, in words. Mandatory: a verdict with no reasoning is an opinion nobody can check.
  finding       text NOT NULL CHECK (length(btrim(finding)) >= 10),
  -- did this review lead to coaching? Set when a coaching record is created FROM the review (0100), never by hand, so
  -- the two cannot disagree about whether anybody followed up.
  coaching_id   uuid,
  reviewed_at   timestamptz NOT NULL DEFAULT now()
);
CALL add_std_columns('support_csat_reviews');
-- ONE OPEN REVIEW PER RATING. Not one review ever: a rating can be revisited, and the ledger keeps both. But two
-- reviewers must not be able to file simultaneous first verdicts on the same rating.
CREATE UNIQUE INDEX uq_csat_review_verdict ON support_csat_reviews
  (response_id, reviewer_admin_id, verdict) WHERE deleted_at IS NULL;
CREATE INDEX idx_csat_review_response ON support_csat_reviews (response_id, reviewed_at DESC);
CREATE INDEX idx_csat_review_recent ON support_csat_reviews (reviewed_at DESC);

-- ---------- RLS: the responses are TENANT data; the reviews are PLATFORM data ----------
-- This asymmetry is deliberate and worth stating. A rating belongs to the tenant whose ticket it is — their desk must
-- read their own CSAT. A platform reviewer's verdict about that tenant's desk does NOT belong to the tenant: a tenant
-- reading "we concluded your agent was at fault" turns an oversight record into a performance-management document the
-- platform never agreed to share. So support_csat_reviews carries no tenant_id and no tenant grant.
ALTER TABLE support_csat_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_csat_responses FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'support_csat_responses' AND policyname = 'p_tenant_support_csat_responses') THEN
    EXECUTE 'CREATE POLICY p_tenant_support_csat_responses ON support_csat_responses
               USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
               WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)';
  END IF;
END $$;

-- ---------- grants (the 0014/0018 default-privileges trap) --------------------------------------
-- Every new table silently arrives kv_app-INSERTable / kv_relay-writable / kv_readonly-readable, so revoke first.
-- RESPONSES: the tenant API writes them (a farmer rates their own ticket) and reads them; admin-api reads them for
-- oversight; the worker has no business in them.
REVOKE ALL ON support_csat_responses FROM kv_app, kv_relay;
GRANT SELECT, INSERT ON support_csat_responses TO kv_app;
GRANT SELECT ON support_csat_responses TO kv_admin;
GRANT SELECT ON support_csat_responses TO kv_readonly;
-- NO UPDATE, NO DELETE FOR ANYBODY. A rating is a thing a farmer said. The platform does not get to edit it, and
-- `rating_mistaken` exists as a review verdict precisely so that a wrong rating is ANNOTATED rather than corrected.

-- REVIEWS: admin-api only. The tenant API must not read them (see the RLS note above) and must not write them.
REVOKE ALL ON support_csat_reviews FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON support_csat_reviews TO kv_admin;   -- UPDATE only to stamp coaching_id
GRANT SELECT ON support_csat_reviews TO kv_readonly;

-- ---------- backfill: what already exists, without inventing what does not ----------
-- Every ticket that currently carries a csat_score gets ONE ledger row, so the new screens are not empty on day one and
-- the two representations agree from the first minute.
--
-- WHAT THE BACKFILL DOES NOT DO: invent a rated_at. There has never been one. `resolved_at` is used where it exists
-- (the rating cannot have preceded the resolution — submitCsat requires a closable status) and the ticket's created_at
-- otherwise, and EVERY backfilled row is flagged so no screen can present a derived timestamp as a recorded one. A
-- backfill that quietly fabricated timestamps would make the ledger's own history untrustworthy at exactly the moment
-- somebody first relies on it.
ALTER TABLE support_csat_responses ADD COLUMN rated_at_is_estimated boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN support_csat_responses.rated_at_is_estimated IS
  'True for rows created by 0099''s backfill, where no rating timestamp was ever recorded and rated_at is the ticket''s resolution (or creation) time. Screens must say so rather than presenting it as the moment the farmer rated.';

INSERT INTO support_csat_responses
  (tenant_id, ticket_id, respondent_user_id, score, comment, comment_language, rated_at, ticket_status,
   rated_agent_user_id, rated_at_is_estimated)
SELECT t.tenant_id, t.id, t.requester_user_id, t.csat_score,
       NULL, NULL,                                    -- there has never been a comment field; none is invented
       COALESCE(t.resolved_at, t.created_at),
       t.status, t.assignee_user_id, true
FROM support_tickets t
WHERE t.csat_score IS NOT NULL AND t.deleted_at IS NULL;
