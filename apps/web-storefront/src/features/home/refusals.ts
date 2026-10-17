// apps/web-storefront/src/features/home/refusals.ts · PC-56 STORE-1b · brief §E — EVERY CANON CLAIM THIS WAVE DOES NOT MAKE, BY NAME. PURE.
//
// Law 12: a trust surface renders only verified truth. The canon (W273 platform home, W274 tenant home, and their nine Retry chain pages)
// prints figures and promises the platform cannot back today. Each one is listed here ONCE, with where the canon makes it and how this
// build answers it: RENDERED as a keyed refusal sentence on the page (`key`), RECORDED only (not rendered — the claim would be incoherent
// or the element is simply not built), or a DELTA (the canon itself is wrong for this surface). The render tests read this map, so a
// refusal that silently disappears from a page — or a refused figure that comes back — turns a test red.

export type RefusalAnswer = 'rendered' | 'recorded' | 'delta';
export interface Refusal { id: string; canon: string; answer: RefusalAnswer; key?: string; why: string }

export const STORE1B_REFUSALS: readonly Refusal[] = Object.freeze([
  { id: 'gmv_yesterday', canon: 'W273 "Yesterday, buyers paid farmers ₹1,86,44,290 through the platform"', answer: 'rendered', key: 'home.refusal.gmv',
    why: 'founder D3: no approved method or attribution for a public payments figure' },
  { id: 'mandi_pulse', canon: 'W273 "Mandi pulse" + "Reference prices from AGMARKNET, updated this morning"', answer: 'rendered', key: 'home.refusal.mandi',
    why: 'founder D3: no approved licence, method or attribution; the market_intel read is not public' },
  { id: 'graded_rate', canon: 'W274 "98.2% orders delivered as graded"', answer: 'rendered', key: 'tenant.refusal.graded',
    why: 'no such metric is recorded anywhere' },
  { id: 'org_rating', canon: 'W274 "4.7★ · 2,180 buyer reviews"', answer: 'rendered', key: 'tenant.refusal.rating',
    why: 'reviews target sellers and buyers; no organisation-level rating is kept (a tenant wave)' },
  { id: 'org_description', canon: 'W274 "1,240 member farmers across Anand and Kheda. Groundnut, wheat …" (tenant-written)', answer: 'rendered', key: 'tenant.refusal.description',
    why: 'no tenant-written description exists and CMS has no public read (a tenant wave)' },
  { id: 'why_buy_copy', canon: 'W274 "Why buy from us" (farmer\'s share on every invoice; graded at our centres)', answer: 'rendered', key: 'tenant.refusal.why',
    why: 'tenant-authored copy needs a public CMS read; the invoice share is STORE-3\'s; the quality promise is built by STORE-SWEEP-a (/<slug>/quality-promise — the rules as the code runs them, not the organisation\'s own copy)' },
  { id: 'trace_demo', canon: 'W273 "See a live trace example"', answer: 'rendered', key: 'home.trace.demoRefused',
    why: 'no public demonstration lot exists; the trace-code entry replaces it' },
  { id: 'camera_scanner', canon: 'W273 "Scan a trace QR"', answer: 'rendered', key: 'home.trace.noCamera',
    why: 'no camera scanner is built; a typed code opens /trace/<code>' },
  { id: 'region_restricted', canon: 'W273 state "Some listings are region-restricted"', answer: 'recorded',
    why: 'no licence / region-restriction filter exists in any feed — the sentence would describe a rule that does not run' },
  { id: 'group_lots_platform_home', canon: 'W273 state "Flagged off — Group lots disabled" ("This seller organisation …")', answer: 'recorded',
    why: 'group lots is a per-organisation state; on the platform home there is no organisation it could be about (it is rendered on W274 from storefront.flags())' },
  { id: 'farmer_names_on_cards', canon: 'W273 / W274 cards "Ramesh Patel · member #0412"', answer: 'recorded',
    why: 'founder D4: a public card names the ORGANISATION, never a farmer or a member number' },
  { id: 'helpline_ussd', canon: 'common chrome "Missed call to order: 1800-419-0123 · USSD *123#"', answer: 'recorded',
    why: 'the IVR/USSD gateway is an unimplemented placeholder (STORE-1a C-2)' },
  { id: 'oncall_paging', canon: 'W3057 / W2465 / W3073 "repeated failures page the on-call"', answer: 'recorded',
    why: 'nothing pages anyone on a failed page load; the failure is the error state again (web-tenant repeatedFailuresGapKey)' },
  { id: 'platform_footer_on_tenant', canon: 'W274 footer (the platform store column + "Sell on …")', answer: 'delta',
    why: 'a tenant store wears its own footer (organisation, Help, Powered by) — the platform footer on a white-label store is a canon defect' },
  { id: 'confirm_over_reload', canon: 'W3055 / W2463 / W3071 "Confirm this action … writes an audit-trail entry"', answer: 'delta',
    why: 'Retry is a page reload (a read): no confirm step and no audit entry exist for a read — the sentence would be false' },
]);

