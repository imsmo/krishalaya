'use server';
// apps/web-ops/src/app/kiosk/actions.ts · kiosk mutation (PC-31 OW-1): create the farmer's account
// (users.create, Idempotency-Key — a double-tap can't create two accounts; the server enforces the ops
// permission + uniqueness). PC-56 HOTFIX-10 · H10-1: the "409 → exists" this comment always promised is now
// TRUE — the API refuses an existing phone (409 USER_PHONE_ALREADY_REGISTERED, nothing about the person) and
// `kioskCreateOutcome` maps it; "Account created" is printed only for the API's 201.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { opsClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildFarmer, kioskCreateOutcome } from '../../features/kiosk/form';
import { SdkError } from '@krishalaya/sdk-js';

export async function createFarmerAction(formData: FormData): Promise<void> {
  await requireSession('/kiosk');
  const built = buildFarmer({
    phone: String(formData.get('phone') ?? ''),
    fullName: String(formData.get('fullName') ?? ''),
    languageCode: String(formData.get('languageCode') ?? ''),
  });
  if (!built.ok) redirect(`/kiosk?error=${built.error}`);
  let outcome: ReturnType<typeof kioskCreateOutcome>;
  try { await opsClient().users.create(built.value, randomUUID()); outcome = kioskCreateOutcome({ ok: true }); }
  catch (e) {
    outcome = kioskCreateOutcome(e instanceof SdkError ? { ok: false, status: e.status, code: e.code } : { ok: false });
  }
  if (outcome !== 'created') redirect(`/kiosk?error=${outcome}`);
  revalidatePath('/kiosk');
  redirect('/kiosk?ok=created');
}
