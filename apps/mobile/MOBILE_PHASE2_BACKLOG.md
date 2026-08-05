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
- [ ] **W10-2 · Dairy farmer** — features/dairy screens (MilkDiary/MccSlip/MilkBill/D2cSubscription); dairy SDK
      exists (memberships/slips/bills). Role: `dairy_farmer` (seeded).
- [ ] **W10-3 · Vet professional** — features/vet screens (bookings calendar/detail/prescription/earnings);
      vet-side APIs exist (vets.manage, bookings box=vet, progress). Flag `vet`.
- [ ] **W10-4 · Store owner** — features/store-owner screens (inventory/orders/batches-expiry/licence);
      verify catalogue/orders seller-side contracts first. Flag `store_owner`.
- [ ] **W10-5 · Delivery partner** — features/delivery-partner screens (tasks/route/pickup-OTP/POD/earnings);
      verify logistics contracts first. Flag `delivery_partner`.
- [ ] **W10-6 · Equipment operator** — NO feature screens exist (only ops-console web flow); scope from
      equipment SDK (PC-33). Decide persona need before building.
- [ ] **W10-7 · MCC operator** — features/mcc-operator screens; overlaps web-ops dairy POS; decide persona
      split (mobile POS vs kiosk) first. Flag `mcc_operator`.
