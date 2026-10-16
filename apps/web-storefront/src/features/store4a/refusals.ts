// apps/web-storefront/src/features/store4a/refusals.ts · PC-56 STORE-4a · brief §E — what the account, the address book and the data-rights
// pages do NOT claim, BY NAME. PURE. (The shape of features/store4/refusals.ts and store3a's.) Each refused canon claim is listed ONCE with
// where the canon makes it and the surfaces it is PRINTED on (a refusal sentence — never an offer); the render tests read this map, so a
// refusal that disappears from its page — or the refused copy coming back into a catalogue (test/claims-guard.spec.ts) — turns a test red.
import type { Store4Refusal, Store4Surface } from '../store4/refusals';

export type Store4aSurface = Exclude<Store4Surface, 'thread'>;

export const STORE4A_REFUSALS: readonly Store4Refusal[] = Object.freeze([
  { id: 'reveal', canon: 'W300 "Phone +91 98••• ••742 · Reveal (reveal is logged)" · the Reveal (step-up) state', surfaces: ['account'],
    key: 'store4a.refusal.reveal', why: 'founder D7 (Q10): no self-reveal route exists and none is built — the masked number is shown, and the number is changed through the app\'s change-phone screen (an OTP to the new number)' },
  { id: 'kyc_auctions', canon: 'W300 "KYC verified — unlocks auctions with bidder qualification" · the KYC-pending state', surfaces: ['account'],
    key: 'store4a.refusal.kycAuctions', why: 'there is no buyer KYC (1a) and no bidder qualification (refused 3c); the business details are shown with their review status only' },
  { id: 'licence', canon: 'W300 "Pesticide licence: not added — needed only for restricted inputs" → W282', surfaces: ['account'],
    key: 'store4a.refusal.licence', why: 'no licence flow exists (refused 2b)' },
  { id: 'buying_history', canon: 'W300 aside "Sellers see your name, district and buying history"', surfaces: ['account'],
    key: 'store4a.refusal.buyingHistory', why: '3b D5: no buying history is shown to an organisation; what an organisation\'s order read carries is printed instead (your name on the order; never your phone)' },
  { id: 'thirty_days', canon: 'W300 "deletion completes within 30 days except records the law makes us keep" · the delete confirm "Everything else erases within 30 days"', surfaces: ['account', 'delete'],
    key: 'store4a.refusal.thirtyDays', why: 'founder D3 (Q7): the cooling-off is 90 days and the request prints its own date; erasure is then done by the platform\'s data-protection desk — nothing erases automatically' },
  { id: 'card', canon: 'W300 "Saved payment methods — UPI nilesh@ok••• · card •••• 4417"', surfaces: ['account'],
    key: 'store4a.refusal.card', why: 'founder D6 (Q4): no card is ever saved (no tokenisation); the masked mandates and payout instruments are shown' },
  { id: 'unserviceable', canon: 'W301 "Unserviceable pincode — bulk (10+ qtl) delivery doesn\'t reach this pincode yet"', surfaces: ['addresses', 'address_form'],
    key: 'store4a.refusal.unserviceable', why: 'founder D4 (Q14): an address is person-level; whether an organisation delivers there is decided by that organisation at checkout (its zones), never on the address book' },
  { id: 'flagged_off', canon: 'W300 / W301 "Flagged off — Account / Addresses disabled for this tenant/plan"', surfaces: ['account', 'addresses'],
    key: 'store4a.refusal.flaggedOff', why: 'Law 10 + founder (HOTFIX-6 D3 carried): a person\'s account, address book and data rights have no kill-switch' },
  { id: 'helpline', canon: 'the store chrome "1800-…" helpline', surfaces: ['account', 'data', 'delete'],
    key: 'store4a.refusal.helpline', why: 'the helpline is an unimplemented placeholder (STORE-1a C-2)' },
  { id: 'audit_reload', canon: 'W3031 "Confirming writes an audit-trail entry with actor, time and reason" (on a profile reload)', surfaces: ['account'],
    key: 'store4a.refusal.auditReload', why: 'Retry on the account is a reload (a read): nothing is written — W3031–W3033 are DECOR; the profile EDIT is the audited act' },
  { id: 'oncall', canon: 'W3033 / W3037 / W3040 "repeated failures page the on-call"', surfaces: ['account', 'address_form', 'addresses'],
    key: 'store4a.refusal.oncall', why: 'nothing pages anyone; a failure is said by name, with a retry' },
  { id: 'driver_view', canon: 'W301 "Gate and vehicle notes travel with the address to every driver"', surfaces: ['addresses', 'address_form'],
    key: 'store4a.refusal.driverView', why: 'the note is stored with the address and carried by every copy (0214) — but no driver\'s drop view reads address lines yet (the logistics reads carry the address id only); named, owed to the logistics wave' },
]);

