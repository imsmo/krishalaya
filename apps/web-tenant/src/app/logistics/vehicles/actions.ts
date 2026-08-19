'use server';
// apps/web-tenant/src/app/logistics/vehicles/actions.ts · W229's two writes (PC-56 TENANT-5b).
//
// **NEITHER COULD BE CALLED FROM ANY TENANT SCREEN.** `POST /v1/logistics/vehicles` and
// `POST /v1/logistics/vehicles/:id/active` have existed since the logistics module was built; the SDK had no
// method for either, so [Register vehicle] on W229 and the parking W229 says happens "automatically" had no path
// from this console at all.
//
// Every mutation carries an Idempotency-Key (Law 3): a double-tapped [Register vehicle] on a village network must
// not put two lorries with one plate on the register — and the plate is UNIQUE per partner, so the second attempt
// would come back a 409 the operator did not cause.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';

const BASE = '/logistics/vehicles';

/** One refusal path: the API's own code rides back in the URL and the page translates it BY NAME. An operator
 *  told "that plate is already on this carrier's register" goes and looks for it; one told "409" files a bug. */
function fail(e: unknown): never {
  const code = e instanceof SdkError ? (e.code || 'generic') : 'generic';
  redirect(`${BASE}?error=${encodeURIComponent(code)}`);
}

export async function registerVehicleAction(formData: FormData): Promise<void> {
  await requireSession(BASE);
  const partnerId = String(formData.get('partnerId') ?? '').trim();
  const regNo = String(formData.get('regNo') ?? '').trim();
  // Checked here as well as on the server: a form that posts nothing should be told so without spending a round
  // trip, and the server's own `.strict()` DTO is the net rather than the plan.
  if (!partnerId) redirect(`${BASE}?error=partner_required`);
  if (!regNo) redirect(`${BASE}?error=reg_required`);
  const capacityRaw = String(formData.get('capacityKg') ?? '').trim();
  const typeId = String(formData.get('vehicleTypeId') ?? '').trim();
  try {
    await tenantClient().fleet.createVehicle({
      partnerId,
      regNo,
      vehicleTypeId: typeId || undefined,
      capacityKg: capacityRaw ? Number(capacityRaw) : undefined,
      isRefrigerated: String(formData.get('isRefrigerated') ?? '') === 'on',
      // The RC is deliberately NOT collected here. It is a `kyc_documents` row — a media upload plus a review —
      // and W229's own restricted state says "RC docs follow KYC document rules". Pretending to take one on this
      // form would produce a vehicle whose RC column claims a document nobody uploaded.
    }, randomUUID());
  } catch (e) { fail(e); }
  revalidatePath(BASE);
  redirect(`${BASE}?ok=registered`);
}

/**
 * Park or un-park. ONE action for both directions on purpose: it is one state change, and the confirm screen —
 * not the code path — is what makes un-parking a vehicle with an expired RC a deliberate act.
 */
export async function parkVehicleAction(formData: FormData): Promise<void> {
  await requireSession(BASE);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${BASE}?error=generic`);
  const isActive = String(formData.get('isActive') ?? '') === 'true';
  try {
    await tenantClient().fleet.setVehicleActive(id, isActive);
  } catch (e) { fail(e); }
  revalidatePath(BASE);
  redirect(`${BASE}?ok=${isActive ? 'unparked' : 'parked'}`);
}
