// apps/web-storefront/src/features/sweep/refusals.ts · PC-56 STORE-SWEEP-a · C1 (survey E1, founder D1–D8) — what Help (W311), the quality promise
// (W309), Trust & your data (W310), About (W308) and Contact (W312, and a store's own contact page) do NOT claim, BY NAME. PURE. (The shape of
// features/store6b/refusals.ts.) Each refused canon claim is listed ONCE with where the canon makes it and the surfaces it is PRINTED on (a
// refusal sentence — never an offer); the render tests read this map, so a refusal that disappears from its page — or the refused copy coming
// back into a catalogue (test/claims-guard.spec.ts) — turns a test red. The refusals word the refused claims GENERICALLY: the literal canon
// phrases ("6 hours", "3%", "disputed value only", "credits", "versioned", "24×7", a phone number, a short code, a mailbox, a chat app's name)
// appear in NO help / about / press / sweep value, not even here.
//
// Carried ids (the same refusal, re-worded for these pages): 1b `gmv_yesterday` (printed with its own 1b key on About), `trace_demo`;
// 1c `ussd_voice_languages`, `partnerships_desk`; 3a `regrade`, `partial_refund`, `escrow_freeze`, `fee_ladder`.
//
// THE SURFACE TYPE: `SweepSurface` — `about` | `quality` | `trust` | `help` | `contact` (the platform's) | `contact_store` (a store's own).
// components/RefusalList.tsx accepts it.
//
// PC-56 STORE-SWEEP-b (founder D1–D4) adds five surfaces: `tracking` (the order page's delivery section, W292 — printed there), `language` (the
// language page, W323 — printed there), and the three RULES pages that get NO route (founder D2/D4 — no public /errors, /empty, /degraded):
// `errors` (W316), `empty` (W317), `degraded` (W320). Their refusals are the verdict's named refusals — the registry the tracker row cites and
// test/sweep-b.spec.ts checks (every key ×3, each says no); they are not printed on a page of their own (there is none). Carried ids extend their
// surfaces (`phone_line` → errors; `short_code` → degraded; `escrow_every_order` → empty) instead of a second sentence.
export type SweepSurface = 'about' | 'quality' | 'trust' | 'help' | 'contact' | 'contact_store' | 'tracking' | 'errors' | 'empty' | 'degraded' | 'language';
export interface SweepRefusal { id: string; canon: string; surfaces: readonly SweepSurface[]; key: string; why: string }

