# Launch feature flags — the recommended switch list (PC-56 FLAGS-1)

**Status: RECOMMENDATION — the founder approves or edits it; nothing here has been switched.**
Written 2026-11-24 by the lead as product owner, from the flag table built from empty (`krishalaya_qa_pay9`: 120 server
flags, 10 ON) and `apps/mobile/src/core/flags/flags.ts` (39 mobile flags). Every row says what turning it on depends on.
Law 10 stays: every flag below remains a kill-switch after launch.

## The launch, in one sentence

**Stage 1 (launch day):** farmers and organisations list produce; buyers find it on the web storefront and in the app,
order it, and **pay the seller on delivery or directly** (`online_payments` OFF). Sellers deliver themselves. Support
tickets, reviews and the DPDP privacy screens work. **Stage 2 (after the money reviews, target +2–4 weeks):** online
payment through Razorpay, commission and the platform fee, disputes with refunds, wallet withdrawals.

Why two stages: every money flag below depends on the Law 9 reviews still owed (migrations 0174 and 0180–0240), the
open checkout questions, and Razorpay live activation. Shipping the marketplace first gets real users and real listings
without putting money on a path nobody has signed off.

## Server flags (`feature_flags`, seed `db/seeds/core/0009_feature_flags.sql`)

### Already ON (keep)
`group_lots` · `kyc` · `listing_boost` · `notification_routine_single_channel` · `org_self_signup` · `product_batches` ·
`selfserve_onboarding` · `storefront_browse` · `storefront_cart` · `storefront_pwa`

**Check before launch:** `listing_boost` is a PAID feature (wallet-funded). With `online_payments` OFF nobody can fund a
wallet, so it is harmless but useless; switch it OFF for Stage 1 so no screen offers a paid boost that cannot be paid.

