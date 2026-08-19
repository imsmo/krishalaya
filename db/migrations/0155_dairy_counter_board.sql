-- =============================================================================================
-- 0155_dairy_counter_board.sql · PC-56 TENANT-6a — THE COUNTER, AND FOUR DEAD THINGS BEHIND IT
-- =============================================================================================
-- W167 (Dairy — collections) is the screen an FPO's dairy secretary opens twice a day. Its lead: "312 pourers ·
-- 2 shifts/day (morning | evening) · Lactoscan-metered fat/SNF at the counter · every drop rated by the active rate
-- card. Cycle 01–15 Jul closes Wed 15, pays Fri 17 Jul." Four claims in one sentence, and this migration is mostly
-- about which of them the database can support.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT THIS WAVE BUILT, AND THE READ THAT DID NOT EXIST
-- ---------------------------------------------------------------------------------------------
-- **A DAY'S COLLECTIONS COULD NOT BE READ.** `MilkCollectionRepository.listFor` requires a `membershipId`, and so
-- does the SDK's `listCollections`. There was no way to ask "what did this centre collect this morning", let alone
-- "show me my three centres side by side" — which is the whole of W167. The dairy module has had a rich WRITE path
-- since 0007 (priced in bigint by the active rate card, unique per member/day/shift, idempotent, outboxed) and no
-- operational read above the level of one member.
--
-- The board groups `milk_collections` by centre for one day and shift. `milk_collections` is PARTITIONED BY RANGE
-- (collected_on), so the day predicate prunes to one partition — but inside that partition the existing indexes are
-- `(membership_id, collected_on)` and `(mcc_id, collected_on, shift)`, neither of which leads with `tenant_id`. A
-- tenant asking for its own morning would therefore scan every tenant's pours in that day's partition. Fixed below.
--
-- ---------------------------------------------------------------------------------------------
-- DEAD THING 1: `milk_collections.device_payload` — THE ANALYZER EVIDENCE NOBODY STORES
-- ---------------------------------------------------------------------------------------------
-- W167's lead says fat/SNF are "Lactoscan-metered at the counter" and its table has an **Analyzer** column with a
-- tick per centre. `grep -rn "device_payload\|devicePayload" apps/ packages/` returns NOTHING: no writer, no reader,
-- not in the DTO, not in the entity's insert. The API takes fat/SNF as plain decimal strings from whatever is
-- calling, and the analyzer's own reading — the thing that would make the number evidence rather than an assertion —
-- is stored nowhere. The centre's analyzer MODEL and SERIAL are real (`mcc_centres`), so the desk prints those and
-- says plainly that a tick means "this centre has an analyzer on file", never "this reading came out of it". It
-- matters because W168 hangs an adulteration flag, and a member's money, on that reading.
--
-- ---------------------------------------------------------------------------------------------
-- DEAD THING 2: `dairy_memberships.payment_cycle` — A PREFERENCE NOTHING READS
-- ---------------------------------------------------------------------------------------------
-- Every membership stores daily | weekly | fortnightly | monthly, and W171 counts them proudly ("214 weekly ·
-- 64 fortnightly · 22 monthly · 12 daily — cash-flow-tight households, their choice, honoured"). `grep` finds only
-- the repository round-tripping the column: **nothing derives a window from it, and nothing pays on it.** This wave
-- derives the cycle window from it as a PURE rule (fortnightly → 01–15 / 16–EOM, the canon's own window) and labels
-- the result `derived`, because deriving a window is not the same as the platform having committed to a cycle.
--
-- ---------------------------------------------------------------------------------------------
-- DEAD THING 3: `MilkBillCycleCloseJob` IS INSTANTIATED NOWHERE
-- ---------------------------------------------------------------------------------------------
-- The job that would generate every member's draft bill at cycle close exists, is correct, is idempotent per
-- (membership, period) — and `grep -rn MilkBillCycleCloseJob apps/` finds only its own file. Its header says
-- "instantiated by apps/worker"; apps/worker does not. So dairy bills have never been generated on a clock, which is
-- why W167's "312 milk_bills building" is, on every tenant today, zero bills building. The board reports the count
-- of members who poured NEXT TO the count of bills that exist — the gap between the two is the finding, on screen.
-- Registering it is TENANT-6c's (the cycle screen owns the close, the dispute window and the payday).
--
-- ---------------------------------------------------------------------------------------------
-- DEAD THING 4: `milk_rate_cards.bonus_rules` — THE PREMIUM BAND THAT PAYS NOTHING
-- ---------------------------------------------------------------------------------------------
-- W168 prints "Bonus slab: fat ≥ 6.5 → +₹0.50/L" and "Premium band pourers 184 / 312 — fat ≥ 6.5 earns the bonus
-- slab"; W167's quality tile calls the routes "premium band". The pricing engine's own header says it: "bonus_rules
-- (premium/penalty slabs in jsonb) are DEFERRED". `grep` confirms the column has exactly one mention in the whole
-- codebase — that comment. **Every pour on this platform has been priced without the premium the canon promises the
-- farmer.** This wave does not fix the engine (the rate card is TENANT-6b's screen and changing how milk is priced is
-- a money change that needs its own proof), but the board refuses to present the accrued total as though the bonus
-- were inside it: it reports `bonusRulesIgnored` whenever a card that priced the window carries slabs.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION REFUSES TO INVENT
-- ---------------------------------------------------------------------------------------------
--   • **A shift clock.** W167 says "evening starts 17:00" and its empty state "Morning shift opens 06:00". No column,
--     no setting, no per-centre schedule exists; those are the hours a farmer walks to the centre for. A per-centre
--     shift window belongs with the centre (TENANT-6d) — inventing one here would send people to a closed door.
--   • **A payday.** "pays Fri 17 Jul", "with ambassador weekly run — one bank trip". Nothing records when a dairy
--     cycle pays, and the canon ties the day to a logistics run no dairy row references. 312 families plan a week
--     around that date; the desk states the derived CLOSE and refuses the payday.
--   • **A BMC temperature.** W167's table has one. `bmc_units` (0007) has had no application code at all since it was
--     created, and although `cold_chain_logs` accepts `subject_type='bmc_unit'`, nothing has ever written a reading.
--     The board reads the stream properly (so the day TENANT-6d starts it, this lights up without a code change) and
--     reports `no_unit` / `no_readings` per centre rather than leaving a blank cell that reads as "cold enough".
--   • **Anything after a flag.** W167's "1 · water_flag · sample retained · handled with dignity": the flag COUNT is
--     real (`water_flag`, `adulteration_flags` per pour); the retained sample, the re-test, the decision and the
--     member's notification are not recorded anywhere. Counted, with its kinds, and named as `workflow: not_built`
--     (TENANT-6b).
-- =============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 155.1 · the board's own index
-- ---------------------------------------------------------------------------------------------
-- One tenant, one day, one shift, grouped by centre. `collected_on` prunes the partition; this index is what keeps
-- the read inside it from scanning every other tenant's pours for that day. Created on the partitioned parent so
-- every existing and future monthly partition carries it.
CREATE INDEX IF NOT EXISTS idx_milkcoll_tenant_day_shift
  ON milk_collections (tenant_id, collected_on, shift);

COMMENT ON COLUMN milk_collections.device_payload IS
  'The analyzer''s own reading for this pour (raw Lactoscan/analyzer payload). PC-56 TENANT-6a: **DEAD — nothing writes it and nothing reads it anywhere in apps/ or packages/.** W167''s lead claims fat/SNF are "Lactoscan-metered at the counter" and its Analyzer column ticks per centre; what is actually recorded is the CENTRE''s analyzer model and serial (mcc_centres), while fat/SNF arrive as plain decimal strings from whatever calls the API. So the tick means "this centre has an analyzer on file", never "this reading came out of it" — and W168 rests an adulteration flag and a member''s money on that reading. Making it evidence needs the counter app to post the device payload (and, ideally, a signature) with the pour.';

COMMENT ON COLUMN dairy_memberships.payment_cycle IS
  'The member''s own payout preference: daily | weekly | fortnightly | monthly (W171: "cash-flow-tight households — their choice, honoured"). PC-56 TENANT-6a: **read by nothing before this wave** — grep found only the repository round-tripping it. TENANT-6a derives the accrual window from it as a pure rule (fortnightly → 01–15 / 16–EOM) and labels the result `derived`; it is NOT yet a cycle the platform has committed to, because no cycle record, close or payday exists (TENANT-6c owns that, together with registering MilkBillCycleCloseJob, which is instantiated nowhere).';

COMMENT ON COLUMN milk_rate_cards.bonus_rules IS
  'Premium/penalty slabs, e.g. fat >= 6.5 -> +50 paise/L (W168 prints exactly that). PC-56 TENANT-6a: **the pricing engine IGNORES this column** — MilkRateCard.priceMinor never reads it and the entity''s own header calls the slabs "DEFERRED", so every pour on this platform has been priced without the premium the canon promises the farmer, and W168''s "premium band pourers 184 / 312" describes money nobody has been paid. W167''s board therefore reports `bonusRulesIgnored` whenever a card that priced the window carries slabs, rather than presenting the accrual as though the bonus were inside it. TENANT-6b owns the rate card and the fix.';

COMMENT ON TABLE bmc_units IS
  'Bulk milk coolers, one or more per MCC: capacity, target temperature and the IoT device reference whose readings land in cold_chain_logs (subject_type = ''bmc_unit''). PC-56 TENANT-6a: **this table has had NO application code since 0007** — no entity, no repository, no service, no route, no SDK method — and no cold-chain reading has ever been written for a bmc_unit, so W170 (BMC monitor) and W167''s BMC-temp column had no data path at all. The counter board reads the stream properly and reports no_unit / no_readings per centre; TENANT-6d owns the monitor, the registration form (W2517–W2520) and the operator call-out.';

-- ---------------------------------------------------------------------------------------------
-- 155.2 · the switch (Law 10 — OFF)
-- ---------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'dairy_counter_board',
       'PC-56 TENANT-6a: W167''s counter board — the first read of a DAY''s milk collections this platform has ever had (per centre: litres, pourers against the membership roll, litre-weighted fat/SNF, the analyzer on file, the cooler''s latest reading, flags) plus the cycle-to-date accrual over a window DERIVED from the members'' own payment_cycle preference. OFF means the dairy console does not exist, which is the pre-wave state: there was no dairy screen in the tenant console at all. Turning it on changes no write path and prices nothing — the board is a read, and the figures the platform cannot support (a shift clock, a payday, a BMC temperature, anything after an adulteration flag) stay named rather than filled in.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'dairy_counter_board');

COMMIT;