export const SWEEP_REFUSALS: readonly SweepRefusal[] = Object.freeze([
  // ── W308 (About — platform-only) ──
  { id: 'live_modules', canon: 'W308 "an operating system for agriculture: the marketplace, payments, logistics, credit, insurance and knowledge" · about.p2 "secure payments, logistics and farm-to-fork traceability"', surfaces: ['about'],
    key: 'sweep.refusal.liveModules', why: 'founder D5: the vision is printed AS a vision — online payment, deliveries and traces are switched on per organisation (seed: OFF), credit and insurance are not built' },
  { id: 'money_trace', canon: 'W308 "Every trace page shows where the money went"', surfaces: ['about'],
    key: 'sweep.refusal.moneyTrace', why: 'STORE-5b: a public trace shows the journey, never a person or a rupee' },
  { id: 'escrow_every_order', canon: 'W308 "Escrow on every order" · W317 first-use "Your first one comes with the same escrow protection as the ten-thousandth"', surfaces: ['about', 'empty'],
    key: 'sweep.refusal.escrowEveryOrder', why: 'pay-on-delivery is the seeded default (`online_payments` OFF) — nothing is held for such an order' },
  { id: 'ussd_voice_languages', canon: 'W308 "Voice-first, 12 languages, USSD on a ₹1,000 phone" · W312 "9 of our 12 languages by voice"', surfaces: ['about', 'contact'],
    key: 'sweep.refusal.voiceLanguages', why: '1c carried: three live languages, nothing spoken, no short-code gateway, no phone price measured' },
  // ── W309 (the quality promise — both chromes) ──
  { id: 'regrade', canon: 'W309 "Graded twice … once at dispatch" · "The dispatch re-grade slip is the reference"', surfaces: ['quality'],
    key: 'sweep.refusal.regrade', why: '3a carried: no dispatch re-grade step exists (refused since 2a) — graded once, at listing' },
  { id: 'partial_refund', canon: 'W309 "Tolerance 3% … refunded at line price — arithmetic, not negotiation"', surfaces: ['quality'],
    key: 'sweep.refusal.tolerance', why: 'founder D1: no tolerance rule exists; a partial refund is an amount the moderator decides (dispute.entity.ts)' },
  { id: 'perishables_window', canon: 'W309 "24 hours … for grains and pulses, 6 hours for perishables"', surfaces: ['quality'],
    key: 'sweep.refusal.perishables', why: 'one 24-hour window for every category (order.entity.ts QUALITY_WINDOW_MS; `order.quality_window_hours` has no consumer)' },
  { id: 'dispute_photos', canon: 'W309 "Raise a dispute with photos in the app; both sides see the same evidence board"', surfaces: ['quality'],
    key: 'sweep.refusal.disputePhotos', why: 'a dispute and its messages carry text only (create-dispute.dto.ts, create-dispute-message.dto.ts)' },
  { id: 'escrow_freeze', canon: 'W309 "A dispute freezes escrow for the disputed value only"', surfaces: ['quality'],
    key: 'sweep.refusal.escrowFreeze', why: 'founder D1 / 3a carried: PARTIAL_FREEZE_BUILT = false — the WHOLE order payment stays in escrow while a dispute is open' },
  { id: 'future_credits', canon: 'W309 "remedies are refunds and future-order credits"', surfaces: ['quality'],
    key: 'sweep.refusal.futureCredits', why: 'RESOLUTION_TYPES = refund_full, refund_partial, replacement, rejected — no credit exists' },
  { id: 'resolved_in_days', canon: 'W309 "resolved in days"', surfaces: ['quality'],
    key: 'sweep.refusal.resolvedInDays', why: 'no service level for a dispute exists anywhere in the code' },
  { id: 'no_fine_print', canon: 'W309 "it\'s the whole policy, no fine print anywhere else"', surfaces: ['quality'],
    key: 'sweep.refusal.noFinePrint', why: 'each order\'s own page says what applies to that order (its status, its cancel rule, its payment)' },
  { id: 'fee_ladder', canon: 'W309 "The cancellation & refund ladder" (→ W291)', surfaces: ['quality'],
    key: 'sweep.refusal.feeLadder', why: '3a carried: no fee ladder — the cancel rule is per order (`/<slug>/orders/[id]/cancel`)' },
  { id: 'trace_demo', canon: 'W309 "a real trace page" (→ W303)', surfaces: ['quality'],
    key: 'sweep.refusal.traceDemo', why: '1b carried: no public demonstration lot — the trace entry `/trace` instead' },
  // ── W310 (Trust & your data — platform-only) ──
  { id: 'regulated_partner', canon: 'W310 "Order payments sit in escrow with a regulated payment partner — not in our operating account"', surfaces: ['trust'],
    key: 'sweep.refusal.regulatedPartner', why: 'founder D2: refused until a nodal / escrow agreement exists; escrow is an account of the platform\'s own ledger' },
  { id: 'independent_audit', canon: 'W310 "independently auditable"', surfaces: ['trust'],
    key: 'sweep.refusal.independentAudit', why: 'founder D2: unprovable from code (an auditor realm exists; "independent" is a fact for the company to establish)' },
  { id: 'encryption', canon: 'W310 "Encryption in transit and at rest"', surfaces: ['trust'],
    key: 'sweep.refusal.encryption', why: 'founder D2: an infrastructure fact the code cannot show' },
  { id: 'consent_documents', canon: 'W310 "documents open only inside an active, logged consent"', surfaces: ['trust'],
    key: 'sweep.refusal.consentDocuments', why: 'founder D2: no such gate on document reads was verified' },
  { id: 'sell_data', canon: 'W310 "We do not sell personal data — revenue is subscriptions and transparent transaction fees"', surfaces: ['trust'],
    key: 'sweep.refusal.sellData', why: 'founder D2: a commitment for the company to make in writing, not something code can prove' },
  { id: 'cert_audits', canon: 'W310 "External certification audits: in progress"', surfaces: ['trust'],
    key: 'sweep.refusal.certAudits', why: 'founder D2: nothing published says an audit is in progress' },
  { id: 'proxied_calls', canon: 'W310 "Phone numbers are proxied on calls"', surfaces: ['trust'],
    key: 'sweep.refusal.proxiedCalls', why: 'founder D2 / HOTFIX-6: the storefront offers no call at all (masking on screens is TRUE and printed)' },
  { id: 'disclosure_programme', canon: 'W310 "responsible-disclosure programme at security@…"', surfaces: ['trust'],
    key: 'sweep.refusal.disclosureProgramme', why: 'no programme exists in code; the security mailbox is printed from the facts when set' },
  { id: 'grievance_figures', canon: 'W310 / W312 "Grievance officer (per Indian intermediary rules) … acknowledgement within 48 hours, resolution within 30 days"', surfaces: ['trust', 'contact'],
    key: 'sweep.refusal.grievanceFigures', why: 'founder D3: the figures are printed only when published as facts (0223); which rules apply is for a lawyer to state' },
  // ── W311 (Help — both chromes) ──
  { id: 'help_search', canon: 'W311 "Search help" ("escrow, QR trace, refund, licence…")', surfaces: ['help'],
    key: 'sweep.refusal.helpSearch', why: 'no help index or anonymous CMS read exists (survey C-3 / C-4); a dozen answers on one page need none' },
  { id: 'voice', canon: 'W311 voice search · "Using everything in your language, by voice"', surfaces: ['help'],
    key: 'sweep.refusal.voice', why: 'nothing on the storefront listens or speaks (1a / 4c carried)' },
  { id: 'short_code', canon: 'W311 "No smartphone? *123# and missed-call ordering" · W312 "USSD *123#" · "Phone & missed call" · W320 status "Phone & USSD channels up"', surfaces: ['help', 'contact', 'contact_store', 'degraded'],
    key: 'sweep.refusal.shortCode', why: 'the short-code / call-back gateway is an unimplemented placeholder (1a C-2)' },
  { id: 'licence_upload', canon: 'W311 "Uploading a pesticide licence"', surfaces: ['help'],
    key: 'sweep.refusal.licenceUpload', why: '2b: regulated inputs are refused and blocked at the cart — there is nothing to upload a licence for' },
  { id: 'versioned_answers', canon: 'W311 "Answers are versioned — what an article said on the day you followed it stays retrievable"', surfaces: ['help'],
    key: 'sweep.refusal.versionedAnswers', why: 'no anonymous published-only CMS read and no platform-page writer (B4, named)' },
  { id: 'phone_line', canon: 'W311 / W312 "1800-419-0123 (07:00–21:00 IST)" · W316 "Still failing — retry / do it by phone"', surfaces: ['help', 'contact', 'contact_store', 'errors'],
    key: 'sweep.refusal.phoneLine', why: 'the helpline is an unimplemented placeholder (1a C-2)' },
  { id: 'ticket', canon: 'W311 "raise a ticket from your account" · W312 "Every channel lands in the same ticket system"', surfaces: ['help', 'contact', 'contact_store'],
    key: 'sweep.refusal.ticket', why: '`support` is OFF and the storefront has no caller; tickets are tenant-scoped (support/README.md)' },
  { id: 'paging', canon: 'W311 "P0 money issues page a human 24×7"', surfaces: ['help'],
    key: 'sweep.refusal.paging', why: 'nothing pages anyone; a problem with an order is raised on that order' },
  { id: 'track_delivery', canon: 'help.a1 (built) "…track delivery from your account"', surfaces: ['help'],
    key: 'sweep.refusal.trackDelivery', why: 'founder D8 → STORE-SWEEP-b D1: the delivery\'s milestones are on the order page where the organisation records deliveries; no live map, person or arrival time anywhere (reworded with SW-b)' },
  // ── W312 (Contact — the platform's) and a store's own contact page ──
  { id: 'messaging_app', canon: 'W312 "WhatsApp: message \'hi\' to the same number"', surfaces: ['contact', 'contact_store'],
    key: 'sweep.refusal.messagingApp', why: 'no chat-app provider is connected (communication/services/whatsapp.service.ts) and no inbound bot exists' },
  { id: 'partnerships_desk', canon: 'W312 "Organisations: partners@… · callbacks within one working day"', surfaces: ['contact', 'contact_store'],
    key: 'sweep.refusal.callbacks', why: '1c carried: no desk calls anyone back; an organisation opens its storefront itself' },
  { id: 'general_thread', canon: '(not in canon) a general enquiry to an organisation', surfaces: ['contact_store'],
    key: 'sweep.refusal.generalThread', why: 'founder D6: a message is always about an order or a lot (`contextType: order | listing`) — a general thread is queued by name (B10)' },
  // ── PC-56 STORE-SWEEP-b · W292 (the delivery section of the order page — founder D1, HOTFIX-9 Q3) ──
  { id: 'map_position', canon: 'W292 the map "last GPS fix near Kadi, 14:52 (locations shown to ~100 m)" · "a GPS gap draws a dotted line, never a teleport"', surfaces: ['tracking'],
    key: 'sweep.refusal.mapPosition', why: 'founder Q3 / HOTFIX-9: a buyer never receives a coordinate (tracking-view.ts — null, not rounded); no map library on the storefront' },
  { id: 'delivery_person', canon: 'W292 "Driver Vikram D. · +91 97••• ••318 (callable after out_for_delivery)"', surfaces: ['tracking'],
    key: 'sweep.refusal.deliveryPerson', why: 'HOTFIX-9: `riderUserId` is null for a buyer — only `riderAssigned`; HOTFIX-6: no call is offered on the storefront' },
  { id: 'vehicle_plate', canon: 'W292 "Vehicle Tata 407 · GJ-2•-••-4412"', surfaces: ['tracking'],
    key: 'sweep.refusal.vehiclePlate', why: 'not in the buyer read; a plate identifies a person\'s vehicle' },
  { id: 'eta_slot', canon: 'W292 "Expected Tue 14 Jul, 09:00–13:00" · "If the slot slips, you get the new window plus a choice (wait vs next-day)" · "ETA widens honestly"', surfaces: ['tracking'],
    key: 'sweep.refusal.etaSlot', why: '3a `slots` carried; `etaVerdict()` — "NOT an ETA. Nothing on this platform computes one" (shipment.service.ts)' },
  { id: 'otp_handover', canon: 'W292 delivered "OTP handover: the driver\'s app accepts only the code sent to YOUR phone"', surfaces: ['tracking'],
    key: 'sweep.refusal.otpHandover', why: '4c `delivery_otp` carried: nothing consumes `logistics.delivery_otp_issued` (survey C-5; B2 named for the logistics wave)' },
  { id: 'transit_sms', canon: 'W292 offline "SMS still arrives for the big moments"', surfaces: ['tracking'],
    key: 'sweep.refusal.transitSms', why: '4c `transit_sms` carried: `logistics.shipment_in_transit` is mapped to no notice' },
  { id: 'reattempt_price', canon: 'W292 failed "Re-attempt tomorrow at no charge (first re-attempt is always free); after two attempts it returns and the ladder applies"', surfaces: ['tracking'],
    key: 'sweep.refusal.reattemptPrice', why: '3a `fee_ladder` carried: no re-attempt pricing and no ladder — `deliveryAttempts` is a plain count' },
  { id: 'returned_refund', canon: 'W292 returned "Refund per the ladder starts the moment the centre re-receives it"', surfaces: ['tracking'],
    key: 'sweep.refusal.returnedRefund', why: 'nothing consumes `logistics.shipment_returned` (survey C-5 / F-8); the order\'s money section shows the payment as it stands' },
  { id: 'stop_reasons', canon: 'W292 places "Unjha collection centre", "Mehsana hub" · "cumin is non-perishable; overnight at hub is routine"', surfaces: ['tracking'],
    key: 'sweep.refusal.stopReasons', why: 'the read carries a status and a time per step — no place; the notes are free text staff write, never a buyer\'s (HOTFIX-9)' },
  { id: 'store_settings', canon: 'W292 flagged off "Tracking disabled … See store settings"', surfaces: ['tracking'],
    key: 'sweep.refusal.storeSettings', why: 'a buyer has no store settings; `logistics` is the organisation\'s switch (the W317 flagged-off shape: "this organisation does not record deliveries here")' },
  { id: 'loading', canon: 'W292 state "Loading"', surfaces: ['tracking'],
    key: 'sweep.refusal.loadingState', why: 'server-rendered: the section arrives with the page or says it could not be read' },
  // ── W323 (the language page — founder D3) ──
  { id: 'ip_guess', canon: 'W323 "ગુજરાતી leads the grid because this connection looks like Gujarat (an IP-based guess …)"', surfaces: ['language'],
    key: 'sweep.refusal.ipGuess', why: 'no geolocation: the person\'s choice (`kv_lang`), else the browser\'s own Accept-Language (lib/i18n `getLang`)' },
  { id: 'speaker_preview', canon: 'W323 "Tap the speaker to hear it" · state "Voice preview playing"', surfaces: ['language'],
    key: 'sweep.refusal.speakerPreview', why: '4c `speaks` / 1a voice carried: nothing on the storefront speaks' },
  { id: 'font_loads', canon: 'W323 state "Font not yet cached (2G) … system font until our font loads"', surfaces: ['language'],
    key: 'sweep.refusal.fontLoads', why: 'no web font is loaded (no @font-face, no next/font) — the phone\'s own fonts show every script; the registry\'s `fontPack` is unused here' },
  { id: 'first_visit', canon: 'W323 as the first-visit chooser (the `(auth)` shell)', surfaces: ['language'],
    key: 'sweep.refusal.firstVisit', why: 'founder D3: no first-visit interstitial — the page is opened when the person wants it' },
  // ── W316 (errors — a rules page, no route; founder D4) ──
  { id: 'auto_retry', canon: 'W316 server "Auto-retry with backoff" · "Auto-retries happen quietly (1s → 3s → 10s), then stop"', surfaces: ['errors'],
    key: 'sweep.refusal.autoRetry', why: 'founder D4 / survey E3: a boundary can sit over a filled form — `reset()` on a button only; a money page never retries by itself (6a)' },
  { id: 'role_request', canon: 'W316 permission "Your role can view but not edit. Ask Amit Joshi, or request the role"', surfaces: ['errors'],
    key: 'sweep.refusal.roleRequest', why: 'a buyer has no role; a person is never named' },
  // ── W317 (empty states — a rules page, no route) ──
  { id: 'closest_matches', canon: 'W317 filtered-empty "Closest: drop \'certified\' (38 lots) or widen to Rajkot (31)" · "never an empty wall when something close exists"', surfaces: ['empty'],
    key: 'store2a.refusal.closest', why: '2a `closest_matches` carried: no relaxation logic; an empty answer is said as empty' },
  // ── W320 (when WE are the problem — a rules page, no route; founder D2) ──
  { id: 'status_page', canon: 'W320 "Global ribbon on every page + status page" · the status page "history kept public 90 days … served from separate infrastructure"', surfaces: ['degraded'],
    key: 'sweep.refusal.statusPage', why: 'founder D2 (Q7): no status page in Phase 1 — B9 (an incident record + a public status read + separate infrastructure) refused by name and queued; the ribbon and the kill-switch pages say it instead' },
  { id: 'next_update', canon: 'W320 "new orders are paused since 14:32. Next update by 15:15"', surfaces: ['degraded'],
    key: 'sweep.refusal.nextUpdate', why: 'founder D2: no incident record exists to hold a time — no time promise, no "next update by"' },
  { id: 'rail_health', canon: 'W320 provider outage "UPI payments are failing at the provider since 14:10. Netbanking works."', surfaces: ['degraded'],
    key: 'sweep.refusal.railHealth', why: 'breakers are recorded per dependency (provider_circuit_events) but nothing tells the storefront which rail is down — per-rail health refused; no provider is named or blamed' },
  { id: 'photos_queued', canon: 'W320 severity 1 "image uploads slow → listings save with photos queued"', surfaces: ['degraded'],
    key: 'sweep.refusal.photosQueued', why: 'a seller\'s act on another app; nothing on the storefront queues (6a: money never queues; forms are drafts on the phone, 6b)' },
]);

