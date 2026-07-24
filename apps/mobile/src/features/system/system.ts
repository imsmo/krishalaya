// apps/mobile/src/features/system/system.ts · PURE cross-cutting logic for the system/settings/search vertical
// (P-23). No React/native (SDK/ui types are `import type` → erased) → unit-tested. Covers: global-search result
// merge + local ranking (ReDoS-safe), semver compare + forced-update decision, the permission rationale catalog,
// and DPDP delete-confirmation validation. The SERVER owns search authority, DPDP export/erasure, and the minimum
// supported version — these helpers only drive the UI.
import type { ListingCard, OrderListItem, SearchHit as UnifiedSearchHit } from '@krishi-verse/sdk-js';
import { COMING_SOON_LANGUAGES } from '@krishi-verse/i18n';

// --- global search ---
// The unified index (P1-14) covers `listings` + `products` today; the design's Sellers/Tips/Mandi/Crop-guide rows
// need a broader index that isn't live yet. We map the types the server DOES return (incl. those broader ones if a
// future index emits them — real data, forward-compatible), and DROP any unknown type (never a fabricated row).
export type SearchHitKind = 'listing' | 'order' | 'product' | 'seller' | 'tip' | 'mandi' | 'crop';
export interface SearchHit { kind: SearchHitKind; id: string; title: string; subtitle?: string; priceMinor?: string; currencyCode?: string; unitCode?: string; note?: string }

const SEARCH_KIND_OF: Record<string, SearchHitKind> = {
  listings: 'listing', products: 'product', sellers: 'seller', tips: 'tip', mandis: 'mandi', crops: 'crop',
};

/** A minor-unit money STRING (Law 2) from an unknown ref value — integer only, never a float. undefined otherwise. */
function refMinor(v: unknown): string | undefined {
  if (typeof v === 'string' && /^\d+$/.test(v)) return v;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return String(v);
  return undefined;
}
function refStr(v: unknown): string | undefined { return typeof v === 'string' && v.trim() ? v.trim() : undefined; }

/** Map the server's unified search hits (P1-14) → the screen's hit shape, lifting price/unit/seller from `ref` when
 * present. Unknown types are dropped (never a fabricated row). Pure; the fan-out path uses mergeSearchResults. */
export function fromUnifiedSearch(items: UnifiedSearchHit[], cap = 50): SearchHit[] {
  return (items ?? [])
    .map((h) => {
      const kind = SEARCH_KIND_OF[String(h.type)];
      if (!kind) return null;
      const ref = (h.ref ?? {}) as Record<string, unknown>;
      return {
        kind, id: String(h.id), title: h.title,
        priceMinor: refMinor(ref.priceMinor),
        currencyCode: refStr(ref.currencyCode),
        unitCode: refStr(ref.unitCode),
        note: refStr(ref.sellerName) ?? refStr(ref.subtitle),
      } as SearchHit;
    })
    .filter((h): h is SearchHit => h !== null)
    .slice(0, cap);
}

/** The icon for a hit kind (matches the design's glyphs). Pure. */
export function searchKindIcon(kind: SearchHitKind): string {
  switch (kind) {
    case 'listing': return '🌾';
    case 'mandi': return '📊';
    case 'tip': return '💡';
    case 'seller': return '👤';
    case 'crop': return '🌾';
    case 'product': return '📦';
    case 'order': return '🧾';
    default: return '🔎';
  }
}

export interface SearchTab { key: 'all' | SearchHitKind; count: number }
const TAB_ORDER: SearchHitKind[] = ['listing', 'seller', 'tip', 'mandi', 'crop', 'product', 'order'];

/** Build the filter tabs from the REAL hits: "All · N" first, then one tab per kind that actually has results,
 * in design order, with its real count. No fabricated categories/counts. Pure. */
export function searchTabs(hits: readonly SearchHit[]): SearchTab[] {
  const counts = new Map<SearchHitKind, number>();
  for (const h of hits) counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1);
  const tabs: SearchTab[] = [{ key: 'all', count: hits.length }];
  for (const k of TAB_ORDER) { const c = counts.get(k); if (c) tabs.push({ key: k, count: c }); }
  return tabs;
}

/** Filter hits by the active tab ('all' → everything). Pure. */
export function filterHits(hits: readonly SearchHit[], tab: 'all' | SearchHitKind): SearchHit[] {
  return tab === 'all' ? [...hits] : hits.filter((h) => h.kind === tab);
}

/** Normalize a search query: trim, collapse whitespace, lowercase, cap length (bounded; plain — no regex). */
export function normalizeQuery(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
}
function contains(haystack: string, q: string): boolean { return haystack.toLowerCase().includes(q); }

