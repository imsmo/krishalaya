// apps/web-storefront/src/features/store5a/refusals.ts · PC-56 STORE-5a · brief §E — what the review pages (W290, the edit chain W3141–W3144, the
// submit chain W3145–W3147) and the accessibility page (W324, W3074–W3076) do NOT claim, BY NAME. PURE. (The shape of features/store4b/refusals.ts.)
// Each refused canon claim is listed ONCE with where the canon makes it and the surfaces it is PRINTED on (a refusal sentence — never an offer);
// the render tests read this map, so a refusal that disappears from its page — or the refused copy coming back into a catalogue
// (test/claims-guard.spec.ts) — turns a test red.
//
// THE SURFACE TYPE: a NEW union, `Store5Surface` (the brief's choice "extend the existing registry type or add Store5Surface" — added, so the
// 4-series union stays the 4-series'); components/RefusalList.tsx accepts it beside the others.
export type Store5Surface = 'review' | 'review_edit' | 'accessibility';
export interface Store5Refusal { id: string; canon: string; surfaces: readonly Store5Surface[]; key: string; why: string }

export const STORE5A_REFUSALS: readonly Store5Refusal[] = Object.freeze([
  // ── W290 and its chains ──
  { id: 'voice', canon: 'W290 "Speak instead" · state "Voice note recorded — 0:42 in ગુજરાતી — we transcribe and post both audio and text"', surfaces: ['review', 'review_edit'],
    key: 'store5a.refusal.voice', why: 'no voice capture or transcription exists on the platform (refused since 1a); the review is typed, in any language' },
  { id: 'photos', canon: 'W290 "Add photos" (chain-form:review → W3141)', surfaces: ['review', 'review_edit'],
    key: 'store5a.refusal.photos', why: 'founder D7 (Q12): photos are refused in Phase 1 — media moderation is not built; `reviews` has no media column' },
  { id: 'offline', canon: 'W290 state Error "your words are saved on this phone and will send when signal returns"', surfaces: ['review', 'review_edit'],
    key: 'store5a.refusal.offline', why: 'nothing is saved on the phone (STORE-6); a failure says so by name, and Retry re-sends under the same key' },
  { id: 'tonight', canon: 'W290 "Your stars update the seller\'s profile tonight"', surfaces: ['review'],
    key: 'store5a.refusal.tonight', why: 'there is no nightly job: the organisation\'s rating is a cached read (120 s) — the success sentence says "within a couple of minutes"' },
  { id: 'masked_name', canon: 'W290 "Your review shows as \\"Buyer N••• S, Ahmedabad · order-verified\\""', surfaces: ['review'],
    key: 'store5a.refusal.maskedName', why: 'founder D5 (Q9): the public label is "Verified buyer" only — no masked name, no city' },
  { id: 'grading_desk', canon: 'W290 "The sub-ratings feed the grading desk — a run of low freshness scores … triggers a cold-chain check"', surfaces: ['review'],
    key: 'store5a.refusal.gradingDesk', why: 'nothing consumes `reviews.review_submitted`; no grading desk or cold-chain check reads sub-ratings' },
  { id: 'org_hide', canon: 'W290 "Sellers can reply but never edit or remove it" (false before STORE-5a: the organisation\'s tenant_admin held review.moderate)', surfaces: ['review'],
    key: 'store5a.refusal.orgHide', why: 'founder D2 (Q8): TRUE now — the organisation replies and flags; hiding, removing and restoring are the platform desk\'s (migration 0218)' },
  { id: 'flagged_off', canon: 'W290 state "Flagged off — Write a Review disabled … See store settings"', surfaces: ['review'],
    key: 'store5a.refusal.flaggedOff', why: 'reworded: when this store\'s reviews are switched off the page says so honestly (`store5a.off`) — there are no "store settings" for a buyer' },
  { id: 'reconcile', canon: 'W3143 / W3146 "Money-adjacent actions reconcile zero-sum before this page ever shows"', surfaces: ['review', 'review_edit'],
    key: 'store5a.refusal.reconcile', why: 'a review moves no money — there is nothing to reconcile' },
  { id: 'oncall', canon: 'W3144 / W3147 "repeated failures page the on-call"', surfaces: ['review', 'review_edit'],
    key: 'store5a.refusal.oncall', why: 'nothing pages anyone; the failure is said by name, with a Retry under the same key' },
  // ── W324 ──
  { id: 'voice_first', canon: 'W324 "Voice-first — Speak instead of type, everywhere a keyboard would appear; long-press anything to hear it read aloud"', surfaces: ['accessibility'],
    key: 'store5a.refusal.voiceFirst', why: 'founder D4 (Q17): no voice exists on the storefront' },
  { id: 'speaks', canon: 'W324 Senior Farmer Mode "every button speaks when touched"', surfaces: ['accessibility'],
    key: 'store5a.refusal.speaks', why: 'senior mode enlarges and spaces (1.3× type, 56px controls); nothing speaks (4c refusal carried)' },
  { id: 'helper', canon: 'W324 state "Set by a helper — an ambassador or family member can set modes … the confirmation is spoken to the OWNER"', surfaces: ['accessibility'],
    key: 'store5a.refusal.helper', why: 'there is no assisted onboarding on the storefront and no voice; the modes are this device\'s cookies' },
  { id: 'everywhere', canon: 'W324 state "Applied — instantly on this device, elsewhere on next open"', surfaces: ['accessibility'],
    key: 'store5a.refusal.everywhere', why: 'founder D4: per device — the modes are not on the account, so they do not follow you to another phone' },
  { id: 'phone_line', canon: 'W324 "the phone line and *123# remain the equal-citizen channels"', surfaces: ['accessibility'],
    key: 'store5a.refusal.phoneLine', why: 'the helpline and the short code are unimplemented placeholders (STORE-1a C-2)' },
  { id: 'seller_preview', canon: 'W324 senior preview "Sell 10 quintals? Yes · બોલીને પણ ચાલે"', surfaces: ['accessibility'],
    key: 'store5a.refusal.sellerPreview', why: 'a seller sentence on a buyer page (survey F-26), and it speaks — the page previews nothing it cannot show' },
  { id: 'unaudited', canon: 'W324 "Always true … colour never carries meaning alone · screen readers get sensible reading order and labelled buttons on every screen"', surfaces: ['accessibility'],
    key: 'store5a.refusal.unaudited', why: 'not audited yet (survey 1F: UNVERIFIED) — only the floor this stylesheet proves is printed as fact' },
  { id: 'a11y_oncall', canon: 'W3076 "repeated failures page the on-call"', surfaces: ['accessibility'],
    key: 'store5a.refusal.oncall', why: 'nothing pages anyone; "Couldn\'t save — the previous setting still applies" with Retry' },
]);

