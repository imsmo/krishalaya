'use server';
// apps/web-tenant/src/app/studio/earnings/rule/actions.ts · the tenant's split rule — PC-56 TENANT-7d-money.
// `propose` (a finance person chooses ONLY the instructor share; the platform's is copied, the tenant's is the remainder) ·
// `approve` / `reject` (a DIFFERENT finance person; a rejection carries a note). Each under a fresh Idempotency-Key; the
// server re-takes the verdict on the locked row and 0174's CHECK refuses maker = checker at the wall.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/mutate/chain';
import { EARNINGS_PATH, RULE_PATH, percentToBps, ruleChainAct } from '../../../../features/studio/earnings';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function ruleAction(formData: FormData): Promise<void> {
  const act = ruleChainAct(opt(formData.get('act')));
  const rule = opt(formData.get('rule'));
  const shareBps = opt(formData.get('shareBps'));
  const note = opt(formData.get('note'));
  await requireSession(RULE_PATH);
  const values = { act: act ?? '', rule, shareBps, note };
  const bps = act === 'propose' ? percentToBps(shareBps) : null;
  if (!act || (act === 'propose' ? bps === null : !rule) || (act === 'reject' && !note)) redirect(`${RULE_PATH}?${carryValues('confirm', values).query}`);
  try {
    if (act === 'propose') values.rule = (await tenantClient().instructorEarnings.proposeRule({ instructorShareBps: bps as number, note: note ?? null }, randomUUID())).id;
    else await tenantClient().instructorEarnings.decideRule(rule as string, { act, note: note ?? null }, randomUUID());
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'rule') : 'rule';
    const detail = e instanceof SdkError && Array.isArray(e.details?.refusals) ? (e.details!.refusals as string[]).join(',') : '';
    redirect(`${RULE_PATH}?${carryValues('failure', values).query}&error=${encodeURIComponent(code)}${detail ? `&refusals=${encodeURIComponent(detail)}` : ''}`);
  }
  revalidatePath(EARNINGS_PATH); revalidatePath(RULE_PATH);
  redirect(`${RULE_PATH}?step=success&act=${encodeURIComponent(act)}${values.rule ? `&rule=${encodeURIComponent(values.rule)}` : ''}`);
}
