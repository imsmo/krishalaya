'use server';
// apps/web-tenant/src/app/auditor/reveal/actions.ts · the recorded reveal (PC-56 TENANT-9c). The API records first, then
// answers; the console carries back only the reveal's GRANT (its read-log id), never a value.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';

export async function revealAuditEntryAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!/^\d{1,19}$/.test(id)) redirect('/auditor');
  await requireSession('/auditor');
  const reason = String(formData.get('reason') ?? '').trim();
  let grant: string | null = null; let code: string | null = null;
  try { grant = (await tenantClient().audit.reveal(id, reason)).revealGrant; }
  catch (e) { const err = e instanceof SdkError ? e : null; code = String((err?.details as { code?: unknown } | undefined)?.code ?? err?.code ?? 'reveal'); }
  if (!grant) redirect(`/auditor/reveal?entry=${id}&error=${encodeURIComponent(code ?? 'reveal')}`);
  redirect(`/auditor?entry=${id}&reveal=${encodeURIComponent(grant)}`);
}
