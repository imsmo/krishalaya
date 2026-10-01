'use server';
// apps/web-tenant/src/app/notifications/act/actions.ts · the notification MUTATE chain's act — W2688 / W2689 · PC-56
// TENANT-8b.
//
// MARK READ (one item, or the center's selection) and MARK ALL READ, under the key the confirm page minted (F-17): a
// double-click is one act. A bulk read is one API act PER ITEM, each under `formKey:id`, so a retry after a partial
// failure re-does only what did not happen and never double-audits what did. The server re-takes ownership on every
// item (another member's id is a 404, never a read flag on somebody else's row).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { ACT_HREF, CENTER_HREF, INBOX_HREF, MAX_PICKS, isAct, itemKey, parsePicks } from '../../../features/notifications/inbox';

export async function inboxActAction(formData: FormData): Promise<void> {
  await requireSession(ACT_HREF);
  const act = String(formData.get('act') ?? '').trim();
  if (!isAct(act)) redirect(CENTER_HREF);
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const picks = parsePicks(formData.getAll('pick').map(String)).slice(0, MAX_PICKS);
  if (act === 'read' && picks.length === 0) redirect(CENTER_HREF);
  const back = () => { const q = new URLSearchParams({ act }); for (const p of picks) q.append('pick', p.at ? `${p.id}|${p.at}` : p.id); return q; };
  let failedCode: string | null = null; let marked = 0;
  try {
    if (act === 'readAll') marked = (await tenantClient().notifications.markAllRead(key)).marked;
    else {
      for (const p of picks) { await tenantClient().notifications.markRead(p.id, { at: p.at, idempotencyKey: itemKey(key, p.id) }); marked += 1; }
    }
  } catch (e) {
    failedCode = e instanceof SdkError ? (e.code || 'act') : 'act';
  }
  if (failedCode) { const q = back(); q.set('step', 'failure'); q.set('error', failedCode); q.set('done', String(marked)); redirect(`${ACT_HREF}?${q.toString()}`); }
  revalidatePath(INBOX_HREF); revalidatePath(CENTER_HREF);
  const q = new URLSearchParams({ step: 'success', act, marked: String(marked) });
  if (act === 'read' && picks.length === 1) q.set('id', picks[0].id);
  redirect(`${ACT_HREF}?${q.toString()}`);
}
