// apps/web-storefront/src/features/store5b/refusals.ts · PC-56 STORE-5b · brief §E — what the trace page (W303), the verify page (W304), the
// record export (W3154–W3155), the certificate page (W305) and the dairy trace (W306) do NOT claim, BY NAME. PURE. (The shape of
// features/store5a/refusals.ts; the surfaces extend 5a's `Store5Surface` union.) Each refused canon claim is listed ONCE with where the canon
// makes it and the surfaces it is PRINTED on (a sentence that says no — never an offer); the render tests read this map, and the claims guard
// keeps the refused copy out of every other key.
import type { Store5Surface } from '../store5a/refusals';

export interface Store5bRefusal { id: string; canon: string; surfaces: readonly Store5Surface[]; key: string; why: string }

export const STORE5B_REFUSALS: readonly Store5bRefusal[] = Object.freeze([
  // ── money (founder D5 · Q4 / Q5) ──
  { id: 'money_split', canon: 'W303 "Where the money went — <amount> the farmer (94.7%) · <amount> FPO · <amount> platform"', surfaces: ['trace'],
    key: 'store5b.refusal.moneySplit', why: 'founder D5 (Q4): a member\'s income and an organisation\'s commercial terms are not public facts — no figure, no percentage' },
  { id: 'was_paid', canon: 'W303 "Ramesh Bhai was paid … a ledger entry this page links to" · "Payment went to escrow the same hour"', surfaces: ['trace'],
    key: 'store5b.refusal.wasPaid', why: 'founder D5: no payment status and no ledger link on a public page; a pay-on-delivery sale never touches escrow, so the page does not say "through escrow" either' },
  { id: 'member_split', canon: 'W306 "split exactly … shared across the 11 contributing members by their exact litres"', surfaces: ['dairy_trace'],
    key: 'store5b.refusal.memberSplit', why: 'founder D5 (Q5): no pooled-sale split to members exists' },
  // ── the farmer (founder D4 · Q6) ──
  { id: 'farmer_name', canon: 'W303 "Grown by Ramesh P. — shared with his consent" + bio + avatar · "Hear a greeting from Ramesh Bhai"', surfaces: ['trace'],
    key: 'store5b.refusal.farmerName', why: 'founder D4 (Q6): organisation-only — "a verified member farmer of <organisation>, <village>"; no name, bio, avatar, voice or consent machinery' },
  // ── the record (founder D2 / D3 · Q13 / Q14) ──
  { id: 'signed', canon: 'W303 "the platform\'s own signed records" · W304 "Download signed record (JSON)"', surfaces: ['trace', 'trace_verify', 'trace_export'],
    key: 'store5b.refusal.signed', why: 'founder D2 (Q13): no signing key exists — the receipt\'s sha256 is the integrity; the file is CSV, not JSON' },
  { id: 'public_ledger', canon: 'W304 "written to a public ledger … polygon:0x8e4f… block 74,120,558" · W303 "Anchored ✓"', surfaces: ['trace', 'trace_verify', 'certificate'],
    key: 'store5b.refusal.publicLedger', why: 'founder D3 (Q14): a daily PLATFORM seal of the chain head, with its time — no public ledger, no chain address, no block number, no tick mark' },
  { id: 'measured_claims', canon: 'W303 "Graded … Grade A … calibrated meters" · "weighbridge 25.02 qtl" · "OTP handover"', surfaces: ['trace'],
    key: 'store5b.refusal.measuredClaims', why: 'the journey vocabulary carries no grading, weighbridge or handover step — the page prints only the steps the organisation recorded' },
  { id: 'flagged_platform', canon: 'W304 state "Chain mismatch … the lot is flagged platform-wide"', surfaces: ['trace_verify'],
    key: 'store5b.refusal.flaggedPlatform', why: 'nothing flags a lot platform-wide; a mismatch is shown, loudly, on this page — never hidden' },
  { id: 'camera', canon: 'the home\'s and W303\'s "Scan a QR" with the camera', surfaces: ['trace', 'trace_verify'],
    key: 'store5b.refusal.camera', why: 'no camera scanner (carried from STORE-1b): type the code printed under the QR' },
  // ── certificates (founder D1 · Q7) ──
  { id: 'platform_verified', canon: 'W305 "only shown after platform verification against the issuing body — the platform\'s own verdict" · "Verified by platform … checked against the lab\'s register"', surfaces: ['certificate', 'trace'],
    key: 'store5b.refusal.platformVerified', why: 'founder D1 (Q7): the check is the ORGANISATION\'s staff\'s — "checked by <organisation>"; no platform trust desk exists in this realm' },
  { id: 'brand_qr', canon: 'W305 "QR · verify at <the brand\'s domain>/c/LAB-26-08841"', surfaces: ['certificate'],
    key: 'store5b.refusal.brandQr', why: 'founder D7 (Q15): no brand-domain literal on an organisation\'s page; the number is looked up on this page\'s own form' },
  { id: 'findings', canon: 'W305 title "Moisture & aflatoxin analysis …" · "Findings — moisture 7.8% · aflatoxin < 2 µg/kg"', surfaces: ['certificate'],
    key: 'store5b.refusal.findings', why: 'a certificate record holds no title and no findings — the page shows what the record holds' },
  { id: 'issuer_contact', canon: 'W305 state "Issuer contact details are platform-staff-only"', surfaces: ['certificate'],
    key: 'store5b.refusal.issuerContact', why: 'no issuer contact is stored at all' },
  { id: 'phone_line', canon: 'W305 / W303 / W306 "Its number works on the phone line too" · "1800-…"', surfaces: ['certificate', 'trace', 'dairy_trace'],
    key: 'store5b.refusal.phoneLine', why: 'the helpline is an unimplemented placeholder (STORE-1a)' },
  { id: 'badge_same_day', canon: 'W305 state expired "Listings that claimed it lost the badge the same day — automatically, not on complaint"', surfaces: ['certificate'],
    key: 'store5b.refusal.badgeSameDay', why: 'reworded to the truth: the badge is read from the certificate every time a listing is shown, so it is gone the day validity passes — nothing is removed from the listing' },
  { id: 'claim_removed', canon: 'W305 state rejected "The seller\'s claim was removed and the moderation desk notified"', surfaces: ['certificate'],
    key: 'store5b.refusal.claimRemoved', why: 'nothing is removed and no desk is notified: the listing reads "organic (self-declared)" because no verified certificate covers it' },
  // ── the dairy lineage (founder D6 · Q16) ──
  { id: 'dairy_lineage', canon: 'W306 "Churned from the milk of 17 Gir cows" · "39 collections … each reading with the member\'s can number" · "bilona … 25 litres to the kilo"', surfaces: ['dairy_trace'],
    key: 'store5b.refusal.dairyLineage', why: 'founder D6 (Q16): no lineage links a jar to collections, coolers or animals — a dairy-lineage backend is queued' },
  { id: 'cold_chain_chart', canon: 'W306 "Cold-chain trail — 4°C, unbroken" chart · "Sensor gap — dotted segment"', surfaces: ['dairy_trace'],
    key: 'store5b.refusal.coldChainChart', why: 'founder D6: the cooler\'s readings are not linked to any batch' },
  // ── the chain pages ──
  { id: 'reload_audit', canon: 'W3156–W3158 / W3086–W3088 "Confirming writes an audit-trail entry with actor, time and reason"', surfaces: ['trace', 'trace_verify', 'certificate', 'dairy_trace'],
    key: 'store5b.refusal.reloadAudit', why: 'Retry is a reload of a public page — nothing is confirmed and nothing is written' },
  { id: 'oncall', canon: 'W3158 / W3088 "repeated failures page the on-call"', surfaces: ['trace', 'trace_verify', 'trace_export', 'certificate'],
    key: 'store5b.refusal.oncall', why: 'nothing pages anyone; the failure is said by name with a Retry' },
]);

