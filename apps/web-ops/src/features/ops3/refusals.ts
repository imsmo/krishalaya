// apps/web-ops/src/features/ops3/refusals.ts · PC-56 OPS-3 — WHAT THE DAIRY COUNTER'S PAGES DO NOT CLAIM, BY NAME. PURE. The shape of
// features/ops2/refusals.ts: each refused canon claim is listed ONCE with where the canon makes it and the surfaces that PRINT it (a sentence that
// says no — never an offer); the render tests read this map, and the claims guard (test/claims-guard.spec.ts, the `ops3.` scope) keeps the canon's
// false words out of every `ops3.` value. No canon person, member, centre, card number, place or figure appears in any value.
//
// OPS-3 is three waves (founder, 2026-11-08; `05_OPS.md` "OPS-3 SPLIT"): 3c → 3a → 3b. This registry carries ALL 23 canon files; the files of the
// waves not yet built stay `pending_3a` / `pending_3b` until their wave decides them (the 4c-7 rule: the value is deleted from the type when the
// last of its files is decided).
//
// OPS-3c · THE PRICE (founder Q1-A — built in HOTFIX-12 —, Q8-A, Q10-A, Q14-A, Q15-A, 2026-11-08) builds:
//   • `rates` (W368, `/rates`) — a READ of the organisation's APPROVED milk rate cards (`GET /v1/dairy/rate-cards?activeOnly=true`, which since
//     HOTFIX-12 means approved and active), each with its name, milk type, pricing model in words, the fat / SNF / base rates through the money
//     formatter ("per kg of fat", "per kg of SNF", "per kg of milk" — Q8-A), the days it covers, its approval state and its premium slabs; whether
//     premium slabs are being paid (the `dairy_bonus_slabs` switch, read from `GET /v1/config/flags`); the rule in WORDS, never a sum; two
//     approved cards covering one day for one milk type raised as an ERROR; the change sentence (only clauses the code proves at merge). No
//     ready-reckoner, no worked example, no poster, no change button, no input.
//   • `rate_export` (W3338–W3339) — DECOR (Q15-A: the poster is refused; no producer).
//   • `rate_act` (W3340–W3342) — PARITY-DECOR: its only trigger is "Retry" on a read; the confirm state links a plain re-read of `/rates`.
export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export type Ops3Surface =
  // the eight pages (survey E5)
  | 'pos_home' | 'pos_collect' | 'pos_quality' | 'pos_slip' | 'pos_exceptions' | 'pos_shift' | 'bmc' | 'rates'
  // the chains
  | 'pos_act' | 'bmc_form' | 'bmc_act' | 'rate_export' | 'rate_act';
export interface Ops3Refusal { id: string; canon: string; surfaces: readonly Ops3Surface[]; key: string; why: string }

/** The surfaces OPS-3c builds. */
export const SURFACES_3C: readonly Ops3Surface[] = ['rates', 'rate_export', 'rate_act'];
const RATE_ALL: readonly Ops3Surface[] = ['rates', 'rate_export', 'rate_act'];

