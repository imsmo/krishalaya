'use server';
// apps/web-ops/src/app/aeps/withdrawal/actions.ts · PC-56 OPS-1b · W391 — THE RECORD ACT (moved from app/money/actions.ts, PC-55 B3), REAL over
// the EXISTING keyed `POST /v1/ambassadors/aeps/events`. It records a LOG — never money: the bank moves AePS cash in its own systems, and
// this writes what the operator read off the bank's device. No "retry the payment", no "reverse it": this console cannot move a rupee.
//
// The outcome is the aeps chain (W3290 / W3291) as a query state of /aeps/withdrawal: `?act=success` after a 201; `?act=failure&reason=<code>`
// with the SERVER's named reason (403 not enabled · 404 switched off · 400 a rule, or a Q7-A refusal by its own code · 409 already recorded)
// or the console's own pre-check (the `ev_*` codes mirror the server's rules in the same order — features/aeps/service.ts).
// Q7-A (founder 2026-11-05): no Aadhaar field and no account-link field is read from the form or sent.
// The Idempotency-Key matters even for a log: a re-submitted form must not turn one withdrawal into two records.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { opsClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { buildAepsEvent } from '../../../features/aeps/service';
import { parseMajorToMinor } from '../../../features/money';
import { AEPS_RECORD, aepsFailureReason } from '../../../features/ops1/aeps';

function failure(reason: string): never { redirect(`${AEPS_RECORD}?act=failure&reason=${encodeURIComponent(reason)}`); }

export async function recordAepsEventAction(formData: FormData): Promise<void> {
  await requireSession(AEPS_RECORD);
  const field = (k: string) => String(formData.get(k) ?? '');
  const built = buildAepsEvent({
    serviceKind: field('serviceKind'), status: field('status'), attemptNo: field('attemptNo'), deviceCertified: formData.get('deviceCertified') === '1',
    bankName: field('bankName'), accountLast4: field('accountLast4'), amountMajor: field('amountMajor'), balanceAfterMajor: field('balanceAfterMajor'),
    exceptionCode: field('exceptionCode'), npciRrn: field('npciRrn'), escalationNote: field('escalationNote'),
  }, parseMajorToMinor);
  if (!built.ok) failure(`ev_${built.error}`);

  try { await opsClient().ambassadors.recordAepsEvent(built.value as unknown as Record<string, unknown>, randomUUID()); }
  catch (e) {
    failure(e instanceof SdkError ? aepsFailureReason(e.status, e.code) : 'record');
  }
  revalidatePath('/aeps/exceptions');
  redirect(`${AEPS_RECORD}?act=success`);
}
