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
      (dev11/dev12 specs updated). HEALTH LOG: table-less/endpoint-less → honest coming-note → PC-54
      `livestock-health-records`. Old placeholders stay un-routed.
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
      Flag `vet` ON; AppRole 'vet' → RBAC `vet`. PRESCRIPTION CONTENT: no endpoints → coming-note → PC-54
      `vet-prescriptions`.
- [ ] **W10-4 · Store owner** — features/store-owner screens (inventory/orders/batches-expiry/licence);
      verify catalogue/orders seller-side contracts first. Flag `store_owner`.
- [ ] **W10-5 · Delivery partner** — features/delivery-partner screens (tasks/route/pickup-OTP/POD/earnings);
      verify logistics contracts first. Flag `delivery_partner`.
- [ ] **W10-6 · Equipment operator** — NO feature screens exist (only ops-console web flow); scope from
      equipment SDK (PC-33). Decide persona need before building.
- [ ] **W10-7 · MCC operator** — features/mcc-operator screens; overlaps web-ops dairy POS; decide persona
      split (mobile POS vs kiosk) first. Flag `mcc_operator`.
