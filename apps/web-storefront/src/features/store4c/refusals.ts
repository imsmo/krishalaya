// apps/web-storefront/src/features/store4c/refusals.ts · PC-56 STORE-4c · brief §E — what the inbox (W299) and the preferences page (W302) do NOT
// claim, BY NAME. PURE. (The shape of features/store4/refusals.ts and store4a's.) Each refused canon claim is listed ONCE with where the canon makes
// it and the surfaces it is PRINTED on (a refusal sentence — never an offer); the render tests read this map, so a refusal that disappears from its
// page — or the refused copy coming back into a catalogue (test/claims-guard.spec.ts) — turns a test red.
import type { Store4Refusal, Store4Surface } from '../store4/refusals';

export type Store4cSurface = Extract<Store4Surface, 'inbox' | 'preferences'>;

export const STORE4C_REFUSALS: readonly Store4Refusal[] = Object.freeze([
  { id: 'delivery_otp', canon: 'W299 empty "Critical events (payment, delivery OTP) always break through" · W302 "Payment & delivery OTP · critical · always on"', surfaces: ['inbox', 'preferences'],
    key: 'store4c.refusal.deliveryOtp', why: 'founder D1 (Q5): there is no delivery-OTP event (the catalogue holds `auth.otp` only) — named for the logistics wave; the PAYMENT notice is critical and always on (0215)' },
  { id: 'price_alert', canon: 'W299 row "Price alert … from your \'Tell me when\' on browse" · W302 "Price alerts · informational · app only"', surfaces: ['inbox', 'preferences'],
    key: 'store4c.refusal.priceAlert', why: 'refused in 2a: no price-alert subscription exists and `price.alert` is not mapped to any emitter' },
  { id: 'transit_sms', canon: 'W299 row "Cumin shipment departed … shipment.in_transit · SMS suppressed (your quiet-channel rule)" · W302 "Transit updates · app only (SMS suppressed by your rule)"', surfaces: ['inbox', 'preferences'],
    key: 'store4c.refusal.transitSms', why: '`logistics.shipment_in_transit` is not mapped to a notice (only `shipment.delivered` is); the suppression reason itself is real and printed from the ladder when it happens' },
  { id: 'sms_fallback', canon: 'W299 state "SMS failed → push fallback — your DND window rejected the outbid SMS; the push copy delivered instead"', surfaces: ['inbox'],
    key: 'store4c.refusal.smsFallback', why: 'there is no outbid SMS (outbid is push + in-app); a fallback exists only for routine tiers when the decided rule\'s flag is ON' },
  { id: 'outbid_sms', canon: 'W299 row "Outbid … app + SMS read 15:46" · W302 "Outbid alerts · important · app + SMS"', surfaces: ['inbox', 'preferences'],
    key: 'store4c.refusal.outbidSms', why: 'outbid reaches the app and a registered device (push + in-app, 0215); each row\'s channels are printed from its own ladder, never claimed' },
  { id: 'counts_window', canon: 'W299 footnote "Showing 5 of 187 (90 days)"', surfaces: ['inbox'],
    key: 'store4c.refusal.countsWindow', why: 'keyset pages (Next), never a total; the inbox keeps what the retention policy keeps and the API does not serve a window, so no day count is printed' },
  { id: 'flagged_off', canon: 'W299 / W302 "Flagged off — Notifications / Preferences & Accessibility disabled"', surfaces: ['inbox', 'preferences'],
    key: 'store4c.refusal.flaggedOff', why: 'founder Q12: a person\'s notices, preferences and quiet hours are never switched off (the `communication` guard is gone from them); chat and calls stay behind it' },
  { id: 'voice_replies', canon: 'W302 "Voice replies read out in ગુજરાતી"', surfaces: ['preferences'],
    key: 'store4c.refusal.voiceReplies', why: 'no voice (Q15)' },
  { id: 'translate_chats', canon: 'W302 "Translate chats automatically" toggle', surfaces: ['preferences'],
    key: 'store4c.refusal.translateChats', why: 'no translation (Q15)' },
  { id: 'speaks', canon: 'W302 Senior Farmer Mode "Every button speaks when touched"', surfaces: ['preferences'],
    key: 'store4c.refusal.speaks', why: 'senior mode is bigger letters and bigger touch targets; nothing speaks (no voice)' },
  { id: 'everywhere_else', canon: 'W302 Saved "applied on this device instantly, everywhere else on next open"', surfaces: ['preferences'],
    key: 'store4c.refusal.everywhereElse', why: 'founder D4 (Q17): senior mode is PER DEVICE (a cookie); the notification choices ARE the account\'s — the success sentence says exactly which is which' },
  { id: 'data_saver', canon: 'W302 aside "Data saver: photos load on tap"', surfaces: ['preferences'],
    key: 'store4c.refusal.dataSaver', why: 'no data-saver mode exists' },
  { id: 'missed_call', canon: 'W302 aside "Missed call & USSD — 1800-… and *123#"', surfaces: ['preferences'],
    key: 'store4c.refusal.missedCall', why: 'refused since 1a — no helpline and no short code' },
  { id: 'voice_search', canon: 'W302 aside "Voice-first: every search box and message bar takes speech"', surfaces: ['preferences'],
    key: 'store4c.refusal.voiceSearch', why: 'the voice button is DECOR; no speech input exists' },
  { id: 'nine_more', canon: 'W302 "English · ગુજરાતી · हिन्दी +9 more at launch"', surfaces: ['preferences'],
    key: 'store4c.refusal.nineMore', why: 'the language switcher\'s "coming soon" list is the honest form (the registry\'s own status), never a launch promise' },
  { id: 'no_notices_yet', canon: 'W302 state "No notifications sent yet"', surfaces: ['preferences'],
    key: 'store4c.refusal.noNoticesYet', why: 'DELTA — an empty inbox belongs to the inbox (W299), which says it there' },
]);