/** The canon shapes STORE-5b builds differently — recorded DELTAs, not refusals. */
export const STORE5B_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'csv_not_json', canon: 'W304 "Download signed record (JSON)" / W3155', built: 'a CSV on the export plane for the signed-in requester (events, hashes, the verdict, the seal row) with the plane\'s receipt — not signed' },
  { id: 'no_verification_yet', canon: 'W304 state "No verification yet — enter or scan a trace code above" (the canon has no input)', built: 'the verify page always has a lot; "Check another code" goes to /trace, the code-entry page' },
  { id: 'certificate_form', canon: 'W305 state "No certificate checked yet — enter a certificate number above" (the canon has no input)', built: 'a GET form by number within the store\'s organisation (the platform page asks for the organisation\'s web name too)' },
  { id: 'export_back', canon: 'W3155 crumb and Back → W273 (survey F-25)', built: 'they return to the verify page' },
  { id: 'chrome', canon: 'W303–W306 "Krishalaya · farm-to-fork trace" chrome + "Visit the bazaar"', built: 'the HOST\'s chrome: an organisation\'s store shows its own mark (another organisation\'s lot goes to the platform page); the organisation is named on both' },
  { id: 'sold_line', canon: 'W303 "Sold … Payment went to escrow the same hour"', built: '"Sold on the platform" — the price, the payment route and who was paid are not shown (a pay-on-delivery sale never touches escrow)' },
  { id: 'logs_staff', canon: 'W304 / W306 "Raw sensor logs are platform-staff-only"', built: 'reworded: the organisation\'s own device logs stay with the organisation\'s staff' },
]);

