# KRISHALAYA — MASTER BUILD SPECIFICATION (every file)

**The build bible. Every file in the repo, what code it must contain, which of the 252 DB tables it touches, which of the 12 laws apply, and its priority wave.** Built by walking the real repo + database. Read alongside `docs/build/00_BUILD_PLAN.md` (order) and the `listings` reference module (pattern).


## How to use
Find a file → read its row → it tells you the layer, exactly what to implement, its DB tables, the laws to obey, and when to build it. Build in wave order (0→1→2→3). The `listings` module is already built as the template; copy it.


## Section index

- **Root & Workspace** — 34 files → `docs/spec/01_root.md`
- **API Core (Wave 0 — build FIRST)** — 85 files → `docs/spec/02_api_core.md`
- **API Business Modules — WAVE 1 (Phase-1 MVP)** — 843 files → `docs/spec/03_api_modules_wave1.md`
- **API Business Modules — WAVE 2 (Phase-2)** — 459 files → `docs/spec/03_api_modules_wave2.md`
- **API Business Modules — WAVE 3 (Phase-3)** — 35 files → `docs/spec/03_api_modules_wave3.md`
- **Backend Services (wallet, worker, outbox-relay, realtime, stream)** — 94 files → `docs/spec/04_backend_services.md`
- **God Mode (admin-api)** — 110 files → `docs/spec/05_god_mode.md`
- **Web Apps (tenant, admin, storefront)** — 118 files → `docs/spec/06_web_apps.md`
- **Mobile App** — 255 files → `docs/spec/07_mobile.md`
- **Channels, Partner Portal & AI** — 68 files → `docs/spec/08_channels_partner_ai.md`
- **Shared Packages** — 68 files → `docs/spec/09_packages.md`
- **Database (migrations, seeds, scripts, DBA)** — 58 files → `docs/spec/10_database.md`
- **Infrastructure (Terraform, Helm, gateway)** — 136 files → `docs/spec/11_infra.md`
- **Ops, QA & Security** — 56 files → `docs/spec/12_ops_qa_security.md`
- **Docs & CI/CD** — 32 files → `docs/spec/13_docs_ci.md`