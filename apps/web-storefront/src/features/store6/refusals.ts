// apps/web-storefront/src/features/store6/refusals.ts · PC-56 STORE-6a · brief §E (survey E6) — what the offline page (W313), the queued-actions
// list (W314), the install page (W319) and the offline form chain (W3127–W3130, DECOR) do NOT claim, BY NAME. PURE. (The shape of
// features/store5a/refusals.ts.) Each refused canon claim is listed ONCE with where the canon makes it and the surfaces it is PRINTED on (a
// refusal sentence — never an offer); the render tests read this map, so a refusal that disappears from its page — or the refused copy
// coming back into a catalogue (test/claims-guard.spec.ts) — turns a test red.
//
// Carried, unchanged: STORE-2a `offline_catalogue`, STORE-2b `offline_cart` / `saved_on_phone`, STORE-4b `offline_queue`, STORE-5a `offline`.
//
// THE SURFACE TYPE: a NEW union, `Store6Surface`; components/RefusalList.tsx accepts it beside the others.
export type Store6Surface = 'offline' | 'queued' | 'install' | 'offline_form';
export interface Store6Refusal { id: string; canon: string; surfaces: readonly Store6Surface[]; key: string; why: string }

export const STORE6A_REFUSALS: readonly Store6Refusal[] = Object.freeze([
  // ── W313 (the offline layer) ──
  { id: 'will_sync', canon: 'W313 §3 "Add to cart — will sync" (chain-form:offline → W3127)', surfaces: ['offline', 'offline_form'],
    key: 'store6.refusal.willSync', why: 'founder D8 (Q5): a cart add is never saved on the phone to send later — offline the button says it needs signal (2a offline_catalogue, 2b offline_cart carried)' },
  { id: 'reading_orders', canon: 'W313 §1 "Browsing, reading orders and writing drafts all work" · W319 "Read every order, message, trace page you\'ve opened"', surfaces: ['offline', 'install'],
    key: 'store6.refusal.readingOrders', why: 'founder Q3: orders and messages are never kept on a phone — shared phones are normal and an order page is a person\'s purchase history' },
  { id: 'action_queues', canon: 'W313 §2 "Keep stale content interactive: a farmer can compose against old data; the action queues (see W314)"', surfaces: ['offline'],
    key: 'store6.refusal.actionQueues', why: 'reworded to the truth: a kept page\'s buttons say "needs signal"; nothing queues (founder D1, NO_OFFLINE_WRITE_QUEUE)' },
  { id: 'fresh_loading', canon: 'W313 §1 Slow connection "Fresh data is loading behind this banner"', surfaces: ['offline'],
    key: 'store6.refusal.freshLoading', why: 'the heartbeat knows two states (live / no signal) — there is no slow tier and nothing loads behind a banner; the page says how old it is' },
  { id: 'other_app', canon: 'offline.hint "The Krishalaya mobile app works offline-first" (×3, retired) · W319 "Krishalaya installs …" / "Add Krishalaya to your home screen?" under a store', surfaces: ['offline', 'install'],
    key: 'store6.refusal.otherApp', why: 'founder D7 (Q10): false for buyers (the mobile app queues two seller acts) and a platform plug on an organisation\'s page — removed everywhere' },
  // ── W314 (queued actions — moved in from the sweep) ──
  { id: 'queue_drawer', canon: 'W314 "The queue drawer — queued · sending… · confirmed · failed — needs you"', surfaces: ['queued'],
    key: 'store6.refusal.queueDrawer', why: 'no queue exists on the storefront (founder Q4: the person presses Send) — so no drawer and none of its states' },
  { id: 'waiting_chip', canon: 'W314 "Show a persistent chip while anything is queued: \\"3 waiting to sync\\""', surfaces: ['queued'],
    key: 'store6.refusal.waitingChip', why: 'nothing waits, so no count is shown' },
  { id: 'undo_fix', canon: 'W314 drawer rows "Undo" (a queued cart edit) and "Fix" (a failed queued add)', surfaces: ['queued'],
    key: 'store6.refusal.undoFix', why: 'there are no queued items to undo or fix' },
  { id: 'replay', canon: 'W314 "sends once, never twice (one idempotency key per action)" · "Replay in the order taken"', surfaces: ['queued'],
    key: 'store6.refusal.replay', why: 'no auto-replay: the person presses again on a live page, which mints its key at that render (keyed-at-render kept)' },
  { id: 'expire_ask', canon: 'W314 "Never expire a queue silently; after 7 days offline, ask before discarding" · W319 "After 7 days offline we ask"', surfaces: ['queued', 'install'],
    key: 'store6.refusal.expireAsk', why: 'nothing is kept to expire in 6a; the drafts rule (ask at 7 days) is STORE-6b\'s, over the person\'s own unsent words' },
  { id: 'cart_queue', canon: 'W314 "Content actions — cart edits, messages, reviews … queue freely"', surfaces: ['queued'],
    key: 'store6.refusal.cartQueue', why: 'founder D8 (Q5): cart edits never queue — a later add would silently re-baseline the agreed price (survey F-8)' },
  { id: 'listing_drafts', canon: 'W314 "listing drafts, photos" · W319 "Write drafts: … listing drafts (queue)"', surfaces: ['queued', 'install'],
    key: 'store6.refusal.listingDrafts', why: 'a seller\'s act on a buyer\'s page (survey F-15) — no listing is written on the storefront' },
  { id: 'named_person', canon: 'W314 "Message to Ramesh Patel (voice, 0:12)"', surfaces: ['queued'],
    key: 'store6.refusal.namedPerson', why: 'messages are to the organisation, never a named person, and there is no voice message (4b carried)' },
  // ── W319 (app & install) ──
  { id: 'size_claim', canon: 'W319 "Small download" · "Under 3 MB — smaller than three photos"', surfaces: ['install'],
    key: 'store6.refusal.sizeClaim', why: 'survey E10: no size budget is measured in CI — no number is printed' },
  { id: 'cheap_phones', canon: 'W319 "works on ₹6,000 phones"', surfaces: ['install'],
    key: 'store6.refusal.cheapPhones', why: 'survey E10: no device is measured — no price of phone is promised' },
  { id: 'speaks', canon: 'W319 "Works in your language, speaks when asked"', surfaces: ['install'],
    key: 'store6.refusal.speaks', why: 'nothing speaks on the storefront (4c speaks carried); the language half is TRUE and printed' },
  { id: 'offline_writes', canon: 'W319 "Offline, always: Write drafts — cart edits, messages, reviews … (queue)"', surfaces: ['install'],
    key: 'store6.refusal.offlineWrites', why: 'founder D1: nothing written offline is sent later by itself (drafts the person sends are 6b\'s)' },
  { id: 'qr_phone_line', canon: 'W319 "Your QR codes and order numbers (for the phone line)"', surfaces: ['install'],
    key: 'store6.refusal.qrPhoneLine', why: 'the phone line is refused (1a/1b); the buyer holds no QR on the storefront' },
  { id: 'otp_handover', canon: 'W319 "Needs signal: OTP delivery handover"', surfaces: ['install'],
    key: 'store6.refusal.otpHandover', why: 'no delivery code is handed over on the storefront (4c delivery_otp carried)' },
  { id: 'clears_photos', canon: 'W319 "One tap clears cached photos; orders, drafts and queued actions are never cleared by cleanup"', surfaces: ['install'],
    key: 'store6.refusal.clearsPhotos', why: 'photos are never kept (founder D3) — there is nothing to clear and no such button' },
  // ── W3127–W3130 (the offline form chain — DECOR: the act is refused) ──
  { id: 'audit_trail', canon: 'W3129 "The change is applied and the audit trail has the entry (actor · time · reason)"', surfaces: ['offline_form'],
    key: 'store6.refusal.auditTrail', why: 'nothing was applied: a refused act writes no row' },
  { id: 'zero_sum', canon: 'W3129 "Money-adjacent actions reconcile zero-sum before this page ever shows"', surfaces: ['offline_form'],
    key: 'store6.refusal.zeroSum', why: 'no money moved — there is nothing to reconcile' },
  { id: 'oncall', canon: 'W3130 "repeated failures page the on-call"', surfaces: ['offline_form'],
    key: 'store6.refusal.oncall', why: 'nothing pages anyone (the home/5a class): there was no attempt to fail' },
]);

