'use server';
// apps/web-tenant/src/app/logistics/routes/actions.ts · W231's writes (PC-56 TENANT-5b).
//
// **NONE OF THESE COULD BE CALLED FROM ANY TENANT SCREEN.** `POST /v1/logistics/routes`,
// `PATCH /v1/logistics/routes/:id` and `POST /v1/logistics/routes/:id/active` have existed since the logistics
// module was built with no SDK method, and `POST :id/approve` did not exist at all because there was nothing to
// approve — a route was live from the moment it was typed.
//
// Idempotency-Key on create and approve (Law 3). Approval especially: it commits a named ambassador's day every
// week, and a double-tapped button must not record two approvals of the same commitment.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { validateDraft } from '../../../features/logistics/routes';

const BASE = '/logistics/routes';

/** The API's own code rides back in the URL and the page translates it BY NAME. `ROUTE_NOT_APPROVABLE` carries a
 *  `reason` too, and the more specific key wins so "needs a vehicle" reaches the operator rather than "conflict". */
function fail(e: unknown, at = BASE): never {
  const err = e instanceof SdkError ? e : null;
  const reason = (err?.details as { reason?: string } | undefined)?.reason;
  const code = reason ?? err?.code ?? 'generic';
  redirect(`${at}?error=${encodeURIComponent(code)}`);
}

/**
 * Create a PROPOSAL. W2404's success state is reached with `?ok=created`, and the copy says a proposal was
 * recorded rather than a run scheduled — an operator who believes they have booked a truck will not come back to
 * approve it, and the Saturday will pass with nobody notified.
 */
export async function createRouteAction(formData: FormData): Promise<void> {
  await requireSession(`${BASE}/new`);
  const draft = {
    defaultName: String(formData.get('defaultName') ?? ''),
    runWeekday: String(formData.get('runWeekday') ?? ''),
    villageRegionIds: formData.getAll('villageRegionIds').map((v) => String(v)).filter(Boolean),
  };
  // W2402: every invalid field, with its reason, values preserved, nothing saved. The redirect carries the draft
  // back so the form can re-render it — a validation error that empties the form is a punishment.
  const errors = validateDraft(draft);
  if (errors.length > 0) {
    const qs = new URLSearchParams({ step: 'form', invalid: errors.map((e) => e.field).join(','),
      defaultName: draft.defaultName, runWeekday: draft.runWeekday });
    for (const v of draft.villageRegionIds) qs.append('villageRegionIds', v);
    redirect(`${BASE}/new?${qs.toString()}`);
  }
  try {
    await tenantClient().routes.create({
      defaultName: draft.defaultName.trim(),
      runWeekday: draft.runWeekday === '' ? null : Number(draft.runWeekday),
      villageRegionIds: draft.villageRegionIds,
    }, randomUUID());
  } catch (e) { fail(e, `${BASE}/new`); }
  revalidatePath(BASE);
  redirect(`${BASE}?ok=created&tab=proposed`);
}

/** W231's [Approve route], carrying the two commitments it approves so the whole act is ONE transaction. */
export async function approveRouteAction(formData: FormData): Promise<void> {
  await requireSession(BASE);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${BASE}?error=generic`);
  const vehicleId = String(formData.get('vehicleId') ?? '').trim();
  const consolidationUserId = String(formData.get('consolidationUserId') ?? '').trim();
  try {
    await tenantClient().routes.approve(id, {
      vehicleId: vehicleId || undefined,
      consolidationUserId: consolidationUserId || undefined,
    }, randomUUID());
  } catch (e) { fail(e); }
  revalidatePath(BASE);
  redirect(`${BASE}?ok=approved`);
}

/** Suspend a run, or restart one that was approved before. A never-approved route is refused by the API rather
 *  than switched live through the back door, and that refusal reaches the operator by name. */
export async function setRouteActiveAction(formData: FormData): Promise<void> {
  await requireSession(BASE);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${BASE}?error=generic`);
  const isActive = String(formData.get('isActive') ?? '') === 'true';
  try {
    await tenantClient().routes.setActive(id, isActive);
  } catch (e) { fail(e); }
  revalidatePath(BASE);
  redirect(`${BASE}?ok=${isActive ? 'restarted' : 'suspended'}`);
}
