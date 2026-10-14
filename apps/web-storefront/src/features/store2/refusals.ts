// apps/web-storefront/src/features/store2/refusals.ts · PC-56 HOTFIX-4 · brief §E — the canon claims on the money pages this hotfix does NOT
// make, BY NAME, and the defects it names but does not fix. PURE. (Pattern: features/home/refusals.ts.)
//
// A trust surface renders only verified truth (Contract §3 Law 12). Each refused claim is listed ONCE with where the canon makes it and how
// this build answers it: RENDERED as a keyed refusal sentence on the confirmation page (`key`), or RECORDED (owed to a named wave / founder
// question). The render test reads this map, so a refusal that silently disappears from /checkout/confirm — or the refused copy coming
// back into a catalogue — turns a test red.
export type RefusalAnswer = 'rendered' | 'recorded';
export interface Refusal { id: string; canon: string; answer: RefusalAnswer; key?: string; why: string }

export const STORE2_HOTFIX4_REFUSALS: readonly Refusal[] = Object.freeze([
  { id: 'auto_refund', canon: 'W284 "Decline or failure → automatic refund, no forms"', answer: 'rendered', key: 'store2.refusal.autoRefund',
    why: 'not built: no handler refunds a paid order on decline / cancel (survey F-3, founder Q8 — STORE-2c)' },
  { id: 'cod_cap', canon: 'W284 "Cash on delivery … capped at ₹20,000 per order for rider safety"', answer: 'rendered', key: 'store2.refusal.codCap',
    why: 'founder D2: no per-order COD cap setting exists (the only cap is the per-rider cash-in-hand setting) — refused until a setting exists' },
  { id: 'one_payment_group', canon: 'W284 / W285 "One payment covers both orders; escrow splits it per order automatically"', answer: 'rendered', key: 'store2.refusal.onePayment',
    why: 'a checkout group has no payment path (survey F-6, founder Q5 — STORE-2c): each order is paid on its own and every order is named' },
  { id: 'price_includes_fee', canon: 'W277 "Price includes grading & platform fee"', answer: 'recorded',
    why: 'founder D4: false when a platform fee is ADDED at checkout — the fee prints as its own row instead; the sentence is in no catalogue' },
]);

/** Named here, NOT fixed by HOTFIX-4 (each owed to the wave / founder question in brackets). */
export const STORE2_HOTFIX4_OWED: readonly { id: string; what: string; owner: string }[] = Object.freeze([
  { id: 'F-2', what: 'stock is not reserved at placement — two buyers can pay for the same lot', owner: 'founder Q4 · STORE-2c' },
  { id: 'F-3', what: 'no automatic refund for a cancelled / declined paid order', owner: 'founder Q8 · STORE-2c' },
  { id: 'F-6', what: 'no single payment for a multi-seller checkout (each order pays separately; all are named)', owner: 'founder Q5 · STORE-2c' },
  { id: 'F-9', what: 'regulated inputs (licence / banned-state rules) are not enforced at cart or checkout', owner: 'founder Q12 · STORE-2b' },
  { id: 'F-10', what: "the API checkout still writes 'INR' for orders / groups / preview / delivery methods (not a one-line read of the listing's currency)", owner: 'STORE-2c' },
]);

export function store2RefusalKey(id: string): string {
  const r = STORE2_HOTFIX4_REFUSALS.find((x) => x.id === id);
  if (!r || r.answer !== 'rendered' || !r.key) throw new Error(`store2 refusals: '${id}' is not a rendered refusal`);
  return r.key;
}
/** The keys the confirmation page prints (in this order). */
export const CONFIRM_REFUSAL_KEYS: readonly string[] = Object.freeze(STORE2_HOTFIX4_REFUSALS.filter((r) => r.answer === 'rendered').map((r) => r.key as string));

/* ------------------------------------------------------------------------------------------------------------------------------------ */
/* PC-56 STORE-2a · brief §E — what an anonymous buyer sees is true and private: W275 browse · W276 search · W277 listing · W280 seller   */
/* (→ the organisation's page) · W282 farm inputs, and their 12 Retry / Apply chain pages                                              */
/* ------------------------------------------------------------------------------------------------------------------------------------ */

