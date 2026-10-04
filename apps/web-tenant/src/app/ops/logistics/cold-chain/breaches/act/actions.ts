'use server';
// apps/web-tenant/src/app/ops/logistics/cold-chain/breaches/act/actions.ts · W2536–W2538 — acknowledge · record the action taken (note
// ≥ 10) · record the outcome (reason ≥ 10; a loss names its amount and currency) · PC-56 TENANT-SW-e. Each act happens once; the
// database refuses a second (BREACH_ACT_ONCE) and an outcome while the breach is still open.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { BREACHES_HREF, breachActInput, isBreachAct, isUuid, readBreachActDraft } from '../../../../../../features/swe/console';

export async function breachActAction(formData: FormData): Promise<void> {
  const base = `${BREACHES_HREF}/act`;
  await requireSession(base);
  const q: Record<string, string> = {}; formData.forEach((v, k) => { if (typeof v === 'string') q[k] = v; });
  if (!isBreachAct(q.act) || !isUuid(q.id)) redirect(BREACHES_HREF);
  const act = q.act; const id = q.id;
  const d = readBreachActDraft(q);
  const carry = new URLSearchParams({ act, id, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== '')) });
  try { await tenantClient().coldChain.breachAct(id, act, breachActInput(act, d), String(q.idempotencyKey ?? '')); }
  catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'unknown') : 'unknown'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(BREACHES_HREF);
  carry.set('step', 'success');
  redirect(`${base}?${carry.toString()}`);
}
