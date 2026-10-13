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
    why: 'tenant-authored copy needs a public CMS read; the invoice share and the quality promise are STORE-3 / STORE-5' },
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
