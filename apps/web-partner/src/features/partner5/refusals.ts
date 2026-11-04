// apps/web-partner/src/features/partner5/refusals.ts · PC-56 PARTNER-5a · THE BOOK IN ARREARS, AS COUNTS (founder 5a-5 … 5a-8) — WHAT THE
// LENDER'S ARREARS PAGES DO NOT CLAIM, BY NAME. PURE. The shape of features/partner4/refusals.ts: each refused canon claim is listed ONCE
// with where the canon makes it and the surfaces that PRINT it (a sentence that says no — never an offer); the render tests read this map,
// and the claims guard (test/claims-guard.spec.ts, the `partner5.` scope) keeps the canon's false words out of every value AND out of every
// key this registry prints (including the PARTNER-4 keys it reuses). The sentences word the refused claims generically: no canon person,
// place, institution, bank, loan or case reference, scheme, figure or avatar appears in any value.
//
// THE SURFACES `Partner5Surface`: `aging` (W223) · `writeoffs` (W222) — built in 5a as READS of the existing 4a/4b definers, with their four
// chain surfaces `aging_export` (W2929–W2930, DECOR + the mailbox line) · `aging_act` (W2931–W2933, PARITY-DECOR: Retry is a genuine re-read)
// · `writeoffs_export` (W3024–W3025, DECOR + the mailbox line) · `writeoffs_act` (W3026–W3028, PARITY-DECOR). The 5b and 5c surfaces are
// DECLARED in the type and used by nothing yet: their founder doors (Q4, Q5, Q6, Q7) are 5b's and 5c's, and their refusals are registered
// there, never here.
export type Partner5Surface =
  | 'aging' | 'writeoffs' | 'aging_export' | 'aging_act' | 'writeoffs_export' | 'writeoffs_act'
  // PARTNER-5b / 5c — declared, unused in 5a
  | 'collections' | 'collections_case' | 'restructure' | 'sla'
  | 'collections_form' | 'collections_act' | 'case_act' | 'restructure_act' | 'sla_export' | 'sla_act';
export interface Partner5Refusal { id: string; canon: string; surfaces: readonly Partner5Surface[]; key: string; why: string }

/** The two export chains of 5a: DECOR, with the partners-mailbox line. */
const EXPORT: readonly Partner5Surface[] = ['aging_export', 'writeoffs_export'];
/** Every chain surface of 5a. */
const CHAINS: readonly Partner5Surface[] = ['aging_export', 'aging_act', 'writeoffs_export', 'writeoffs_act'];
/** The two pages of 5a. */
const PAGES: readonly Partner5Surface[] = ['aging', 'writeoffs'];

