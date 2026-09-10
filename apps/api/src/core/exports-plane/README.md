# core/exports-plane — the tenant EXPORT PLANE (PC-56 TENANT-6e-2 · W2553 / W2554)

What `core/bulk` is for files coming IN, this is for files going OUT. Generic, tenant-safe machinery behind every
"Export" button on the tenant console: a queue with a live **position** and an honest **ETA**, a worker that streams
the file and computes its **sha256** and **row count**, an audit-stamped **receipt** (file name, row count, sha256,
generated-at, requester, notes), a **15-minute signed link**, and a **log of every fetch** — refused ones included.
**No business logic lives here**: what is in a file is a registered `DatasetProducer`'s business. Dairy's
`dairy.insights` (W172) is the first. Gated by the `tenant_exports` flag (default OFF).

## Flow

1. A dataset's own route enqueues — `POST /v1/dairy/insights/export` (permission `dairy.manage`, module flag `dairy`,
   `Idempotency-Key` required). `ExportPlaneService.enqueue` validates the params with the PRODUCER's strict zod schema,
   stores them canonically with their sha256, and writes a `tenant_export_jobs` row (`queued`) + audit + outbox in one
   transaction. The SAME request (tenant, dataset, params-hash, requester) while the first is still open returns the
   first job — `uq_texp_open_request` in 0169 makes it unrepresentable otherwise. Cap: 5 open jobs per requester.
2. `GET /v1/exports/:id` — W2553 while `queued` (`standing.position` 1-based across the ONE cross-tenant FIFO;
   `standing.eta` = `no_history` until an export has ever finished, else `(ahead+1) × median(last 20 runs)` ceiled,
   labelled `estimate`), W2554 from `ready` on (the receipt, the fetch counts, `download.kind`). Position and the
   median are computed by `export_queue_standing()` — a SECURITY DEFINER function owned by `kv_relay` that returns three
   numbers and nothing else, so the request tier never reads another tenant's row.
3. **Worker** — `ExportPlaneCadenceJob` (`tenant-exports`, every 10 s, REGISTERED in `ExportsPlaneModule.onModuleInit`)
   → `ExportWorker.tick(relayPool)`: release stale `running` claims (> 1 h) → expire `ready` files past retention →
   peek the FIFO head → `generate`: claim (`FOR UPDATE SKIP LOCKED`, `attempts++`, third claim fails it) → producer
   streams rows into `CsvSink` (temp file, sha256 + bytes + DATA rows computed on the way, RFC 4180 CRLF, UTF-8 BOM,
   formula cells neutralised) → `ObjectStore.putObjectStream` → `ready` with the receipt + `exports.export_ready`
   outbox event (→ notification `exports.export_ready`, inapp + push, en/hi/gu, requester as recipient) in ONE
   transaction. Failures are CODES: `unknown_dataset | dataset_disabled | money_shape_missing | producer_failed |
   storage_failed | too_many_attempts`.
4. `POST /v1/exports/:id/link` mints the HMAC link (`jti`, job, tenant, minter, 15-min expiry; key HKDF-derived from
   `JWT_ACCESS_SECRET`) and audits the mint with its `jti`. Refused unless `ready` and within retention.
5. `GET /v1/exports/:id/download?token=…` — the link BESIDE the session (the link authorises the file, the session says
   who). Verify signature → expiry → binding → job state; **every refusal is a `tenant_export_downloads` row before the
   403**; a served fetch is streamed with the digest re-computed over the bytes sent and logged (`served`/`aborted`,
   `digest_matched`). The console proxies this route so the browser never needs the API bearer.
6. Retention: `EXPORT_FILE_RETENTION_DAYS = 7` (a constant, with its reason in the entity); the sweep flips `ready →
   expired`; the receipt stays and the page says the file is gone. The bytes are removed by the bucket's lifecycle rule.

## Extension point

```ts
onModuleInit() { this.datasets.register(this.myDataset); }   // DatasetProducer: code, permission, params (zod strict), datasetName(), produce()
```

`produce()` is a READ that returns `{ header, rows: AsyncIterable, notes, fileSuffix }` or a coded refusal. A producer
that refuses a figure MUST say so in `notes` — a refused figure is never a row (a spreadsheet missing a column invites
somebody to compute it from the wrong ones). `datasetName()` reads `ui_messages` (`exports.dataset.<code>`, seed 0017)
so the notice never carries a platform code inside vernacular copy.

## Threats considered (§4)

- **Tenant isolation / RLS** — both tables ENABLED + FORCED; `tenant_id` in every tenant query; the worker's tenant
  half runs through the unit of work as `kv_app`; the relay pool is SELECT-only on both tables (0169 revokes); the
  standing function returns counts only. Proven live: the neighbour's job is 404, its fetch log empty from there.
- **No IDOR / enumeration** — a job the tenant does not own is 404; a member without the dataset's permission is 403
  (a member of the tenant enumerates nothing by asking).
- **Link forgery / replay** — HMAC-SHA256 over the payload, length-checked constant-time compare, `v` pinned; signature
  is checked BEFORE any payload field decides anything (not even which refusal to log); a link is bound to one job in
  one tenant and dies AT the 15th minute; the token never appears in rendered HTML (mint → redirect → download).
- **Every fetch logged** — refused attempts too, with the `jti` when it could be read; append-only by grant.
- **Write amplification / DoS** — 5 open jobs per requester; one job per worker tick; bounded peeks; file cap 4 GB
  (S3 single-PUT) named on the receipt; stale claims released, third claim fails.
- **Integrity** — the receipt's sha256 is computed over the bytes as stored (BOM included) and re-computed over the
  bytes served; `ck_texp_ready` refuses a `ready` row without its receipt; `version` optimistic lock; a lost update
  throws (`ExportJobUpdateLostError`), never vanishes.
- **CSV injection** — `=`, `@`, and sign-then-non-digit cells are prefixed; negative numbers left alone.
- **Fail closed** — plane flag unreadable ⇒ refused; key derivation refuses a short secret at boot.

## Deferred / named

Multipart upload beyond 4 GB; a crash between streaming the last byte and writing the `served` row loses that row;
an orphaned object when a succeed is lost to a stale-claim release; removal of expired bytes is the bucket's lifecycle
rule (infra), not this code; a second dataset (GSTR-1, logistics insights) stays synchronous and is a wave of its own.

## Tests

`__tests__/export-plane.spec.ts` (state machine, entity invariants, position/ETA, link mint/verify, CSV sink, canonical
params, projection); `modules/dairy/__tests__/tenant6e2-export.spec.ts` (the dairy rows, the notice guard);
`__tests__/export-plane.integration.spec.ts` (real Postgres: enqueue → tick → ready → sha256 recomputed over stored
bytes → link → served with digest → three refusals logged → expiry → stale claim → storage failure → RLS → the real
dairy dataset with its flag off and on).
