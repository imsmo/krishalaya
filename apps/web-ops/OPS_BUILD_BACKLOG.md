# web-ops — build backlog (PC-30, ops console for platform field staff)

**Status today.** OW-0 ✅ (this scaffold): Next.js 14 App Router on the MAIN platform API via `@krishalaya/sdk-js`
(§C-2 ruling: ops staff hold ops-scoped permissions — NEVER admin-api / god-mode tokens). Phone-OTP login
(`kvo_access`/`kvo_refresh` httpOnly cookies + silent refresh + `requireSession`), full i18n en/hi/gu (35-key
parity, spec-gated), shell (sidebar links ONLY to built routes), root loading/error/not-found boundaries,
DataTable, jest (safe-next + parity). Dashboard shows the honest wave map.

**The binding spec** is `Development_Program/CANON_VS_CODE_LEDGER.md` Part 3 (FLOWMAP_ops register): 51 dev-owed
rows — 45 BACKEND-READY, 6 gated on PC-54 (`iot-device-fleet`, `ops-alerting`).

## Waves (one per session, `Yes start PC-3x`; each adds its sidebar entry when it ships)
- [x] **OW-0 · foundation** — this scaffold.
- [x] **OW-1 · kiosk (4 rows)** ✅ 2026-08-05 — /kiosk: create the farmer's account (users.create, idempotent,
      409→'already exists' honesty) + the GUIDED HANDOFF checklist. CONSENT RULING: KYC + first listing happen in
      the FARMER'S OWN session (assisted, never impersonated — no on-behalf writes; an `assisted-onboarding`
      on-behalf surface would be a PC-54 decision). Canon rows kiosk-home/profile → BUILT; kiosk-kyc/first-listing
      → resolved by the handoff design (farmer-session actions, mobile/storefront already built).
- [x] **OW-2 · warehouse (18 rows)** ✅ 2026-08-05 — /warehouse (+/[id]): storage-booking lifecycle
      (requested→confirmed→stored→released + cancel, pure state-machine gates; release idempotent w/
      server-settled fee), assay reports (plain-text name=value → typed params), eNWR issue (stored-only,
      NERL/CCRL, float-free valuation, idempotent) + receipt register. SDK: NEW WarehousingResource.
      Canon-row notes: weighbridge = the confirm→store step (weighment precedes 'stored'); stacking +
      per-lot storage-billing detail + wh-insights = server read-models → PC-54 note; assay CERTIFICATE
      file rides reportMediaId (upload wiring with the shared MediaUploader when ops gets one).
