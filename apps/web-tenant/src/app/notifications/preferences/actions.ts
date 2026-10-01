'use server';
// apps/web-tenant/src/app/notifications/preferences/actions.ts · W433's *Save preferences* → the notification FORM chain's
// review (W2684) · PC-56 TENANT-8b.
//
// WRITES NOTHING. The matrix posts every editable cell (a hidden `cell` per cell, a checked `on` when ticked); this action
// re-reads YOUR matrix, keeps only the cells you CHANGED (`matrixChanges` — locked and not-sent cells are never editable,
// so they can never be smuggled in), and opens the chain's review with those changes in the URL (the house pattern: values
// in the query string, the review computed by the API). The write happens only from the review, under the key the review
// page mints. (PC-28b's `savePreferencesAction` / `saveQuietHoursAction` wrote straight from the form with no review, no
// key and no audit row — gone.)
import { redirect } from 'next/navigation';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { MAX_CHANGES, PREFS_EDIT_HREF, PREFS_HREF, encodeChanges, matrixChanges } from '../../../features/notifications/inbox';

export async function prepareMatrixAction(formData: FormData): Promise<void> {
  await requireSession(PREFS_HREF);
  const posted = formData.getAll('cell').map(String);
  const ticked = new Set(formData.getAll('on').map(String));
  let changes: ReturnType<typeof matrixChanges> = [];
  try { changes = matrixChanges(await tenantClient().notifications.matrix(), posted, ticked); }
  catch { redirect(PREFS_HREF); }
  if (changes.length === 0) redirect(`${PREFS_HREF}?note=nochange`);
  if (changes.length > MAX_CHANGES) redirect(`${PREFS_HREF}?note=toomany`);
  const q = new URLSearchParams({ form: 'preferences', step: 'review' });
  for (const s of encodeChanges(changes)) q.append('set', s);
  redirect(`${PREFS_EDIT_HREF}?${q.toString()}`);
}