export const PARTNER5_REFUSALS: readonly Partner5Refusal[] = Object.freeze([
  // ── W223 · days past a recorded due date (founder 5a-6) ──
  { id: 'percent_of_book', canon: 'W223 column "% of book" and every cell of it ("95.4%" … "0.0%")', surfaces: ['aging', 'aging_export'],
    key: 'partner5.refusal.percentOfBook', why: 'founder 5a-6 / 4b-7 / survey E9: each row is a count and a bigint Σ of `outstanding_minor` (0232:112-130); a share of the book is a ratio and is not printed — and over a book whose due dates are all NULL it would mislead whichever way it rounded' },
  { id: 'missed_instalments', canon: 'W223 column "Arrears (missed inst.)" and the lead "arrears shown alongside (what collections works). Two numbers, labelled, never conflated."', surfaces: ['aging'],
    key: 'partner5.refusal.missedInstalments', why: 'GAP-BE (P4-B9): there is no instalment table (0011 has none; FIN/domain/loan-repayment.entity.ts:2-3 — a repayment row is created AT PAYMENT), so there is nothing missed to sum. The outstanding basis EXISTS and is the only one printed (survey §1F)' },
  { id: 'five_buckets', canon: 'W223 rows "current 1,110 …" · "1–15 DPD" · "16–30 DPD" · "31–90 DPD" · "90+ DPD"', surfaces: ['aging'],
    key: 'partner5.refusal.fiveBuckets', why: 'DELTA: the canon\'s five buckets are not the platform\'s six (`not_due` · `no_due_date` · 1-30 · 31-60 · 61-90 · 90+, 0232:115-123); "current" must not absorb `no_due_date` — a loan with no due date is undated, not on time, and today that is every loan (0232:117)' },
  { id: 'pre_review', canon: 'W223 row "90+ DPD (pre-NPA review)"', surfaces: ['aging'],
    key: 'partner5.refusal.preReview', why: 'FALSE: no review of any kind and no asset classification exists in FIN, PCON or any migration — the bucket is a count (survey §1F; §1 "No overdue")' },
  { id: 'cure_machinery', canon: 'W223 "Zero loans in 90+ — the cure machinery (auto-deduction, early vet-visit-style nudges, mediation) works upstream so the bottom bucket stays empty."', surfaces: ['aging'],
    key: 'partner5.refusal.cureMachinery', why: 'FALSE (survey F-6): 90+ is zero because no loan has a due date (`loan-application.service.ts:129` opens every loan with `nextDueDate: null`; 0232:117), not because anything cures; there is no contact engine (4b-5) and the "vet-visit" inference is the WALL. The canon\'s last sentence ("the day it doesn\'t, this table says so") becomes true only with P4-B9' },
  { id: 'computed_nightly', canon: 'W223 error state "Couldn\'t load aging — Bucket math is server-computed nightly + live-adjusted."', surfaces: ['aging', 'aging_act'],
    key: 'partner5.refusal.computedNightly', why: '"server-computed" is TRUE; "nightly + live-adjusted" is FALSE — no job exists; `partner_loan_dpd()` is a STABLE SQL function evaluated on every request (0232:112) and each answer carries `computedAt`' },
  { id: 'bucket_drilldown', canon: 'FM:32 drill-in "linkless table" on W223 — a bucket row opened to the loans in it', surfaces: ['aging'],
    key: 'partner5.refusal.bucketDrilldown', why: 'refused (founder 5a-5, WALL): a bucket drill-down would list the loans in arrears; a lender never names, ranks or contacts a borrower through this console, so a row is not a link (survey §1F)' },
  { id: 'aging_roles', canon: 'W223 restricted state "Aging restricted — Risk-committee view; needs credit-risk role." · W222 restricted state "Write-offs restricted — Board-level view …"', surfaces: PAGES,
    key: 'partner4.refusal.platformRoles', why: 'FALSE: the partner realm has four roles (0225) and `partner.loans.read` covers both pages for all four (0231:142-164); no risk-committee, credit-risk or board role exists — PARTNER-4\'s refusal, reused by key' },
  { id: 'plan_settings', canon: 'W222 / W223 flagged-off state "This module is switched off for this tenant/plan (feature flag) … See plan settings."', surfaces: PAGES,
    key: 'partner4.refusal.planSettings', why: 'OFF-as-OFF via `partner_console` (`lib/lender.ts:34-37`); no plan-settings surface exists for a partner organisation (the 2a / 2c / 3a / 4a precedent, reused by key)' },
  // ── W222 · written-off loans (founder 5a-3 / 5a-7) ──
  { id: 'written_off_share', canon: 'W222 "2 loans written off FY (₹1,10,000 · 0.16% of book)"', surfaces: ['writeoffs', 'writeoffs_export'],
    key: 'partner4.refusal.writtenOffShare', why: 'founder 4a-7 / survey E9: the count and the bigint sum are printed (`partner-loans.rules.ts:169`, :198); the share is a ratio and is not — PARTNER-4a\'s refusal, reused by key' },
  { id: 'writeoff_date', canon: 'W222 "2 loans written off FY" read as written off IN the year, and the column "Written off" read as a moment', surfaces: ['writeoffs'],
    key: 'partner5.refusal.writeoffDate', why: 'there is no write-off date: no `written_off_at` column exists and `updated_at` moves on any update (0001:45-74; survey C-4). The counts window is over loans OPENED (0231:262-263, `l.created_at`), so the page prints "of the loans opened in this window"' },
  { id: 'books_not_story', canon: 'W222 "A write-off closes your books, not the borrower\'s story — recovery stays open, humane, and logged."', surfaces: ['writeoffs'],
    key: 'partner5.refusal.booksNotStory', why: 'FALSE ×3 (survey F-2): the loan is the cooperative\'s, not the lender\'s (FIN README :13-15); a `written_off` loan refuses every repayment (`loan.entity.ts:34`) and the milk deduction skips it (`loan.repository.ts:71`), so nothing stays open; and nothing is logged (C-5)' },
  { id: 'cause_column', canon: 'W222 table column "Cause" and the rows\' causes (a borrower\'s death, a lapsed policy, a herd\'s disease)', surfaces: ['writeoffs'],
    key: 'partner5.refusal.causeColumn', why: 'GAP-BE + WALL: the reason the write-off route demands is discarded (`servicing.service.ts:88-98`, survey C-4), and a cause would be a fact about a person and her family (survey F-4) — never copied into a fixture or a value' },
  { id: 'recovered_since', canon: 'W222 column "Recovered since" and the cell "₹18,000 (… claim, family-assisted)"', surfaces: ['writeoffs'],
    key: 'partner5.refusal.recoveredSince', why: 'FALSE (MONEY): no recovery money can move — a written-off loan refuses every repayment (`loan.entity.ts:34`) and `ledger_txn_type` has no `recovery` code (seed core/0005:41). Recording a recovery is the money wave\'s (P5-B11, founder 5a-3 Q2-b)' },
  { id: 'causes_documented', canon: 'W222 footer "2 of 2 write-offs (FY) · both causes documented — neither is \'refused to pay\'" (FM:166, classed `filter`)', surfaces: ['writeoffs'],
    key: 'partner5.refusal.causesDocumented', why: 'FALSE: nothing is documented (C-4); and the footer is a static line FM mis-classed (F-15) — recorded as a DELTA too' },
  { id: 'writeoff_gates', canon: 'W222 "Write-off gate (hard)": "≥ 180 DPD · mediation attempted · restructure offered or inapplicable" · "Committee sign-off (your bank) + platform conduct check"', surfaces: ['writeoffs'],
    key: 'partner5.refusal.writeoffGates', why: 'FALSE ×5 (survey §1 "Write-off rules, as coded"): one person, `overdue` only, no DPD threshold, no mediation check, no committee, no conduct check — and founder 5a-3 now refuses every write-off by name (`WRITE_OFF_NOT_LIVE`) until P5-B1 + P4-B12 ship together' },
  { id: 'post_writeoff_conduct', canon: 'W222 "Post-write-off: no recovery agents · family approached only for insurance/estate help"', surfaces: ['writeoffs'],
    key: 'partner5.refusal.postWriteoffConduct', why: 'nothing enforces any of it: no contact engine, no agent register and no conduct check exist (founder 4b-5 / 5a-5; `features/partner4/refusals.ts` `code_of_conduct`). "marketplace access never blocked" is 5b\'s true line and is left to it' },
  { id: 'dairy_case', canon: 'W222 "The dairy case, honestly — Herd loss with a disease-outbreak record (animal health file) — insurance would have covered it, but the enrolment lapsed."', surfaces: ['writeoffs'],
    key: 'partner5.refusal.dairyCase', why: 'WALL: an animal-health record is dairy data on the other side of the wall (survey §1E), and a case narrative is a family\'s; no lender is told one' },
  { id: 'cattle_insurance_rule', canon: 'W222 "The platform lesson shipped already: livestock-loan disbursal now requires active insurance (product rule since Apr 2026)."', surfaces: ['writeoffs'],
    key: 'partner4.refusal.cattleInsuranceRule', why: 'FALSE — S4 already refused the identical claim on W218 (`features/partner4/refusals.ts` `cattle_insurance_rule`): `eligibility_rules` is evaluated by nothing. Reused BY KEY (brief §E)' },
  { id: 'recorded_with_evidence', canon: 'W222 "Write-offs recorded with cause evidence · recoveries post to the ledger like any money"', surfaces: ['writeoffs'],
    key: 'partner5.refusal.recordedWithEvidence', why: 'FALSE ×2 (MONEY): no cause, no evidence (C-4); no `write_off` / `recovery` `ledger_txn_type` (seed core/0005:41)' },
  { id: 'gate_exists', canon: 'W222 empty state "No write-offs — A clean book — the gate exists for the years that are not like this one."', surfaces: ['writeoffs'],
    key: 'partner5.refusal.gateExists', why: '"the gate exists" is FALSE (survey §1E); "none have reached that point" is TRUE for a STRUCTURAL reason — nothing ever becomes `overdue` (C-6) — so the empty state says the reason, not the virtue' },
  { id: 'records_immutable', canon: 'W222 error state "Couldn\'t load write-offs — Records are immutable. Retry."', surfaces: ['writeoffs', 'writeoffs_act'],
    key: 'partner5.refusal.recordsImmutable', why: 'FALSE: there is no write-off record at all, and `loans` is an ordinary updatable table with no trigger (survey §1E; founder 4c-5 / 5a-8: the word is never printed about any table here)' },
  { id: 'board_committee', canon: 'W222 restricted state "Board-level view; initiating needs committee workflow, never a single officer."', surfaces: ['writeoffs'],
    key: 'partner5.refusal.boardCommittee', why: 'FALSE ×2 (survey F-2): no board role exists, and initiating needed EXACTLY a single officer (`servicing.service.ts:88-98`) — the canon\'s sentence is the precise inverse of the code; founder 5a-3 refuses the act by name now' },
  // ── the four chains (W2929–W2930, W2931–W2933, W3024–W3025, W3026–W3028) ──
  { id: 'board_pack', canon: 'W222 "Export (board pack)" (FM:168, `chain-export` → W3024–W3025) and the module sentence of W3024 / W3025', surfaces: ['writeoffs', 'writeoffs_export'],
    key: 'partner5.refusal.boardPack', why: 'DECOR (founder 5a-8, 2b-1): no partner export plane exists (P2-B6), and the lender\'s board is not a platform surface — nothing is prepared for one' },
  { id: 'export_file', canon: 'W2929 / W3024 "audit-stamped, checksummed, delivered by signed URL" · W2930 / W3025 "file name, row count, sha256, generated-at, requester — delivery via 15-min signed URL, every fetch logged" · W223 "Export (signed)"', surfaces: [...EXPORT, ...PAGES],
    key: 'partner4.refusal.exportFile', why: 'founder 5a-8 / 4a-7 (2b-1): there is no partner export plane in Phase 1 (P2-B6); the console names the partners mailbox instead — PARTNER-4\'s refusal, reused by key' },
  { id: 'chain_zero_sum', canon: 'W2932 / W3027 "Money-adjacent actions reconcile zero-sum before this page ever shows"', surfaces: CHAINS,
    key: 'partner4.refusal.chainZeroSum', why: 'nothing reached from these pages moves a rupee (survey §1 rupee 6), so there is nothing to reconcile — reused by key' },
  { id: 'chain_on_call', canon: 'W2933 / W3028 "repeated failures page the on-call"', surfaces: CHAINS,
    key: 'partner4.refusal.chainOnCall', why: 'no paging from a partner page exists (survey §1, the shared chain sentences refused by PARTNER-1…4) — reused by key' },
  { id: 'chain_audit', canon: 'W2931 / W3026 "confirming writes an audit-trail entry with actor, time and reason" · W2932 / W3027 "View audit trail" · "the audit trail has the entry (actor · time · reason · before/after)"', surfaces: CHAINS,
    key: 'partner4.refusal.chainAudit', why: 'a re-read writes only its own partner-realm read row (one per dpd / counts / list read, counts only — survey E10; PCON partner-console.controller.ts:294-331 are GETs) and the console has no audit-trail page — reused by key' },
]);