/** The 12 STORE-5b canon files and their verdicts. */
export const STORE5B_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W303-store-trace.html', flowmap: 'route `trace/[qrToken]` · nav-detail ×2', verdict: 'BUILT under both chromes — the product line, the organisation-only farmer line with the village, the journey with step labels, meta and short hashes, the seal sentence, the certificates, "Check the record yourself"; not published / no longer published / not found / in progress states' },
  { file: 'W304-store-trace-verify.html', flowmap: 'chain-export:trace → W3154 · nav-detail', verdict: 'BUILT — the server\'s recompute per event (recomputes ✓ / MISMATCH / written before version 2), the chain summary, the exact formula, the seal, the honesty note, "Download the record"' },
  { file: 'W305-store-certificate.html', flowmap: 'route `certificates/[id]` · chain-mutate:certificate (Retry)', verdict: 'BUILT under both chromes — by id and by number; type from the vocabulary, status + meaning, "checked by <organisation> (<role>)", validity, subject, reason; not published / not found / the form' },
  { file: 'W306-store-trace-dairy.html', flowmap: 'route `trace/[qrToken]/dairy`', verdict: 'REFUSED (founder D6) — an honest "dairy trace not available yet" for any lot, a link back to the trace' },
  { file: 'W3086-store-certificate-mutate-confirm.html', flowmap: 'W305 Retry', verdict: 'DECOR — Retry reloads the certificate page; nothing is confirmed' },
  { file: 'W3087-store-certificate-mutate-success.html', flowmap: 'W3086 Proceed', verdict: 'DECOR — the reloaded page' },
  { file: 'W3088-store-certificate-mutate-failure.html', flowmap: 'W3086 Proceed (failure)', verdict: 'DECOR — the error state with Retry' },
  { file: 'W3154-store-trace-export-queued.html', flowmap: 'chain-export:trace', verdict: 'BUILT — REAL: signed in, keyed at render; queued with position and the plane\'s ETA, "Check ready page", Back to verify' },
  { file: 'W3155-store-trace-export-ready.html', flowmap: 'W3154 → ready', verdict: 'BUILT — REAL: the receipt (file, rows, sha256, generated-at, You), "Download (link valid N minutes)", every fetch logged; CSV not JSON' },
  { file: 'W3156-store-trace-mutate-confirm.html', flowmap: 'W303 / W304 / W306 Retry', verdict: 'DECOR — Retry reloads the page' },
  { file: 'W3157-store-trace-mutate-success.html', flowmap: 'W3156 Proceed', verdict: 'DECOR — the reloaded page' },
  { file: 'W3158-store-trace-mutate-failure.html', flowmap: 'W3156 Proceed (failure)', verdict: 'DECOR — the error state with Retry' },
]);

export function store5bRefusalKeys(surface: Store5Surface): string[] {
  return STORE5B_REFUSALS.filter((r) => (r.surfaces as readonly string[]).includes(surface)).map((r) => r.key);
}