/** The canon shapes STORE-4a builds differently — recorded DELTAs (Law 4), not refusals. */
export const STORE4A_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'deletion_chain', canon: 'W300 "Delete my account…" (no canon chain of its own)', built: 'the deletion request rides the W3031–W3033 confirm → success → failure SHAPE at /account/delete, with W300\'s "Delete confirm" state as the confirm body (figures from the server)' },
  { id: 'one_csv', canon: 'W3029 / W3030 "the file" — the canon implies "everything" as one download', built: 'ONE CSV with a `section` column (profile · address · order · message · consent · notification · data_request), across every organisation' },
  { id: 'both_chromes', canon: '`(marketplace)/account…` under the platform header', built: 'BOTH real — the platform /account… and /<slug>/account… under the organisation\'s mark — one shared screen component per page (components/account/*Screen.tsx with a chrome prop for hrefs); the data is the person\'s whatever the chrome' },
  { id: 'keyset_caps', canon: '"N of M" counts', built: 'the address book is capped at the API\'s 50 (printed "50+" at the cap) and the request history at 50 (Law 11)' },
  { id: 'retry_reload', canon: 'W3031 "Confirm this action" before Retry on W300', built: 'Retry is a reload (a read): no confirm, no audit entry' },
  { id: 'chain_back_links', canon: 'W3030 / W3032 / W3033 / W3035 / W3036 / W3037 / W3039 / W3040 crumb and "Back" → W316', built: 'Back returns to the account / the address book / the form itself — W316 is the error canon (survey F-25: the worst link defect is W3037\'s "Retry — back to confirm" → W316)' },
  { id: 'review_step', canon: 'W3035 review as its own page', built: 'the same route `?step=review` (server-held draft, no client JS); Submit carries the key minted when the form rendered' },
]);

/** The 14 STORE-4a canon files and their verdicts. */
export const STORE4A_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W300-store-account.html', flowmap: 'route `account`', verdict: 'BUILT at /account and /<slug>/account — the profile (name, masked phone and email, language), business details with their review status, shortcuts, saved methods, wallet balance, data rights' },
  { file: 'W301-store-addresses.html', flowmap: 'route `account/addresses`', verdict: 'BUILT at /account/addresses (both chromes) — labelled cards, the note, masked receiver, default, remove / make-default confirms' },
  { file: 'W3029-store-account-export-queued.html', flowmap: 'W300 "Download my data" (chain-export:account)', verdict: 'BUILT — REAL: the queued job with its position and honest ETA (/account/data)' },
  { file: 'W3030-store-account-export-ready.html', flowmap: 'W3029 "Check ready page"', verdict: 'BUILT — REAL: the receipt (file, rows, sha256, generated-at, requester) + "Download (link valid 15 minutes)" — every fetch logged; W316 links a canon defect' },
  { file: 'W3031-store-account-mutate-confirm.html', flowmap: 'W300 Retry', verdict: 'PARITY-DECOR — Retry is a reload; the DELETION request rides this shape (DELTA deletion_chain)' },
  { file: 'W3032-store-account-mutate-success.html', flowmap: 'W3031 Proceed', verdict: 'PARITY-DECOR — the re-rendered page; the deletion success is /account/delete?ok=requested; W316 links a canon defect' },
  { file: 'W3033-store-account-mutate-failure.html', flowmap: 'W3031 Proceed (failure)', verdict: 'PARITY-DECOR — the load error again with Retry; the deletion failure is named (blocked / server); on-call refused' },
  { file: 'W3034-store-addresses-form-form-error.html', flowmap: 'W301 "+ Add address" / "Edit"', verdict: 'BUILT — REAL: every field\'s refusal by the one rule + the label + the note, values kept' },
  { file: 'W3035-store-addresses-form-review.html', flowmap: 'W3034 Submit', verdict: 'BUILT — REAL: read-only values; for an edit the diff against the current row, field by field' },
  { file: 'W3036-store-addresses-form-success.html', flowmap: 'W3035 Submit', verdict: 'BUILT — REAL: the saved card; for a copied edit "orders already placed keep the old address"' },
  { file: 'W3037-store-addresses-form-failure.html', flowmap: 'W3035 Submit (failure)', verdict: 'BUILT — REAL: validation / unknown label / not found / concurrency / server, values kept, the same key; W316 links a canon defect' },
  { file: 'W3038-store-addresses-mutate-confirm.html', flowmap: 'W301 the card actions', verdict: 'BUILT — REAL: remove ("orders already heading there keep their copy" + the default reassignment) / make-default (before → after)' },
  { file: 'W3039-store-addresses-mutate-success.html', flowmap: 'W3038 Proceed', verdict: 'BUILT — REAL: removed / default changed, said on the book' },
  { file: 'W3040-store-addresses-mutate-failure.html', flowmap: 'W3038 Proceed (failure)', verdict: 'BUILT — REAL: not found / concurrency / server, with Retry' },
]);

/** The keys a surface prints (in registry order). */
export function store4aRefusalKeys(surface: Store4aSurface): string[] {
  return STORE4A_REFUSALS.filter((r) => (r.surfaces as readonly string[]).includes(surface)).map((r) => r.key);
}
