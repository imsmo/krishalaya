'use server';
// apps/web-tenant/src/app/dairy/bmc/divert/actions.ts · PC-56 TENANT-6d-6 · W2521's confirm, for the diversion.
//
// This runs only from the CONFIRM step, and the confirm step has already asked the API every question this action
// could — including the two it must not cache: whether this centre-shift-day is already diverted, and how many members
// that decision reaches. So this validates presence and nothing else; the server re-takes the whole verdict.
//
// IT REQUESTS. It does not divert. The success URL carries the new record's id so the screen can deep-link to its
// audit trail, and the reason is dropped from that URL — it is in the audit row now, and a URL carrying somebody's
// stated reason around leaks it into a browser history and a proxy log (TENANT-6d-5's ruling).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import type { DairyShift } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/mutate/chain';

const PATH = '/dairy/bmc/divert';
const BOARD = '/dairy/bmc';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function requestDiversionAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const values: Record<string, string | undefined> = {
    fromMccId: opt(formData.get('fromMccId')),
    toMccId: opt(formData.get('toMccId')),
    divertedOn: opt(formData.get('divertedOn')),
    shift: opt(formData.get('shift')),
    reason: opt(formData.get('reason')),
  };
  if (!values.fromMccId || !values.toMccId || !values.shift || !values.reason) {
    redirect(`${PATH}?${carryValues('confirm', values).query}`);
  }

  let id: string;
  try {
    const made = await tenantClient().dairy.requestDiversion({
      fromMccId: values.fromMccId as string, toMccId: values.toMccId as string,
      divertedOn: values.divertedOn, shift: values.shift as DairyShift, reason: values.reason as string,
    }, randomUUID());
    id = made.id;
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'divert') : 'divert';
    const q = carryValues('failure', values);
    redirect(`${PATH}?${q.query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(BOARD);
  redirect(`${PATH}?step=success&id=${encodeURIComponent(id)}`);
}
