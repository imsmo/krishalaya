# stream-processor

High-throughput Kafka stream tier for Krishalaya. Moves heavy fan-out work OFF the write path: instead of the
in-process relay doing search indexing / notifications / projections synchronously in the outbox tx, this
service tails the outbox to Kafka and processes it asynchronously, at scale, decoupled and independently
scalable. Phase 2 (the in-process handlers in `apps/api` remain the source of truth until this is rolled on).

## Pipeline (end-to-end, nothing faked)

```
outbox_events (pg, append-only)
   │  OutboxTailer: keyset read from a per-shard checkpoint (never mutates status → no contention with the
   │  in-process dispatcher), publish each row to its ingest topic, keyed by tenant_id
   ▼
Kafka  kv.orders / kv.auctions / kv.dairy / kv.catalogue / kv.payments / kv.views / kv.events
   │  one consumer GROUP per concern (independent — a slow analytics consumer never blocks search)
   ▼
consumers ──▶ search_indexer      → OpenSearch upsert/delete by id
          ──▶ notification_fanout → external notifier (HTTP, dedups on idempotency-key)
          ──▶ projection_builder  → stream_read_projections (CQRS read-models, monotonic upsert)
          ──▶ fraud_signal        → score → produce kv.fraud.signals (advisory; human review, never auto-action)
          ──▶ view_counter        → UPSERT listing_view_counts (P1-15; counted views read-model, kv.views only)
          ──▶ analytics_etl       → flatten → produce kv.analytics.events (analytics-pipeline lands it)
   │  poison/exhausted → stream_dead_letters + kv.dlq
```

Idempotency: Kafka is at-least-once, so every `(consumer, event_id)` is recorded in `stream_processed_events`;
a redelivered message is a no-op. Side effects are themselves idempotent (upsert-by-id, notifier idempotency
key, monotonic projection), so a crash between effect and record is safe.

## Threats considered (§4, adapted for an infra stream tier)

- **Tenant isolation.** Every event carries `tenant_id`; it's the Kafka partition key (per-tenant ordering, no
  cross-tenant reorder), it's written on every `stream_processed_events`/`stream_read_projections`/DLQ row, and
  tenant-scoped writes run through `withTenantTx` so RLS holds. The processor connects as the **kv_relay
  BYPASSRLS** role (cross-tenant infra, like the relay) — RLS is defense-in-depth, not the only guard.
- **No PII on derived streams.** The search doc, notification payload, projection doc, fraud signal, and
  analytics fact are all NON-PII by construction (ids + dimensions + **string** minor-unit amounts, Law 2);
  analytics-etl additionally drops any obviously-PII key defensively.
- **Poison-message containment.** A bad/oversized/unparseable message can't crash a consumer or block a
  partition (head-of-line blocking): permanent errors → DLQ immediately, transient errors → bounded
  exponential-backoff retry then DLQ. The offset always commits.
- **No automated money/account action.** `fraud_signal` only EMITS an advisory signal for the human review
  queue (Law 11: enforcement is server-authoritative with a human in the loop). Money never moves here.
- **Bounded everything (§5).** Keyset tail (no OFFSET), capped tail batch, per-statement timeouts, bounded
  consumer concurrency, capped DLQ (one row per `(consumer,event_id)`).
- **Degrade, never die (Law 12).** OpenSearch/notifier degrade to no-op when unconfigured; a Redis/broker/DB
  blip rolls back the tail tick and re-publishes next time (consumers dedup). Fail-closed config: in prod the
  service refuses to start without `KAFKA_BROKERS` + `DATABASE_URL`.

## What's real here vs. owned elsewhere (honest boundaries)
- **Real:** the tailer, the Kafka producer/consumer runtime, idempotency, retry/DLQ, the 6 consumers, the
  OpenSearch writer, the notifier client, the CQRS projections, fraud scoring (pure, unit-tested).
- **Owned by the consuming side (flagged, not faked):** the **analytics-pipeline** (ClickHouse + dbt) ingests
  `kv.analytics.events`; the **ai-governance** review queue / admin risk tooling consumes `kv.fraud.signals`;
  rich cross-event velocity/device features live in the **feature-store** (`apps/ai-services`). This service's
  contract ends at producing those topics.

## Run / test
```bash
npm run typecheck
npm test            # pure core: topics, envelope, retry policy, fraud scoring (no Kafka/pg I/O)
npm run build && npm start
```
The live broker/DB run in the cluster (not the offline sandbox); migration `0031_stream_processing.sql` provides
the checkpoint + dedup + DLQ + projection tables. Config: `.env.example`.
