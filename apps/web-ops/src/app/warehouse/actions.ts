'use server';
// apps/web-ops/src/app/warehouse/actions.ts · warehouse-wave mutations (PC-32 OW-2). All server-gated (PC-56 OPS-1a: release is NOT offered — paused,
// founder Q3-A); a refusal degrades to an honest, NAMED state message (Law 12).
// PC-56 OPS-2b: `issueNwrAction` is REMOVED (founder Q3-A) and `recordAssayAction` MOVED to app/warehouse/assay/actions.ts (W372).
// PC-56 OPS-2a (founder Q11-A, D3): confirm / store / cancel are the warehouse's NAMED operator's only (the API answers 403 by name to anyone else →
// `error=notOperator`); the operator's cancel carries a REQUIRED reason (the API answers 400 BOOKING_CANCEL_REASON_REQUIRED without one →
// `error=reason`). The reason travels in the request body (`cancelBooking(id, reason)`). Every act is audited by the API.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { opsClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { DASHBOARD_PAGE, bookingError } from '../../features/ops2/intake';

function back(id: string, qs: string): never { redirect(`/warehouse/${encodeURIComponent(id)}?${qs}`); }

export async function bookingLifecycleAction(formData: FormData): Promise<void> {
  await requireSession(DASHBOARD_PAGE);
  const id = String(formData.get('id') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');
  if (!id) redirect(DASHBOARD_PAGE);
  try {
    const w = opsClient().warehousing;
    if (kind === 'confirm') await w.confirmBooking(id);
    else if (kind === 'store') await w.storeBooking(id);
    // PC-56 OPS-1a (founder 1a-2, Q3-A): no release from this console — the storage fee would leave the depositor's wallet without her word
    // (the API refuses it by name: 409 STORAGE_RELEASE_AWAITS_DEPOSITOR). `kind=release` falls through to the generic refusal below.
    else if (kind === 'cancel') await w.cancelBooking(id, String(formData.get('reason') ?? '').trim());
    else back(id, 'error=action');
  } catch (e) {
    back(id, `error=${e instanceof SdkError ? bookingError(e.status, e.code) : 'action'}`);
  }
  revalidatePath(`/warehouse/${id}`); revalidatePath(DASHBOARD_PAGE);
  back(id, `ok=${kind}`);
}
