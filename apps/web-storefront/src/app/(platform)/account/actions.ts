'use server';
// apps/web-storefront/src/app/(platform)/account/actions.ts · the person's account acts (PC-24b; PC-56 STORE-4a). AUTHENTICATED; the API resolves
// the person from the token (no id, no IDOR).
//
// PC-56 STORE-4a — ONE action module for BOTH chromes (founder Q13): every form carries a hidden `chrome` (`platform` or the organisation's slug,
// re-validated by features/store4a/account.ts `chromeOf`) so the act answers back to the page it came from; the tenant tree's pages import
// THESE actions (never a second copy).
//   • updateProfileAction — the profile edit (the API AUDITS it: `user.profile_updated`, field names + masked values);
//   • requestExportAction — "Download my data" (W3029): the API enqueues the PERSONAL dataset on the export plane under the key minted when the
//     page rendered (a second request while one is open → the same job);
//   • mintDownloadAction — W3030 "Download (link valid 15 minutes)": the API mints the signed link (audited with its jti); the browser goes to
//     this app's own download route with it, which presents it BESIDE the session (the console's 6e-2 pattern) — the token is never rendered;
//   • requestDeletionAction — the deletion request (the W3031–W3033 shape): refused by the API while anything is open (`DSR_BLOCKED`) —
//     named back on the confirm, the key kept for a Retry.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { buildProfilePatch } from '../../../features/account/form';
import { accountHref, chromeOf, downloadHref, type AccountChrome } from '../../../features/store4a/account';
import { deleteFailureOf } from '../../../features/store4a/data-rights';

const KEY = /^[a-z-]+:[0-9a-f-]{36}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const api = (c: AccountChrome) => serverClient(c.kind === 'tenant' ? c.slug : undefined);

export async function updateProfileAction(formData: FormData): Promise<void> {
  const c = chromeOf(formData.get('chrome'));
  await requireSession(accountHref(c));
  const built = buildProfilePatch({
    fullName: String(formData.get('fullName') ?? ''),
    email: String(formData.get('email') ?? ''),
    languageCode: String(formData.get('languageCode') ?? ''),
  });
  if (!built.ok) redirect(accountHref(c, '', { error: built.error }));
  try { await api(c).users.updateMe(built.value); }
  catch { redirect(accountHref(c, '', { error: 'profile' })); }
  revalidatePath(accountHref(c));
  redirect(accountHref(c, '', { ok: 'profile' }));
}

export async function requestExportAction(formData: FormData): Promise<void> {
  const c = chromeOf(formData.get('chrome'));
  const key = String(formData.get('key') ?? '');
  await requireSession(accountHref(c, 'data'));
  if (!KEY.test(key)) redirect(accountHref(c, 'data', { error: 'request' }));
  try { await api(c).privacy.requestDataExport(key); }
  catch { redirect(accountHref(c, 'data', { error: 'request', k: key })); }
  revalidatePath(accountHref(c, 'data'));
  redirect(accountHref(c, 'data', { ok: 'requested' }));
}

export async function mintDownloadAction(formData: FormData): Promise<void> {
  const c = chromeOf(formData.get('chrome'));
  const id = String(formData.get('id') ?? '');
  await requireSession(accountHref(c, 'data'));
  if (!UUID.test(id)) redirect(accountHref(c, 'data'));
  let token: string;
  try { token = (await api(c).exportsPlane.mintLink(id)).token; }
  catch (e) { redirect(accountHref(c, 'data', { download: e instanceof SdkError ? (e.code || 'link') : 'link' })); }
  redirect(downloadHref(c, id, token));
}

export async function requestDeletionAction(formData: FormData): Promise<void> {
  const c = chromeOf(formData.get('chrome'));
  const key = String(formData.get('key') ?? '');
  await requireSession(accountHref(c, 'delete'));
  if (!KEY.test(key)) redirect(accountHref(c, 'delete', { failure: 'server' }));
  try { await api(c).privacy.requestAccountDeletion({}, key); }
  catch (e) {
    const f = deleteFailureOf(e instanceof SdkError ? e.code : null, e instanceof SdkError ? e.status : null);
    redirect(accountHref(c, 'delete', { failure: f, k: key }));
  }
  revalidatePath(accountHref(c, 'delete'));
  redirect(accountHref(c, 'delete', { ok: 'requested' }));
}