export const OPS3_REFUSALS: readonly Ops3Refusal[] = Object.freeze([
  // ══ W368 · the rate card (founder Q1-A, Q8-A, Q15-A) ══
  { id: 'card_number', canon: 'W368 heading "Rate card [ref] — public math, same for everyone"', surfaces: ['rates'],
    key: 'ops3.refusal.cardNumber', why: 'FALSE: a card has no number or code column (0009 `milk_rate_cards`); it is shown by its own name' },
  { id: 'versioned', canon: 'W368 "v3 effective 01 Jul (versioned — every pour stores its rate_card_id, so old slips recompute forever)"', surfaces: ['rates'],
    key: 'ops3.refusal.versioned', why: 'FALSE (survey C-9): no version column; "every pour stores its rate_card_id" is true (0009:301); a pour is never priced again — its stored amount is the money' },
  { id: 'never_quietly', canon: 'W368 "Version history — rates never change quietly · v3 … v2 … v1"', surfaces: ['rates'],
    key: 'ops3.refusal.neverQuietly', why: 'refused by the founder\'s wording rule (OPS-3 brief §D): only the HOTFIX-12 facts the code proves are said; there is no version history' },
  { id: 'announced_ahead', canon: 'W368 "Every change announced 7 days ahead on the counter poster, the app and SMS — a rate that surprises the queue is a rate done wrong."', surfaces: ['rates'],
    key: 'ops3.refusal.announcedAhead', why: 'FALSE: no notice period exists; a card starts on the organisation\'s tomorrow at the earliest (HOTFIX-12) and members are sent a push / in-app notice at approval' },
  { id: 'sms', canon: 'W368 "… the app and SMS"', surfaces: ['rates'],
    key: 'ops3.refusal.sms', why: 'FALSE: the approval notice is push and in-app only (seed 0007 `dairy.rate_card_approved` channels); no SMS is sent' },
  { id: 'board_minute', canon: 'W368 state "Rates are the FPO board\'s — … Changing needs the tenant dairy desk + board minute reference — recorded."', surfaces: ['rates'],
    key: 'ops3.refusal.boardMinute', why: 'FALSE: no board-minute field exists on a card (0009, 0234)' },
  { id: 'poster', canon: 'W368 "Print counter poster (A2, [lang])" (FM:52, `chain-export:rate` → W3338–W3339) · "Bonus slabs … print with the card … and the poster says that too."', surfaces: ['rates', 'rate_export'],
    key: 'ops3.refusal.poster', why: 'GAP-BE + founder Q15-A: nothing produces a poster; no `dairy.rate_card` dataset on the export plane' },
  { id: 'ready_reckoner', canon: 'W368 ready-reckoner "₹ per kg of milk · fat% \\ SNF% … = [n]" (FM:19 drill-in, the linkless table)', surfaces: ['rates'],
    key: 'ops3.refusal.readyReckoner', why: 'client money math refused (E3): the page computes no price' },
  { id: 'worked_example', canon: 'W368 "Formula on the poster too: ₹/kg = fat% × [n] + SNF% × [n]. Example the queue can check: [n] fat / [n] SNF → … = ₹[n] — exactly [member]\'s slip."', surfaces: ['rates'],
    key: 'ops3.refusal.workedExample', why: 'client money math refused (E3); the rule is printed in words; a member is never named (Q10-A)' },
  { id: 'cached_card', canon: 'W368 state "Card fetch failed — POS keeps pricing from its cached card (the version is printed on every slip) — a network blip never reprices milk."', surfaces: ['rates', 'rate_act'],
    key: 'ops3.refusal.cachedCard', why: 'FALSE: the server prices every pour (`milk-collection.service.ts` record); no device keeps a card; no slip is printed' },
  { id: 'change_here', canon: 'W368 state "Changing rates is dairy-desk-restricted — … tenant dairy desk plus a board minute reference, recorded."', surfaces: ['rates'],
    key: 'ops3.refusal.changeHere', why: 'founder Q1-A: this console only READS rates; no create, approve or close act is offered here' },
  { id: 'search', canon: 'W368 "Search rates… ⌘K"', surfaces: RATE_ALL,
    key: 'ops3.refusal.search', why: 'DECOR: no rate search route; no input is built (E7)' },
  { id: 'plan_settings', canon: 'W368 flagged-off state "… Nothing is broken — it is not enabled. See plan settings."', surfaces: ['rates'],
    key: 'ops3.refusal.planSettings', why: 'the S1…S6 precedent: no settings page is pointed to; a switched-off module says it is switched off' },
  { id: 'pourer_count', canon: 'console chrome "[org] · dairy ops · [n] member pourers · 2 shifts" · avatar "MM"', surfaces: RATE_ALL,
    key: 'ops3.refusal.pourerCount', why: 'no count is computed on this page (E3); no member is shown (Q10-A); "MM" is an avatar span, not a role (Q14-A)' },
  // ══ the two chains ══
  { id: 'export_queue', canon: 'W3338 "this job is queued with a position and ETA; you will find the file on the ready page"', surfaces: ['rate_export'],
    key: 'ops3.refusal.exportQueue', why: 'no job is created (Q15-A)' },
  { id: 'export_receipt', canon: 'W3338 "audit-stamped, checksummed, delivered by signed URL" · W3339 "Audit-stamped receipt: file name, row count, sha256 … 15-min signed URL, every fetch logged"', surfaces: ['rate_export'],
    key: 'ops3.refusal.exportReceipt', why: 'TRUE of CORE\'s export plane in mechanism, but no rate-card dataset is registered — refused here' },
  { id: 'rate_confirm_audit', canon: 'W3340 "confirming writes an audit-trail entry with actor, time and reason"', surfaces: ['rate_act'],
    key: 'ops3.refusal.rateConfirmAudit', why: 'reading the cards again writes nothing' },
  { id: 'rate_zero_sum', canon: 'W3341 "The change is applied and the audit trail has the entry (actor · time · reason · before/after). Money-adjacent actions reconcile zero-sum before this page ever shows."', surfaces: ['rate_act'],
    key: 'ops3.refusal.rateZeroSum', why: 'FALSE on a re-read, and on the page that sets a member\'s pay the most dangerous chain sentence: nothing was changed, nothing balanced — refused BY NAME' },
  { id: 'rate_audit_trail', canon: 'W3341 "View audit trail"', surfaces: ['rate_act'],
    key: 'ops3.refusal.rateAuditTrail', why: 'no ops audit surface exists; the card\'s own record is on the organisation\'s console' },
  { id: 'rate_on_call', canon: 'W3342 "repeated failures page the on-call"', surfaces: ['rate_act'],
    key: 'ops3.refusal.rateOnCall', why: 'no paging exists for these pages' },
]);
export function ops3RefusalKeys(surface: Ops3Surface): string[] { return OPS3_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key); }

