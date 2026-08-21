'use server';
// apps/web-tenant/src/app/dairy/bmc/call/actions.ts · the chain's confirm — W2522/W2523 · PC-56 TENANT-6d-5.
//
// This runs only from the CONFIRM step, and the confirm step has already asked the API every question this action could
// ask — including the one it must NOT cache: whether the person who holds that centre is still the person who holds it.
// So this action validates presence and nothing else. Re-checking a rule here would be a second implementation of it,
// and the server re-takes the whole verdict anyway.
//
// SUCCESS keeps the unit id, so W2522 can deep-link to that cooler's own audit trail. FAILURE keeps the unit id AND the
// typed reason, so *"Retry — back to confirm"* returns to a screen with the operator's own words still in it rather
// than to an empty box at the worst possible moment.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/mutate/chain';

const PATH = '/dairy/bmc/call';
const BOARD = '/dairy/bmc';

export async function callOperatorAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const unitId = String(formData.get('unitId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const values = { unitId, reason };
  // The only check: the two things without which there is no act. Everything else is the server's to decide.
  if (unitId.length === 0 || reason.length === 0) {
    redirect(`${PATH}?${carryValues('confirm', values).query}`);
  }

  try {
    await tenantClient().dairy.callBmcOperator(unitId, { reason }, randomUUID());
  } catch (e) {
    // A refused call (`BMC_CALL_REFUSED`) and an unavailable telephony provider (`MASKED_CALL_UNAVAILABLE`) both land
    // here, and both are honest failures: W2523's *"state is untouched (all-or-nothing)"* is true of each. The code
    // travels so the screen can name which one it was instead of saying "something went wrong".
    const code = e instanceof SdkError ? (e.code || 'call') : 'call';
    const q = carryValues('failure', values);
    redirect(`${PATH}?${q.query}&error=${encodeURIComponent(code)}`);
  }
  // The monitor's own page shows nothing about this call, but the audit trail behind it is fresh and the tile's
  // alerting panel reads flags and rules — so the board is revalidated rather than left on a cached render.
  revalidatePath(BOARD);
  // The REASON is deliberately dropped from the success URL: it is in the audit row now, and a URL that carries
  // somebody's stated reason around after the act is a URL that leaks it into a browser history and a proxy log.
  redirect(`${PATH}?step=success&unitId=${encodeURIComponent(unitId)}`);
}
