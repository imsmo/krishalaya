'use server';
// apps/web-gov/src/app/schemes/actions.ts · reviewer mutations (PC-41 GW-1). Server perms authoritative;
// 409 → honest illegal-state message. Reject requires a reason (a farmer must always know why).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { govClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildDbt } from '../../features/schemes/review';
import { SdkError } from '@krishalaya/sdk-js';

function back(id: string, qs: string): never { redirect(`/schemes/${encodeURIComponent(id)}?${qs}`); }

export async function applicationAction(formData: FormData): Promise<void> {
  await requireSession('/schemes');
  const id = String(formData.get('id') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');
  if (!id) redirect('/schemes');
  const s = govClient().schemes;
  try {
    if (kind === 'verify') await s.verifyApplication(id);
    else if (kind === 'clarify') await s.requestClarification(id, String(formData.get('note') ?? '').trim() || undefined);
    else if (kind === 'approve') await s.approveApplication(id, String(formData.get('govtAppRef') ?? '').trim() || undefined);
    else if (kind === 'reject') {
      const reason = String(formData.get('reason') ?? '').trim();
      if (!reason) back(id, 'error=reason');
      await s.rejectApplication(id, reason);
    } else if (kind === 'close') await s.closeApplication(id);
    else back(id, 'error=action');
  } catch (e) {
    back(id, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'action'}`);
  }
  revalidatePath(`/schemes/${id}`); revalidatePath('/schemes');
  back(id, `ok=${kind}`);
}

// GW-2: record a DBT credit against an approved application (per-application — the API's only DBT write).
export async function recordDbtAction(formData: FormData): Promise<void> {
  await requireSession('/schemes');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/schemes');
  const built = buildDbt({
    amountMajor: String(formData.get('amountMajor') ?? ''),
    creditedOn: String(formData.get('creditedOn') ?? ''),
    instalmentNo: String(formData.get('instalmentNo') ?? ''),
    pfmsRef: String(formData.get('pfmsRef') ?? ''),
  });
  if (!built.ok) back(id, `error=dbt_${built.error}`);
  try { await govClient().schemes.recordDbt(id, built.value); }
  catch (e) { back(id, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'dbt'}`); }
  revalidatePath(`/schemes/${id}`);
  back(id, 'ok=dbt');
}