- [x] **OW-3 · equipment/CHC + livestock (7 rows)** ✅ 2026-08-05 — /equipment (+/[id]): rental lifecycle
      requested→quoted(advance, float-free)→confirmed(RENTER's device — their consent, their wallet)→
      in_progress(renter's OTP = presence proof)→completed(actual usage)→settled(idempotent, money server-side);
      cancel pre-start; asset register. SDK: NEW EquipmentResource. Canon notes: chc-maintenance = asset
      status toggle (asset lifecycle depth = PC-54 note); chc-insights → OW-6; livestock EAR-TAG LOOKUP =
      API gap (animal registry has no tag-number query param) → PC-54 `livestock-tag-lookup`.
- [x] **OW-4 · dairy POS (11 rows)** ✅ 2026-08-05 — /dairy: record collection (member+shift+weighment+FAT/SNF+
      adulteration flags; SERVER prices every slip from the rate card — POS never computes money; idempotent,
      409→same-slip honesty), member slip lookup (member+range → server-priced amounts), milk bills (generate
      per period → preview[dispute window]→approve→pay idempotent run, only the legal step shows), active rate
      charts. Canon rows pos-shift/slip/quality/exceptions/bmc/rate-chart/payout-run all BUILT (bmc = the MCC
      registry lives in tenant /dairy; ops POS records against memberships).
- [x] **OW-5 · assisted money (3 rows)** ✅ **BUILT 2026-08-06 (PC-55 B3)** — OW-0..OW-6 built. (B3's tick first
      read "the ops console is now 100%"; that was premature — OW-7 was still READY-but-unbuilt until B4. Corrected
      here rather than quietly reworded.) /money records an AePS service event on W54-13, with Ledger Appendix 3 (canon
      W390–W392) drawn on the screen and not merely enforced: LOG-ONLY notice up top (AePS cash moves in the BANK's
      systems over NPCI — this platform moves nothing) · masked identifiers ONLY (account/Aadhaar boxes accept
      exactly 4 digits, maxLength=4, so a full Aadhaar cannot be typed here even by accident) · ≤3 attempts with
      the **NO-OTP-FALLBACK** sentence written out ("there is no OTP alternative in AePS — after the third failure
      send the customer to a bank mitra") · an uncertified reader may record ONLY a blocked
      `device_not_rd_certified` event and the copy says switch to the certified backup · the 3rd finger-fail
      REQUIRES the escalation note, next to "the money is untouched" · amount only on a withdrawal · bank-reported
      balance labelled informational · the ₹10k cap deliberately NOT printed (bank-set, W391 — a hardcoded number
      becomes a lie the day a bank changes it) · commission named as bank-side, never a ledger entry.
      /money/oversight = the supervisor's cross-operator view, filtered by the API's own status/exception
      vocabulary, leading with the two rows that mean somebody did not get their money (3-strike escalations and
      uncertified-device blocks). READ-ONLY by design: no retry/reverse/resolve button exists, because only the
      bank can complete an AePS transaction. Dashboard 'money' flips Live; nav links it; the now-callerless
      'dash.coming' key was deleted from all three catalogues.

- [x] **OW-6 · insights (2 rows)** ✅ 2026-08-05 — /insights: tenant analytics (tenancy/analytics 30-day
      server-computed; 403 → honest permission note) + operational snapshot (status breakdown of the LATEST 50
      per register, labeled as a snapshot never a total; true totals need read-models → PC-54 note).
      **OPS CANON FULLY DISPOSITIONED**: OW-0..6 built/resolved; OW-7 gated on PC-54.
      CORRECTED (PC-56 OPS-5b, survey C-8 / F-9 / E16 — the lines above are kept, not deleted):
      • "OPS CANON FULLY DISPOSITIONED" was FALSE for `/insights`: the canon's `/insights` is W369, the dairy centre's insights page
        (dairy chrome, dairy sidebar), not tenant analytics. OW-6's page printed the organisation's GMV and payouts paid on the field
        console, whose money rule is "only READS" (OPS-1 Q2-A), with an `'INR'` fallback when no currency came back (a Rule-Zero
        literal); the analytics read beside it also returns a per-seller sales ranking (`topSellers`) the page never printed.
      • OPS-5b retired it: web-ops no longer calls `client.tenancy.analytics` (a source assertion, test/ops5b-pages.spec.ts); the
        tenant analytics stay on the organisation's console. `/insights` is now W369 — a READ of `GET /v1/dairy/insights` (the
        whole organisation's milk figures as the server words them; no member, no reason, no rank, no %), behind `dairy` +
        `dairy_insights` and `dairy.manage`; its export is REAL on the tenant export plane; it sits in the Dairy sidebar group.
        The OW-6 snapshot ("latest 50 per register") and its `ins.` keys (19) are gone.
- [x] **OW-7 · IoT fleet + ops alerting** ✅ **BUILT 2026-08-06 (PC-55 B4)** — **OW-0..OW-7 ALL BUILT: the ops
      console is complete.** No backend change was needed (W54-12 fleet/breach reads + PC-55 A6 rule CRUD, cadence
      evaluator, fired feed and acknowledge were already there).
      /devices — sensor fleet + breach feed (6h/24h/72h/7d), with the frame stated out loud: this is NOT an
      equipment register, a sensor appears only because it sent readings in the last 30 days, so a device nobody
      installed is simply absent (check against your own installation list). THE WORST TRUTH WINS: a sensor that has
      gone quiet reads as QUIET even while its last readings were breaching, because once it stops reporting nobody
      knows what the cargo is doing. Unknown sensors are counted WITH the silent ones, never into "ok".
      **CORRECTED (PC-56 OPS-4c, survey C-12 — the words above are kept, not deleted): "a sensor appears only because it sent
      readings in the last 30 days" was FALSE.** The fleet grouped `device_ref`, which only a MANUAL reading writes (a person's
      typed reference, or a cooler's reference stamped on a person's reading); a signed logger never appeared, and a typed reading
      made a "sensor" look heard from. OPS-4c: the fleet and the `device_silent` rule read registered loggers and their SIGNED
      readings only; `/devices` answers a 307 to `/iot/dashboard` (W400). Soil pods and weather masts are registered only — no
      reading of theirs is received (C-17, founder TENANT-12).
      /devices/rules — rule CRUD offering exactly the threshold keys the API accepts per kind, with the API's own
      defaults shown and applied when a box is left blank (a blank form still produces a WORKING rule, never a
      silently disabled one). Cooldown stated in real minutes (5 … 10080) because that is the number the dedupe
      buckets on. Recipients de-duplicated (nobody paged twice for one event). A rule can be PAUSED, never deleted,
      so the alerts it already fired keep their author. Quiet-hours notice: channelHint is a PREFERENCE, never a
      bypass of somebody's night — firing rides the existing notification spine.
      /devices/alerts — fired feed ordered unacknowledged → critical → newest, so what is still on fire is on top
      before anyone filters. Acknowledge is the ONLY act (no delete, no edit: an alert is evidence a threshold was
      crossed). "Run the rules now" runs the SAME evaluator as the cadence and reports evaluated/fired/**suppressed**
      verbatim — hiding the suppressed count would make a working cooldown look like a broken evaluator.
      Dashboard row + nav added.
      CORRECTED (PC-56 OPS-5a, survey C-3 / C-4 / E1 / E6 — the lines above are kept, not deleted):
      • "A rule can be PAUSED, never deleted, so the alerts it already fired keep their author" was FALSE as built: nothing wrote an
        author (`created_by`/`updated_by` were never set; no audit row for a create, edit, pause or acknowledge). Since HOTFIX-14 every
        change is keyed and recorded (actor, before/after, reason) and a change that could make an alert quieter needs a second person;
        since OPS-5a the feed's acknowledge is keyed and recorded too, and a breach's or a silence's own alert is refused there
        (ALERT_ACK_ON_ITS_OWN_FILE — it is acknowledged on its own file). An alert row still carries no author of its own.
      • "Quiet-hours notice: … never a bypass of somebody's night" — a CRITICAL alert reaches a person even in their quiet hours, by
        design (TENANT-6d-5, 0165); the preferred channel is read by nothing in the spine (HOTFIX-14 §2.2). No escalation exists.
      • Both pages are GONE (OPS-5a): `/devices/rules` and `/devices/alerts` answer a 307 to `/iot/alert-rules` (W402), which reads the
        rules and what they sent and carries the change act (propose / confirm / withdraw). "Run the rules now" left this console (E6):
        it paged real people on demand; the API route stays and writes an audit row. Acknowledge is not offered on W402.