/** The canon shapes STORE-6a builds differently — recorded DELTAs, not refusals. */
export const STORE6A_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'policy_routes', canon: 'W313 / W314 / W319 routed to `(canon)/offline`, `(canon)/…`, `(canon)/app` under the platform chrome', built: '/offline, /queued and /app under BOTH chromes — the organisation\'s on its store (the web-tenant W318 policy-page precedent); /offline is also the worker\'s fallback' },
  { id: 'w314_moved', canon: 'W314 sits in STORE-SWEEP (03_STORE:82)', built: 'moved into STORE-6a (founder HOTFIX-8 D4) — the money law of this wave' },
  { id: 'chain_links', canon: 'W3128 "Back to edit" → W273 · W3129 Back → W273 · W3130 "Retry — back to confirm" → W273 (a form chain has no confirm) · W3127 no forward link (survey F-14)', built: 'every link returns to the offline page (W313) or to the live act; W3130\'s "Retry" is "Try on the listing, with signal"' },
  { id: 'chain_shape', canon: 'four chain pages W3127–W3130', built: 'one route, `/offline?form=error|review|success|failure`, each state printing the refusal and the live act' },
  { id: 'aging_tier', canon: 'W313 §2 "<15 min quiet · >1 hour prominent · >24 hours full-width" (15 min – 1 h unnamed)', built: 'the interval is named `aging`: the "as of" line, nothing louder' },
  { id: 'monogram_route', canon: 'the brief\'s `/<slug>/icon.svg`', built: '`/<slug>/app-icon.svg` — Next 14 treats a segment named `icon.<ext>` as its metadata-image convention' },
  { id: 'invitation', canon: 'W319 "Add to home screen" / "Not now" / the second-visit rule (chain-form:pwa → W3137–W3140)', built: 'STORE-6b\'s — this page prints the browser\'s own install steps in words, and no button' },
  { id: 'fm_classes', canon: 'FM classes cart "1" as `pagination` ×3 and "Not now" as `filter` (survey F-13)', built: 'recorded; the cart count is the header\'s own; "Not now" is 6b\'s' },
]);

