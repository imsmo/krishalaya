'use server';
// apps/web-tenant/src/app/listings/actions.ts · W123's bulk bar (PC-56 TENANT-2a).
//
// TWO BULK VERBS, AND DELIBERATELY NO THIRD: pause and extend — "bulk actions never change price" is W123's own
// bar note, and this module simply exposes no bulk verb that could. Plain multi-checkbox forms (no client JS);
// bounded at BULK_MAX; each id is attempted independently so one refused listing (already paused, raced, held)
// never blocks the rest — the outcome reports done AND skipped, because a bulk action that only reports success
// is a bulk action that lies about the rows it dropped.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { parseBulkIds } from '../../features/listings/console';

const EXTEND_DAYS = 30;   // W123's action is "Extend expiry"; the house window (0005's default listing life)

async function runBulk(formData: FormData, back: string, verb: 'pause' | 'extend'): Promise<void> {
  await requireSession('/listings');
  const parsed = parseBulkIds(formData.getAll('ids').map(String));
  if (!parsed.ok) redirect(`${back}error=bulk_${parsed.error}`);
  const client = tenantClient();
  let done = 0; let skipped = 0;
  for (const id of parsed.ids) {
    try {
      if (verb === 'pause') await client.listings.pause(id);
      else await client.listings.extend(id, EXTEND_DAYS, randomUUID());
      done += 1;
    } catch { skipped += 1; }   // refused rows are COUNTED, never silently dropped
  }
  revalidatePath('/listings');
  redirect(`${back}ok=bulk_${verb}&done=${done}&skipped=${skipped}`);
}

export async function bulkListingsAction(formData: FormData): Promise<void> {
  const status = String(formData.get('status') ?? '').trim();
  const back = status ? `/listings?status=${encodeURIComponent(status)}&` : '/listings?';
  const verb = String(formData.get('verb') ?? '');
  if (verb !== 'pause' && verb !== 'extend') redirect(`${back}error=bulk_none`);
  await runBulk(formData, back, verb as 'pause' | 'extend');
}
