'use server';
// apps/web-tenant/src/app/marketplace/requirements/[id]/actions.ts · W132 "Respond with member stock" — PC-56 TENANT-11d.
// Opens a pooled-quote DRAFT (a server row; the desk only — the API re-decides) and returns to the detail page with the matched
// member stock showing. A refusal lands on the mutate chain's failure screen (W2370) with the API's code as a sentence.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { REQUIREMENTS_HREF, actBase, failureCodesFrom, isUuid, reqHref } from '../../../../features/requirements/console';

export async function openDraftAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!isUuid(id)) redirect(REQUIREMENTS_HREF);
  await requireSession(reqHref(id));
  let failed: string[] | null = null;
  try { await tenantClient().requirements.createGroup(id); }
  catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status) : ['unknown']; }
  if (failed) redirect(`${actBase(id)}?step=failure&act=send&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(reqHref(id));
  redirect(reqHref(id, { respond: '1', ok: 'draft' }));
}
