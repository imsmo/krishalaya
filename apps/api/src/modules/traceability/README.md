# traceability (PRD §16.3) — farm-to-fork QR

A traceable produce lot carries a public QR; the supply-chain journey is recorded as a tamper-evident
hash chain; a consumer scans the QR (no login) and sees the provenance. Money-free. Gated by the
`traceability` feature flag (default **OFF**).

## What it owns

- **Trace lots** (`trace_lots`, tenant-scoped) — a lot tied to a listing, owned by a farmer, with declared
  inputs + certificate refs. `qr_token` is a 32-char unguessable **public capability**; `blockchain_anchor` is
  the Phase-2 tamper anchor (set to the chain head by the anchor job).
- **Trace events** (`trace_events`, PARTITIONED by `created_at`, append-only) — the journey
  (`harvested → listed → sold → packed → picked → in_transit → delivered`, + `recalled`). Each event is
  **hash-chained**: `event_hash = sha256(prevHash ‖ lotId ‖ eventCode ‖ meta)`, genesis chaining off the lot id.
  Tampering any link breaks every subsequent hash — verifiable provenance.

## Flows

- **Read provenance is universal.** The public scan needs **no role and no login at all** — any authenticated
  role *and* anonymous consumers can read a lot's farm-to-fork journey from its QR. Traceability is **not**
  "farmer + admin only"; only *authoring* is gated.
- **Author** (`trace.manage`): `create` a lot (Idempotency-Key; seeds a genesis event) and `append` journey
  events (each chained off the previous hash under a `FOR UPDATE` lock on the lot so the chain head is stable).
  Authoring is least-privilege (§4 / Law 6): held only by roles that physically own/produce a saleable lot —
  **farmer, pashupalak, dairy_farmer, vyapari, organic_store, pharma_store, fpo_coordinator** (+ `tenant_admin`).
  Buyers/handlers (customer, delivery_partner, vet, banker, ambassador, …) cannot fabricate provenance; the
  in-transit/delivered legs are intended to arrive from the deferred logistics-outbox fanout, not manual entry.
- **Public scan** (NO auth): `GET /v1/traceability/scan/:qrToken` returns a curated provenance projection via
  the **`SECURITY DEFINER` `trace_scan()` function** (migration 0028) — the single controlled RLS-bypass path.
  It returns only `qrToken / listingId / declaredInputs / certificateIds / anchored / events[]` — **never**
  `tenant_id`, the farmer's user id / phone, or any PII. Flag-gated (404 when off), token-format validated.
- **Anchor job** (worker, BYPASSRLS) stamps each un-anchored lot's `blockchain_anchor` with its chain head.

## Threats considered (§4)

- **Tenant isolation / RLS** — `trace_lots` + `trace_events` are RLS-protected; `tenant_id` binds every
  authenticated query. The public scan can't read tables directly (RLS hides everything with no tenant context)
  — it goes only through `trace_scan()`, which is `REVOKE`d from PUBLIC and `GRANT EXECUTE`d to `kv_app`.
- **Public endpoint** — the capability is the unguessable token (no enumeration; anchored-regex format check);
  the projection is fixed and **non-PII** (no tenant id, no user id/phone). Flag-gated, fail-closed.
- **No IDOR** — authenticated reads are owner-or-`trace.manage` (404 for a stranger). Authoring is
  `trace.manage`-only.
- **Integrity** — append-only hash chain makes the journey tamper-evident; the anchor pins the chain head.
- **Scale** — events list is keyset (never OFFSET); event queries bound the lot so PG prunes partitions (Law 8).

## Deferred (schema present, not built)

Auto-population of journey events from `orders`/`logistics` outbox events (those payloads don't yet carry
`listing_id`; the `appendForListing()` hook is ready for when they do); on-chain anchoring (the local chain-head
anchor is wired); recall/withdrawal workflow.

## Tests

`__tests__/traceability-domain.spec.ts` (hash chain determinism + tamper detection, lot lifecycle),
`trace-lot.service.spec.ts` (create authz + genesis, chained append, 404 IDOR, idempotent fanout hook),
`tenant-isolation.spec.ts` (CI gate: tenant binding, FOR UPDATE, keyset, public scan routes through
`trace_scan()` not a raw read), `traceability.integration.spec.ts` (real Postgres + 0028: create → chained
journey → public scan returns no PII → unknown-token 404 → cross-tenant RLS denial; runs when `DATABASE_URL` is set).


## PC-56 STORE-5b (2026-10-17) — supersedes the claims above where they disagree
- **The public read is `trace_scan_v3`** (migration 0219): the organisation (display name + slug), the product line, the village + district of
  the parcel's region (never a coordinate), every event's hash and hash VERSION, allow-listed meta, the seal, the lot's certificates. A lot whose
  organisation is not live answers `{live:false, wasLive}` → `TRACE_NO_LONGER_PUBLISHED` (was live) or `TRACE_SCAN_NOT_FOUND` (never live).
- **Hash version 2** (`domain/trace-chain.ts`): sha256(prev|lot|code|canonical(meta)|createdAt µs UTC); the INSERT carries `created_at`. v1 rows
  keep the old formula and verify as `unverifiable_v1`. `GET /v1/traceability/scan/:qrToken/verify` recomputes forward (a break breaks every
  hash after it).
- **The anchor job never ran (survey C-3).** It is now `TraceAnchorClock` (`jobs/anchor-hashes.job.ts`, cadence `trace-anchor`, daily): a DAILY
  PLATFORM SEAL per organisation with `traceability` ON — re-sealed whenever the head moves (`anchored_at`, `anchored_event_count`), audited
  `trace.lot_sealed`. No public ledger, no on-chain anchoring (refused by name).
- **The record export** `POST /v1/traceability/scan/:qrToken/export` (signed in, keyed) → `traceability.lot_record` on the export plane
  (requester-only, CSV, the plane's receipt — not signed).
- **Certificates of a lot** live in `trace_lot_certificates` (0219); `trace_lots.certificate_ids` is kept and no longer read.