/** The canon shapes STORE-5a builds differently — recorded DELTAs, not refusals. */
export const STORE5A_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'review_route', canon: 'W290 `(marketplace)/orders/[id]/review` under the platform header (survey C-13 / F-16)', built: '/<slug>/orders/[id]/review and /review/edit under the organisation\'s chrome (founder Q13); the platform /orders/[id]/review is a door' },
  { id: 'body_limit', canon: 'the form\'s "In your own words" (the old page capped it at 2,000)', built: '4,000 characters — the API\'s own limit (survey F-23)' },
  { id: 'chain_links', canon: 'W3141–W3147 every link → W273 (home); W3141 has no forward link (survey F-25)', built: 'every link returns to the review page, the edit page or the order; W3141 is the form itself with the error and the values kept' },
  { id: 'edit_chain', canon: 'W3142 "Everything you entered, read-only, with the diff against current values"', built: 'the edit\'s review: old vs new per row (stars, each dimension, the words) and the lock date, Save under the key minted at render' },
  { id: 'invite_from_completion', canon: 'W290 "Review invites stay open 30 days after delivery"', built: 'the window counts from when the order COMPLETED (the eligibility is recorded then) — `reviews.invite_window_days`, a platform setting' },
  { id: 'sub_ratings_optional', canon: 'W290 three sub-rating rows of five stars', built: 'the dimensions come from the `review_dimension` vocabulary (labels in your language); each is optional — only the overall stars are required' },
  { id: 'a11y_no_confirm', canon: 'W3074 "Confirm this action" before a mode is saved', built: 'a device preference has no confirm (the 4b "Send" precedent): the switch IS the save; W3075 is the page re-rendered in the mode(s), W3076 the named failure with Retry' },
  { id: 'a11y_links', canon: 'W3075 / W3076 crumb and Back → W316 (survey F-25)', built: 'they return to the accessibility page itself' },
  { id: 'fm_classes', canon: 'FM classes the 20 stars `toggle-decor` and omits W324\'s four mode switches (survey F-24)', built: 'the stars are the rating input (radio groups); the three modes built are real switches; Voice-first is refused' },
]);