/** What was built differently from the canon, and why (DELTAs). */
export const OPS3_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'route_rates', canon: 'W368 canon route `rates`; the console sidebar "Centre · Rate card"', built: '`/rates` at the canon address, a sidebar entry "Rates" under a Dairy group with the built `/dairy` and `/payout` only (E2: built routes only)' },
  { id: 'fm_drill_in_reckoner', canon: 'FM:19 drill-in — the ready-reckoner grid on W368, the one linkless table', built: 'none: the grid is client money math and is refused by name (`ready_reckoner`)' },
  { id: 'fm_chain_ids_3', canon: 'FM :36-53 name W1770–W1779 and W1783–W1787 as chain targets (survey C-14)', built: 'those files do not exist; the real rate chains are W3338–W3339 (export) and W3340–W3342 (mutate)' },
  { id: 'no_prices_today_marker', canon: 'survey §1H: "the one `resolveActive` would pick today marked"', built: 'the server sends no such marker, so the page computes none (brief §E2): each card prints the days it covers' },
  { id: 'earlier_cards_premise', canon: 'brief §E2 "Earlier cards: `activeOnly:false`, labelled \'earlier cards\'; empty state \'No earlier card is on record.\'"',
    built: 'PREMISE WAS FALSE at first build: the API read `?activeOnly=false` as TRUE (`z.coerce.boolean()`). FIXED IN THIS WAVE (lead decision 2026-11-09): the query is the strict `queryBoolean()` and only a `dairy.manage` holder widens the list (`MilkRateCardService.list`). `/rates` keeps `activeOnly:true` as built and draws NO "earlier cards" section: the read carries no tenant "today", so telling which approved cards ended before today would need the page\'s own clock. The approved list already holds the closed cards, each with its dates' },
  { id: 'rate_act_reread', canon: 'W3340–W3342 confirm / success / failure (FM:53 "Retry")', built: 'PARITY-DECOR: the page\'s error state offers "Retry", whose confirm state links a plain re-read of `/rates`; Back → W368' },
  { id: 'rate_export_back', canon: 'W3338 / W3339 Back → W368', built: 'Back → `/rates` (the trigger and the donor are the same page)' },
  { id: 'slabs_paid_read', canon: 'W368 "Bonus slabs (bonus_rules) print with the card; there are none active this cycle"', built: 'each card\'s slabs printed; whether slabs are PAID from `GET /v1/config/flags` (`dairy_bonus_slabs` off for everyone ⇒ nobody is paid a premium; on ⇒ "not shown on this page"; unread ⇒ "could not be read")' },
  { id: 'rule_in_words', canon: 'brief §E2 "fat kg × the fat rate + SNF kg × the SNF rate, each rounded to the paisa"', built: 'the same rule with the words "times" and "plus" — no "×", "+" or "=" on the page (brief §C: no "×")' },
  { id: 'currency_inr', canon: 'survey E3 "the tenant\'s currency (never the \'INR\' literal)"', built: 'the console\'s house shape (OPS-1a payout, OPS-2c billing): `formatMoneyMinor(minor, \'INR\', lang)` — the console reads no tenant currency yet' },
]);

