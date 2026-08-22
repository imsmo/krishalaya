-- ==================================================================================================================
-- 0168 · PC-56 TENANT-6e-1 · THE INSIGHTS — W172 (Dairy insights)
-- ==================================================================================================================
--
-- W172 is the cooperative's own answer to "is this working?". Four KPIs across the top, a 90-day volume chart split by
-- shift, and one panel that tries to EXPLAIN a number rather than just print it (*"What moved member Rs/L"*). Its own
-- footnote sets the terms this migration keeps:
--
--     *"Numbers assemble from milk_collections + milk_bills (derived - no new tables)"*
--
-- So this migration adds NO TABLE and NO INDEX. It is almost entirely a flag and a set of column comments, and that is
-- the finding: **every figure on W172 that this platform can honestly produce was already reachable, and the two it
-- cannot are missing a fact, not a table.** Writing the read plane without recording that would leave the next wave to
-- rediscover it.
--
-- ------------------------------------------------------------------------------------------------------------------
-- 168.1  WHY THERE IS NO NEW INDEX (Law 8, satisfied by earlier waves)
-- ------------------------------------------------------------------------------------------------------------------
-- Every aggregate this wave adds is a tenant-scoped range over `milk_collections`, which is PARTITIONED BY RANGE
-- (collected_on) into monthly partitions. A 90-day window prunes to four of them, and inside each one the read is
-- served by an index that already exists:
--
--   • `idx_milkcoll_tenant_day_shift (tenant_id, collected_on, shift)` — 0155.1, created on the partitioned parent so
--     every existing and future partition carries it. It leads with `tenant_id`, which is the whole reason 6a created
--     it: without it a tenant asking for its own window scans every other tenant's pours in those partitions. It
--     serves the daily-volume aggregate, the Rs/L aggregate and the by-shift weekly buckets with one shape.
--   • `idx_dairy_cycle_tenant_window (tenant_id, period_start DESC, payment_cycle)` — 0157, for the closed-cycle
--     count this wave uses as its history gate.
--   • `uq_milkbills_member_period` and `idx_milkbills_cycle_window` — 0158, for the bill-side figures.
--
-- THE ONE READ THAT REACHES FURTHER BACK IS BOUNDED ON PURPOSE. W172's *"pourers active 312, +18 this quarter ·
-- 4 win-backs"* asks a question about the past that has no natural floor: "new" means "never poured before", and
-- "never" is an unbounded scan of every partition this tenant has ever had — the exact shape Law 8 forbids, and one
-- that gets slower every month a cooperative succeeds. So the cohorts are judged against a DECLARED LOOKBACK (one
-- year, `POURER_LOOKBACK_DAYS` in `domain/dairy-insights.ts`) and the API returns that number next to the counts. The
-- screen therefore says "new to us this year", which is true, instead of "new ever", which the query never checked.
--
-- ------------------------------------------------------------------------------------------------------------------
-- 168.2  THE KPI THIS PLATFORM CANNOT PRODUCE — *"On-time payout streak · 24 cycles"*
-- ------------------------------------------------------------------------------------------------------------------
-- This is the single most persuasive number on the screen: a cooperative would quote it to a member deciding whether
-- to pour here or at the private collector down the road. **Nothing on this platform records when a milk payment
-- actually reached anybody.**
--
--   • `dairy_bill_cycles.payday` (0157) is the DATE the money was PROMISED for. That half exists.
--   • `dairy_bill_cycles.status` admits exactly `open` and `closed` (0157's `ck_dairy_bill_cycle_status`). A cycle has
--     no paid state, so no cycle has ever recorded being paid.
--   • `milk_bills.status` admits `paid` — and no column anywhere says WHEN. There is no `paid_at` on the bill.
--   • `payouts` (0006) carries `payout_status` with a `success` value and **no settled instant at all** — no
--     `settled_at`, no `paid_at`. The only timestamp is the shared `updated_at`, which any later touch of the row
--     overwrites, so it cannot be read as a settlement time even opportunistically.
--
-- A streak is `count of consecutive cycles where paid_at <= payday`. Two of those three terms do not exist. So the
-- tile is REFUSED BY NAME, with the missing facts listed on the wire, and the screen prints what IS true beside it:
-- how many cycles closed in the window, and how many of them have every bill approved. That is a weaker sentence than
-- "24 cycles" and it is the one the data supports.
--
-- WHY THIS MIGRATION DOES NOT JUST ADD THE COLUMN. A `paid_at` that nothing writes reads NULL forever, and a streak
-- computed over NULLs prints `0` — a screen confidently telling a cooperative it has never paid on time. The honest
-- fix is a settlement instant stamped by the payments module on the provider's own confirmation, which is a money-path
-- migration under Law 2 and Law 9's CODEOWNERS review, plus a writer in a module dairy does not own. It is named here
-- and carried, not smuggled into a read wave.
COMMENT ON COLUMN dairy_bill_cycles.payday IS
  'The date the cycle''s money is PROMISED for (0157). PC-56 TENANT-6e-1: this is one half of "paid on time" and the '
  'other half does not exist - no cycle, bill or payout row records WHEN money actually settled, so W172''s "on-time '
  'payout streak" is refused by name rather than computed over nulls. Completing it needs a settlement instant '
  'stamped by the payments module on the provider confirmation (money path: Law 2 + Law 9 review).';

COMMENT ON COLUMN milk_bills.status IS
  'draft|previewed|disputed|approved|paid (0009, window and dispute states added by 0158). PC-56 TENANT-6e-1: the '
  '"paid" value has no instant beside it - there is no paid_at on this table and no settled_at on payouts - so this '
  'column can say that a bill was paid and never when. Any "on-time" figure over milk payments needs that instant '
  'first; W172''s payout-streak tile is refused for exactly this reason.';

-- ------------------------------------------------------------------------------------------------------------------
-- 168.3  THE OTHER REFUSAL — *"Zero spoilage"*, ALREADY ADJUDICATED
-- ------------------------------------------------------------------------------------------------------------------
-- W172's explanation panel ends on *"zero spoilage"*. TENANT-6d-2 met the same claim in W170 (*"0 L milk lost to
-- temperature"*) and settled it in `domain/bmc.ts`: **no relation on this platform reduces anybody's litres anywhere
-- in the schema**, so `litresLostVerdict()` returns `not_measurable` with the missing inputs named. 0162 added the
-- condemnation THRESHOLD (`dairy.bmc_condemn_temp_decic`) and no condemnation FACT.
--
-- This wave reuses that verdict rather than deciding it again, because two dairy screens disagreeing about whether
-- spoilage is measurable would be worse than either being wrong alone — 0155's argument for one `cycleWindow`,
-- applied to a refusal. "Zero spoilage" printed from the absence of a table is a promise made out of a silence.
--
-- ------------------------------------------------------------------------------------------------------------------
-- 168.4  THE THIRD, SMALLEST REFUSAL — *"Rate card v4"*
-- ------------------------------------------------------------------------------------------------------------------
-- 0009's own comment calls `milk_rate_cards` *"dynamic pricing (PRD 19.4): versioned, per tenant"* and the table has
-- no version column: only `effective_from`, `effective_to` and `is_active`. An ordinal counted from `effective_from`
-- would look identical on screen and mean something else — the platform's count of cards, not the number the
-- cooperative's own secretary wrote on the notice board. So the panel prints the card's own `default_name`, its
-- `pricing_model` and the date it took effect, all of which are facts, and no version number.
COMMENT ON COLUMN milk_rate_cards.effective_from IS
  'The date this card starts pricing pours (0009). PC-56 TENANT-6e-1: 0009 calls this table "versioned" and there is '
  'no version column - so W172''s "Rate card v4" has no source, and the insights panel names the card and this date '
  'instead of printing an ordinal that would read as a tenant-assigned version.';

-- ------------------------------------------------------------------------------------------------------------------
-- 168.4b  WHAT BUILDING THIS PAGE FOUND — FIVE COUNTRIES WITH NO CURRENCY
-- ------------------------------------------------------------------------------------------------------------------
-- Every figure on W172 is money per litre, so the read model resolves the tenant's currency AND its scale, and refuses
-- the page rather than guessing (TENANT-6d-7's ruling on the notice path, applied to a screen). Writing the live test
-- for that refusal turned up why it is not defensive code:
--
--     SELECT c.code, c.currency_code FROM countries c
--       LEFT JOIN currencies u ON u.code = c.currency_code WHERE u.code IS NULL;
--      -> AE|AED   GB|GBP   SA|SAR   DE|EUR   JP|JPY
--
-- **Five of the seven seeded countries named a currency that did not exist.** `countries.currency_code` is NOT NULL and
-- carries no foreign key to `currencies.code`, and `core/0002_countries_regions_gj_mh.sql` runs BEFORE
-- `core/0003_currencies_units.sql` in the seed order — so nothing on this platform could have noticed. Any tenant in
-- Dubai, London, Riyadh, Berlin or Tokyo had no currency scale at all, and every money figure for them was a guess at
-- two decimals or a failure. **The yen has no minor unit**: two decimals renders ¥5,160 as ¥51.60.
--
-- The five rows are added by `db/seeds/core/0003_currencies_units.sql`, with each currency's real scale and
-- `is_active = false` (whether Krishalaya transacts in a currency is not a seed's decision). Two residuals are named
-- there and carried rather than fixed here: five countries are active whose currencies are not, and the FOREIGN KEY
-- that would make this unrepresentable belongs with whoever owns country onboarding in `apps/admin-api` — the seed
-- order inserts countries first, so the constraint changes what that flow may do.
--
-- ------------------------------------------------------------------------------------------------------------------
-- 168.5  THE FLAG (Law 10)
-- ------------------------------------------------------------------------------------------------------------------
-- One flag for the whole screen, the shape 0154 used for the logistics desk: the KPIs, the chart and the explanation
-- panel are one page and one judgement about whether a tenant should see derived analytics at all.
--
-- OFF is not "empty page". OFF means the API refuses the read and the screen says the insights are not switched on —
-- because a tenant whose page silently shows zeroes learns that it poured no milk, which is the opposite of true.
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('dairy_insights',
   'PC-56 TENANT-6e-1 (W172): the DERIVED dairy insights page - 90-day volume and Rs/L with their change against the '
   'preceding 90 days, the by-shift weekly chart, the pourer cohorts against a declared one-year lookback, and the '
   'premium-slab explanation read from the active rate card''s own bonus_rules. Adds no table: every figure is '
   'assembled from milk_collections, milk_bills and dairy_bill_cycles. OFF means the API refuses the read and the '
   'page says the insights are not switched on - never a page of zeroes, which would read as "this cooperative '
   'collected no milk". The member drill-down inside it needs member.view360 (0128) on top of this flag.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 168.6  WHAT THIS MIGRATION DOES NOT DO
-- ------------------------------------------------------------------------------------------------------------------
--   • **It adds no table, no materialised view and no rollup.** W172's footnote asks for derived numbers and the
--     window is 90 days over four monthly partitions behind a tenant-leading index. A rollup becomes right when a
--     district union's window costs more than a page load can spend, and it brings a staleness contract with it
--     (*"as of 04:00"*) that this screen would then have to print. Naming the trigger rather than pre-building it.
--   • **It does not add the settlement instant.** 168.2. That is a money-path migration plus a writer in `payments`.
--   • **It does not add a spoilage relation.** 168.3. 6d-2's refusal stands until something actually reduces litres.
--   • **It does not touch how milk is priced.** The premium-slab counts READ `bonus_rules`; whether those slabs were
--     actually APPLIED to a pour is 6b-1's `dairy_bonus_slabs` flag, and the panel reports `earned` or `would_qualify`
--     accordingly (6b-2's distinction). A cooperative running with the slab flag off sees how many members WOULD have
--     earned the premium, labelled as such - never a premium total that was never paid.
--   • **It does not decide the member drill-down.** W172's restricted state names `member.view360`, which 0128 already
--     defines and grants to `tenant_admin` only. This wave honours that permission on the drill-down and adds no new
--     grant: a figure a manager may see in aggregate is not a person's record they may open.
--   • **It does not build the export.** W2553 and W2554 promise a QUEUED export with a position and an ETA, a ready
--     page, and an audit-stamped receipt carrying row count, sha256, generated-at and requester, delivered by a
--     15-minute signed URL with every fetch logged. The tenant realm has none of that plane: `report_export_receipts`
--     and `report_export_downloads` (0120) are `REVOKE ALL ... FROM kv_app, kv_relay` and keyed on
--     `generated_by_admin_id`; `data_export_jobs` (0015) is the DPDP/offboarding queue, admin-approved, with no queue
--     position, ETA, row count, checksum or fetch log; and the one tenant export that exists (TENANT-3c-1's GSTR-1)
--     is synchronous, capped at 50,000 rows, and hands back a receipt that lives only in the response body. That is a
--     queue, an issuer and a log — **TENANT-6e-2 · THE EXPORT**, declared here rather than thinned into this wave.
