'use server';
// apps/web-ops/src/app/warehouse/actions.ts · warehouse-wave mutations (PC-32 OW-2). All server-gated by
// warehousing.manage (PC-56 OPS-1a: release is NOT offered — paused, founder Q3-A); 409s degrade to honest state messages (Law 12).
// PC-56 OPS-2b: `issueNwrAction` is REMOVED (founder Q3-A — this platform does not issue an eNWR; the API refuses it by name) and
// `recordAssayAction` MOVED to app/warehouse/assay/actions.ts (W372, the assay chain's states).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { opsClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';

function back(id: string, qs: string): never { redirect(`/warehouse/${encodeURIComponent(id)}?${qs}`); }

export async function bookingLifecycleAction(formData: FormData): Promise<void> {
  await requireSession('/warehouse');
  const id = String(formData.get('id') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');
  if (!id) redirect('/warehouse');
  try {
    const w = opsClient().warehousing;
    if (kind === 'confirm') await w.confirmBooking(id);
    else if (kind === 'store') await w.storeBooking(id);
    // PC-56 OPS-1a (founder 1a-2, Q3-A): no release from this console — the storage fee would leave the depositor's wallet without her word
    // (the API refuses it by name: 409 STORAGE_RELEASE_AWAITS_DEPOSITOR). `kind=release` falls through to the generic refusal below.
    else if (kind === 'cancel') await w.cancelBooking(id, String(formData.get('reason') ?? '').trim() || undefined);
    else back(id, 'error=action');
  } catch (e) {
    back(id, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'action'}`);
  }
  revalidatePath(`/warehouse/${id}`); revalidatePath('/warehouse');
  back(id, `ok=${kind}`);
}