/** Merge listings + the caller's orders into a unified, query-filtered hit list (listings first, then orders;
 * capped). Matching is a plain case-insensitive substring over the visible text (no regex on user input). */
export function mergeSearchResults(listings: ListingCard[], orders: OrderListItem[], query: string, cap = 50): SearchHit[] {
  const q = normalizeQuery(query);
  const lHits: SearchHit[] = (listings ?? [])
    .filter((l) => !q || contains(l.title ?? '', q))
    .map((l) => ({ kind: 'listing' as const, id: l.id, title: l.title, priceMinor: l.priceMinor, currencyCode: l.currencyCode, unitCode: l.unitCode }));
  const oHits: SearchHit[] = (orders ?? [])
    .filter((o) => !q || contains(o.orderNo ?? '', q) || contains(o.status ?? '', q) || contains(o.counterparty ?? '', q))
    .map((o) => ({ kind: 'order' as const, id: o.id, title: o.orderNo, subtitle: o.status }));
  return [...lHits, ...oHits].slice(0, cap);
}

// --- app version / forced update (semver) ---
/** Compare two dotted versions numerically. Returns -1 (a<b), 0 (equal), 1 (a>b). Non-numeric parts → 0. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = String(a ?? '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b ?? '').split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d !== 0) return d < 0 ? -1 : 1; }
  return 0;
}
/** A forced update is required only when a minimum is configured AND the current version is below it. */
export function isUpdateRequired(current: string, min: string | null | undefined): boolean {
  if (!min) return false;
  return compareVersions(current, min) < 0;
}

// --- permission rationale catalog (just-in-time, store-compliant; §8) ---
// Grouped as the onboarding primer (screen 185): SMS/Camera/Microphone are core to the flows; Location/Notifications
// are optional. This screen only EXPLAINS + routes to the OS prompt/settings — the actual grant is an OS decision
// (never faked; §13). `photos` stays keyed for other call-sites but isn't shown in the primer (camera covers it).
export type PermissionGroup = 'required' | 'optional';
export interface PermissionItem { key: string; icon: string; group: PermissionGroup }
export const PERMISSIONS: PermissionItem[] = [
  { key: 'sms', icon: '📞', group: 'required' },
  { key: 'camera', icon: '📷', group: 'required' },
  { key: 'microphone', icon: '🎤', group: 'required' },
  { key: 'location', icon: '📍', group: 'optional' },
  { key: 'notifications', icon: '🔔', group: 'optional' },
];
export function permissionsByGroup(group: PermissionGroup): PermissionItem[] {
  return PERMISSIONS.filter((p) => p.group === group);
}
export function permissionTitleKey(key: string): string { return `system.permissions.${key}.title`; }
export function permissionWhyKey(key: string): string { return `system.permissions.${key}.why`; }

// --- language switcher (screen 187) ---
// Design order (Gujarati → Hindi → English) differs from the LANGUAGES registry order; this orders the SUPPORTED
// codes for display without inventing any language.
//
// DEV-21: `COMING_LANGUAGES` is now DERIVED from the shared `@krishi-verse/i18n` registry's own
// `COMING_SOON_LANGUAGES` (was a hardcoded `['mr']` before this batch — a single entry that silently omitted the
// other 10 canon-shipped target languages, bn/te/ta/as/pa/kn/ml/or/ar/ur). The registry is now the single source
// of truth for "what's coming" everywhere (web pickers + this screen) — no per-app list to keep in sync by hand.
const LANG_DISPLAY_ORDER = ['gu', 'hi', 'en'];
export const COMING_LANGUAGES: readonly string[] = COMING_SOON_LANGUAGES.map((l) => l.code);
/** Order the available (supported) language codes into the design's display order; unknown codes keep their
 *  original relative order at the end. Pure. */
export function orderedLanguageCodes(available: readonly string[]): string[] {
  const rank = (c: string) => { const i = LANG_DISPLAY_ORDER.indexOf(c); return i === -1 ? LANG_DISPLAY_ORDER.length : i; };
  return [...available].sort((a, b) => rank(a) - rank(b));
}
export function languageSubKey(code: string): string { return `system.language.sub.${code}`; }

