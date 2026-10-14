-- ==================================================================================================================
-- MIGRATION 0206 — PC-56 HOTFIX-4 · STOREFRONT MONEY AND PRIVACY TRUTH (no canon screens) · A4 the webhook's context from the PAYMENT ROW
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0006 is applied; nothing here edits it: the `payments` table, its columns,
-- its RLS, its grants and its existing indexes — uq_payments_gwid included — are left exactly as they are. This file only ADDS one index
-- and one SECURITY DEFINER lookup.)
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey F-4b): `PaymentService.handleWebhook` took the TENANT from `payload.payment.entity.notes.tenant_id` and refused
-- "webhook missing tenant/order context" without it. Those notes are written on the GATEWAY ORDER (`createIntent` → Razorpay
-- `POST /v1/orders {notes}`); the storefront's checkout sheet passes no notes of its own (apps/web-storefront PayButton), and whether Razorpay
-- copies an order's notes onto the payment entity it sends in `payment.captured` is UNPROVEN here (no test-mode keys on this Mac). If it
-- does not, EVERY capture was refused: money taken at the gateway, never booked. And the lookup it then ran,
-- `SELECT … FROM payments WHERE tenant_id=$1 AND gateway_order_id=$2`, had no index on gateway_order_id (0006 indexes gateway_payment_id,
-- user_id and the open statuses only) — a scan of the tenant's payments on the money path (Law 11).
--
-- WHAT IS TRUE NOW:
--   206.1  idx_payments_gateway_order — (provider_code, gateway_order_id) WHERE gateway_order_id IS NOT NULL. NOT unique: 0006 never
--          promised it, the sandbox gateway derives its id from the payment id, and a uniqueness failure on an existing database would stop
--          this migration on data nobody can repair from here; the lookup below refuses an ambiguous id instead (no row → "not ours").
--   206.2  payment_context_for_gateway_order(provider, gateway_order_id) — SECURITY DEFINER, because the webhook is unauthenticated and the
--          tenant is exactly what it does not know yet (0193 api_key_for_prefix precedent: "definer rights because the tenant is not known
--          until the key is"). Returns (tenant_id, payment_id) of the ONE payment carrying that gateway order for that provider — and NOTHING
--          when none or more than one does. No amount, no user, no status, no PII: the caller then opens the tenant's transaction (RLS on)
--          and locks the row by id there (`getByGatewayOrderForUpdate`), exactly as before. Notes become a cross-check only (a mismatch is
--          refused and logged by the service, never trusted).
--
-- RLS / GRANTS DECISION: no table is created; `payments` keeps its 0006 RLS policies and grants untouched (the index changes neither).
-- The function is owned by the migration owner, EXECUTE revoked from PUBLIC and granted to kv_app only (the API pool the webhook runs on).
-- Partition pass: `payments` is not partitioned (0006: a plain table) — the index is a plain index.
--
-- LAW 9: this file touches no ledger table and no wallet function. It is on the PAYMENT path (the webhook's tenant resolution) and is listed
-- in the HOTFIX-4 report §9 for the founder's review before production.
--
-- REVERSAL (documented, not automatic): `DROP FUNCTION payment_context_for_gateway_order(varchar, varchar); DROP INDEX
-- idx_payments_gateway_order;` — the service then cannot resolve a notes-less webhook (it refuses it, as before this file).
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 206.1  the index the webhook's lookup needs
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payments_gateway_order ON payments (provider_code, gateway_order_id) WHERE gateway_order_id IS NOT NULL;

-- ------------------------------------------------------------------------------------------------------------------
-- 206.2  the one cross-tenant question the webhook must ask: whose payment is this gateway order?
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION payment_context_for_gateway_order(p_provider varchar, p_gateway_order_id varchar)
RETURNS TABLE (tenant_id uuid, payment_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH hits AS (
    SELECT p.tenant_id, p.id
      FROM payments p
     WHERE p.provider_code = p_provider AND p.gateway_order_id = p_gateway_order_id AND p.deleted_at IS NULL
       AND p_gateway_order_id IS NOT NULL AND length(p_gateway_order_id) BETWEEN 1 AND 120
     LIMIT 2
  )
  SELECT h.tenant_id, h.id FROM hits h WHERE (SELECT count(*) FROM hits) = 1
$$;
REVOKE ALL ON FUNCTION payment_context_for_gateway_order(varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_context_for_gateway_order(varchar, varchar) TO kv_app;
COMMENT ON FUNCTION payment_context_for_gateway_order(varchar, varchar) IS
  'PC-56 HOTFIX-4 (0206, A4): the payment webhook''s one lookup — (provider, gateway order id) → the tenant and payment id of the ONE '
  'payment carrying it; nothing when none or several do. Definer rights because the unauthenticated webhook does not know the tenant until '
  'the payment row says it. No amount, user, status or PII. The caller locks the row by id inside the tenant''s RLS transaction.';
