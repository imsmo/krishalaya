'use server';
// apps/web-tenant/src/app/twin/scenarios/[id]/act/actions.ts · W2805 / W2806 · the scenario acts — PC-56 TENANT-12.
// run: the API records the attempt and refuses it by the gate's name (409 TWIN_NO_MODEL_REGISTERED, `details.runId`) — the failure
// screen says so and reads the recorded refusal back. archive: a reason, final. Re-judged by the API on the locked scenario (the
// confirm step is not an authorisation token). The Idempotency-Key is the confirm page's. The reason never travels into a URL.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { SCENARIOS_HREF, actBase, failureCodesFrom, isAct, isUuid, scenarioHref } from '../../../../../features/twin/twin';

export async function scenarioActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = actBase(id);
  await requireSession(base);
  const act = String(formData.get('act') ?? '');
  if (!isUuid(id) || !isAct(act)) redirect(SCENARIOS_HREF);
  const key = String(formData.get('idempotencyKey') ?? '');
  if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) redirect(`${base}?step=failure&act=${act}&error=unknown`);
  const reason = String(formData.get('reason') ?? '').trim();
  const c = tenantClient();
  let failed: string[] | null = null; let runId = '';
  try {
    if (act === 'run') await c.twin.run(id, key);
    else await c.twin.archive(id, reason, key);
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    failed = err ? failureCodesFrom(err.code, err.status, err.details) : ['unknown'];
    const rid = (err?.details as { runId?: unknown } | undefined)?.runId;
    if (typeof rid === 'string' && isUuid(rid)) runId = rid;
  }
  revalidatePath(SCENARIOS_HREF); revalidatePath(scenarioHref(id));
  if (failed) redirect(`${base}?step=failure&act=${act}&error=${encodeURIComponent(failed.join(','))}${runId ? `&rid=${runId}` : ''}`);
  redirect(`${base}?step=success&act=${act}`);
}