/** The five STORE-2a surfaces. Each refusal names the surfaces it is PRINTED on (the render tests read this map). */
export type Store2aSurface = 'browse' | 'search' | 'listing' | 'sellers' | 'inputs';
export interface Store2aRefusal { id: string; canon: string; surfaces: readonly Store2aSurface[]; key: string; why: string }

/** Every canon claim STORE-2a does not make, BY NAME, and where it is printed (as a refusal sentence — never as an offer). */
export const STORE2A_REFUSALS: readonly Store2aRefusal[] = Object.freeze([
  { id: 'mandi_reference', canon: 'W275 "mandi reference today: ₹6,240/qtl (Junagadh APMC)" · W277 "this listing is ₹90 below it"', surfaces: ['browse', 'listing'],
    key: 'store2a.refusal.mandi', why: 'founder 1b D3: no licensed, attributed mandi source; market_intel is OFF and authed' },
  { id: 'tell_me_when', canon: 'W275 empty "tap Tell me when — we\'ll message you the moment one is published"', surfaces: ['browse', 'search'],
    key: 'store2a.refusal.tellMeWhen', why: 'saved searches store notify_new_matches and NOTHING reads it (survey F-21, GAP B21)' },
  { id: 'tell_me_if_returns', canon: 'W277 paused "Tell me if it returns — the seller sees the demand"', surfaces: ['listing'],
    key: 'store2a.refusal.tellMeIfReturns', why: 'a saved listing has no notifier (F-21)' },
  { id: 'follow_seller', canon: 'W280 "Follow seller — hear when the next lot lists"', surfaces: ['sellers'],
    key: 'store2a.refusal.follow', why: 'a saved seller has no notifier (F-21)' },
  { id: 'offline_catalogue', canon: 'W275 offline "listings saved from your last visit … you can still add to cart — it syncs"', surfaces: ['browse'],
    key: 'store2a.refusal.offline', why: 'no offline catalogue or cart queue (STORE-6); a queued cart contradicts Law 6\'s spirit' },
  { id: 'region_restricted', canon: 'W275 / W276 "Some varieties / results are region-restricted … left off quietly"', surfaces: ['browse', 'search'],
    key: 'store2a.refusal.regionRestricted', why: 'no feed consults banned_state rules (regulated-rule.entity.ts "Phase-2 hook")' },
  { id: 'multilingual_search', canon: 'W276 "We searched in three languages at once … spelling doesn\'t have to be perfect … Spoken search works too"', surfaces: ['search'],
    key: 'store2a.refusal.multilingual', why: 'title ILIKE / prefix only; no transliteration or phonetic analyser (survey B31)' },
  { id: 'voice_search', canon: 'W276 "Voice search — heard you as …" + "Speak again"', surfaces: ['search'],
    key: 'store2a.refusal.voice', why: 'no voice input exists' },
  { id: 'closest_matches', canon: 'W276 "Closest matches … We never show an empty wall"', surfaces: ['search'],
    key: 'store2a.refusal.closest', why: 'no relaxation logic; an empty answer is said as empty' },
  { id: 'distance', canon: 'W275 "Nearest first" · "4 km" · W277 "Delivery to 382330 Wed 15 Jul – Thu 16 Jul · ₹80/qtl/100km"', surfaces: ['browse', 'search', 'listing'],
    key: 'store2a.refusal.distance', why: 'founder D3: no location is asked for; per_km pricing is deferred and no delivery ETA exists (F-22)' },
  { id: 'ai_grade', canon: 'W277 "AI photo-grade suggested A (confidence 0.9142) — confirmed by centre staff"', surfaces: ['listing'],
    key: 'store2a.refusal.aiGrade', why: 'founder D2: an unconfirmed AI suggestion is not shown, and no confidence number' },
  { id: 'price_includes_fee', canon: 'W277 "Price includes grading & platform fee"', surfaces: ['listing'],
    key: 'store2a.refusal.priceFee', why: 'HOTFIX-4 D4: false when a platform fee is added at checkout; no grading fee exists' },
  { id: 'bulk_pricing', canon: 'W277 / W280 "Bulk pricing is verified-buyer-only"', surfaces: ['listing', 'sellers'],
    key: 'store2a.refusal.bulk', why: 'no bulk tiers and no buyer KYC exist' },
  { id: 'dispatch_regrade', canon: 'W277 "Quality promise: grade verified again at dispatch"', surfaces: ['listing'],
    key: 'store2a.refusal.dispatchRegrade', why: 'no dispatch re-grade step exists (founder Q16 → STORE-SWEEP W309)' },
  { id: 'farmer_identity', canon: 'W277 / W280 "Ramesh Patel · Anand FPO member #0412 · 12 bigha · since Oct 2021" + avatar + vernacular name', surfaces: ['listing', 'sellers'],
    key: 'store2a.refusal.farmer', why: 'HOTFIX-4 D3: seller identity = the ORGANISATION, everywhere' },
  { id: 'seller_badges', canon: 'W280 "KYC verified" · "centre-graded seller" · "126 completed sales"', surfaces: ['sellers'],
    key: 'store2a.refusal.badges', why: 'no such organisation-level record exists; completed sales have no public bounded read' },
  { id: 'reviews_translated', canon: 'W280 "Reviews can be written in any language — buyers read them translated"', surfaces: ['sellers'],
    key: 'store2a.refusal.translated', why: 'no translation exists' },
  { id: 'inputs_fifo_expiry', canon: 'W282 "sold batch-tracked, oldest stock first (FIFO), expiry always … on the page" + batch lines', surfaces: ['inputs'],
    key: 'store2a.refusal.fifo', why: 'checkout writes batchId null; no batch / expiry public read (F-9 / C-2, B15)' },
  { id: 'inputs_mrp', canon: 'W282 "MRP-capped price"', surfaces: ['inputs'],
    key: 'store2a.refusal.mrp', why: 'no MRP field exists' },
  { id: 'inputs_age', canon: 'W282 "licence-gated and 18+"', surfaces: ['inputs'],
    key: 'store2a.refusal.age', why: 'no age check exists (founder Q12 → STORE-2b)' },
  { id: 'inputs_label_helpline', canon: 'W282 "an emergency helpline on the label"', surfaces: ['inputs'],
    key: 'store2a.refusal.labelHelpline', why: 'no helpline exists' },
  { id: 'inputs_switch', canon: 'W282 "This seller organisation hasn\'t switched on input sales"', surfaces: ['inputs'],
    key: 'store2a.refusal.inputsSwitch', why: 'no per-organisation inputs flag; the platform browse switch is the only switch' },
  { id: 'flag_tenant_plan', canon: 'W275–W282 "Flagged off — … switched off for this tenant/plan (feature flag) … See store settings"', surfaces: ['browse', 'search', 'listing', 'sellers', 'inputs'],
    key: 'store2a.refusal.flagTenantPlan', why: 'founder D4: storefront_browse is a PLATFORM switch — no tenant or plan, no store setting' },
  { id: 'oncall_paging', canon: 'W3082 / W3098 / W3105 / W3150 "repeated failures page the on-call"', surfaces: ['browse', 'listing', 'sellers', 'inputs'],
    key: 'store2a.refusal.oncall', why: 'nothing pages anyone on a failed page load; the failure is said, with a Retry' },
  { id: 'listing_helpline', canon: 'W277 error "the lot number JNG-GG20-0412 works on the phone line 1800-419-0123 too"', surfaces: ['listing'],
    key: 'store2a.refusal.helpline', why: 'the IVR / helpline is an unimplemented placeholder (STORE-1a C-2)' },
]);

