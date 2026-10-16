'use server';
// apps/web-storefront/src/app/(platform)/account/preferences/actions.ts · PC-56 STORE-4c · C3 — the PREFERENCES chain's acts (canon W302 → W3134
// confirm → W3135 success / W3136 failure), for BOTH chromes (a hidden `chrome` field — `platform` or the organisation's slug; the tenant tree's
// page imports THESE actions, never a second copy — 4a's pattern). AUTHENTICATED.
//
//   reviewPreferencesAction — W302 Save: the posted form → the CHANGES against the server's matrix (features/store4c/preferences.ts: locked cells
//     are never a change; the promotional switch sets every promotional cell and the consent), the window (only if changed; the zone is the
//     organisation's — blank — or the person's own, never a literal), the ONE language (only if changed). Nothing changed → said. Else the
//     draft is held server-side (an httpOnly cookie on this page's path — never the URL) and the page goes to `?step=review` (W3134), where the
//     SERVER's three reviews are the confirm.
//   submitPreferencesAction — W3134 Save: under the key MINTED WHEN THE FORM RENDERED (`prefs:<uuid>`), each act with its own derived key —
//     (1) the `marketing` consent grant / withdrawal (`/v1/consents`, `:c`) when the promotional switch changed; (2) the preference rows (`:p`);
//     (3) quiet hours (`:q`); (4) the account language (`PATCH users/me` — naturally idempotent) AND this site's language cookie (founder D3).
//     A failure → the review again with the NAMED failure (W3136), the draft and the key kept: Retry replays the same keys (an act already done
//     is answered from memory, never applied twice). Success → `?ok=saved` (W3135: "applied to your account; senior mode on this device").
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { SdkError } from '@krishalaya/sdk-js';
import type { NotificationMatrix } from '@krishalaya/sdk-js';
import { isSupported } from '@krishalaya/i18n';
import { serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { LANG_COOKIE } from '../../../../lib/i18n';
import { accountHref, chromeOf, type AccountChrome } from '../../../../features/store4a/account';
import {
  PREFS_DRAFT_COOKIE, actKey, decodePrefsDraft, draftIsEmpty, encodePrefsDraft, formChanges, languageOptions, matrixView, prefsFailureOf, readPrefsKey,
  windowChange, type PrefsDraft, type PrefsFailure,
} from '../../../../features/store4c/preferences';

const ONE_YEAR = 60 * 60 * 24 * 365;
const api = (c: AccountChrome) => serverClient(c.kind === 'tenant' ? c.slug : undefined);
const page = (c: AccountChrome, q: Record<string, string> = {}) => accountHref(c, 'preferences', q);
const cookieOpts = (c: AccountChrome, maxAge: number) => ({ httpOnly: true, sameSite: 'lax' as const, secure: true, path: accountHref(c, 'preferences'), maxAge });
const keep = (c: AccountChrome, d: PrefsDraft) => cookies().set(PREFS_DRAFT_COOKIE, encodePrefsDraft(d), cookieOpts(c, 900));
const spend = (c: AccountChrome) => cookies().set(PREFS_DRAFT_COOKIE, '', cookieOpts(c, 0));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function reviewPreferencesAction(fd: FormData): Promise<void> {
  const c = chromeOf(fd.get('chrome'));
  await requireSession(page(c));
  const key = readPrefsKey(fd.get('key'));
  if (!key) redirect(page(c));
  let matrix: NotificationMatrix;
  try { matrix = await api(c).notifications.matrix({ audience: 'buyer' }); } catch { redirect(page(c, { error: 'load' })); }
  const view = matrixView(matrix);
  const ticked = new Set(fd.getAll('cell').map(String));
  const { changes, consent } = formChanges(view, ticked, String(fd.get('promo') ?? '') === 'on');
  const starts = String(fd.get('starts') ?? '').trim(); const ends = String(fd.get('ends') ?? '').trim();
  if ((starts || ends) && !(HHMM.test(starts) && HHMM.test(ends))) redirect(page(c, { error: 'window', k: key }));   // a time the form cannot hold
  const quiet = starts && ends ? windowChange(matrix, { starts, ends, zone: String(fd.get('zone') ?? '') }) : null;
  const langRaw = String(fd.get('language') ?? '');
  const allowed = new Set(languageOptions(matrix, isSupported).map((l) => l.code));
  const language = allowed.has(langRaw) && langRaw !== matrix.language.current ? langRaw : null;
  const draft: PrefsDraft = { v: 1, key, changes, consent, quiet, language };
  if (draftIsEmpty(draft)) redirect(page(c, { error: 'nothing', k: key }));
  keep(c, draft);
  redirect(page(c, { step: 'review', k: key }));                                                       // W3134
}

export async function submitPreferencesAction(fd: FormData): Promise<void> {
  const c = chromeOf(fd.get('chrome'));
  await requireSession(page(c));
  const key = readPrefsKey(fd.get('key'));
  const draft = decodePrefsDraft(cookies().get(PREFS_DRAFT_COOKIE)?.value, key);
  if (!key || !draft) redirect(page(c, key ? { k: key } : {}));
  const sdk = api(c);
  const st: { failure: PrefsFailure | null; event: string | null } = { failure: null, event: null };
  const fail = (e: unknown, act: 'consent' | 'preferences' | 'quiet' | 'language') => {
    const code = e instanceof SdkError ? e.code : null; const status = e instanceof SdkError ? e.status : null;
    st.failure = prefsFailureOf(code, status, act);
    const d = e instanceof SdkError ? (e.details as { eventCode?: unknown } | undefined) : undefined;
    if (st.failure === 'cannot_opt_out' && typeof d?.eventCode === 'string' && /^[a-z][a-z0-9_.]{1,79}$/.test(d.eventCode)) st.event = d.eventCode;
  };
  // (1) the consent half of the promotional switch — recorded FIRST: an opt-in is never written without its consent on the record
  if (draft.consent !== null) { try { await sdk.privacy.setConsent('marketing', draft.consent, actKey(key, 'c'), 'web'); } catch (e) { fail(e, 'consent'); } }
  // (2) the preference rows
  if (!st.failure && draft.changes.length > 0) { try { await sdk.notifications.setPreferences(draft.changes, actKey(key, 'p')); } catch (e) { fail(e, 'preferences'); } }
  // (3) quiet hours
  if (!st.failure && draft.quiet) { try { await sdk.notifications.setQuietHours(draft.quiet, actKey(key, 'q')); } catch (e) { fail(e, 'quiet'); } }
  // (4) ONE language: the account's (what notices use) and this site's
  if (!st.failure && draft.language) {
    try { await sdk.users.updateMe({ languageCode: draft.language }); } catch (e) { fail(e, 'language'); }
    if (!st.failure) cookies().set(LANG_COOKIE, draft.language, { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: ONE_YEAR });
  }
  if (st.failure) {
    keep(c, draft);
    redirect(page(c, { step: 'review', k: key, failure: st.failure, ...(st.event ? { event: st.event } : {}) }));   // W3136
  }
  spend(c);
  revalidatePath(page(c));
  redirect(page(c, { ok: 'saved' }));                                                                    // W3135
}
