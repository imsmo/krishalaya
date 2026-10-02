'use server';
// apps/web-tenant/src/app/governance/resolutions/new/actions.ts · W2743 / W2744 · the resolutions form chain's submit — PC-56
// TENANT-9b. Runs only from the REVIEW step (the API already answered every question); the writer re-takes the review and
// refuses with the same codes if anything moved (GOVERNANCE_REFUSED, every code by name). THE IDEMPOTENCY-KEY IS THE
// FORM'S (minted on the review page) — the old /governance action minted a fresh one per submit, so a double-click made two
// resolutions. Success drops the values from the URL — they are on the resolution and its audit row now.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { carryValues } from '../../../../features/forms/chain';
import { DRAFT_FIELDS, MAX_CARRIED_RESOLUTION, NEW_RESOLUTION_HREF, RESOLUTIONS_HREF, refusalCodesFrom } from '../../../../features/governance/resolutions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function submitResolutionAction(formData: FormData): Promise<void> {
  await requireSession(NEW_RESOLUTION_HREF);
  const key = opt(formData.get('idempotencyKey')) ?? randomUUID();
  const idRaw = opt(formData.get('id'));
  const id = idRaw && UUID.test(idRaw) ? idRaw : undefined;
  const values: Record<string, string> = {};
  for (const f of DRAFT_FIELDS) { const v = opt(formData.get(f)); if (v !== undefined) values[f] = v; }
  let savedId: string | null = null; let failed: string[] | null = null;
  try {
    const m = tenantClient().memberships;
    savedId = (id ? await m.updateResolution(id, values, key) : await m.createResolution(values, key)).id;
  } catch (e) { failed = e instanceof SdkError ? refusalCodesFrom(e.details, e.code || 'unknown') : ['unknown']; }
  if (failed) redirect(`${NEW_RESOLUTION_HREF}?${carryValues('failure', { ...values, ...(id ? { id } : {}) }, MAX_CARRIED_RESOLUTION).query}&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(RESOLUTIONS_HREF);
  redirect(`${NEW_RESOLUTION_HREF}?step=success&saved=${encodeURIComponent(savedId!)}`);
}
