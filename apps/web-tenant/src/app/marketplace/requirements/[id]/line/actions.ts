'use server';
// apps/web-tenant/src/app/marketplace/requirements/[id]/line/actions.ts · W2366 / W2367 · a member's line of the pooled quote —
// add · edit · record the member's consent — PC-56 TENANT-11d. The review's rules re-run here; the API re-decides inside its
// transaction (desk permission, member's published listing, available ≥ quantity, the requirement's unit, one line per member;
// the consent bound to exactly these figures). Each act is audited with ip; the success screen reads the audit row back.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { LINE_KEYS, REQUIREMENTS_HREF, carried, failureCodesFrom, isUuid, missingNames, reqHref, reviewLine, rupeesToMinor } from '../../../../../features/requirements/console';

export async function lineAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = `${REQUIREMENTS_HREF}/${encodeURIComponent(id)}/line`;
  await requireSession(base);
  const values = carried(LINE_KEYS, (k) => formData.get(k));
  const keep = new URLSearchParams(values);
  const mode = values.mode === 'edit' ? 'edit' : values.mode === 'consent' ? 'consent' : 'add';
  if (!isUuid(id) || !isUuid(values.gid)) redirect(REQUIREMENTS_HREF);
  const refusals = reviewLine(values, mode);
  if (refusals.length > 0) redirect(`${base}?step=failure&error=${encodeURIComponent([...new Set(refusals.map((r) => r.code))].join(','))}&${keep.toString()}`);
  const price = rupeesToMinor(values.price);
  const c = tenantClient().requirements;
  let failed: string[] | null = null; let names: string[] = [];
  try {
    if (mode === 'add') await c.addLine(id, values.gid, { listingId: values.listingId, quantity: values.quantity, ...(price && price !== 'invalid' ? { priceMinor: price } : {}) });
    else if (mode === 'edit') {
      if (!isUuid(values.lid)) throw new Error('NOT_FOUND');
      await c.editLine(id, values.gid, values.lid, { quantity: values.quantity, ...(price && price !== 'invalid' ? { priceMinor: price } : {}) });
    } else {
      if (!isUuid(values.lid)) throw new Error('NOT_FOUND');
      await c.recordConsent(id, values.gid, values.lid, { channel: values.consentChannel as 'otp' | 'voice' | 'written', ...(isUuid(values.consentMediaId) ? { mediaId: values.consentMediaId } : {}), ...(values.consentNote ? { note: values.consentNote.slice(0, 500) } : {}) });
    }
  } catch (e) {
    failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status) : e instanceof Error && e.message === 'NOT_FOUND' ? ['NOT_FOUND'] : ['unknown'];
    names = e instanceof SdkError ? missingNames(e.details) : [];
  }
  if (failed) redirect(`${base}?step=failure&error=${encodeURIComponent(failed.join(','))}${names.length ? `&names=${encodeURIComponent(names.join('|'))}` : ''}&${keep.toString()}`);
  revalidatePath(reqHref(id));
  redirect(`${base}?step=success&mode=${mode}&gid=${encodeURIComponent(values.gid)}`);
}
