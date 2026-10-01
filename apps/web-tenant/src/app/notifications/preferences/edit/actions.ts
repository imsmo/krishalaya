'use server';
// apps/web-tenant/src/app/notifications/preferences/edit/actions.ts · the notification form chain's submit — W2685 /
// W2686 · PC-56 TENANT-8b.
//
// Runs only from the REVIEW step, and the review has already asked the API every question this action could ask — so it
// validates nothing beyond presence (6d-4's contract). The same body the review saw goes to the writer, which re-takes the
// review (window) or the catalogue checks (preferences) and refuses with the same codes if anything moved underneath.
// THE IDEMPOTENCY-KEY IS THE FORM'S (F-17): minted when the review rendered, carried in a hidden input. Success drops the
// values from the URL: they are in the row and its audit entry now.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { carryValues } from '../../../../features/forms/chain';
import { INBOX_HREF, PREFS_EDIT_HREF, PREFS_HREF, decodeChanges, isForm } from '../../../../features/notifications/inbox';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function submitNotificationFormAction(formData: FormData): Promise<void> {
  await requireSession(PREFS_EDIT_HREF);
  const formRaw = opt(formData.get('form'));
  if (!isForm(formRaw)) redirect(PREFS_HREF);
  const form = formRaw;
  const key = opt(formData.get('idempotencyKey')) ?? randomUUID();
  const values = { starts: opt(formData.get('starts')), ends: opt(formData.get('ends')), timezone: opt(formData.get('timezone')), languageCode: opt(formData.get('languageCode')) };
  const sets = formData.getAll('set').map(String);
  const failure = (code: string) => {
    if (form === 'preferences') {
      const q = new URLSearchParams([['form', 'preferences'], ['step', 'failure'], ['error', code], ...sets.map((s): [string, string] => ['set', s])]);
      return `${PREFS_EDIT_HREF}?${q.toString()}`;
    }
    return `${PREFS_EDIT_HREF}?${carryValues('failure', { ...values, form }).query}&error=${encodeURIComponent(code)}`;
  };
  const changes = form === 'preferences' ? decodeChanges(sets) : [];
  if (form === 'window' && (!values.starts || !values.ends)) redirect(`${PREFS_EDIT_HREF}?${carryValues('review', { ...values, form }).query}`);
  if (form === 'preferences' && changes.length === 0) redirect(PREFS_HREF);
  if (form === 'language' && !values.languageCode) redirect(`${PREFS_EDIT_HREF}?form=language`);
  const c = tenantClient();
  let failedCode: string | null = null;
  try {
    if (form === 'window') await c.notifications.setQuietHours({ starts: values.starts!, ends: values.ends!, ...(values.timezone ? { timezone: values.timezone } : {}) }, key);
    else if (form === 'preferences') await c.notifications.setPreferences(changes, key);
    else await c.users.updateMe({ languageCode: values.languageCode });
  } catch (e) {
    failedCode = e instanceof SdkError ? (e.code || 'save') : 'save';
  }
  if (failedCode) redirect(failure(failedCode));
  revalidatePath(PREFS_HREF); revalidatePath(INBOX_HREF);
  redirect(`${PREFS_EDIT_HREF}?form=${form}&step=success`);
}
