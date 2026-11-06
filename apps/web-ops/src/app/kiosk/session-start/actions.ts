'use server';
// apps/web-ops/src/app/kiosk/session-start/actions.ts · PC-56 OPS-1c · W381 — THE CREATE ACT (moved from app/kiosk/actions.ts, PC-31 OW-1;
// HOTFIX-10 H10-1), REAL over the EXISTING keyed `POST /v1/users` (`user.approve`; audited `user.created_assisted`). It creates an account for a
// NEW number and nothing else: no consent, no membership, no referral, no earning (re-verified for OPS-1c — `user.service.ts` adminCreate
// writes the user, its outbox event and one audit row; nothing consumes the event into a referral).
// The outcome is the kiosk chain (W3330 / W3331) as a query state of /kiosk/session-start: `?act=success` after a 201; `?act=failure&reason=<code>`
// with the SERVER's named reason (409 USER_PHONE_ALREADY_REGISTERED → `exists`, Q9-A: nothing about the person · 400 / 422 a field rule ·
// 403 not allowed) or the console's own pre-check (`phone` / `name` / `lang`). THE PHONE NEVER ENTERS A URL: it is read from the posted form,
// and every redirect carries `act` and a reason code only. The Idempotency-Key makes a double tap one account.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { opsClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { buildFarmer } from '../../../features/kiosk/form';
import { KIOSK_START, kioskFailureReason } from '../../../features/ops1/kiosk';

function failure(reason: string): never { redirect(`${KIOSK_START}?act=failure&reason=${encodeURIComponent(reason)}`); }

export async function createAccountAction(formData: FormData): Promise<void> {
  await requireSession(KIOSK_START);
  const built = buildFarmer({
    phone: String(formData.get('phone') ?? ''),
    fullName: String(formData.get('fullName') ?? ''),
    languageCode: String(formData.get('languageCode') ?? ''),
  });
  if (!built.ok) failure(built.error);
  try { await opsClient().users.create(built.value, randomUUID()); }
  catch (e) {
    failure(e instanceof SdkError ? kioskFailureReason(e.status, e.code) : 'create');
  }
  redirect(`${KIOSK_START}?act=success`);
}
