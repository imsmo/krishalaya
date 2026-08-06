'use server';
// apps/web-tenant/src/app/returns/actions.ts · returns/RMA lifecycle (PC-55 B8, on W54-2).
// The seller's four steps, and one of them moves money. The API re-validates the state AND the acting party on
// every call, so this file's job is to send an exact step and translate a refusal — never to decide one.
//
// REFUND IS THE ONLY MONEY LEG, and it is Resolve-gated server-side. The page withholds the button unless the
// session's token carries that permission (display gating only, lib/auth.getTenantPermissions), so an operator who
// cannot refund does not learn that by clicking. A 403 is still translated precisely, because a token claim can be
// stale and the API is the authority.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';

const STEPS = ['approve', 'reject', 'receive', 'refund'] as const;
type Step = (typeof STEPS)[number];

function back(qs: string): never { redirect(`/returns?${qs}`); }
function errKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.status === 403) return 'forbidden';
    if (e.status === 404) return 'notFound';
    if (e.status === 409) return 'illegal';
  }
  return 'generic';
}

export async function returnStepAction(formData: FormData): Promise<void> {
  await requireSession('/returns');
  const id = String(formData.get('id') ?? '').trim();
  const step = String(formData.get('step') ?? '').trim();
  if (!id) redirect('/returns');
  if (!(STEPS as readonly string[]).includes(step)) back('error=step');
  const returns = tenantClient().returns;
  try {
    const s = step as Step;
    if (s === 'approve') await returns.approve(id);
    else if (s === 'reject') await returns.reject(id);
    else if (s === 'receive') await returns.receive(id);
    else await returns.refund(id);
  } catch (e) { back(`error=${errKey(e)}`); }
  revalidatePath('/returns');
  back(`ok=${step}`);
}