/** The verdict values. `pending_3a` / `pending_3b` are deleted from the type by the wave that decides the last of their files. */
export type Ops3Verdict = 'BUILT (read)' | 'BUILT (honest)' | 'REAL' | 'DECOR' | 'PARITY-DECOR' | 'pending_3a' | 'pending_3b';
export type Ops3Wave = '3a' | '3b' | '3c';
/** Every canon file of OPS-3 (23), each with ONE verdict: 3c decides its 6; 3a's 9 and 3b's 8 wait for their waves. */
export const OPS3_CANON_FILES: readonly { file: string; wave: Ops3Wave; module: string; verdict: Ops3Verdict; note: string }[] = Object.freeze([
  // ── 3c · THE PRICE (6) — decided (founder Q1-A via HOTFIX-12, Q8-A, Q10-A, Q14-A, Q15-A) ──
  { file: 'W368-ops-rate-chart.html', wave: '3c', module: 'dairy', verdict: 'BUILT (read)', note: '/rates — a READ of the organisation\'s approved milk rate cards (GET /v1/dairy/rate-cards?activeOnly=true): name, milk type, pricing model in words, fat / SNF / base rates through the money formatter "per kg of fat / SNF / milk" (Q8-A), the days each covers, its approval state, its premium slabs and whether slabs are paid; the rule in words; two approved cards on one day for one milk type raised as an error; "Rates are changed on your organisation\'s dairy console, not here." + the HOTFIX-12 facts; no change button, no ready-reckoner, no poster, zero inputs' },
  { file: 'W3338-ops-rate-export-queued.html', wave: '3c', module: 'dairy', verdict: 'DECOR', note: '/rates?export=queued — "Print counter poster" refused (Q15-A): nothing queued' },
  { file: 'W3339-ops-rate-export-ready.html', wave: '3c', module: 'dairy', verdict: 'DECOR', note: '?export=ready — no file was made; the export receipt refused; Back → /rates' },
  { file: 'W3340-ops-rate-mutate-confirm.html', wave: '3c', module: 'dairy', verdict: 'PARITY-DECOR', note: '/rates?act=confirm — "Retry": reading the cards again changes nothing; the link IS a re-read of /rates' },
  { file: 'W3341-ops-rate-mutate-success.html', wave: '3c', module: 'dairy', verdict: 'PARITY-DECOR', note: '?act=success — the cards are read afresh each time the page opens; nothing was changed; the zero-sum sentence refused BY NAME' },
  { file: 'W3342-ops-rate-mutate-failure.html', wave: '3c', module: 'dairy', verdict: 'PARITY-DECOR', note: '?act=failure — nothing was changed; Back → /rates reads it again; nobody is paged' },
  // ── 3a · THE COUNTER (9) — pending ──
  { file: 'W360-ops-pos-home.html', wave: '3a', module: 'dairy', verdict: 'pending_3a', note: 'OPS-3a (survey §1A)' },
  { file: 'W361-ops-pos-collect.html', wave: '3a', module: 'dairy', verdict: 'pending_3a', note: 'OPS-3a (survey §1B) — the record act' },
  { file: 'W362-ops-pos-quality.html', wave: '3a', module: 'dairy', verdict: 'pending_3a', note: 'OPS-3a (survey §1C)' },
  { file: 'W363-ops-pos-slip.html', wave: '3a', module: 'dairy', verdict: 'pending_3a', note: 'OPS-3a (survey §1D)' },
  { file: 'W364-ops-pos-exceptions.html', wave: '3a', module: 'dairy', verdict: 'pending_3a', note: 'OPS-3a (survey §1E)' },
  { file: 'W365-ops-pos-shift.html', wave: '3a', module: 'dairy', verdict: 'pending_3a', note: 'OPS-3a (survey §1F)' },
  { file: 'W3335-ops-pos-mutate-confirm.html', wave: '3a', module: 'dairy', verdict: 'pending_3a', note: 'OPS-3a (survey §1I)' },
  { file: 'W3336-ops-pos-mutate-success.html', wave: '3a', module: 'dairy', verdict: 'pending_3a', note: 'OPS-3a (survey §1I)' },
  { file: 'W3337-ops-pos-mutate-failure.html', wave: '3a', module: 'dairy', verdict: 'pending_3a', note: 'OPS-3a (survey §1I)' },
  // ── 3b · THE COOLER (8) — pending ──
  { file: 'W366-ops-bmc.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1G)' },
  { file: 'W3282-ops-bmc-form-form-error.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1J)' },
  { file: 'W3283-ops-bmc-form-review.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1J)' },
  { file: 'W3284-ops-bmc-form-success.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1J)' },
  { file: 'W3285-ops-bmc-form-failure.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1J)' },
  { file: 'W3286-ops-bmc-mutate-confirm.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1K)' },
  { file: 'W3287-ops-bmc-mutate-success.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1K)' },
  { file: 'W3288-ops-bmc-mutate-failure.html', wave: '3b', module: 'dairy', verdict: 'pending_3b', note: 'OPS-3b (survey §1K)' },
]);

