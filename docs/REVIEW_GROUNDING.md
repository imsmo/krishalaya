# Krishalaya — Review Grounding (memory anchor)

Purpose: single source of truth for what the product IS and what the current
build state is, so every subsequent piece of work is built to the same bar —
"world's largest SaaS agri platform: millions of real users, billions of
operations, global." Written after a full re-review of PRD v4, the database,
the source monorepo, the Phase-1 screens, and the marketing website.

## 1. Product (PRD v4 — Krishalaya_PRD_v4.docx)
- 62 sections, 833 headings, 231 tables. Vision built from Junagadh, Gujarat;
  engineered for global scale; anchored in farmer dignity.
- **24 stakeholder roles** (farmer, buyer/consumer, vyapari, worker, sardar,
  ambassador, FPO coordinator, tenant admin/staff, support, auditor, AI ops
  officer, delivery, pharma/organic store, vet, dairy/MCC operator, banker,
  insurer, govt officer, equipment owner, super-admin/owner, …). Multi-role.
- **28 functional modules** (M01–M28): identity, catalogue/attributes, listings,
  auctions, wallet/escrow, orders, delivery, reviews, education, pharma, organic,
  requirements, communication, CMS, + verticals: pashupalan, dairy, govt schemes,
  modular farming, agri-fintech, CHC/equipment, warehousing/WHR, contract farming,
  export/GI, land/soil/weather, drone/robotics, women/SHG/tribal, rural retail,
  labour marketplace.
- **18 AI capabilities** (voice listing, photo grading, fair-price bands, search,
  recommendations, translation, fraud detection, dispute triage, …); AI always
  human-in-loop and visibly marked.
- **3 phases**: Phase 1 MVP (Q2–Q4 2026, 9 months, core commerce + labour +
  dairy + schemes on ramp), Phase 2 Scale (2027), Phase 3 Frontier (2028–30).
- NFRs: multi-tenant SaaS, 5 plan tiers, tenant isolation, high availability,
  DPDP + sector compliance, vernacular/offline-first, observability.

## 2. Database (Database_Architecture/full_platform — 15 SQL files)
- **252 tables** across 15 domain files (00_foundation … 14_audit_additions).
- Billion-scale posture: **32 partitioned** tables, `tenant_id` on **235** tables,
  **bigint minor units** for money on 135 (never float), UUIDv7 keys (882 refs),
  RLS auto-applied via automation in 13_platform_ops_security.
- Fully dynamic master data: languages/translations as data, category tree (ltree)
  + typed EAV attributes, dynamic RBAC (roles/permissions tables), multi-currency,
  rules-as-data (commission/tax/charges), membership tiers, usage counters.
- Double-entry append-only ledger, hot-account striping (shard_no), hash-chaining.

## 3. Source monorepo (krishalaya/ — WORK IN PROGRESS, ~80% implemented)
- pnpm + turborepo. **17 apps**: api (44 modules), admin-api (God mode, 15 ops
  modules, 245+ tests, FIDO2), wallet-service (gRPC, the only ledger writer),
  worker, outbox-relay, realtime-gateway, stream-processor, web-tenant, web-admin,
  web-storefront, web-partner, mobile (Expo, role-switching, offline-first),
  ivr-ussd-gateway, whatsapp-bot, ai-services (FastAPI), analytics-pipeline.
- **9 packages**: config, contracts (zod), i18n, sdk-js, testing, tokens, ui,
  ui-native. db/ has 54 migrations (~5.8k LOC). infra/ ops/ qa/ security/ docs/.
- **Substantive API modules** (real domain/repo/service/controller/tests):
  listings (production exemplar), orders, payments, schemes, assistant, logistics,
  requirements, disputes, memberships, reviews, auctions, equipment, dairy,
  livestock, exports, buyer, lookups. ~14 more are sound scaffolds (labour,
  fintech, traceability, market-intel, warehousing, contract-farming, …).
- **core/ is real, not stub**: auth, database+unit-of-work, outbox, tenancy-context
  (AsyncLocalStorage), resilience, cache, search (OpenSearch), observability,
  rbac, http. Partial: backpressure, cells, sharding, quota, idempotency, secrets.
- Bootstrap wired: main.ts + app.module.ts (CoreModule first, RequestId +
  TenantContext middleware on all routes). deps installed (node_modules present).
- 12 platform "laws" enforced in code (tenant isolation, money=bigint, idempotency,
  append-only audit, state machines, DB-backed RBAC, partition/shard/cell,
  money-safety plane, feature flags, God-mode isolation, degrade-never-fabricate).

## 4. Phase-1 screen design (Phase-1 all screen design/)
- Delivered as **100 interactive HTML screens** (v1.0.0), `NN-slug.html`,
  numbered 01–100. NOTE: user refers to "196 screens" — CHANGELOG shows 196 is
  the **planned v2 target**; 100 are currently built (101–196 pending).
- Roles covered: Farmer (28), Shared (16), Buyer (14), Worker (14), Tenant Admin
  (13), Ambassador (10). ~23 flows: onboarding/auth, wallet/KYC, create-listing
  (voice-first), labour booking, auctions, mandi prices, orders/payouts, schemes,
  buyer browse/checkout/bids, worker jobs/earnings/insurance, tenant mgmt/branding,
  ambassador onboarding/commissions.
- Design system: tokens in 7 formats (CSS/JSON/JS/SCSS/Swift/XML/Tailwind) +
  12 designer-pack guides. Colors: green #1E6F3F, gold #F39C12, AI-purple #6C3483,
  cream #FAF7F0, ink #232A33. Fonts: Fraunces (display), Plus Jakarta Sans (body),
  Hind/Hind Vadodara (Devanagari/Gujarati), JetBrains Mono (money). 48dp tap
  targets, WCAG AA, dignity-first, AI-marked-never-hidden.

## 5. Marketing website (krishalaya_website/)
- Static HTML/CSS/JS (vanilla + Three.js hero), 20 pages, finished/production-ready.
- Home + 6 persona landings (farmers, FPOs, buyers, consumers, ambassadors,
  investors) + about/pricing/careers/press/blog/case-studies/crops/help/contact +
  signup(3-step)/login + legal. Live GMV cost calculator. 22-language i18n.
- Positioning: "operating system for Indian agriculture … 50M farmers, 250K buyers,
  75M households … built from Junagadh, engineered for global scale."

## Discrepancies to reconcile (flagged, not yet fixed)
1. **Screen count**: 100 built vs 196 target (96 screens 101–196 outstanding).
2. **Fonts**: website uses Space Grotesk + Inter; app design system specifies
   Fraunces + Plus Jakarta Sans. Brand typography is inconsistent across surfaces.
3. **Gold hex**: website #f59e0b vs design-system #F39C12.
4. **Language count**: website 22, app design-system 3 (Phase-1), packages/i18n 12.
   Need one canonical Phase-1 language list.
5. **RLS**: only 2 explicit CREATE POLICY statements — rest rely on the auto-RLS
   generator; confirm every tenant table actually gets a policy at migrate time.

## Build bar for all future work
MNC-grade, production-level, billion-ops-ready. Every write: one ACID tx on the
tenant shard, domain events to outbox in the same tx (no dual-write), idempotency,
quota, optimistic locking, metrics. Reads via replica/CQRS read-models, never the
write primary. Money always bigint minor units via wallet-service. tenant_id on
every query + RLS. State machines for lifecycle. Tests incl. tenant-isolation gate.
Follow the `listings` module as the reference shape for every remaining module.