/** The nine Retry chain pages and their verdicts (brief C4 — recorded, not built). Retry = `reloadHref` (features/home/load-result.ts). */
export const STORE1B_CHAIN_PAGES: readonly { file: string; verdict: string }[] = Object.freeze([
  { file: 'W3055-store-home-mutate-confirm.html', verdict: 'PARITY-DECOR (reload) · confirm sentence FALSE for a read → DELTA confirm_over_reload' },
  { file: 'W3056-store-home-mutate-success.html', verdict: 'PARITY-DECOR (the re-rendered home)' },
  { file: 'W3057-store-home-mutate-failure.html', verdict: 'PARITY-DECOR (the error state again) · "page the on-call" refused (oncall_paging)' },
  { file: 'W2463-store-tenanthome-mutate-confirm.html', verdict: 'PARITY-DECOR (reload) · DELTA confirm_over_reload' },
  { file: 'W2464-store-tenanthome-mutate-success.html', verdict: 'PARITY-DECOR (the re-rendered tenant home)' },
  { file: 'W2465-store-tenanthome-mutate-failure.html', verdict: 'PARITY-DECOR (the error state again) · oncall_paging refused' },
  { file: 'W3071-store-tenanthome-mutate-confirm.html', verdict: 'PARITY-DECOR (WSX-40 duplicate of W2463) · DELTA confirm_over_reload' },
  { file: 'W3072-store-tenanthome-mutate-success.html', verdict: 'PARITY-DECOR (orphan duplicate of W2464)' },
  { file: 'W3073-store-tenanthome-mutate-failure.html', verdict: 'PARITY-DECOR (orphan duplicate of W2465) · oncall_paging refused' },
]);

export function refusalKey(id: string): string {
  const r = STORE1B_REFUSALS.find((x) => x.id === id);
  if (!r || r.answer !== 'rendered' || !r.key) throw new Error(`refusals: '${id}' is not a rendered refusal`);
  return r.key;
}

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* PC-56 STORE-1c · brief §E — canon W307 "Open your organisation's storefront" and its 14 chain pages                                  */
/* ------------------------------------------------------------------------------------------------------------------------------------ */

/** Every W307 claim this build does not make, BY NAME. All `rendered` ones print in W307's `kv-refused` block (the render test reads this
 *  list, so a refusal that silently disappears — or a refused claim that comes back as an offer — turns it red). */
export const STORE1C_REFUSALS: readonly Refusal[] = Object.freeze([
  { id: 'ussd_voice_languages', canon: 'W307 "12 languages, voice-first, USSD" + the chrome "Missed call to order … USSD"', answer: 'rendered', key: 'signup.refused.ussd',
    why: 'three live console languages (en/hi/gu); the IVR/USSD gateway is an unimplemented placeholder (survey C-2)' },
  { id: 'sandbox_money', canon: 'W307 "Start in trial mode — real features, sandbox money"', answer: 'rendered', key: 'signup.refused.sandbox',
    why: 'no payments trial mode exists (GAP-B23)' },
  { id: 'escrow_ledger', canon: 'W307 "Escrow-protected payments … The ledger balances to the rupee, always."', answer: 'rendered', key: 'signup.refused.payments',
    why: 'wallet / online-payment flags are OFF — the page says nothing about escrow (brief §E), only that it makes no payment promise' },
  { id: 'trace_every_lot', canon: 'W307 "Farm-to-fork trace on every lot"', answer: 'rendered', key: 'signup.refused.trace',
    why: '`traceability` flag OFF — "every" would be false' },
  { id: 'your_domain', canon: 'W307 "your logo, your colours, your domain"', answer: 'rendered', key: 'signup.refused.domain',
    why: 'custom domains (`tenant_domains`) are OFF — the organisation gets its own address on the platform; custom domains later' },
  { id: 'partnerships_desk', canon: 'W307 "Prefer a human? Our partnerships desk calls you back: 1800-419-0123 · partners@krishalaya.in"', answer: 'rendered', key: 'signup.refused.desk',
    why: 'founder D3: no helpline, no partnerships desk, no callback desk exists; PC-56 STORE-SWEEP-a: the Contact page (/contact) lists every mailbox the platform has published (0223), or "not published yet"' },
  { id: 'resolution_desk', canon: 'W307 "names aren\'t first-come-first-served … the resolution desk sorts it with documents"', answer: 'rendered', key: 'signup.refused.names',
    why: 'slugs ARE first come (SIGNUP_SLUG_UNAVAILABLE, tenant-signup.service.ts); no resolution desk (GAP-B21)' },
  { id: 'otp_ten_minutes', canon: 'W307 "valid 10 minutes … no limits games"', answer: 'rendered', key: 'signup.refused.otp',
    why: 'the TTL and the resend cooldown are the server\'s (ttlSec / resendInSec) and are printed from it' },
  { id: 'member_count_field', canon: 'W307 form "Member farmers (rough count is fine)" + "No seat-counting for member farmers, ever"', answer: 'rendered', key: 'signup.refused.members',
    why: 'founder D4: no column for a guess; and plans DO carry a member limit (`plan_limits.max_farmers`, enforced on member add) — "never" is false' },
  { id: 'oncall_paging_signup', canon: 'W2469 / W3067 / W2472 / W3070 "repeated failures page the on-call"', answer: 'rendered', key: 'signup.refused.oncall',
    why: 'nothing pages anyone on a failed signup; the failure is said, with a Retry' },
  { id: 'flag_for_tenant_plan', canon: 'W307 state "switched off for this tenant/plan (feature flag) … See store settings"', answer: 'rendered', key: 'signup.refused.flag',
    why: 'pre-tenant: `org_self_signup` is a PLATFORM switch (founder D1) — there is no tenant or plan for it to be about' },
  { id: 'anand_proof', canon: 'W307 lead "Anand FPO\'s 1,240 members are the proof it works"', answer: 'recorded',
    why: 'founder D4: replaced by the LIVE count of verified organisations (storefront.stats()), omitted while not counted yet' },
  { id: 'chain_back_to_w316', canon: 'W2467 / W2468 / W2469 / W3064–W3067 "Back to the screen / Back to edit → W316"', answer: 'delta',
    why: 'the chain pages point back at the error canon (STORE-SWEEP) — a defect: Back goes to W307\'s own form (?step=form)' },
  { id: 'confirm_over_replay', canon: 'W2470 / W3068 "Confirm this action … Confirming writes an audit-trail entry"', answer: 'delta',
    why: 'Retry is an idempotent REPLAY of the same request (same key): a confirm page over it would confirm nothing and write no second audit row' },
]);