### Stage 1 — turn ON (no money moves; nothing pending)
| Flag | Why at launch | Depends on |
|---|---|---|
| `support` | Grievances must have a working door (IT Rules / DPDP); tickets + SLA + escalation (the worker's escalation job already runs) | a support helpline number in platform facts |
| `reviews` | Trust on a new marketplace; verified-purchase only | — |
| `communication` | Order updates to buyers and sellers | **blocker 6**: a notification gateway and an email provider. Without them this ON still records preferences but delivers nothing — turn ON only after the provider is live |
| `cms` | Organisations publish their own refund/shipping policies (the LEGAL-1 pages read the tenant's own version first) | LEGAL-1 shipped |
| `logistics` | The order page's delivery section and OTP proof of delivery | decide: seller-delivered orders work without it; ON gives buyers tracking. **Recommended ON** |
| `traceability` + `certificates_public` | Farm-to-fork QR is a differentiator and moves no money | per organisation (tenant allow-list), not global |

### Stage 2 — turn ON only after the named review (MONEY)
| Flag | What it does | Blocked by |
|---|---|---|
| `online_payments` | The Pay step at checkout (Razorpay) | Law 9 reviews 0180–0240 · checkout questions (payment-attempt lifetime, duplicate-capture refunds, wallet pay per order or per checkout) · Razorpay live KYC · legal pages live (LEGAL-1) |
| `commission_split` | Escrow splits into seller-net + commission + GST/TDS. **OFF = the platform earns nothing on an order** | the same review + a CA's sign-off on GST/TDS lines |
| `buyer_charges` | Delivery slab + platform fee at checkout | pricing decision |
| `disputes` + `dispute_refunds` | Disputes with an escrow → buyer refund | dispute moderators staffed · refund path review |
| `document_pdfs` | Invoice / statement PDFs to S3 | GST invoice format reviewed by a CA |
| `promotions` | Coupons | a promotion budget decision |

### Stays OFF at launch (Phase 2+ or not built for launch)
`auctions` · `offers` · `requirements` · `fintech` · `insurance` · `pmfby_sync` · `surveyor_dispatch` ·
`vet_cert_verification` · `dairy` · `livestock` · `equipment` · `warehousing` · `contract_farming` · `exports` · `labour`
· `mgnrega` · `wage_priority_payout` · `education` · `ambassadors` · `memberships` · `tenancy` (SaaS billing — Stage 3,
when organisations start paying) · `land_soil_weather` (the weather source's free tier is non-commercial) ·
`market_intel` · `schemes` · `services_marketplace` · `ai_assistant` · `ai_governance` · `assisted_doc_prefill` ·
`unified_search` · `search_indexing` · `listing_views` · `realtime_fanout` · `bulk_import` · `digital_twin` ·
`tenant_api` · `tenant_branding` · `tenant_domains` · `tenant_host_routing` (no TLS for custom domains yet) ·
`partner_console` · `gov_console` · `autopay_execution` · `audit_trail` · every TENANT-SW / OPS sub-flag
(`cod_ledger`, `pod_review`, `staff_invites`, `setup_calls`, `agm_packs`, `share_register_import`, `logistics_*`,
`cold_chain_device_ingest`, `insights_*`, `tenant_commission_rules`) · `storefront_offline_reads` ·
`storefront_install_prompt`.

## Mobile flags (`apps/mobile/src/core/flags/flags.ts`)

### Finding 1 — 32 of 39 mobile flags cannot be switched off remotely
The app hydrates its flags from `GET /v1/config/flags`, which returns the server's `feature_flags` rows. Only **7** mobile
keys have a server row of the same name (`listing_boost`, `support`, `auctions`, `kyc`, `fintech`, `dairy`,
`livestock`). The other **32** (`buyer_app`, `buyer_checkout`, `wallet`, `orders_fulfilment`, `notifications`,
`system_screens`, `release_gate`, …) fall back to the value compiled into the build: **a bad screen behind one of them
needs an app-store release to switch off.** That breaks the promise in the file's own header.
**Fix (FLAGS-2, small):** a seed adds one server row per mobile-only key, each set to the launch value below. No new
code — the hydrate path already reads them.

### Finding 2 — five Phase-2 operator apps are ON in the launch build, with their server modules OFF
PC-50 flipped these defaults ON when the apps were built: `mcc_operator`, `vet`, `store_owner`, `delivery_partner`,
`equipment_owner` (and `dairy`, `livestock`, which the server's OFF rows already override). None has a server row, so a
user given one of those roles gets an app whose every call answers "flag off" or 404 from the `dairy` / `livestock` /
`equipment` / `logistics` modules. **Fix (in FLAGS-2):** their server rows are seeded OFF; the build defaults stay.

### Recommended launch values (Stage 1)
| ON | `farmer_app` · `buyer_app` · `buyer_checkout` (checkout without the Pay step while `online_payments` is OFF) · `orders_fulfilment` · `kyc` · `notifications` (push already works) · `farmer_profile` · `system_screens` (the DPDP export/delete screens **both stores require**) · `support` · `release_gate` (the forced-update kill-switch must be live from day one) |
|---|---|
| Stage 2 | `wallet` (withdrawals) · `payments_addmoney` · `offers_chat` |
| OFF | `ota_updates` (expo-updates is not installed — blocker 3) · `voice_listing` · `voice_assistant` · `tips_assistant` · `mandi_weather` · `schemes_govt` · `auctions` · `listing_boost` · `wallet_p2p` · `labour_hire` · `worker_active_job` · `worker_app` · `trader_app` · `ambassador_app` · `ambassador_training` · `tenant_admin_lite` · `fintech` · `dairy` · `livestock` · `mcc_operator` · `vet` · `store_owner` · `vyapari` · `delivery_partner` · `equipment_owner` · `fpo_coordinator` |

## What the founder decides here
1. **Two stages (recommended), or online payment on launch day?** Online payment on day one needs every Stage 2 money
   review done before launch.
2. `logistics` ON at launch (recommended) or seller-confirmed delivery only.
3. Approve FLAGS-2 (seed server rows for the 32 mobile-only keys at the values above).
