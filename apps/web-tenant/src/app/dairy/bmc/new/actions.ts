'use server';
// apps/web-tenant/src/app/dairy/bmc/new/actions.ts · the chain's submit — W2519/W2520 · PC-56 TENANT-6d-4.
//
// The chain's own contract: this runs only from the REVIEW step, and the review has already asked the API every
// question this action could ask. So it validates nothing beyond presence — re-checking here would be a second
// implementation of a rule, and the two would disagree the first time one changed.
//
// SUCCESS lands on the chain's success state WITH THE NEW ID, so the screen can deep-link to that cooler's own audit
// trail (W2519's *"the audit trail has the entry"* is a promise this keeps rather than states). FAILURE lands on the
// failure state with the values intact, so the retry path goes back to a review of what was typed and not to a blank
// form.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/forms/chain';

const PATH = '/dairy/bmc/new';
const BOARD = '/dairy/bmc';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function registerBmcFromChainAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const values: Record<string, string | undefined> = {
    mccId: opt(formData.get('mccId')),
    capacityLitres: opt(formData.get('capacityLitres')),
    minTempC: opt(formData.get('minTempC')),
    targetTempC: opt(formData.get('targetTempC')),
    toleranceC: opt(formData.get('toleranceC')),
    iotDeviceRef: opt(formData.get('iotDeviceRef')),
    model: opt(formData.get('model')),
    serialNo: opt(formData.get('serialNo')),
  };
  // The only check this action makes: the two fields without which there is nothing to register. Everything else the
  // review already answered against the database.
  if (!values.mccId || !values.capacityLitres) {
    redirect(`${PATH}?${carryValues('review', values).query}`);
  }

  let id: string;
  try {
    const created = await tenantClient().dairy.registerBmcUnit({
      mccId: values.mccId as string, capacityLitres: values.capacityLitres as string,
      minTempC: values.minTempC, targetTempC: values.targetTempC, toleranceC: values.toleranceC,
      iotDeviceRef: values.iotDeviceRef, model: values.model, serialNo: values.serialNo,
    }, randomUUID());
    id = created.id;
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'save') : 'save';
    // ALL-OR-NOTHING, and the values survive: W2520's retry path is a review of what was typed, with the reason.
    const q = carryValues('failure', values);
    redirect(`${PATH}?${q.query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(BOARD);
  redirect(`${PATH}?step=success&id=${encodeURIComponent(id)}`);
}
