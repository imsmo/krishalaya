'use server';
// apps/web-tenant/src/app/insights/governance/agm/[id]/act/actions.ts · W2475–W2477 (issue · addendum · retry DECOR) and the pack's other
// acts — PC-56 TENANT-SW-d. One action, the act named in the form; the API is the judge (checker ≠ maker, both tenant_admin, issued =
// immutable) and its refusal comes back as codes the page turns into sentences.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../../lib/api-client';
import { requireSession } from '../../../../../../lib/session';
import { AGM_HREF, agmPackHref, isAgmAct, isIdemKey, isUuid } from '../../../../../../features/swd/console';
import { codesFrom } from '../../../../../../features/swc/console';

const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return codesFrom(err?.code, err?.status, err?.details); };

export async function agmActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const act = String(formData.get('act') ?? '');
  if (!isUuid(id) || !isAgmAct(act) || act === 'retry') redirect(AGM_HREF);
  await requireSession(agmPackHref(id));
  const back = (q: Record<string, string>) => `${agmPackHref(id)}/act?${new URLSearchParams({ act, ...q }).toString()}`;
  const k = String(formData.get('key') ?? ''); const key = isIdemKey(k) ? k : randomUUID();
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  const media = formData.getAll('mediaId').map((x) => String(x).trim()).find(Boolean) ?? '';
  if (media && !isUuid(media)) redirect(back({ step: 'failure', error: 'VALIDATION_FAILED' }));
  const c = tenantClient().agmPacks;
  let landed = id;
  try {
    switch (act) {
      case 'issue': await c.issue(id, key); break;
      case 'confirm': await c.confirm(id, key); break;
      case 'send_back': await c.sendBack(id, reason, key); break;
      case 'withdraw': await c.withdraw(id, reason, key); break;
      case 'addendum': landed = (await c.addendum(id, { reason, ...(media ? { auditorMediaId: media } : {}) }, key)).id; break;
      case 'annexure': await c.annexure(id, media || null); break;
      case 'reassemble': await c.reassemble(id); break;
    }
  } catch (e) { redirect(back({ step: 'failure', error: codesOf(e).join(',') })); }
  revalidatePath(agmPackHref(id)); revalidatePath(AGM_HREF);
  redirect(back({ step: 'success', ...(landed !== id ? { landed } : {}) }));
}
