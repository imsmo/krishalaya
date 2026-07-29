-- 0076_relay_wallet_role_elevation.sql
-- FIX (DEV-32, found by a REAL live-boot execution of the pilot loop — a real apps/api process
-- against a real, fully-migrated Postgres, with the continuous outbox relay timer running exactly
-- as it does in every other environment, per S1/KV-BL-063 and DEV-03's own boot-proof): the SAME
-- class of bug 0065 fixed for kv_app, but for kv_relay.
--
-- The live outbox-relay timer (core/outbox/relay.runner.ts, core/outbox/outbox.dispatcher.ts)
-- executes every dispatched handler's transaction on a DEDICATED connection authenticated as the
-- kv_relay role (RELAY_DATABASE_URL — "MUST be the kv_relay BYPASSRLS role, never kv_app", per
-- env.validation.ts's own comment; this is deliberate, so the relay can see pending events ACROSS
-- every tenant, which kv_app's RLS-scoped connection cannot).
--
-- `OrderCompletedHandler` (apps/api/src/modules/payments/events/handlers/order-completed.handler.ts)
-- releases escrow by calling `InProcessWalletClient.post()`, which does `SET LOCAL ROLE kv_wallet`
-- on whatever connection it's handed (wallet.client.inprocess.ts) — that connection is the RELAY's
-- own kv_relay-authenticated one when the call originates from a relay-dispatched handler (as
-- opposed to a synchronous in-request wallet call, which runs on the kv_app-authenticated request
-- connection instead). 0065 only made kv_app a member of kv_wallet; kv_relay was never granted
-- membership. Reproduced live, independently, before writing this fix:
--     SET LOCAL ROLE kv_wallet;  -- as kv_relay -> "permission denied to set role \"kv_wallet\""
--
-- Net effect (confirmed, not assumed): in ANY real environment running the documented S1 relay
-- architecture (RELAY_DATABASE_URL = kv_relay), `orders.order_completed`'s escrow-release leg
-- ALWAYS fails — the order still completes (a different tx) but the seller's wallet is never
-- credited and the outbox event is quarantined `failed` forever (OutboxDispatcher swallows
-- per-event handler errors so the relay keeps ticking, but this one event never succeeds). This is
-- a genuine, previously-undiscovered P0 money-path defect: no prior batch's proof exercised a
-- MONEY-WRITING handler through the LIVE continuously-running relay's OWN kv_relay connection —
-- DEV-03's boot-proof used generic non-money outbox rows; unit/integration test fixtures construct
-- their own pg Pool authenticated as the DB owner/superuser (bypasses role checks entirely);
-- scripts/pilot-e2e's manual relay-tick.mjs was never actually re-run against the corrected 0065
-- role graph until this batch. Likely also blocks any OTHER relay-dispatched handler that writes
-- to the ledger (grep apps/api/src/modules/*/events/handlers for wallet-client callers if auditing
-- further — out of this migration's own narrow scope, which only fixes the grant).
--
-- Same fix shape as 0065 (never edit an applied migration — fix forward): make kv_relay a MEMBER
-- of kv_wallet too, so relay-dispatched handlers can transiently assume it exactly the way
-- request-scoped kv_app callers already can. Does not touch RLS, does not grant kv_relay anything
-- beyond the SAME already-narrow kv_wallet privilege set 0014/0065 established (SELECT/INSERT[/
-- UPDATE] on wallet_accounts/ledger_entries/ledger_transactions only) — the "only the wallet
-- writes money" invariant (Law 2) is unchanged; this only widens WHICH login roles may transiently
-- become the wallet writer, mirroring 0065's own reasoning exactly.
--
-- Idempotent: GRANT role membership is a no-op if already granted. kv_wallet + kv_relay both exist
-- (created before 0014/0018, which already grant privileges to both).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kv_wallet')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kv_relay') THEN
    EXECUTE 'GRANT kv_wallet TO kv_relay';
  END IF;
END $$;