// --- unified messages inbox (screen 191) ---
// The mobile Conversation contract carries only {contextType, contextId, isLocked, createdAt} — NO counterparty
// name/role, last-message preview, or unread count. So the inbox categorizes each thread by its REAL contextType
// (order/requirement/direct → buyers; booking → workers; support/dispute → support; else other) — the tab counts
// are real. Richer rows (names, previews, unread) need a conversation-summary read-model that isn't live yet (§13).
export type MessageCategory = 'buyers' | 'workers' | 'support' | 'other';
export interface ConversationLike { contextType: string }
export function messageCategory(contextType: string | null | undefined): MessageCategory {
  const k = (contextType ?? '').toLowerCase();
  if (/support|dispute/.test(k)) return 'support';
  if (/booking|labour|worker/.test(k)) return 'workers';
  if (/order|requirement|direct|listing|offer/.test(k)) return 'buyers';
  return 'other';
}
export interface MessageTab { key: 'all' | MessageCategory; count: number }
const MSG_TAB_ORDER: MessageCategory[] = ['buyers', 'workers', 'support'];
/** "All · N" then one tab per design category that actually has threads, with real counts. Pure. */
export function messageTabs(convos: readonly ConversationLike[]): MessageTab[] {
  const counts = new Map<MessageCategory, number>();
  for (const c of convos ?? []) { const cat = messageCategory(c.contextType); counts.set(cat, (counts.get(cat) ?? 0) + 1); }
  const tabs: MessageTab[] = [{ key: 'all', count: (convos ?? []).length }];
  for (const k of MSG_TAB_ORDER) { const n = counts.get(k); if (n) tabs.push({ key: k, count: n }); }
  return tabs;
}
/** Filter conversations by tab ('all' → everything). Pure. */
export function filterConversationsByTab<T extends ConversationLike>(convos: readonly T[], tab: 'all' | MessageCategory): T[] {
  return tab === 'all' ? [...convos] : convos.filter((c) => messageCategory(c.contextType) === tab);
}

// --- conversation summary rendering (contract-gap P0-1) ---
// The server read-model now supplies last-message preview + unread count. These pure helpers turn that into what
// the row renders: a text preview, or a 📷/🎤 placeholder kind when the last message was media-only. Unit-tested.
export interface ConversationPreviewLike { lastMessageBody?: string | null; lastMessageHasAttachment?: boolean; lastMessageHasVoice?: boolean }
export type PreviewKind = 'text' | 'photo' | 'voice' | 'none';
export function conversationPreview(c: ConversationPreviewLike): { kind: PreviewKind; text: string } {
  const body = (c.lastMessageBody ?? '').trim();
  if (body) return { kind: 'text', text: body };
  if (c.lastMessageHasVoice) return { kind: 'voice', text: '' };
  if (c.lastMessageHasAttachment) return { kind: 'photo', text: '' };
  return { kind: 'none', text: '' };
}
/** Sum unread across the inbox for the header "· N new" badge. Clamps negatives/NaN to 0. */
export function unreadTotal(convos: readonly { unreadCount?: number }[]): number {
  return convos.reduce((s, c) => s + Math.max(0, Math.trunc(c.unreadCount ?? 0) || 0), 0);
}

// --- screen 192 (message archive) ---
// The mobile Conversation contract has NO archive flag/endpoint, no counterparty name/role, no last-message
// summary or order value, and no restore mutation (see the screen's §13 header). The nearest REAL signal of a
// finished/closed thread is `isLocked` — a conversation the server has locked (e.g. once its order completed).
// So the archive degrades to locked threads, newest first. Pure so it's unit-tested.
export interface ArchivableConversation { isLocked?: boolean; createdAt?: string }
export function archivedConversations<T extends ArchivableConversation>(convos: readonly T[]): T[] {
  return convos
    .filter((c) => c.isLocked === true)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

// --- screen 195 (feedback CTA) ---
// The mobile contract has NO product-feedback endpoint; feedback opens a real low-priority support ticket
// (support.open → subject only, no free body/attachment field — see the screen's §13 header). These helpers drive
// the form: the fixed set of "what works well" feature chips (static chrome, NOT per-user data), a submit-gate, and
// a bounded composition of {rating, liked features, improvement note} into the ticket subject. Pure → unit-tested.
export const FEEDBACK_FEATURES = ['voice', 'mandi', 'weather', 'payouts', 'protection', 'worker'] as const;
export type FeedbackFeature = typeof FEEDBACK_FEATURES[number];
export function feedbackFeatureLabelKey(f: string): string { return `system.feedback.feat.${f}`; }
export function canSubmitFeedback(rating: number): boolean {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}
/** Compose the feedback into a bounded (≤250-char) support-ticket subject. Language-neutral tokens (the subject is
 * read by support agents, not shown to the user). No regex → ReDoS-safe. */
export function composeFeedback(rating: number, positives: readonly string[], improvement: string): string {
  const stars = Math.max(1, Math.min(5, Math.round(rating)));
  const parts = [`Rating ${stars}/5`];
  if (positives.length) parts.push(`Likes: ${positives.join(', ')}`);
  const imp = improvement.trim();
  if (imp) parts.push(`Improve: ${imp}`);
  return parts.join(' | ').slice(0, 250);
}

// --- screen 196 (about) ---
// The launch language set is REAL (the i18n registry), so the "Languages" row is derived, never hardcoded to
// "3 (GU, HI, EN)". Pure → unit-tested.
export function languagesSummary(langs: readonly { code: string }[]): string {
  return `${langs.length} (${langs.map((l) => l.code.toUpperCase()).join(', ')})`;
}

// --- degrade-never-die fallback classification (Law 12) ---
// Drives WHICH global fallback a thrown error should surface. Decoupled from the SDK by NAME (not instanceof) so
// this stays a pure, framework-free helper: an SdkNetworkError/SdkTimeoutError (the request never reached the API)
// is an "offline" condition; everything else (5xx, unknown, a render crash) is "server".
export type FallbackKind = 'offline' | 'server';
export function classifyFallback(err: unknown): FallbackKind {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name) : '';
  return name === 'SdkNetworkError' || name === 'SdkTimeoutError' ? 'offline' : 'server';
}
/** Extract a SAFE support reference from a thrown error (the SDK's requestId, if present). Returns null otherwise —
 * NEVER the error message, code, stack, or any field that could leak PII/secrets (the SdkError contract guarantees
 * requestId is safe). Bounded to 64 chars. */