/** The 12 STORE-5a canon files and their verdicts. */
export const STORE5A_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W290-store-review.html', flowmap: 'route `orders/[id]/review` · chain-form:review ×2 · chain-mutate:review', verdict: 'BUILT at /<slug>/orders/[id]/review — flag-aware, the server\'s eligibility and window, the vocabulary\'s sub-ratings, the key at render, Already reviewed / Locked / Window closed / not eligible states' },
  { file: 'W3141-store-review-form-form-error.html', flowmap: 'chain-form:review', verdict: 'BUILT — REAL: the edit form with the named error (stars required, words ≤ 4,000, an unknown dimension) and the values kept' },
  { file: 'W3142-store-review-form-review.html', flowmap: 'chain-form:review → W3143', verdict: 'BUILT — REAL: old vs new and the lock date; Save under the key minted at render' },
  { file: 'W3143-store-review-form-success.html', flowmap: 'W3142 Submit', verdict: 'BUILT — REAL: "Updated — locks on <date>" on the review page' },
  { file: 'W3144-store-review-form-failure.html', flowmap: 'W3142 Submit (failure)', verdict: 'BUILT — REAL: locked / removed / invalid / unknown dimension / switched off / server, Retry with the SAME key' },
  { file: 'W3145-store-review-mutate-confirm.html', flowmap: 'chain-mutate:review', verdict: 'BUILT — REAL: the SERVER\'s preview (the organisation, the stars and dimension labels, "Verified buyer", the lock date), Proceed under the form\'s key' },
  { file: 'W3146-store-review-mutate-success.html', flowmap: 'W3145 Proceed', verdict: 'BUILT — REAL: the order page `?status=reviewed` — "published on <organisation>\'s page", the rating within a couple of minutes' },
  { file: 'W3147-store-review-mutate-failure.html', flowmap: 'W3145 Proceed (failure)', verdict: 'BUILT — REAL: not eligible / already reviewed / window closed / unknown dimension / invalid / switched off / server, Retry with the SAME key' },
  { file: 'W324-store-accessibility.html', flowmap: 'route `account/accessibility` · chain-mutate:accessibility', verdict: 'BUILT at /account/accessibility under both chromes — Senior, High contrast, Calm motion (per device, stacking), the proven floor; Voice-first refused' },
  { file: 'W3074-store-accessibility-mutate-confirm.html', flowmap: 'W324 Retry', verdict: 'DELTA — no confirm for a device preference (the switch is the save)' },
  { file: 'W3075-store-accessibility-mutate-success.html', flowmap: 'W3074 Proceed', verdict: 'BUILT — the page re-rendered in the mode(s) with "Saved on this device"' },
  { file: 'W3076-store-accessibility-mutate-failure.html', flowmap: 'W3074 Proceed (failure)', verdict: 'BUILT — "Couldn\'t save — the previous setting still applies" with Retry re-posting the same values' },
]);

/** The keys a surface prints (in registry order). */
export function store5aRefusalKeys(surface: Store5Surface): string[] {
  return STORE5A_REFUSALS.filter((r) => (r.surfaces as readonly string[]).includes(surface)).map((r) => r.key);
}
