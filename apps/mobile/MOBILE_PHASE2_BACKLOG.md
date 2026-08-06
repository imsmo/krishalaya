# mobile — Phase-2 role apps backlog (PC-50, Wave 10)

**Phase-2 scope activation** (founder order, 2026-08-05). Before this wave the six Phase-2 roles existed only as
founder-approved DEV-11/12 flag-gated EmptyState placeholders (features/*/screens, deliberately UN-routed).
Each wave below turns ONE role into a real, routed app: verify backend → SDK → role catalog → route group →
real screens → i18n en/hi/gu → specs. One wave per approval (`Yes start PC-50 | W10-N`).

- [x] **W10-1 · Pashupalak (livestock)** ✅ 2026-08-05 — NEW `(pashupalak)` tab app (Home/Herd/Vets/Bookings):
      animal registry (species/breed lookups, INAPH Pashu Aadhaar, register idempotent, retire sold/deceased/
      lost), vet directory + booking (fee SERVER-snapshotted, never client-priced; cancel pre-service; farmer
      confirm-complete settles the fee idempotently — mirrors domain/vet-booking.state.ts). NEW SDK
      LivestockResource. AppRole 'pashupalak' (RBAC code `pashupalak`, seeded). Flag `livestock` flipped ON
      (dev11/dev12 specs updated). Old placeholders stay un-routed.
      **HEALTH LOG SHIPPED 2026-08-06 (PC-55 B5)** on W54-4 — the coming-note is gone (as is the one on the
      Pashupalak home, which had become false): the animal screen now has a Details/Health tab pair with the
      lifetime file. WHAT IS DUE NEXT leads, showing the EARLIEST unmet date so an overdue vaccination cannot
      hide behind a later one, and overdue is unmissable (a count also rides the Health tab label). Recording
      asks for the batch number on vaccinations/dewormings WITH the reason (a recall cannot be traced without
      it) but never forces it — a fabricated batch is worse than none. A next-due date in the PAST is refused:
      a reminder dated yesterday is not a reminder. The event picker is the server's seeded vocabulary, so an
      unknown code can never be sent. No new route: a shed is a bad place to lose your position in a stack.
- [x] **W10-2 · Dairy farmer** ✅ 2026-08-05 — NEW `(dairy)` tab app (Home/Diary/Bills/Rates), a pure TRUST
      MIRROR (zero writes — recording is the MCC counter's job): my memberships (box=mine), milk diary (owner-
      checked collections, month pager, per-slip SERVER-priced amounts, NO client-side money totals — the
      footer says totals live on the bill), milk bills (box=mine; detail = gross/every deduction line/net,
      dispute-window instant-compare + honest "raise it at your centre" note — the dispute WRITE is operator-
      side, no fake button), active rate charts (the exact counter rates, cached offline). Flag `dairy` ON;
      AppRole 'dairy' → RBAC `dairy_farmer`. D2C SUBSCRIPTION: NO backend → coming-note → PC-54
      `dairy-d2c-subscriptions`. Old placeholders stay un-routed.
- [x] **W10-3 · Vet professional** ✅ 2026-08-05 — NEW `(vet)` tab app (Practice/Bookings/Earnings), the
      PROVIDER side of Pashupalak's bookings: one-time idempotent self-registration (licence 2–60, AI-tech,
      radius), price list from the SEEDED vet_service vocabulary (chips, never free-typed), rupees→minor by
      string math (Law 2), idempotent one-price-per-service upsert; work queue box=vet with status filters;
      case detail shows ONLY legal vet actions (vetActionsFor mirrors the state machine — `completed` is the
      FARMER's confirm-and-pay, never offered); earnings = completed fees per row, NO client grand total
      (wallet = ledger of record, footer says so). SDK: vet-side methods on LivestockResource (87/87).
      Flag `vet` ON; AppRole 'vet' → RBAC `vet`.
      **PRESCRIPTION PAD SHIPPED 2026-08-06 (PC-55 B5)** on W54-4 — the coming-note is gone. SCHEDULE H IS PER
      LINE (one prescription routinely mixes a Schedule-H antibiotic with an ordinary supplement, so there is no
      pad-wide toggle), and this app does NOT decide which drugs are Schedule H — no such list ships here, and
      inventing one would be dangerous; the veterinarian marks the line because they are licensed to know. EVERY
      line needs a medicine AND a dose ("give the white tablet" is not a prescription): an untouched row is
      dropped, a HALF-filled row is refused and named by number. validUntil cannot already have passed. ONE
      prescription per booking, VET-OF-RECORD only (both server-enforced) — once written, the pad is replaced by
      the signed document, because a signed prescription is not a draft and an edit would only 409.
      SUPERSEDED-BY-DESIGN: PRESCRIPTION CONTENT was → PC-54
      `vet-prescriptions`.
- [x] **W10-4 · Store owner** ✅ 2026-08-05 — NEW `(store)` tab app (Orders/Inventory/Batches/Licence),
      RBAC `pharma_store`: orders role=seller REUSING features/orders (same data path + spec-pinned
      nextActions/seller tabs as the farmer sell-side — one domain, one code path); inventory = my live
      listings (features/listings) w/ low/out-of-stock pills; batch & expiry ledger (NEW SDK batch methods:
      list/create idempotent/recall with audited reason; calendar expiry maths — expired/≤30d soon/ok; MRP
      rupees→minor string math); licence = the REAL business-KYC record (masked PII, 'expired' is a server
      status → honest renew note). Flag `store_owner` ON. Licence-expiry REMINDERS: no backend →
      coming-note → PC-54 `store-licence-reminders`.
- [x] **W10-5 · Delivery partner** ✅ 2026-08-05 — NEW `(delivery)` tab app (Today/History), RBAC
      `delivery_partner`: box=mine tasks (server-scoped to the assigned rider), task detail offers ONLY
      legal rider milestones (riderActionsFor mirrors domain/shipment.state.ts; assign/cancel/returned = ops
      moves; `failed` is re-attemptable); DELIVER = buyer OTP 4–8 (isValidPodOtp reused) + optional POD photo
      via the shared media pipeline, Idempotency-Keyed; FAIL requires an audited reason. SDK: rider milestone
      methods on ShipmentsResource (89/89). HONEST MONEY: chargeMinor = what the CUSTOMER paid; rider payout terms NOW BUILT (PC-55 A7 — History shows the real statement) → no invented per-drop earnings → PC-54 `rider-payouts`. Route MAP: no routing
      backend → the task list is the route sheet (no fake map). Flag `delivery_partner` ON.
- [x] **W10-6 · Equipment owner** ✅ 2026-08-05 — persona RESOLVED by design canon (founder-confirmed: all 520+
      screens designed; owner surfaces = screens 308–312 + 496): NEW `(equipment)` tab app (Requests/Fleet/
      Earnings), RBAC `equipment_owner`. Requests box=owner w/ status chips; rental detail = ONLY legal owner
      actions (ownerActionsFor mirrors the state machine — QUOTE advance rupees→minor on requested; START on
      confirmed with the RENTER's OTP presence proof; COMPLETE actual usage; SETTLE idempotent money leg;
      renter's CONFIRM never offered). Fleet: register machine (taxonomy category, zod-mirrored, idempotent),
      status toggle active/maintenance/retired (496), rate lines per_hour/per_acre/… (string-math minor, real
      bases). Earnings = settled totals, NO client grand total (wallet = ledger). SDK: box params +
      registerAsset/setRate (90/90). NEW flag `equipment_owner` ON. Canon 312 alerts: no maintenance-schedule
      backend → status pill is the honest alert → PC-54 `equipment-maintenance-alerts`. Renter-side canon
      297–307 = the FARMER app's rental flow (separate scope, not this role).
- [x] **W10-7 · MCC operator** ✅ 2026-08-05 — persona RESOLVED by design canon (screens 236–239, worker-mcc-*;
      the mobile twin of the web-ops dairy POS — same endpoints, one truth): NEW `(mcc)` tab app (Counter/
      Members/Centre), RBAC `dairy_farmer` (the seeded "Dairy Farmer / MCC Operator" role). Counter (237):
      box=mcc roster (operator's centre found by operatorUserId in the REAL registry), slip entry mirroring
      web-ops pos.ts EXACTLY (DEC bounds, seeded adulteration vocab, no price field ever) → idempotent,
      SERVER-priced, priced result echoed back. Members + farmer ledger (239): the SAME owner-or-manage
      slips/bills endpoints the farmer app reads — one truth, two viewers; no client totals. Centre (236):
      registry facts + active rate charts. Day totals / shift-close (238 + ShiftClose placeholder): NO
      per-MCC collections read-model → honest note → PC-54 `mcc-shift-summary`. Flag `mcc_operator` ON.
      **PHASE-2 MOBILE ACTIVATION COMPLETE — W10-1..7 ALL SHIPPED.**