/** The refusal i18n keys printed on one surface (render tests read this). */
export function partner5RefusalKeys(surface: Partner5Surface): string[] {
  return PARTNER5_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}

/** The canon shapes PARTNER-5a builds differently — recorded DELTAs, not refusals (survey F-15 / F-16). */
export const PARTNER5_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'fm_footer_filter', canon: 'FM:166 — W222\'s static footer "2 of 2 write-offs (FY) · both causes documented…" classed `filter`',
    built: 'no footer is drawn; the claim in it is refused by name (`causes_documented`), and nothing on the page is a filter' },
  { id: 'fm_td_filter', canon: 'FM:169 — W222\'s `<td>` holding a canon loan number (a reference cell) classed `filter`',
    built: 'each row\'s loan reference is a REAL LINK to that loan\'s own page (`/lender/portfolio/[id]`, the 4a read) — the reference is the id\'s short form, never a loan number' },
  { id: 'fm_avatar_filter', canon: 'FM:167 (W222) and FM:172 (W223) — the two-letter avatar `<span>` classed `filter`',
    built: 'no avatar is drawn; the header carries the platform\'s mark and the lender\'s own name (founder 5a-8)' },
  { id: 'fm_dead_nav_detail', canon: 'FM:171 (W222) and FM:175 (W223) — "View portfolio", a dead `<button … data-decor>` FM registers as `nav-detail` "sibling detail by context (build resolves)"',
    built: 'a REAL link to `/lender/portfolio` on both pages' },
  { id: 'fm_chain_ids', canon: 'FM names the four chains by W13xx ids that exist nowhere: W1387/W1388, W1389–W1391, W1392/W1393, W1394–W1396 (`ls CANON | grep -cE "^W1(38[7-9]|39[0-6])-"` → 0)',
    built: 'the canon\'s own files: W1387/W1388 → W3024/W3025, W1389–W1391 → W3026–W3028, W1392/W1393 → W2929/W2930, W1394–W1396 → W2931–W2933. The HTML was right; FM is stale (survey F-15)' },
  { id: 'orphans_subnav', canon: 'W222 and W223 are TOTAL ORPHANS — reachable only from their own five chain pages; W212, their crumb parent, links to neither (survey F-16)',
    built: 'the inbound edge the canon never drew is the lending sub-navigation: two LIVE rows (`/lender/portfolio/writeoffs`, `/lender/portfolio/aging`) on every lending page. Neither is a sidebar item (the canon has none either)' },
  { id: 'drill_ins', canon: 'FM:31 (W222) and FM:32 (W223) — the two "linkless tables"',
    built: 'W222\'s rows link to the loan page (the 4a read); W223\'s bucket table stays linkless — a drill-down would list the loans in arrears (refused, `bucket_drilldown`)' },
  { id: 'six_buckets', canon: 'W223\'s five buckets — current / 1–15 / 16–30 / 31–90 / 90+ — with a "% of book" column',
    built: 'the platform\'s SIX (0232:115-123): no due date recorded FIRST (with the reason beside it), then not yet due, then 1–30 · 31–60 · 61–90 · more than 90 days past a recorded due date — each a count and a bigint sum; the days spelled out, never the acronym; no "current", no share' },
  { id: 'sum_check_both', canon: 'W223 "5 buckets · 1,148 loans · ₹6,84,20,000 total outstanding ✓ (sums server-verified)"',
    built: 'the sentence prints BOTH figures — the BigInt sum of the six rows and the dpd read\'s servicing outstanding — never a tick alone; restructured loans sit outside both and their count is printed beside it (founder 5a-6, survey F-1)' },
  { id: 'two_windows', canon: 'W222 "written off FY" and W223 "As of 13 Jul" over one book',
    built: 'the dpd read is NOT windowed (every servicing loan); the counts read IS (loans OPENED in the IST window); the written-off list is NOT (every written-off loan, whenever opened). Each figure carries the label of its own window and its own as-of' },
  { id: 'chain_routes', canon: 'the chain pages W2929–W2933 and W3024–W3028 as separate files',
    built: 'query states of their parent pages: `?export=queued|ready` and `?act=confirm|success|failure` on `/lender/portfolio/aging` and `/lender/portfolio/writeoffs`; Back returns to the triggering page' },
]);

