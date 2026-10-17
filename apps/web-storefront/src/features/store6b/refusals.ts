// apps/web-storefront/src/features/store6b/refusals.ts · PC-56 STORE-6b · brief §E — what "On this phone" (W315, rebuilt), its discard chain
// (W3151–W3153) and the install invitation (W3137–W3140, on the sheet and the `/app` page) do NOT claim, BY NAME. PURE. (The shape of
// features/store6/refusals.ts.) Each refused canon claim is listed ONCE with where the canon makes it and the surfaces it is PRINTED on (a
// refusal sentence — never an offer); the render tests read this map, so a refusal that disappears from its page — or the refused copy coming
// back into a catalogue (test/claims-guard.spec.ts) — turns a test red.
//
// THE SURFACE TYPE: `Store6bSurface` — `sync` (the new page) and `install` (6a's `/app` surface: the 6b refusals print there beside 6a's).
// components/RefusalList.tsx accepts it.
export type Store6bSurface = 'sync' | 'install';
export interface Store6bRefusal { id: string; canon: string; surfaces: readonly Store6bSurface[]; key: string; why: string }

export const STORE6B_REFUSALS: readonly Store6bRefusal[] = Object.freeze([
  // ── W315 (Sync & conflicts → "On this phone") ──
  { id: 'last_full_sync', canon: 'W315 "Last full sync: today, 17:41"', surfaces: ['sync'],
    key: 'store6b.refusal.lastFullSync', why: 'there is no sync: nothing of the server\'s is copied to the phone — the honest line is "this page loaded at <time>"' },
  { id: 'on_wifi', canon: 'W315 "· on Wi-Fi"', surfaces: ['sync'],
    key: 'store6b.refusal.onWifi', why: 'the connection type is never read (no `navigator.connection`) and nothing waits for a kind of network' },
  { id: 'sync_now', canon: 'W315 "Sync now" (chain-mutate:sync → W3151)', surfaces: ['sync'],
    key: 'store6b.refusal.syncNow', why: 'founder D1 (Q4): no batch send — each draft has its own "Send now" link to its live page, where the person presses Send' },
  { id: 'badges', canon: 'W315 badges "synced orders, messages, prices · 2 queued cart edits · 1 conflict needs you"', surfaces: ['sync'],
    key: 'store6b.refusal.badges', why: 'nothing is synced or queued and nothing conflicts: orders, messages and prices are never kept on the phone (founder Q3); cart edits never queue (Q5)' },
  { id: 'data_saver', canon: 'W315 data-saver note "photos sync only on tap … The setting lives in W302"', surfaces: ['sync'],
    key: 'store6b.refusal.dataSaver', why: 'there is no data-saver setting (4c `data_saver` carried); photos are never kept (6a D3)' },
  { id: 'voice', canon: 'W315 "voice sends automatically"', surfaces: ['sync'],
    key: 'store6b.refusal.voice', why: 'no voice is recorded or sent on the storefront (1a / 4b carried), and nothing sends automatically' },
  { id: 'conflict_card', canon: 'W315 conflict card "Keep phone version" / "Keep computer version" · "Merge by hand" (chain-mutate:sync → W3151)', surfaces: ['sync'],
    key: 'store6b.refusal.conflictCard', why: 'a draft lives on one phone only — there is never a second version to choose between or merge' },
  { id: 'listing_drafts', canon: 'W315 "a listing draft edited on phone and computer"', surfaces: ['sync'],
    key: 'store6b.refusal.listingDrafts', why: 'a listing draft is a seller\'s act on a buyer\'s page (survey F-15): no listing is written on the storefront' },
  { id: 'two_places', canon: 'W315 rule "you decide: your own content edited in two places … never auto-merge"', surfaces: ['sync'],
    key: 'store6b.refusal.twoPlaces', why: 'reworded to the truth: your words are only on this phone and leave when YOU press Send — nothing is merged, nothing is edited in two places' },
  { id: 'auto_send', canon: 'W314 / W319 "will send when signal returns" (the drafts half of the 4b offline_queue and 5a offline refusals)', surfaces: ['sync', 'install'],
    key: 'store6b.refusal.autoSend', why: 'founder D1 (Q4): nothing is sent by itself — the API remembers a key for 24 hours, deploys change the server\'s acts, and a message sent hours later into a locked thread would be a betrayal' },
  { id: 'other_drafts', canon: 'W319 "Write drafts — cart edits, messages, reviews, listing drafts"', surfaces: ['sync', 'install'],
    key: 'store6b.refusal.otherDrafts', why: 'founder D4: only a message and a review are kept as you type — never a cart line, an address, a preference, an offer, a bid or the sign-in form' },
  { id: 'chain_sentences', canon: 'W3152 / W3139 "the audit trail has the entry … reconcile zero-sum" · W3153 / W3140 "repeated failures page the on-call"', surfaces: ['sync', 'install'],
    key: 'store6b.refusal.chainSentences', why: 'a discard and an install are this phone\'s own acts: no record is written on the server, no money moves, nobody is paged' },
  // ── W319 / W3137–W3140 (the invitation) ──
  { id: 'size_figure', canon: 'W319 / W3138 "Under 3 MB — smaller than three photos"', surfaces: ['install'],
    key: 'store6b.refusal.sizeFigure', why: 'survey E10: no size is measured — the invitation names none' },
  { id: 'first_visit', canon: 'an install prompt on the first visit', surfaces: ['install'],
    key: 'store6b.refusal.firstVisit', why: 'founder D3 (Q8): the invitation is offered from the second visit of a device, never the first, and never again for 30 days after "Not now"' },
]);

