'use server';
// apps/web-tenant/src/app/ai-review/actions.ts · AI review-queue (ai.review) mutations. Every write goes through
// the SDK to the audited, RBAC-gated + `ai_governance`-flagged API, which owns the review state machine and fans
// each resolution back to the originating module via the outbox. This layer only shapes + pre-validates the form
// and surfaces the API's typed error code. 'use server' modules export ONLY async functions.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { validateResolve, validateEnqueue } from '../../features/ai-review/queue';

const PATH = '/ai-review';
const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };
const back = (id?: string) => id ? `${PATH}?item=${encodeURIComponent(id)}` : PATH;

function fail(e: unknown, id?: string): never {
  const b = back(id);
  redirect(`${b}${b.includes('?') ? '&' : '?'}error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'save') : 'save')}`);
}

export async function claimAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().aiReview.claim(id); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=claim`);
}

export async function resolveAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  const decision = String(formData.get('decision') ?? '').trim();
  const note = opt(formData.get('note'));
  if (!id) redirect(`${PATH}?error=save`);
  const bad = validateResolve({ decision, note });
  if (bad) redirect(`${back(id)}&error=${bad}`);
  try { await tenantClient().aiReview.resolve(id, { decision: decision as 'accepted' | 'rejected', note }); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=${decision === 'accepted' ? 'accept' : 'reject'}`);
}

export async function enqueueAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const queueKind = String(formData.get('queueKind') ?? '').trim();
  const priority = opt(formData.get('priority'));
  const subjectType = opt(formData.get('subjectType'));
  const subjectId = opt(formData.get('subjectId'));
  const bad = validateEnqueue({ queueKind, priority, subjectType, subjectId });
  if (bad) redirect(`${PATH}?error=${bad}`);
  let id: string | undefined;
  try {
    const item = await tenantClient().aiReview.enqueue({
      queueKind: queueKind as 'fraud_flag' | 'low_confidence_grade' | 'price_anomaly' | 'dispute_triage' | 'drift' | 'manual',
      priority: priority ? Number(priority) : undefined,
      subjectType, subjectId,
    });
    id = item.id;
  } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=enqueue`);
}
