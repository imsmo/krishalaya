# 🌾 Krishalaya — The Operating System for Indian Agriculture
Multi-tenant agri-commerce SaaS. 28 modules · 24 roles · 12 languages · From Farm to Future.

## Monorepo Layout
| Path | What | Stack |
|---|---|---|
| apps/api | Core API — modular monolith, 31 business modules | NestJS + TS |
| apps/admin-api | GOD MODE — platform-owner plane (separate security realm: FIDO2, IP allowlist) | NestJS + TS |
| apps/wallet-service | THE ONLY writer of the money ledger (separate service from day 1) | NestJS + gRPC |
| apps/worker | Queue consumers: notifications, settlements, ingestion, ops jobs | NestJS + BullMQ/SQS |
| apps/outbox-relay | Publishes outbox_events → SQS/EventBridge/OpenSearch/webhooks | Node |
| apps/web-tenant | Tenant admin panel (incl. support-inbox, auditor, AI review) | Next.js |
| apps/web-admin | Super-admin (God-mode) panel | Next.js |
| apps/web-storefront | Public site + tenant storefronts + public trace QR pages (SEO) | Next.js |
| apps/web-partner | Bank/NBFC/insurer portal (loan queues, claims) | Next.js |
| apps/realtime-gateway | WebSocket fan-out — live auctions/bids/order-tracking, millions of concurrent sockets | Node + Redis pub/sub |
| apps/stream-processor | Kafka(MSK) consumers — search index, fan-out, ETL, fraud (Phase 2) | Node + Kafka |
| apps/mobile | Farmer/Buyer/Worker/Ambassador/Vyapari/Vet/MCC… role-switching app, offline-first | React Native + Expo |
| apps/ivr-ussd-gateway | Voice menus + *123# for feature phones (PRD signature channel) | Node |
| apps/whatsapp-bot | WhatsApp conversational commerce (Phase 2) | Node |
| apps/ai-services | Voice extraction, photo grading, price bands + ML training | Python FastAPI |
| apps/analytics-pipeline | Events → ClickHouse, dbt marts, sellable data products | Node + dbt |
| packages/* | contracts, design tokens, UI kits, i18n, SDK, test utils, lint configs | shared |
| db/ | migrations (baseline = ../Database_Architecture/full_platform), seeds, scripts, dba/ | SQL |
| infra/ | Terraform (AWS Mumbai+Hyderabad), gateway/WAF, Helm charts, Dockerfiles | IaC |
| ops/ | runbooks, alerts, dashboards, on-call, load tests, status page | — |
| security/ qa/ | threat model, DPIA, access reviews · test strategy, device matrix, UAT per role | — |

## Golden Paths
- New feature → copy the module blueprint (see CLAUDE.md), wire flag, ship dark.
- New DB change → db/migrations/NNNN_description.sql via PR.
- Local dev → `docker compose up` then `pnpm dev`.

## Scale Story (why this structure survives billions of operations)
Stateless apps (scale = add pods) · all heavy work in worker queues (scale =
add consumers) · money isolated in wallet-service (scale/harden independently)
· modules are extraction-ready microservices (move folder → new app, keep
contract) · DB pre-partitioned/sharded-ready (see Database_Architecture docs)
· country = a cell (re-deploy whole stack per region, Phase 4+).