/** Every canon file of PARTNER-5 (31), each with ONE verdict. 5a decides its 12; 5b's 13 and 5c's 6 wait for their own waves. */
export type Partner5Verdict = 'BUILT (read)' | 'BUILT (honest)' | 'PARITY-DECOR' | 'DECOR' | 'pending_5b' | 'pending_5c';
export const PARTNER5_CANON_FILES: readonly { file: string; wave: '5a' | '5b' | '5c'; verdict: Partner5Verdict; note: string }[] = Object.freeze([
  // ── 5a · THE BOOK IN ARREARS, AS COUNTS (12) ──
  { file: 'W223-partner-dpd-aging.html', wave: '5a', verdict: 'BUILT (read)', note: '/lender/portfolio/aging over GET /v1/partner/loans/dpd + GET /v1/partner/loans/counts (two audit rows, counts only): the platform\'s SIX rows — no due date recorded first, with the statement beside it, then not yet due and the four rows past a recorded due date — each a count and a bigint sum; the sum-check sentence with BOTH figures; the restructured count from the windowed counts read with the restructured note; computedAt. Every percentage, "arrears (missed inst.)", the five buckets and "current", "pre-NPA review", the cure-machinery paragraph, "nightly + live-adjusted", the credit-risk role and "plan settings" are refused by name. Export is DECOR + mailbox; Retry is the PARITY-DECOR re-read; "View portfolio" is a real link' },
  { file: 'W222-partner-writeoffs.html', wave: '5a', verdict: 'BUILT (read)', note: '/lender/portfolio/writeoffs over GET /v1/partner/loans/counts + GET /v1/partner/loans?status=written_off (keyset; two audit rows): the written-off count and outstanding over the loans OPENED in the window, with the window label and that caveat; the statement and the lockdown note (founder 5a-7); every written-off loan as LOAN FACTS (reference → the loan page, kind, the cooperative\'s public name, principal, outstanding, status, opened). Never a cause, reason, write-off date, actor, person, scheme, animal or death. "0.16% of book", "closes your books…", the Cause and Recovered-since columns, "both causes documented", the five gates, the post-write-off conduct, the dairy case and the insurance product rule, "recorded with cause evidence", "the gate exists", "Records are immutable", the board/committee view and "plan settings" are refused by name. Export is DECOR + mailbox; Retry is the PARITY-DECOR re-read; "View portfolio" is real' },
  { file: 'W2929-partner-dpd-export-queued.html', wave: '5a', verdict: 'DECOR', note: '/lender/portfolio/aging?export=queued — no partner export plane (P2-B6): exports are not available, write to the partners mailbox' },
  { file: 'W2930-partner-dpd-export-ready.html', wave: '5a', verdict: 'DECOR', note: '?export=ready — no file, no row count, no checksum, no signed link' },
  { file: 'W2931-partner-dpd-mutate-confirm.html', wave: '5a', verdict: 'PARITY-DECOR', note: '/lender/portfolio/aging?act=confirm — the module\'s only trigger is Retry, a genuine re-read of partner_loan_dpd(): no confirm step, no audit row of its own, no money' },
  { file: 'W2932-partner-dpd-mutate-success.html', wave: '5a', verdict: 'PARITY-DECOR', note: '?act=success — the rows were read again; nothing was written' },
  { file: 'W2933-partner-dpd-mutate-failure.html', wave: '5a', verdict: 'PARITY-DECOR', note: '?act=failure — nothing changed' },
  { file: 'W3024-partner-writeoffs-export-queued.html', wave: '5a', verdict: 'DECOR', note: '/lender/portfolio/writeoffs?export=queued — no partner export plane; nothing is prepared for a board; write to the partners mailbox' },
  { file: 'W3025-partner-writeoffs-export-ready.html', wave: '5a', verdict: 'DECOR', note: '?export=ready — no file, no checksum, no signed link' },
  { file: 'W3026-partner-writeoffs-mutate-confirm.html', wave: '5a', verdict: 'PARITY-DECOR', note: '/lender/portfolio/writeoffs?act=confirm — Retry is a genuine re-read of partner_loan_counts + partner_loans(status => written_off): no confirm step, no audit row of its own, no money' },
  { file: 'W3027-partner-writeoffs-mutate-success.html', wave: '5a', verdict: 'PARITY-DECOR', note: '?act=success — the figures and the list were read again' },
  { file: 'W3028-partner-writeoffs-mutate-failure.html', wave: '5a', verdict: 'PARITY-DECOR', note: '?act=failure — nothing changed' },
  // ── 5b · COLLECTIONS THE PLATFORM DOES NOT DO (13) — decided by 5b ──
  { file: 'W219-partner-collections.html', wave: '5b', verdict: 'pending_5b', note: 'PARTNER-5b — an honest page that reads nothing (survey §1B)' },
  { file: 'W220-partner-collections-case.html', wave: '5b', verdict: 'pending_5b', note: 'PARTNER-5b — an honest page; its two canon inputs are never rendered (survey §1C)' },
  { file: 'W221-partner-restructure.html', wave: '5b', verdict: 'pending_5b', note: 'PARTNER-5b — an honest page (survey §1D)' },
  { file: 'W2914-partner-collections-form-form-error.html', wave: '5b', verdict: 'pending_5b', note: 'PARTNER-5b — the collections form chain (survey §1G)' },
  { file: 'W2915-partner-collections-form-review.html', wave: '5b', verdict: 'pending_5b', note: 'PARTNER-5b — the collections form chain' },
  { file: 'W2916-partner-collections-form-success.html', wave: '5b', verdict: 'pending_5b', note: 'PARTNER-5b — the collections form chain' },
  { file: 'W2917-partner-collections-form-failure.html', wave: '5b', verdict: 'pending_5b', note: 'PARTNER-5b — the collections form chain' },
  { file: 'W2918-partner-collections-mutate-confirm.html', wave: '5b', verdict: 'pending_5b', note: 'PARTNER-5b — the collections mutate chain (survey §1H)' },
  { file: 'W2919-partner-collections-mutate-success.html', wave: '5b', verdict: 'pending_5b', note: 'PARTNER-5b — the collections mutate chain' },
  { file: 'W2920-partner-collections-mutate-failure.html', wave: '5b', verdict: 'pending_5b', note: 'PARTNER-5b — the collections mutate chain' },
  { file: 'W2999-partner-restructure-mutate-confirm.html', wave: '5b', verdict: 'pending_5b', note: 'PARTNER-5b — the restructure mutate chain (survey §1I)' },
  { file: 'W3000-partner-restructure-mutate-success.html', wave: '5b', verdict: 'pending_5b', note: 'PARTNER-5b — the restructure mutate chain' },
  { file: 'W3001-partner-restructure-mutate-failure.html', wave: '5b', verdict: 'pending_5b', note: 'PARTNER-5b — the restructure mutate chain' },
  // ── 5c · THE PROMISE THE PLATFORM SETS (6) — decided by 5c ──
  { file: 'W214-partner-sla-reports.html', wave: '5c', verdict: 'pending_5c', note: 'PARTNER-5c — the promise the platform sets (survey §1A)' },
  { file: 'W3009-partner-sla-export-queued.html', wave: '5c', verdict: 'pending_5c', note: 'PARTNER-5c — the SLA export chain (survey §1N)' },
  { file: 'W3010-partner-sla-export-ready.html', wave: '5c', verdict: 'pending_5c', note: 'PARTNER-5c — the SLA export chain' },
  { file: 'W3011-partner-sla-mutate-confirm.html', wave: '5c', verdict: 'pending_5c', note: 'PARTNER-5c — the SLA mutate chain (survey §1O)' },
  { file: 'W3012-partner-sla-mutate-success.html', wave: '5c', verdict: 'pending_5c', note: 'PARTNER-5c — the SLA mutate chain' },
  { file: 'W3013-partner-sla-mutate-failure.html', wave: '5c', verdict: 'pending_5c', note: 'PARTNER-5c — the SLA mutate chain' },
]);

