'use server';
// apps/web-storefront/src/app/account/actions.ts · buyer account mutations (PC-24b). AUTHENTICATED; the API
// resolves the subject from the token (users.updateMe — no id, no IDOR) and the address book is caller-scoped
// server-side. Validation lives in features/account/form.ts (pure, unit-tested); empty optionals are dropped.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildProfilePatch, buildAddress } from '../../features/account/form';

function back(qs: string): never { redirect(`/account?${qs}`); }

export async function updateProfileAction(formData: FormData): Promise<void> {
  await requireSession('/account');
  const built = buildProfilePatch({
    fullName: String(formData.get('fullName') ?? ''),
    email: String(formData.get('email') ?? ''),
    languageCode: String(formData.get('languageCode') ?? ''),
  });
  if (!built.ok) back(`error=${built.error}`);
  try { await serverClient().users.updateMe(built.value); }
  catch { back('error=profile'); }
  revalidatePath('/account');
  back('ok=profile');
}

export async function addAddressAction(formData: FormData): Promise<void> {
  await requireSession('/account');
  const built = buildAddress({
    line1: String(formData.get('line1') ?? ''),
    line2: String(formData.get('line2') ?? ''),
    village: String(formData.get('village') ?? ''),
    pincode: String(formData.get('pincode') ?? ''),
    contactName: String(formData.get('contactName') ?? ''),
    contactPhone: String(formData.get('contactPhone') ?? ''),
    isDefault: formData.get('isDefault') === '1',
  });
  if (!built.ok) back(`error=${built.error}`);
  try { await serverClient().addresses.create(built.value); }
  catch { back('error=address'); }
  revalidatePath('/account');
  back('ok=address');
}

export async function removeAddressAction(formData: FormData): Promise<void> {
  await requireSession('/account');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) back('error=address');
  try { await serverClient().addresses.remove(id); }
  catch { back('error=address'); }
  revalidatePath('/account');
  back('ok=removed');
}

export async function makeDefaultAddressAction(formData: FormData): Promise<void> {
  await requireSession('/account');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) back('error=address');
  try { await serverClient().addresses.update(id, { isDefault: true }); }
  catch { back('error=address'); }
  revalidatePath('/account');
  back('ok=default');
}
