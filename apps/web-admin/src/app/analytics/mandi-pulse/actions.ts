'use server';
// apps/web-admin/src/app/analytics/mandi-pulse/actions.ts · W107's decide chain (PC-56 ADMIN-SWEEP).
//
// admin-api re-authorises: `market.price.review`, and a note of at least twenty characters. **THE NOTE IS SHOWN TO THE
// AMBASSADOR WHO REPORTED THE PRICE** — it is coaching rather than a verdict, and "wrong" teaches nobody anything.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../../lib/admin-client';

function apiErrorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'notAllowed';
    // Already decided: deciding again would overwrite the note the reporter was shown.
    if (e.status === 409) return 'alreadyDecided';
    if (e.status === 422) return 'invalid';
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const BACK = '/analytics/mandi-pulse/quarantine';

export async function decidePriceAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id');
  const priceDate = str(formData, 'priceDate');
  const decision = str(formData, 'decision');
  const note = str(formData, 'note');
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(priceDate) || (decision !== 'released' && decision !== 'rejected')) {
    redirect(`${BACK}?error=invalid`);
  }
  if (note.length < 20) redirect(`${BACK}?error=note`);
  try {
    await adminPost(`market/quarantine/${encodeURIComponent(id)}/decide`, { body: { priceDate, decision, note } });
  } catch (e) { redirect(`${BACK}?error=${apiErrorKey(e)}`); }
  revalidatePath(BACK); revalidatePath('/analytics/mandi-pulse');
  redirect(`${BACK}?ok=${decision}`);
}