/** The 7 STORE-6a canon files and their verdicts. */
export const STORE6A_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W313-store-offline-canon.html', flowmap: 'route `(canon)/offline` · chain-form:offline', verdict: 'BUILT at /offline under both chromes — the worker\'s fallback AND the rules: the two honest states + the as-of line, the tiers, the don\'ts, where it applies, the exceptions never cached' },
  { file: 'W314-store-queued-actions.html', flowmap: '(sweep → 6a)', verdict: 'BUILT at /queued under both chromes — "Money never queues": the 16 acts + the codes + the download links from the registry, each with its reason; the drawer refused by name' },
  { file: 'W319-store-pwa-install.html', flowmap: 'route `(canon)/app` · chain-form:pwa', verdict: 'BUILT at /app under both chromes — installs as the organisation, the honest offline contract, the polite update, the storage line; the invitation is 6b\'s' },
  { file: 'W3127-store-offline-form-form-error.html', flowmap: 'chain-form:offline', verdict: 'DECOR — /offline?form=error: the refusal printed ("needs signal; nothing is saved on the phone") and the live act' },
  { file: 'W3128-store-offline-form-review.html', flowmap: 'W3127 → W3129', verdict: 'DECOR — /offline?form=review: nothing to review (the act is refused); links corrected to W313' },
  { file: 'W3129-store-offline-form-success.html', flowmap: 'W3128 Submit', verdict: 'DECOR — /offline?form=success: nothing was applied; the audit / zero-sum sentences refused' },
  { file: 'W3130-store-offline-form-failure.html', flowmap: 'W3128 Submit (failure)', verdict: 'DECOR — /offline?form=failure: "nothing was changed" is TRUE; Retry = the live act with signal; on-call refused' },
]);

/** The i18n keys of one surface's refusals (render tests read this). */
export function store6RefusalKeys(surface: Store6Surface): string[] {
  return STORE6A_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}
