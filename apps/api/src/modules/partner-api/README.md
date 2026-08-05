# partner-api (the partner machine-to-machine realm · PC-55 A10) — **DARK**

A bank, NBFC or insurer calls `/v1/partner-api/*` from their own systems, authenticated by an **API key** instead of a
tenant JWT, and sees **only their own book** — across every tenant they serve. Read-only. Behind the `partner_api`
feature flag, which ships **OFF** (migration 0090), so until the S2 review enables it every route answers **404**.

Security review doc: `PC55_A10_PARTNER_API_SECURITY_NOTES.md` (the founder's `Development_Program` folder, outside this repo).

## Why this exists
Until now "partner" was not an identity. Every partner-facing surface (PC-2A/2B/2C, W54-8/W54-9) is a **tenant user**
holding `insurance.manage`/`loan.manage` who *passes* a `partnerId` in the request. That works for a console operated
inside a tenant and is useless for machine integration. `partner_api_keys` is the missing identity: **the key names
the partner, and nothing else in the request is trusted to.**

## Routes (`/v1/partner-api`, flag `partner_api`, per-route `@PartnerScope`)
| Route | Scope | Returns |
|---|---|---|
| `GET /me` | `partner:identity:read` | the key's own partner id, scopes, quota — proves a credential without reading any farmer's record |
| `GET /lending/loans` | `lending:book:read` | this partner's servicing book (cursor page) |
| `GET /lending/loans/:id/repayments` | `lending:book:read` | one loan's schedule + collections |
| `GET /insurance/policies` | `insurance:book:read` | policies written on this insurer's products |

No mutations exist here **by construction**: the first partner realm should be incapable of changing a farmer's loan
or policy. Writes are a later, separately reviewed wave (maker-checker + idempotency of their own).

## How isolation actually works (not by a WHERE clause)
A partner's book spans **tenants**, so tenant RLS (`app.tenant_id`) is the wrong axis. Migration 0090 adds the other
axis as database physics:

- role **`kv_partner`** — `SELECT` on exactly `loans`, `loan_repayments`, `insurance_policies`. Nothing else.
- `kv_app` is a **non-inheriting** member (`WITH INHERIT FALSE`), so the app holds those privileges only inside an
  explicit `SET LOCAL ROLE kv_partner` block that ends with the transaction (the lesson migration 0076 learned).
- **`current_partner_id()`** + RLS policies `TO kv_partner` (SELECT-only, NULL-guarded). Forget to set the partner and
  you see **zero** rows, not everything. Setting `app.partner_id` can never widen what `kv_app` sees, because the
  policies do not apply to `kv_app` at all.
- `insurance_policies` ownership is proven by **`partner_owns_insurance_policy()`** (`SECURITY DEFINER`), so no insurer
  ever gets a route to another insurer's `insurance_products.premium_calc` — their pricing model.

The `partner_id` predicates in the repository SQL are **defence in depth** (and index help). Delete them and the
queries still cannot leak. That is the property worth having.

## The guard (`guards/partner-key.guard.ts`)
Shape → existence → constant-time secret → usability → scope → per-key quota, each failing closed.
- Steps 1–4 give the **same opaque 401**: distinguishing "unknown key" from "revoked key" is an existence oracle.
  Wrong scope is different — that caller is authenticated, so it says which scope is missing.
- A route that forgets `@PartnerScope` is **refused**, not opened.
- Quota is a fixed hourly window per **key** (`rate_limit_per_hour`); the platform IP limiter is the backstop.
  On a cache outage the quota falls **open** (a partner isn't locked out by our Redis) — bounded by the IP limiter and
  the hard 200-row page clamp.
- `last_used_at` is stamped at most **once a minute per key**: a read API must not become a write API.
- The partner is attached to the **request** (`req.partner`, read via `@CurrentPartner()`), never to the tenant
  AsyncLocalStorage context — a partner call has no tenant, and writing a fake one would be a lie the whole stack
  would believe.

## Keys
`kv_pk_<env>_<handle>.<secret>` — prefix stored plainly (unique index, the lookup handle, safe to log); secret is 32
bytes of CSPRNG entropy and only its **SHA-256** is stored. SHA-256 (not bcrypt) is deliberate: 256 bits of randomness
has no dictionary to attack, while a work factor would be paid on every call — and the compare is constant-time.
There is **no wildcard scope**: a key can never become god-mode.

Minting is a **human-run script** — `node db/scripts/mint-partner-key.js --partner <id|code> --name "…" --scopes …`
(`--list`, `--revoke <prefix>`). 0090 revoked `INSERT` on `partner_api_keys` from `kv_app` **and** `kv_relay`: no
request handler in this platform can create a credential. Revocation is permanent.

## Webhooks out to partners
`partner_webhook_endpoints` is the partner axis of the tenant table, and reuses the **entire** proven rail: the same
HMAC signer (`X-KV-Signature: t=…,v1=…`), the same AES-256-GCM secret at rest, the same partitioned
`webhook_deliveries`, the same worker with its backoff/park policy. The one seam is the view
`webhook_delivery_targets` (tenant `UNION ALL` partner), which `apps/worker/jobs/webhook-delivery.job` now joins.

`PartnerWebhookFanoutHandler` asks the two questions in this order: **who owns this aggregate?** (resolved from
`loans.partner_id`, or policy → product → partner — *never* from the event payload) then **does that partner subscribe?**
Ownership unresolvable ⇒ nothing is sent. Deliveries keep the **originating tenant_id**, so the platform can always
answer "which of my events went to which partner?".

## Known limits (honest, not hidden)
- Endpoints (like keys) are provisioned by ops during onboarding — there is no partner-facing write surface yet,
  because there is no partner *user* identity yet (only machine keys). An admin-console screen is a later wave and must
  go through the audited `kv_admin` realm.
- `partner_api_keys.partner_id` references `financial_partners`. A logistics-partner realm adds a nullable sibling
  column + a CHECK (additive migration, not a rewrite).
- Cross-shard book reads scatter-gather per shard and merge on uuid-v7 order; at `SHARD_COUNT=1` this is one query.

## Tests
`__tests__/partner-api.spec.ts` (37) pins every claim above. Five mutations were run and each killed a spec: honouring
a `*` scope, treating a missing `@PartnerScope` as open, ignoring the resolved-owner mismatch in `deliverable()`,
disclosing the 401 reason, and an off-by-one quota. The SDK spec proves a partner call never attaches a user bearer
token (removing `anonymous: true` fails it).
