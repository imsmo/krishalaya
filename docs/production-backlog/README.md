# Krishalaya — Production Backlog (go-live plan)

This folder is the **single source of truth for everything still pending before and after go-live**, ordered by
priority. It was produced by a deep review of the whole repo (`MODULE_STATUS.md`, every `*_BUILD_BACKLOG.md`,
the 48 DB migrations), the canonical schema in `Database_Architecture/full_platform/`, and `Krishalaya_PRD_v4.docx`.

---

## 0. Honest status first — read this before you panic

**The Phase-1 product is built.** This is not a half-finished codebase. Concretely, the review found:

- **Database:** all **250 canonical tables** from `Database_Architecture` are implemented across 48 migrations,
  **plus 36 extra ops tables**. Zero schema domains missing.
- **Backend (`apps/api` + `admin-api` + `wallet-service` + `worker` + `realtime-gateway` + `ai-services` +
  `stream-processor`):** every Phase-1 module is live and unit/integration-tested. The `🟡/⬜` marks you saw in the
  local-setup guide were **"do I start this process for a local run"** flags — *not* build status. They are all built.
- **Clients:** `web-storefront`, `web-tenant`, `web-partner`, `web-admin` and `mobile` are all at their
  Definition-of-Done (flipped ✅ in their backlogs).

So what's left for production is **not "build the product"** — it is four honest buckets:

1. **Wiring real-world external providers + cloud infra + secrets** (you can't ship to real users on dev stubs).
2. **A small number of missing API endpoints** that currently leave a few Phase-1 mobile/web surfaces showing
   "coming soon" (built client-side, waiting on the backend).
3. **The one genuinely-absent module: insurance** (Phase-2 in the PRD; blocks partner-insurance + worker PMSBY).
4. **Phase-2 / Phase-3 roadmap + scale-triggered infra** — by definition *after* launch.

> **Bottom line:** to "go live" you must finish **P0** (and you should do **P1** for a polished GA). **P2 and P3
> are post-launch roadmap** — do not block your launch on them.

---

## 1. Priority tiers

| Tier | File | Meaning | Blocks go-live? |
|------|------|---------|-----------------|
| **P0** | [`P0-launch-blockers.md`](./P0-launch-blockers.md) | Real providers, secrets, cloud infra, observability, the missing GA endpoints, security/DR sign-off | **YES — must be done** |
| **P1** | [`P1-ga-completeness.md`](./P1-ga-completeness.md) | Un-flag the remaining Phase-1 surfaces (SDK/read-model gaps, tenant-admin config, AI assistant, search) | Strongly recommended for a clean GA |
| **P2** | [`P2-phase2-verticals.md`](./P2-phase2-verticals.md) | Insurance module, mobile role apps, IVR/USSD/WhatsApp, ONDC | No — Phase-2 roadmap |
| **P3** | [`P3-scale-and-phase3.md`](./P3-scale-and-phase3.md) | Backpressure/sharding/cells execution + Phase-3 moonshots | No — scale-triggered / future |

Each file lists **discrete, numbered tasks** (e.g. `P0-1`, `P0-2`). Each task has: **why it's pending**, **scope &
acceptance criteria**, **track** (which app/service), and **dependencies**.

---

## 2. How to use this backlog (the workflow you already know)

This mirrors the wave-by-wave cadence used to build the rest of the platform:

1. Open the priority file and pick the **next un-done task** (top to bottom — they're ordered).
2. **Copy the contract** from [`00-PRODUCTION-CONTRACT.md`](./00-PRODUCTION-CONTRACT.md) and paste it at the top of
   your build prompt. This is mandatory — it's the same engineering constitution (`AI_AGENT_BUILD_GUIDE.md` §1)
   that produced the existing code, extended to cover frontend/mobile/infra tasks too.
3. Paste the **single task block** under it. Say: *"Build exactly this one task end-to-end, then stop."*
4. When it's green (typecheck + tests + the task's own acceptance check), tick it and move to the next.

> **Do one task per session.** Each task is scoped to be completable and verifiable on its own. Resist batching —
> the contract's Definition-of-Done (paste the green output) is what keeps quality at the production bar.

---

## 3. Suggested go-live sequence (the critical path)

```
P0-1  Provision cloud infra (Terraform/Helm apply to a real cluster)
P0-2  Wire secrets (AWS Secrets Manager) + assertProductionSecurity passes
P0-3  Real SMS/OTP provider (login works for real users)
P0-4  Real payment gateway (Razorpay live keys + webhook verification)
P0-5  Run DB migrations on prod + seed lookups (NOT demo seeds)
P0-6  Observability live (dashboards + alerts + on-call) and load/soak test
P0-7  Security pen-test + DPDP compliance sign-off + DR/backup drill
P0-8  Missing GA endpoints (earnings/insights/autopay, clock-out, push-token, eKYC, weather)
        ↓  (now you can serve real users)
P1-*  Un-flag remaining Phase-1 surfaces for a clean GA
        ↓  (GA complete)
P2-*  Phase-2 verticals  →  P3-*  scale + Phase-3
```

P0-1…P0-7 are infra/ops and can run **in parallel** with P0-8 (code). P1 can start once P0 code is merged.

---

## 4. Where the detail lives (so you can verify any claim here)

- Per-track pending notes: `apps/*/{API,MOBILE,ADMIN,PARTNER,STOREFRONT,TENANT}_BUILD_BACKLOG.md` and
  `apps/api/MODULE_STATUS.md` (the "FLAGGED-not-faked" and "deferred" notes).
- Launch gate already run once: `apps/api/LAUNCH_READINESS.md`.
- The build contract + laws: `AI_AGENT_BUILD_GUIDE.md` §1 and `/CLAUDE.md` (the 12 Laws).
- Canonical schema vs implemented: `Database_Architecture/full_platform/*.sql` vs `db/migrations/*.sql`.