/** The canon shapes SWEEP-a builds differently — recorded DELTAs, not refusals. */
export const SWEEP_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'quality_route', canon: 'W309 at `(public)/quality`', built: '`/quality-promise` and `/<slug>/quality-promise` (reserved since 0204; `quality` is not reserved)' },
  { id: 'trust_route', canon: 'W310 at `(public)/trust`', built: '`/trust-data`, platform-only (reserved since 0204; `trust` is not reserved); a store host answers 307 to the platform origin' },
  { id: 'help_language_link', canon: 'W311 "Using everything in your language" → W323', built: 'CLOSED by STORE-SWEEP-b: the help answer links the language page (`/language`, `/<slug>/language`); the preferences page is named in the page itself' },
  { id: 'chrome_split', canon: 'W308–W312 draw the platform chrome on every page', built: 'Help, the quality promise and a store\'s Contact under the organisation\'s chrome with organisation-neutral words; About, Press, Pricing, Blog, Trust and the platform Contact are the platform\'s (a store host redirects them)' },
  { id: 'counts_cadence', canon: 'W308 "live platform counters, refreshed daily"', built: 'the precomputed counts with their "as of" line (recomputed every 15 minutes — storefront-public-stats.job.ts)' },
  { id: 'store_contact', canon: 'W312 the platform\'s channels on every page', built: 'a store\'s `/<slug>/contact` offers "Message the organisation" about an order or a lot (4b), behind its `communication` flag, and the platform\'s Grievances link' },
  { id: 'footer_links', canon: 'the canon footer\'s `#help` / `#returns` / `#contact` anchors', built: 'real links: `/help`, `/quality-promise`, `/contact`, `/trust-data` (platform); `/<slug>/help`, `/<slug>/quality-promise`, `/<slug>/contact` + Grievances (store); STORE-SWEEP-b: + Language on both' },
  // ── PC-56 STORE-SWEEP-b ──
  { id: 'tracking_route', canon: 'W292 at `(marketplace)/orders/[id]/tracking`; W288 / W295 / W296 / W299 link it', built: 'a SECTION `#tracking` of the order page `/<slug>/orders/[id]` (the store\'s chrome only); the four inbound links resolve to the order page' },
  { id: 'coming_soon_languages', canon: 'W323 "Registry rows with is_active=false don\'t render — we never show a language we can\'t honour"', built: 'the language page shows the live languages as buttons and the rest as ONE "not available yet" line (the 4c `nine_more` / DEV-21 switcher precedent) — never selectable' },
  { id: 'one_language_per_page', canon: 'W317 "bilingual line on farmer-facing empties" · W316 / W320 / W323 bilingual headings', built: 'one language per page (4c "ONE language"): every sentence in the person\'s language; the language page writes each choice in its own script' },
  { id: 'status_page_queued', canon: 'W320 the status page and the platform-incident ribbon with "next update by"', built: 'no status page (B9 queued): a ribbon on every page of a chrome while `storefront_cart` or `storefront_browse` is OFF — the feature, "our side", the working detour, no time promise; the kill-switch pages say "our side" and, for buying, "nothing was charged"' },
  { id: 'rules_pages', canon: 'W316 `(canon)/errors` · W317 `(canon)/empty` · W320 `(canon)/degraded`', built: 'no public route (PARITY-DECOR): the rules are kept by the boundaries, the empties and the kill-switch pages, each with its render test' },
]);