/** The 14 chain pages and their verdicts (brief C2/C3). One implementation: features/signup/flow.ts steps on /for-organisations. */
export const STORE1C_CHAIN_PAGES: readonly { file: string; verdict: string }[] = Object.freeze([
  { file: 'W2466-store-storesignup-form-form-error.html', verdict: 'GAP-UI built — ?step=form re-rendered with every refusal against its field, values kept (cookie)' },
  { file: 'W2467-store-storesignup-form-review.html', verdict: 'GAP-UI built — ?step=review, read-only, Idempotency-Key minted at render · "Back to edit → W316" DELTA chain_back_to_w316' },
  { file: 'W2468-store-storesignup-form-success.html', verdict: 'GAP-UI built — ?step=done (created / resumed); audit tenancy.self_serve_signup is real' },
  { file: 'W2469-store-storesignup-form-failure.html', verdict: 'GAP-UI built — ?step=failure, named refusal, Retry = same key · oncall refused (oncall_paging_signup)' },
  { file: 'W3064-store-storesignup-form-form-error.html', verdict: 'GAP-UI built (WSX-40 duplicate of W2466 — one implementation)' },
  { file: 'W3065-store-storesignup-form-review.html', verdict: 'GAP-UI built (duplicate of W2467 — one implementation)' },
  { file: 'W3066-store-storesignup-form-success.html', verdict: 'GAP-UI built (duplicate of W2468 — one implementation)' },
  { file: 'W3067-store-storesignup-form-failure.html', verdict: 'GAP-UI built (duplicate of W2469 — one implementation)' },
  { file: 'W2470-store-storesignup-mutate-confirm.html', verdict: 'PARITY-DECOR — FLOWMAP_tenant:1011 decor-offline-retry; the Retry is the failure page\'s same-key replay · DELTA confirm_over_replay' },
  { file: 'W2471-store-storesignup-mutate-success.html', verdict: 'PARITY-DECOR — the replay\'s success is ?step=done (W2468)' },
  { file: 'W2472-store-storesignup-mutate-failure.html', verdict: 'PARITY-DECOR — the replay\'s failure is ?step=failure (W2469) · oncall refused' },
  { file: 'W3068-store-storesignup-mutate-confirm.html', verdict: 'PARITY-DECOR (orphan duplicate of W2470) · DELTA confirm_over_replay' },
  { file: 'W3069-store-storesignup-mutate-success.html', verdict: 'PARITY-DECOR (orphan duplicate of W2471)' },
  { file: 'W3070-store-storesignup-mutate-failure.html', verdict: 'PARITY-DECOR (orphan duplicate of W2472) · oncall refused' },
]);

/** The keys of every W307 refusal that is printed, in order. */
export function signupRefusalKeys(): string[] {
  return STORE1C_REFUSALS.filter((r) => r.answer === 'rendered' && r.key).map((r) => r.key as string);
}
