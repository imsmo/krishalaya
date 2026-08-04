// apps/mobile/src/features/system/system.api.ts · data layer for the system/settings/search vertical (P-23). Keeps
// screens thin (guide §3). Global search FANS OUT over existing reads (public listings catalogue + the caller's own
// orders) and merges client-side — there's no dedicated search endpoint yet (flagged). DPDP export/deletion + the
// requests-status read are LIVE (identity PrivacyController); phone-change is OTP-verified server-side. All DEGRADE
// to a single-shape result on failure so the screen shows an honest "submitted / unavailable" message — the app
// NEVER fabricates an export or deletes the account locally (the server is the data controller — Law 11).
// Feedback opens a real support ticket (P-22). Reads degrade-never-die; writes are idempotent (Law 3).
import type { ListingCard, OrderListItem, PrivacyRequest } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';
import { mergeSearchResults, fromUnifiedSearch, normalizeQuery, type SearchHit } from './system';

/** Global search. Prefers the unified server endpoint (P1-14 — one ranked, tenant-isolated, OpenSearch-or-Postgres
 * query); if it's disabled (flag OFF → 404) or unreachable, DEGRADES to the legacy client fan-out (public listings
 * catalogue + the caller's own orders, merged client-side). Either way the app never fabricates a result (Law 12). */
export async function globalSearch(query: string): Promise<SearchHit[]> {
  const q = normalizeQuery(query);
  if (!q) return [];
  try {
    const page = await apiClient().search.query({ q, limit: 20 });
    return fromUnifiedSearch(page.items);
  } catch {
    return fanOutSearch(q);
  }
}

/** Legacy client-side fan-out fallback — used only when the unified endpoint is unavailable. */
async function fanOutSearch(q: string): Promise<SearchHit[]> {
  const [listings, buying, selling] = await Promise.all([
    apiClient().listings.browse({ q, limit: 20 }).then((p) => p.items).catch((): ListingCard[] => []),
    apiClient().orders.list({ role: 'buyer', limit: 20 }).then((p) => p.items).catch((): OrderListItem[] => []),
    apiClient().orders.list({ role: 'seller', limit: 20 }).then((p) => p.items).catch((): OrderListItem[] => []),
  ]);
  return mergeSearchResults(listings, [...buying, ...selling], q);
}

export interface PrivacyActionResult { ok: boolean; status?: string; coolingEndsAt?: string | null; reason?: 'unavailable' }
/** Request a DPDP data export. Degrades to { ok:false, reason:'unavailable' } if the endpoint isn't live yet. */
export async function requestDataExport(format?: string): Promise<PrivacyActionResult> {
  try { const r = await apiClient().privacy.requestDataExport(newId(), format); return { ok: true, status: r.status }; }
  catch { return { ok: false, reason: 'unavailable' }; }
}
/** Request account deletion (DPDP erasure). LIVE — the server records the request, runs a 90-day cooling-off +
 * retention/anti-fraud holds, then erases (the app never deletes locally). Idempotent; re-requesting returns the
 * existing open request. Degrades honestly on failure. */
export async function requestAccountDeletion(reason?: string): Promise<PrivacyActionResult> {
  try { const r = await apiClient().privacy.requestAccountDeletion({ reason }, newId()); return { ok: true, status: r.status, coolingEndsAt: r.coolingEndsAt ?? null }; }
  catch { return { ok: false, reason: 'unavailable' }; }
}
/** The caller's OWN DPDP requests (export + deletion) for status tracking. Degrades to [] (screen shows none). */
export async function myPrivacyRequests(): Promise<PrivacyRequest[]> {
  try { return await apiClient().privacy.myRequests(); } catch { return []; }
}
/** The caller's OPEN (pending/in-progress) deletion request, if any — drives the cooling-off banner on screen 177. */
export async function openDeletionRequest(): Promise<PrivacyRequest | null> {
  const reqs = await myPrivacyRequests();
  return reqs.find((r) => r.kind === 'deletion' && (r.status === 'open' || r.status === 'in_progress')) ?? null;
}

export interface PhoneChangeResult { ok: boolean; reason?: 'unavailable' }
/** Start a phone-number change (server sends an OTP to the new number; optional reason for audit). Degrades honestly. */
export async function startPhoneChange(newPhone: string, reason?: string): Promise<PhoneChangeResult> {
  try { await apiClient().privacy.startPhoneChange(newPhone, newId(), reason); return { ok: true }; }
  catch { return { ok: false, reason: 'unavailable' }; }
}
export async function confirmPhoneChange(newPhone: string, code: string): Promise<PhoneChangeResult> {
  try { await apiClient().privacy.confirmPhoneChange(newPhone, code); return { ok: true }; }
  catch { return { ok: false, reason: 'unavailable' }; }
}

/** The caller's DPDP consent records (privacy-settings toggles, screen 178). Degrades to [] (all opt-in defaults
 *  read as OFF) if the endpoint is unreachable — the app never fabricates a granted consent. */
export async function getConsents(): Promise<import('@krishalaya/sdk-js').ConsentRecord[]> {
  try { return await apiClient().privacy.listConsents(); }
  catch { return []; }
}
/** Grant/withdraw a consent purpose (idempotent — Law 3). Returns ok:false so the toggle reverts on failure. */
export async function setConsent(purposeCode: string, granted: boolean): Promise<{ ok: boolean }> {
  try { await apiClient().privacy.setConsent(purposeCode, granted, newId()); return { ok: true }; }
  catch { return { ok: false }; }
}

/** Send feedback by opening a real support ticket (P-22 support module). Throws on a real error. */
export async function submitFeedback(text: string): Promise<{ id: string }> {
  const t = apiClient();
  const ticket = await t.support.open({ subject: text.slice(0, 250), severity: 'P3', channel: 'app' }, newId());
  return { id: ticket.id };
}