// ── THE DECOR / PARITY-DECOR CHAINS: each is a query state of its parent page ──
export type Chain5Id = 'aging_export' | 'aging_act' | 'writeoffs_export' | 'writeoffs_act';
export interface Chain5Def {
  id: Chain5Id; wave: '5a' | '5b' | '5c'; param: string; page: string; surface: Partner5Surface; states: readonly string[];
  key: (state: string) => string; files: readonly string[];
  /** An export chain prints "exports are not available … write to the partners mailbox" + the mailbox FACT (founder 5a-8, 2b-1). */
  mailbox?: boolean;
}
export const PARTNER5_CHAINS: readonly Chain5Def[] = Object.freeze([
  { id: 'aging_export', wave: '5a', mailbox: true, param: 'export', page: '/lender/portfolio/aging', surface: 'aging_export', states: ['queued', 'ready'],
    key: (s: string) => `partner5.chain.agingExport.${s}`, files: ['W2929', 'W2930'] },
  { id: 'aging_act', wave: '5a', param: 'act', page: '/lender/portfolio/aging', surface: 'aging_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner5.chain.agingAct.${s}`, files: ['W2931', 'W2932', 'W2933'] },
  { id: 'writeoffs_export', wave: '5a', mailbox: true, param: 'export', page: '/lender/portfolio/writeoffs', surface: 'writeoffs_export', states: ['queued', 'ready'],
    key: (s: string) => `partner5.chain.writeoffsExport.${s}`, files: ['W3024', 'W3025'] },
  { id: 'writeoffs_act', wave: '5a', param: 'act', page: '/lender/portfolio/writeoffs', surface: 'writeoffs_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner5.chain.writeoffsAct.${s}`, files: ['W3026', 'W3027', 'W3028'] },
]);
export function chain5ById(id: Chain5Id): Chain5Def { return PARTNER5_CHAINS.find((c) => c.id === id) as Chain5Def; }
/** The chain state a page was opened in (`?act=confirm` …), or null for the page itself / an unknown state. */
export function chain5State(id: Chain5Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain5ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
