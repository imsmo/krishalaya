'use server';
// apps/web-tenant/src/app/dairy/centres/new/actions.ts · the chain's submit — W2557/W2558 · PC-56 TENANT-6d-4.
//
// The chain's own contract: this runs only from the REVIEW step, and the review has already asked the API every
// question this action could ask. So it validates nothing beyond presence — re-checking here would be a second
// implementation of a rule, and the two would disagree the first time one changed.
//
// SUCCESS lands on the chain's success state WITH THE NEW ID, so the screen can deep-link to that record's own audit
// trail (W2557's *"the audit trail has the entry"* is a promise this keeps rather than states). FAILURE lands on the
// failure state with the values intact, so the retry path goes back to a review of what was typed and not to a blank
// form.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/forms/chain';

const PATH = '/dairy/centres/new';
const BOARD = '/dairy/centres';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function createCentreFromChainAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const values: Record<string, string | undefined> = {
    code: opt(formData.get('code')),
    defaultName: opt(formData.get('defaultName')),
    capacityLitresShift: opt(formData.get('capacityLitresShift')),
    analyzerModel: opt(formData.get('analyzerModel')),
    analyzerSerial: opt(formData.get('analyzerSerial')),
    operatorUserId: opt(formData.get('operatorUserId')),
    operatorReason: opt(formData.get('operatorReason')),
    morningOpensAt: opt(formData.get('morningOpensAt')),
    morningClosesAt: opt(formData.get('morningClosesAt')),
    eveningOpensAt: opt(formData.get('eveningOpensAt')),
    eveningClosesAt: opt(formData.get('eveningClosesAt')),
  };
  // The only check this action makes: the two fields without which there is nothing to create. Everything else the
  // review already answered against the database.
  if (!values.code || !values.defaultName) {
    redirect(`${PATH}?${carryValues('review', values).query}`);
  }

  let id: string;
  try {
    const created = await tenantClient().dairy.createMcc({
      code: values.code as string, defaultName: values.defaultName as string,
      capacityLitresShift: values.capacityLitresShift, analyzerModel: values.analyzerModel,
      analyzerSerial: values.analyzerSerial, operatorUserId: values.operatorUserId,
      operatorReason: values.operatorReason,
      morningOpensAt: values.morningOpensAt, morningClosesAt: values.morningClosesAt,
      eveningOpensAt: values.eveningOpensAt, eveningClosesAt: values.eveningClosesAt,
    }, randomUUID());
    id = created.id;
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'save') : 'save';
    // ALL-OR-NOTHING, and the values survive: W2558's retry path is a review of what was typed, with the reason.
    const q = carryValues('failure', values);
    redirect(`${PATH}?${q.query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(BOARD);
  redirect(`${PATH}?step=success&id=${encodeURIComponent(id)}`);
}
