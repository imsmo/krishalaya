'use server';
// apps/web-ops/src/app/money/actions.ts · OW-5 assisted-money write (PC-55 B3).
// ONE action, and it records a LOG — never money. AePS cash moves in the bank's systems over NPCI; this writes what
// the bank did. So there is deliberately no "retry the payment" or "reverse it" action here: this console cannot
// move a rupee, and a button suggesting otherwise would be a lie to an operator standing in front of a customer.
//
// The Idempotency-Key matters even for a log: a kiosk on a bad connection re-submitting the form must not turn one
// customer's withdrawal into two records that a supervisor later reads as two withdrawals.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { opsClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildAepsEvent } from '../../features/aeps/service';
import { parseMajorToMinor } from '../../features/money';
import { SdkError } from '@krishalaya/sdk-js';

function back(qs: string): never { redirect(`/money?${qs}`); }

export async function recordAepsEventAction(formData: FormData): Promise<void> {
  await requireSession('/money');
  const built = buildAepsEvent({
    serviceKind: String(formData.get('serviceKind') ?? ''),
    status: String(formData.get('status') ?? ''),
    attemptNo: String(formData.get('attemptNo') ?? ''),
    deviceCertified: formData.get('deviceCertified') === '1',
    customerUserId: String(formData.get('customerUserId') ?? ''),
    bankName: String(formData.get('bankName') ?? ''),
    accountLast4: String(formData.get('accountLast4') ?? ''),
    aadhaarLast4: String(formData.get('aadhaarLast4') ?? ''),
    amountMajor: String(formData.get('amountMajor') ?? ''),
    balanceAfterMajor: String(formData.get('balanceAfterMajor') ?? ''),
    exceptionCode: String(formData.get('exceptionCode') ?? ''),
    npciRrn: String(formData.get('npciRrn') ?? ''),
    escalationNote: String(formData.get('escalationNote') ?? ''),
  }, parseMajorToMinor);
  if (!built.ok) back(`error=ev_${built.error}`);

  try { await opsClient().ambassadors.recordAepsEvent(built.value as unknown as Record<string, unknown>, randomUUID()); }
  catch (e) {
    const status = e instanceof SdkError ? e.status : 0;
    // 403 = this operator is not an AePS-enabled active ambassador (the server's own gate — the console must not
    // pretend the record was kept). 400 = a W391/W392 rule the server re-checked. 409 = already recorded.
    back(`error=${status === 403 ? 'notEnabled' : status === 409 ? 'dup' : status === 400 || status === 422 ? 'rule' : 'record'}`);
  }
  revalidatePath('/money');
  back('ok=recorded');
}