/** The 10 STORE-SWEEP canon files and their verdicts (SW-a's 5, then SW-b's 5). */
export const SWEEP_CANON_FILES: readonly { file: string; verdict: string }[] = Object.freeze([
  { file: 'W308-store-about.html', verdict: 'GAP-UI built — /about rebuilt (platform-only): the three precomputed counts with "as of" (or the error / not-yet sentence), the vision printed as a vision, the principles only where code makes them true; GMV, "money on every trace", "escrow on every order", voice / languages refused' },
  { file: 'W309-store-quality-promise.html', verdict: 'GAP-UI built — /quality-promise under both chromes: each rule with its mechanism (graded once; 24 h window for orders paid online; no window on delivery-paid; text disputes holding the WHOLE payment, flag-aware; the moderator decides; refunds to source); the re-grade, tolerance, perishables, photos, partial freeze, credits, days, fine print, ladder and demo trace refused' },
  { file: 'W310-store-trust-data.html', verdict: 'GAP-UI built — /trust-data (platform-only): TRUE claims with their mechanism; the regulated partner, independent audit, encryption, consent gate, data-sale promise, certification audits and proxied calls refused; the grievance block and legal facts from 0223 or "not published yet"' },
  { file: 'W311-store-help-center.html', verdict: 'GAP-UI built — /help under both chromes: the false money / tracking / support answers removed (founder D8), the money answer by the store\'s `online_payments` (both cases on the platform); search, voice, short code, licence upload, versioned answers, phone line, ticket and paging refused' },
  { file: 'W312-store-contact.html', verdict: 'GAP-UI built — /contact (platform): five mailboxes, the entity and office from 0223 or "not published yet", the self-serve signup link; /<slug>/contact (store): "Message the organisation" about an order or a lot; phone, short code, chat app, callbacks and one ticket system refused' },
  // ── PC-56 STORE-SWEEP-b ──
  { file: 'W292-store-tracking.html', verdict: 'BUILT (section) — `#tracking` on /<slug>/orders/[id] (DELTA tracking_route) over the buyer\'s tracking read (HOTFIX-9), behind the organisation\'s `logistics` flag (17th allow-listed key, fail-closed): the shipment status, the milestones with their times, "a delivery partner is assigned" (never who), the attempt count, the partner\'s reference when set, "no journey updates yet"; OFF / unreadable / a failed read each said in the section, never the page; map, position, person, phone, vehicle, ETA and slot, the handover code, text messages, re-attempt pricing, the refund on return, stop reasons, store settings and "Loading" refused' },
  { file: 'W316-store-error-canon.html', verdict: 'PARITY-DECOR — no /errors route: every error answers what happened, that nothing was charged or lost, and what to do now, inside its own chrome ([tenantSlug]/not-found + error, (platform)/not-found + error, global-error with no chrome, the middleware\'s localized 503/404); a Try-again button and never an automatic retry; no "Oops", no exclamation mark, the code in small print; the phone line and the role request refused' },
  { file: 'W317-store-empty-canon.html', verdict: 'PARITY-DECOR — no /empty route: the built empties keep the rules (one call to action, filters stay visible, an empty answer is said as empty and never "try again later", no illustrations); "closest matches" stays refused (2a), escrow on a first order refused, the bilingual line a DELTA (one language per page)' },
  { file: 'W320-store-degraded-service.html', verdict: 'PARITY-DECOR — no /degraded route and no status page (B9 refused and queued): a ribbon on every page while buying or browsing is paused names the feature, says "our side" and gives the working detour; the kill-switch pages say "our side" and, for buying, "nothing was charged"; reads stay alive; no time promise, no per-rail health, no provider named, no queued photos' },
  { file: 'W323-store-language.html', verdict: 'BUILT — /language and /<slug>/language: the live languages as buttons, each written in itself, posting to /api/lang with the page the person came from; the rest as one "not available yet" line (DELTA coming_soon_languages); changed later from Account → Preferences; no IP guess, no speaker, no web font, no first-visit interstitial' },
]);

/** The i18n keys of one surface's refusals (render tests read this). */
export function sweepRefusalKeys(surface: SweepSurface): string[] {
  return SWEEP_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}
/** The surfaces a STORE renders (Help, the quality promise, a store's contact page) — the brand guard scopes these keys: no platform name. */
export const STORE_RENDERED_SURFACES: readonly SweepSurface[] = Object.freeze(['help', 'quality', 'contact_store'] as SweepSurface[]);
/** PC-56 STORE-SWEEP-b: the surfaces SW-b adds that a STORE renders (the delivery section, the language page) — test/brand-guard.spec.ts scopes their
 *  refusals with `sweep.tracking.*`, `sweep.language.*` and the store boundary words (`sweep.err.*`). */
export const STORE_RENDERED_SURFACES_B: readonly SweepSurface[] = Object.freeze(['tracking', 'language'] as SweepSurface[]);
