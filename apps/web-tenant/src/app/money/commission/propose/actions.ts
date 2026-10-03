'use server';
// apps/web-tenant/src/app/money/commission/propose/actions.ts · W149 propose — the one write of the form chain (PC-56 TENANT-SW-a). The
// API re-validates everything (strict DTO, the 7-day notice, the second-admin requirement); this only carries the reviewed values and the
// idempotency key the review page minted (a double tap is one proposal — Law 3).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { COMMISSION_HREF, proposalInput, readProposalDraft } from '../../../../features/swa/console';

export async function proposeCommissionAction(formData: FormData): Promise<void> {
  const base = `${COMMISSION_HREF}/propose`;
  await requireSession(base);
  const q: Record<string, string> = {};
  formData.forEach((v, k) => { if (typeof v === 'string') q[k] = v; });
  const d = readProposalDraft(q);
  const carry = new URLSearchParams(Object.entries(d).filter(([, v]) => v !== '') as Array<[string, string]>);
  let id = '';
  try { id = (await tenantClient().tenantConfig.proposeCommissionRule(proposalInput(d), String(q.idempotencyKey || ''))).id; }
  catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'generic') : 'generic'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(COMMISSION_HREF);
  redirect(`${base}?step=success&proposalId=${encodeURIComponent(id)}`);
}