/** The five canon chain groups (survey §1I–§1M, 15 files, each exactly once) and the wave that owns each. */
export const OPS3_CHAIN_GROUPS: readonly { id: string; donor: string; wave: Ops3Wave; files: readonly string[] }[] = Object.freeze([
  { id: 'pos_mutate', donor: 'W360 (comment) / W362 (links)', wave: '3a', files: ['W3335', 'W3336', 'W3337'] },
  { id: 'bmc_form', donor: 'W366', wave: '3b', files: ['W3282', 'W3283', 'W3284', 'W3285'] },
  { id: 'bmc_mutate', donor: 'W366', wave: '3b', files: ['W3286', 'W3287', 'W3288'] },
  { id: 'rate_export', donor: 'W368', wave: '3c', files: ['W3338', 'W3339'] },
  { id: 'rate_mutate', donor: 'W368', wave: '3c', files: ['W3340', 'W3341', 'W3342'] },
]);

// ── THE BUILT CHAINS: each is a query state of its parent page (the OPS-1 `Ops1Chain` / OPS-2 `Ops2Chain` shape). ──
export type Chain3Id = 'rate_export' | 'rate_act';
export interface Chain3Def {
  id: Chain3Id; wave: Ops3Wave; kind: 'DECOR' | 'REAL' | 'PARITY-DECOR'; param: 'act' | 'export'; page: string; surface: Ops3Surface; states: readonly string[];
  key: (state: string) => string; files: readonly string[]; statement: string;
}
export const OPS3_CHAINS: readonly Chain3Def[] = Object.freeze([
  { id: 'rate_export', wave: '3c', kind: 'DECOR', param: 'export', page: '/rates', surface: 'rate_export', states: ['queued', 'ready'],
    key: (s: string) => `ops3.chain.rateExport.${s}`, files: ['W3338', 'W3339'], statement: 'ops3.rates.notHere' },
  { id: 'rate_act', wave: '3c', kind: 'PARITY-DECOR', param: 'act', page: '/rates', surface: 'rate_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `ops3.chain.rateAct.${s}`, files: ['W3340', 'W3341', 'W3342'], statement: 'ops3.rates.notHere' },
]);
export function chain3ById(id: Chain3Id): Chain3Def { return OPS3_CHAINS.find((c) => c.id === id) as Chain3Def; }
/** The chain state a page was opened in (`?act=confirm`, `?export=queued` …), or null for the page itself / an unknown state. */
export function chain3State(id: Chain3Id, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chain3ById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
