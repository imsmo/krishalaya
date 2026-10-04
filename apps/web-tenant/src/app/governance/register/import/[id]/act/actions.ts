'use server';
// apps/web-tenant/src/app/governance/register/import/[id]/act/actions.ts · W2626–W2628 the import's mutate chain (propose · confirm ·
// reject; retry is DECOR — a re-read) — PC-56 TENANT-SW-d. The API is the judge: confirm needs a second tenant_admin (the trigger refuses
// confirmer = proposer), propose/reject need a reason (audited).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../../lib/api-client';
import { requireSession } from '../../../../../../lib/session';
import { REGISTER_IMPORT_HREF, importHref, isIdemKey, isImportAct, isUuid } from '../../../../../../features/swd/console';
import { codesFrom } from '../../../../../../features/swc/console';

const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return codesFrom(err?.code, err?.status, err?.details); };

export async function importActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const act = String(formData.get('act') ?? '');
  if (!isUuid(id) || !isImportAct(act) || act === 'retry') redirect(REGISTER_IMPORT_HREF);
  await requireSession(importHref(id));
  const back = (q: Record<string, string>) => `${importHref(id)}/act?${new URLSearchParams({ act, ...q }).toString()}`;
  const k = String(formData.get('key') ?? ''); const key = isIdemKey(k) ? k : randomUUID();
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  const c = tenantClient().registerImports;
  try {
    if (act === 'propose') await c.propose(id, reason, key);
    else if (act === 'confirm') await c.confirm(id, key);
    else if (act === 'reject') await c.reject(id, reason);
  } catch (e) { redirect(back({ step: 'failure', error: codesOf(e).join(',') })); }
  revalidatePath(importHref(id)); revalidatePath(REGISTER_IMPORT_HREF);
  redirect(back({ step: 'success' }));
}
