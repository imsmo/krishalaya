// apps/mobile/src/features/ambassador/ambassador.api.ts · data layer for the ambassador vertical (P-15). Keeps
// screens thin (guide §3). Reads degrade-never-die (null/empty). createReferral is idempotent (Law 3) and throws
// so the screen shows the precise outcome (409 duplicate code / 403 not-allowed). Money is bigint minor strings
// (Law 2); the app never moves money — commission accrues + pays out SERVER-SIDE (Law 11). The ambassador only
// ever sees/acts on their OWN profile/earnings/referrals (server resolves the caller — no IDOR).
import type { AmbassadorProfile, Referral, AmbassadorEarning, SuggestedListingDraft, LeaderboardEntry, AmbassadorVisit, AmbassadorTarget, SetTargetInput } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

export interface ReferralsPage { items: Referral[]; nextCursor: string | null }
export interface EarningsPage { items: AmbassadorEarning[]; nextCursor: string | null }

/** The tenant leaderboard (ranked by commission earned). `period` 'month' scopes to the current calendar month
 * (via periodStart); 'all' is all-time. Degrades to an empty list — the home rank-badge simply hides when the
 * caller isn't on it. Read-only, no PII beyond ids the server already returns. */
export async function leaderboard(period: 'month' | 'all' = 'all'): Promise<LeaderboardEntry[]> {
  let periodStart: string | undefined;
  if (period === 'month') {
    const n = new Date();
    periodStart = new Date(n.getFullYear(), n.getMonth(), 1).toISOString();
  }
  try { return await apiClient().ambassadors.leaderboard({ periodStart, limit: 50 }); } catch { return []; }
}

/** The caller's own ambassador profile, or null if not an ambassador / unavailable. */
export async function myProfile(): Promise<AmbassadorProfile | null> {
  try { return await apiClient().ambassadors.myProfile(); } catch { return null; }
}

export interface VisitsPage { items: AmbassadorVisit[]; nextCursor: string | null }
/** The caller-ambassador's own geo-stamped field visits (keyset). Degrades to an empty page. */
export async function listVisits(cursor?: string): Promise<VisitsPage> {
  try { return await apiClient().ambassadors.listVisits({ cursor }); } catch { return { items: [], nextCursor: null }; }
}
/** Log a field visit the ambassador made (purpose + optional notes + geo). Throws so the screen shows the outcome.
 * Records only what the ambassador enters; no farmer PII is fabricated. */
export function logVisit(input: { purpose?: string; notes?: string; lat?: number; lng?: number; regionId?: string }): Promise<AmbassadorVisit> {
  return apiClient().ambassadors.logVisit(input);
}
/** The caller's referrals (optionally by status). Degrades to an empty page. */
export async function listReferrals(status?: string, cursor?: string): Promise<ReferralsPage> {
  try { return await apiClient().ambassadors.listReferrals({ status, cursor }); } catch { return { items: [], nextCursor: null }; }
}
/** The caller's earnings. Degrades to an empty page. */
export async function myEarnings(unpaidOnly?: boolean, cursor?: string): Promise<EarningsPage> {
  try { return await apiClient().ambassadors.myEarnings({ unpaidOnly, cursor }); } catch { return { items: [], nextCursor: null }; }
}
/** The caller-ambassador's own per-period targets (screen 169). Degrades to an empty list. */
export async function myTargets(): Promise<AmbassadorTarget[]> {
  try { return await apiClient().ambassadors.myTargets(); } catch { return []; }
}
/** Set/replace a per-period target (screen 170). THROWS so the screen shows the outcome — in particular a 403
 * when the caller lacks `ambassadors.manage` (targets may be set by a coordinator, not self-serve — Law 11/§4).
 * The server upserts by (ambassador, metric, period) so a retry is safe. */
export function setTarget(input: SetTargetInput): Promise<AmbassadorTarget> {
  return apiClient().ambassadors.setTarget(input);
}

/** Create a referral code to share with a farmer. REAL + idempotent (Law 3). Throws on a real error (409 the code
 * is taken / 403 not allowed) so the screen can show a precise message. */
export function createReferral(code: string): Promise<Referral> {
  return apiClient().ambassadors.createReferral(code, newId());
}

/** P1-16-AI · ask the AI tier to SUGGEST listing fields from a farmer's document (OCR'd upstream). ADVISORY only:
 * the suggestion is NEVER auto-submitted — the ambassador reviews/edits the draft and confirms via the consent-gated
 * on-behalf create. Degrade-never-die: returns null when the flag is off (404) or the model tier is unavailable, so
 * the screen falls back to manual entry rather than blocking or fabricating a value. */
export async function suggestListingFromDocs(
  farmerUserId: string,
  docText: string,
  locale?: 'hi' | 'en' | 'gu',
  mediaIds?: string[],
): Promise<SuggestedListingDraft | null> {
  try { return await apiClient().ambassadors.suggestListingFromDocs({ farmerUserId, docText, locale, mediaIds }); }
  catch { return null; }
}
