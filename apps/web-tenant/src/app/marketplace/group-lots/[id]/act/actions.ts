'use server';
// apps/web-tenant/src/app/marketplace/group-lots/[id]/act/actions.ts · W2634 / W2635 · the group-lot acts — PC-56 TENANT-11c.
// ready · list · extend · nudge · cancel · withdraw · prepare · confirm · refuse. Re-judged by the API on the locked lot (the
// confirm step is not an authorisation token). list's and confirm's Idempotency-Key is the confirm page's (a double click lists
// once / pays once). The reason never travels into a success URL — it is on the audit row, which the success screen reads back.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { GROUP_LOTS_HREF, actBase, failureCodesFrom, isAct, isUuid, localToIso, lotHref, rupeesToMinor } from '../../../../../features/group-lots/console';

const opt = (v: string) => (v.length > 0 ? v : undefined);

export async function groupLotActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = actBase(id);
  await requireSession(base);
  const actRaw = String(formData.get('act') ?? '');
  if (!isUuid(id) || !isAct(actRaw)) redirect(GROUP_LOTS_HREF);
  const act = actRaw;
  const s = (k: string) => String(formData.get(k) ?? '').trim();
  const reason = s('reason');
  const key = s('idempotencyKey') || randomUUID();
  const c = tenantClient().groupLots;
  let failed: string[] | null = null; let extra = '';
  try {
    if (act === 'ready') await c.markReady(id, opt(reason));
    else if (act === 'list') {
      const price = rupeesToMinor(s('price'));
      if (!price || price === 'invalid') throw new Error('PRICE_INVALID');
      await c.listLot(id, { pricePerUnitMinor: price, ...(reason ? { reason } : {}) }, key);
    } else if (act === 'extend') {
      const iso = localToIso(s('deadline'));
      if (!iso || iso === 'invalid') throw new Error('DEADLINE_REQUIRED');
      await c.extend(id, { pledgeDeadline: iso, reason });
    } else if (act === 'nudge') { const r = await c.nudge(id, opt(reason)); extra = `&sent=${r.recipients}`; }
    else if (act === 'cancel') await c.cancel(id, { reasonCode: s('reasonCode'), ...(s('reasonText') ? { reasonText: s('reasonText') } : {}) });
    else if (act === 'withdraw') await c.withdraw(id);
    else if (act === 'prepare') await c.prepareSettlement(id);
    else if (act === 'confirm') { const r = await c.confirmSettlement(id, key, opt(reason)); extra = `&moved=${encodeURIComponent(r.movedMinor)}`; }
    else await c.refuseSettlement(id, reason);
  } catch (e) {
    failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status)
      : e instanceof Error && (e.message === 'PRICE_INVALID' || e.message === 'DEADLINE_REQUIRED') ? [e.message] : ['unknown'];
  }
  if (failed) redirect(`${base}?step=failure&act=${act}&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(GROUP_LOTS_HREF); revalidatePath(lotHref(id));
  redirect(`${base}?step=success&act=${act}${extra}`);
}