/** The canon shapes STORE-4c builds differently — recorded DELTAs (Law 4), not refusals. */
export const STORE4C_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'preferences_route', canon: '`notifications/preferences`', built: '/account/preferences under BOTH chromes (a person-level page, founder Q13); /notifications/preferences is kept as a door' },
  { id: 'inbox_route', canon: '`(marketplace)/notifications`', built: '/<slug>/notifications under the organisation\'s chrome (notices carry the organisation); the platform /notifications is a door to the session\'s store' },
  { id: 'mark_all_read', canon: '(none — W299 draws no mark-all control)', built: 'an EXTRA: "Mark all read", keyed (minted at render) and audited server-side' },
  { id: 'keyset', canon: '"Showing 5 of 187"', built: 'keyset Next (Law 11)' },
  { id: 'retry_reload', canon: 'W3118 "Confirm this action" before Retry on W299', built: 'Retry is a reload (a read): no confirm, no audit entry — W3118–W3120 are DECOR' },
  { id: 'review_step', canon: 'W3134 confirm as its own page', built: 'the same route `?step=review` (a server-held draft, no client JS): the server\'s three reviews ARE the confirm' },
]);

/** The 8 STORE-4c canon files and their verdicts. */
export const STORE4C_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W299-store-notifications.html', flowmap: 'route `notifications`', verdict: 'BUILT at /<slug>/notifications (the platform /notifications a door) — All / Unread, tier chips, the channel ladder, deep links only when served, mark read (keyed), mark all read (EXTRA), keyset' },
  { file: 'W302-store-preferences.html', flowmap: 'route `account/preferences`', verdict: 'BUILT at /account/preferences (both chromes) — one language, senior mode on this device, the buyer matrix with locked and opt-in rows, quiet hours in the organisation\'s zone' },
  { file: 'W3118-store-notifications-mutate-confirm.html', flowmap: 'W299 Retry', verdict: 'PARITY-DECOR — Retry is a reload' },
  { file: 'W3119-store-notifications-mutate-success.html', flowmap: 'W3118 Proceed', verdict: 'PARITY-DECOR — the re-rendered inbox' },
  { file: 'W3120-store-notifications-mutate-failure.html', flowmap: 'W3118 Proceed (failure)', verdict: 'PARITY-DECOR — the load error again with Retry' },
  { file: 'W3134-store-preferences-mutate-confirm.html', flowmap: 'W302 Save', verdict: 'BUILT — REAL: the server\'s reviews (preferences · quiet hours · language) + the consent half, the key minted at render' },
  { file: 'W3135-store-preferences-mutate-success.html', flowmap: 'W3134 Proceed', verdict: 'BUILT — REAL: "saved — applied to your account; senior mode on this device"' },
  { file: 'W3136-store-preferences-mutate-failure.html', flowmap: 'W3134 Proceed (failure)', verdict: 'BUILT — REAL: named (cannot switch off · zone · window · language · validation · concurrency · consent · server), values kept, the same key' },
]);

/** The keys a surface prints (in registry order). */
export function store4cRefusalKeys(surface: Store4cSurface): string[] {
  return STORE4C_REFUSALS.filter((r) => (r.surfaces as readonly string[]).includes(surface)).map((r) => r.key);
}
