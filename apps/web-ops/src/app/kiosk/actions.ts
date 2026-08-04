'use server';
// apps/web-ops/src/app/kiosk/actions.ts · kiosk mutation (PC-31 OW-1): create the farmer's account
// (users.create, Idempotency-Key — a double-tap can't create two accounts; the server enforces the ops
// permission + uniqueness: an existing phone comes back 409 and we say so honestly).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { opsClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildFarmer } from '../../features/kiosk/form';
import { SdkError } from '@krishalaya/sdk-js';

export async function createFarmerAction(formData: FormData): Promise<void> {
  await requireSession('/kiosk');
  const built = buildFarmer({
    phone: String(formData.get('phone') ?? ''),
    fullName: String(formData.get('fullName') ?? ''),
    languageCode: String(formData.get('languageCode') ?? ''),
  });
  if (!built.ok) redirect(`/kiosk?error=${built.error}`);
  try { await opsClient().users.create(built.value, randomUUID()); }
  catch (e) {
    redirect(`/kiosk?error=${e instanceof SdkError && e.status === 409 ? 'exists' : 'create'}`);
  }
  revalidatePath('/kiosk');
  redirect('/kiosk?ok=created');
}