/** The canon shapes STORE-2a deliberately builds differently — recorded DELTAs (Law 4), not refusals. */
export const STORE2A_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'category_route', canon: 'W275 route `(marketplace)/c/[...path]`', built: '`/[tenantSlug]?category=<id>` — the category path as a parameter (the whole subtree); `c` is not reserved' },
  { id: 'offset_pagination', canon: 'W275 / W276 / W282 "Showing 1–24 of 126 · ‹ Prev / Next ›"', built: 'keyset "Show more" (Law 11) + the capped count line ("126 listings" / "1,000+ listings")' },
  { id: 'per_farmer_page', canon: 'W280 `(marketplace)/s/[id]` — one farmer\'s page', built: '`/[tenantSlug]/sellers` — the ORGANISATION\'s page (HOTFIX-4 D3); `sellers` reserved in 0207' },
  { id: 'confirm_before_filter', canon: 'W3080 "Proceed — confirm" before applying filters (+ "Confirming writes an audit-trail entry")', built: 'a GET form: applying a filter is a read — no confirm step, no audit entry (the sentence would be false)' },
  { id: 'chain_back_links', canon: 'W3081 / W3082 "Back to the screen → W316"', built: 'Back / Retry return to the screen itself (W316 is the error canon — a canon defect, survey F-27)' },
  { id: 'listing_route', canon: 'W277 route `(marketplace)/l/[id]`', built: '`/[tenantSlug]/listings/[id]` (STORE-1b\'s per-tenant store route; buying stays in the organisation\'s store)' },
]);