export function safeErrorRef(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const r = (err as { requestId?: unknown }).requestId;
  return typeof r === 'string' && r.trim() ? r.trim().slice(0, 64) : null;
}

// --- DPDP account-delete confirmation (typed phrase guard against accidental taps) ---
/** The user must type the confirmation word exactly (case-insensitive, trimmed) to enable deletion. The word is
 * the localized `expected` (e.g. "DELETE"/"हटाएँ") — compared verbatim, no regex. */
export function deleteConfirmationOk(input: string, expected: string): boolean {
  return (input ?? '').trim().toLowerCase() === (expected ?? '').trim().toLowerCase() && !!(expected ?? '').trim();
}

// --- account-delete "why leaving?" reasons (screen 177). A fixed vocabulary the server records for churn analytics. ---
export const DELETE_REASONS = ['notUsing', 'alternative', 'privacy', 'featurePhone', 'badExperience', 'other'] as const;
export type DeleteReason = (typeof DELETE_REASONS)[number];

/** The i18n label key for a delete-reason chip. Pure. */
export function deleteReasonLabelKey(reason: DeleteReason): string {
  return `accountDelete.reason.${reason}`;
}

/** True when the wallet still holds withdrawable money (a positive minor-unit balance) — used to nudge the user to
 *  withdraw BEFORE deleting. Guards against a non-numeric/failed balance. Money stays a bigint string (Law 2). Pure. */
export function hasWithdrawableBalance(availableMinor: string | null | undefined): boolean {
  if (typeof availableMinor !== 'string' || !/^-?\d+$/.test(availableMinor)) return false;
  try { return BigInt(availableMinor) > 0n; } catch { return false; }
}

/** Compose the free-text reason sent to the server from the chosen reason code + optional feedback. Pure. */
export function composeDeleteReason(reason: DeleteReason | '', feedback: string): string {
  const fb = (feedback ?? '').trim();
  if (!reason) return fb;
  return fb ? `${reason}: ${fb}` : reason;
}

// --- privacy-settings consent toggles (screen 178). Each toggle is a DPDP consent purpose the server records
//     (append-only). The toggle/label/hint are UI chrome (i18n); the granted STATE is real data from the server. ---
export type ConsentGroup = 'profile' | 'data';
export interface ConsentToggle { code: string; group: ConsentGroup }
export interface ConsentRecordLike { purposeCode: string; granted: boolean }

/** The privacy toggles the screen renders, in design order, grouped into Profile-visibility and Data-&-analytics. */
export const CONSENT_TOGGLES: ConsentToggle[] = [
  { code: 'profile_visible', group: 'profile' },
  { code: 'phone_to_verified', group: 'profile' },
  { code: 'exact_location', group: 'profile' },
  { code: 'personalized_recos', group: 'data' },
  { code: 'research_sharing', group: 'data' },
  { code: 'marketing_comms', group: 'data' },
];

export function consentLabelKey(code: string): string { return `privacySettings.toggle.${code}`; }
export function consentHintKey(code: string): string { return `privacySettings.hint.${code}`; }

/** Whether a given consent purpose is currently granted, from the server's consent list. Unknown purpose → false
 *  (consent is opt-IN: absence means not granted — the safe DPDP default). Pure. */
export function consentGranted(list: readonly ConsentRecordLike[] | null | undefined, code: string): boolean {
  for (const c of list ?? []) if (c && c.purposeCode === code) return !!c.granted;
  return false;
}

// --- DPDP data-export format (screen 179). 'data' = machine-readable CSV+JSON bundle; 'pdf' = human-readable report. ---
export const EXPORT_FORMATS = ['data', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export function exportFormatLabelKey(f: ExportFormat): string { return `dataDownload.format.${f}`; }
