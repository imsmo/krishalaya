# ai-services

Internal AI inference tier for Krishalaya (FastAPI / Python). Four model endpoints — **voice→listing
extraction**, **photo grading**, **price bands**, **fraud signals** — called service-to-service by `apps/api`
/ `apps/worker` / `apps/stream-processor`. Every decision is **advisory** and is recorded to the
`ai_inferences` audit log; enforcement (publishing a listing, moving money, blocking an account) stays
server-authoritative with a human in the loop (Law 11).

## Endpoints (all service-to-service authed, advisory only)
| Endpoint | Model code | Returns |
|---|---|---|
| `POST /v1/price-bands` | `price_band` | P10/P50/P90 as **string minor units** (Law 2) + confidence |
| `POST /v1/voice-extraction` | `voice_listing_extract` | structured draft listing + confidence + needs_review |
| `POST /v1/photo-grading` | `photo_grading` | suggested grade (A/B/C/reject) + confidence + needs_review |
| `POST /v1/fraud-signals` | `fraud_score` | risk score 0–100 + explainable reasons + flagged |
| `GET /healthz`, `GET /metrics` | — | liveness + Prometheus metrics (no PII labels) |

Every model resolves its active row from the `ai_models` registry (lifecycle authoring is admin-api's job,
Law 11); a result below the model's `confidence_threshold` (or from an unregistered model) is flagged for the
ai-governance human review queue.

## Architecture
`common/` — `config` (fail-closed settings), `auth` (constant-time s2s bearer), `http` (FastAPI auth dependency
+ body-size guard), `redact` (pointer-only `input_ref` + PII scrub), `resilience` (timeout + retry + circuit
breaker), `telemetry` (JSON logs + metrics), `db` (asyncpg pool, lazy-imported), `model_registry`,
`inference_logger`. Each domain has pure logic (model math / scoring / parsing — unit-tested) behind a thin
FastAPI router that authenticates, runs the pure logic, records the inference, and returns the advisory result.

## Threats considered (§4, adapted for an internal Python inference tier)
- **Fail closed.** In production the service refuses to start without a strong `API_SHARED_SECRET` + an
  inference-log DB. Provider keys (LLM/STT) are optional — their absence degrades a path to needs_review, never
  an open/insecure state.
- **Service-to-service auth.** Every model endpoint requires a shared bearer, **constant-time** compared; a
  bad/missing secret raises 401 before any handler logic. No end-user tokens here — the trusted caller passes a
  **server-resolved** `tenant_id`.
- **Tenant isolation.** The caller's `tenant_id` is stamped on every `ai_inferences` row and set via
  `set_config('app.tenant_id', …)` so RLS holds; the service performs **no cross-tenant reads** of business data.
- **No PII in the audit log.** `input_ref` is reduced to ALLOW-LISTED pointer keys (`media_id`, `listing_id`,
  …); the raw transcript/audio/image is **never persisted or logged** (only pointers + structured output). A
  deep PII scrubber masks anything that slips through (phone/Aadhaar/PAN/email/JWT). Unit-tested.
- **Never trust the model.** LLM/CV output is normalised + validated (unknown keys dropped, types coerced,
  out-of-range values rejected) before use — a hallucinated field becomes `null`, not a bad listing.
- **Money correctness (Law 2).** Price bands are computed in **int minor units** via the nearest-rank
  percentile (float-free, matching market-intel `baseline-v1`) and crossed as strings — never floated.
- **Advisory only (Law 11).** No endpoint moves money or changes an account; outputs route to confirm-screens /
  the human review queue. Fraud flags are signals, not blocks.
- **Degrade, never die (Law 12).** External providers are wrapped in timeout + retry + circuit-breaker; on
  open-circuit/timeout the path returns confidence 0 / needs_review. Inference logging is best-effort (a log
  outage never fails the response). Request bodies are size-capped.

## What's real vs. owned elsewhere (honest boundaries)
- **Real here:** the four serving endpoints, the float-free price-band model, voice output normalisation +
  confidence, photo grade mapping, fraud scoring, the security/resilience/redaction core, inference logging to
  `ai_inferences`. All pure logic is unit-tested.
- **Boundaries (flagged, not faked):** the LLM (`call_llm`, Anthropic) + STT providers are real HTTP calls but
  run only when keyed (else degrade); the per-crop CV model + STT produce the scores/transcripts this tier
  consumes; model TRAINING pipelines (`training/`, `feature-store/`) and rich cross-event velocity/graph
  features are the feature-store's batch job. Model lifecycle WRITES are admin-api (Law 11).

## Run / test
```bash
python -m pip install -e .[dev]
python -m pytest          # pure logic: price bands, redaction, auth/config, voice, grading, fraud, breaker
uvicorn src.main:app --port 8000
```
In the offline sandbox (fastapi/pytest not installed) the suite runs under plain `python3` (all pure modules are
stdlib-only); `python3 -m py_compile` validates every file. Live serving needs the declared deps + a Postgres
with migration 0013 (`ai_models` / `ai_inferences`).