/** The 12 chain pages and their verdicts (brief C6), with the FLOWMAP citations of the canon buttons that point at them. */
export const STORE2A_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W3080-store-browse-mutate-confirm.html', flowmap: 'W275 data-flowmap="chain-mutate:browse" ×2 ("Apply filters", "Retry")', verdict: 'PARITY-DECOR — a GET form / a reload; the confirm + "audit entry" FALSE → DELTA confirm_before_filter' },
  { file: 'W3081-store-browse-mutate-success.html', flowmap: 'W3080 Proceed', verdict: 'PARITY-DECOR — the re-rendered results (filters in the URL) · "→ W316" DELTA chain_back_links' },
  { file: 'W3082-store-browse-mutate-failure.html', flowmap: 'W3080 Proceed (failure)', verdict: 'PARITY-DECOR — the error state with Retry = the same URL, filters kept · on-call refused (oncall_paging)' },
  { file: 'W3096-store-inputs-mutate-confirm.html', flowmap: 'W282 data-flowmap="chain-mutate:inputs" ("Retry")', verdict: 'PARITY-DECOR — Retry = reload of /[tenantSlug]/inputs; no confirm over a read' },
  { file: 'W3097-store-inputs-mutate-success.html', flowmap: 'W3096 Proceed', verdict: 'PARITY-DECOR — the re-rendered inputs page' },
  { file: 'W3098-store-inputs-mutate-failure.html', flowmap: 'W3096 Proceed (failure)', verdict: 'PARITY-DECOR — the error state again · on-call refused' },
  { file: 'W3103-store-listing-mutate-confirm.html', flowmap: 'W277 data-flowmap="chain-mutate:listing" ×2 ("Ask the seller to relist", "Retry")', verdict: 'PARITY-DECOR — Retry = reload; "Ask the seller to relist" = a link to the organisation\'s page (the inquiry thread is STORE-2b/3)' },
  { file: 'W3104-store-listing-mutate-success.html', flowmap: 'W3103 Proceed', verdict: 'PARITY-DECOR — the re-rendered listing (or its tombstone)' },
  { file: 'W3105-store-listing-mutate-failure.html', flowmap: 'W3103 Proceed (failure)', verdict: 'PARITY-DECOR — the error state again · on-call and the helpline refused' },
  { file: 'W3148-store-seller-mutate-confirm.html', flowmap: 'W280 data-flowmap="chain-mutate:seller" ("Retry")', verdict: 'PARITY-DECOR — Retry = reload of /[tenantSlug]/sellers' },
  { file: 'W3149-store-seller-mutate-success.html', flowmap: 'W3148 Proceed', verdict: 'PARITY-DECOR — the re-rendered organisation page' },
  { file: 'W3150-store-seller-mutate-failure.html', flowmap: 'W3148 Proceed (failure)', verdict: 'PARITY-DECOR — the error state again · on-call refused' },
]);

/** The refusal keys a surface prints, in this list's order. */
export function store2aRefusalKeys(surface: Store2aSurface): string[] {
  return STORE2A_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}