/** The canon shapes STORE-6b builds differently — recorded DELTAs, not refusals. */
export const STORE6B_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'sync_route', canon: 'W315 at `(canon)/sync` — "Sync & conflicts", reached from a "waiting to sync" chip', built: '/sync and /<slug>/sync under BOTH chromes, rebuilt as "On this phone": the person\'s unsent drafts read from THIS phone; the chip "N on this phone" beside the cart in both headers (never in the offline shell)' },
  { id: 'send_now_link', canon: 'W315 "Sync now"', built: 'per draft, "Send now" = a LINK to its live page with `?draft=<id>` (the page\'s keeper fills the form; its key is minted at that render) — nothing is posted from /sync' },
  { id: 'discard_chain', canon: 'W3151–W3153 the shared mutate confirm / success / failure ("Confirm this action")', built: 'the REAL device act "Discard this draft?" (/sync?discard=<id> → ?done=discarded | ?done=failed): IndexedDB only, no API call, no audit row' },
  { id: 'pwa_chain', canon: 'W3137–W3140 the shared form error / review / success / failure', built: 'W3138 = the bottom sheet itself; W3139 / W3140 its next states AND `/app?install=success|failure`; W3137 = `/app?install=error` (and the `/app` line for a browser that offers no install)' },
  { id: 'chain_links', canon: 'W3138 "Back to edit" → W273 · W3139 Back → W273 · W3140 Retry / Back → W273 (survey F-14)', built: 'every link returns to the page the sheet was on, the `/app` page, or the list on /sync; W3153 Retry → the confirm again' },
  { id: 'device_cookies', canon: 'survey B5 "`kvs_install` through `/api/mechanism`"', built: 'the CLIENT writes `kvs_visits` and `kvs_install` (JS-readable, a year): the invitation is a client island and needs no server round-trip (founder D3)' },
  { id: 'sheet_words', canon: 'W319 "Add Krishalaya to your home screen?"', built: '"Add <organisation> to your home screen?" — the organisation\'s name and icon as its manifest has them (the platform host: the platform store\'s)' },
  { id: 'wipe_marker', canon: 'the brief: sign-out wipes drafts through HOTFIX-8\'s `Clear-Site-Data: "storage"`', built: '+ a JS-readable one-shot `kvs_wipe` set by the same armed clear route: a browser that ignores the header (older Safari) still wipes the drafts at the next load' },
]);

/** The 8 STORE-6b canon files and their verdicts. */
export const STORE6B_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W315-store-sync-center.html', flowmap: 'route `(canon)/sync`', verdict: 'REBUILT at /sync under both chromes as "On this phone" — the drafts on this phone (store, kind, first words, age, Send now, Discard), the 7-day question, the 30-day notice, "this page loaded at", the rules rewritten to the truth; the sync engine refused by name' },
  { file: 'W3151-store-sync-mutate-confirm.html', flowmap: 'chain-mutate:sync', verdict: 'REAL (device) — /sync?discard=<id>: "Discard this draft? Nothing on the server changes" — Proceed deletes it from this phone; Cancel → the list' },
  { file: 'W3152-store-sync-mutate-success.html', flowmap: 'W3151 Proceed', verdict: 'REAL (device) — /sync?done=discarded: "Discarded from this phone"; the audit / zero-sum sentences refused' },
  { file: 'W3153-store-sync-mutate-failure.html', flowmap: 'W3151 Proceed (failure)', verdict: 'REAL (device) — /sync?done=failed: "This phone\'s storage could not be written — the draft is kept"; Retry → the confirm; on-call refused' },
  { file: 'W3137-store-pwa-form-form-error.html', flowmap: 'chain-form:pwa', verdict: 'REAL (device) — /app?install=error and the /app line: "This browser can\'t install from here — use Share, then Add to Home Screen" (the canon\'s arrow put in words: no bare arrow on an RTL-safe page)' },
  { file: 'W3138-store-pwa-form-review.html', flowmap: 'W3137 → W3139', verdict: 'REAL (device) — the bottom sheet on the second visit: "Add <organisation> to your home screen?" with its icon; Add → the browser\'s own prompt; Not now' },
  { file: 'W3139-store-pwa-form-success.html', flowmap: 'W3138 Submit', verdict: 'REAL (device) — "Added — opens as <organisation>" (the sheet\'s next state; /app?install=success)' },
  { file: 'W3140-store-pwa-form-failure.html', flowmap: 'W3138 Submit (failure)', verdict: 'REAL (device) — "Not added — add it later from the App page" (the sheet\'s next state; /app?install=failure); "Not now" honoured 30 days' },
]);

/** The i18n keys of one surface's refusals (render tests read this). */
export function store6bRefusalKeys(surface: Store6bSurface): string[] {
  return STORE6B_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}
