'use server';
// apps/web-tenant/src/app/esg/disclosures/new/actions.ts · W2600 / W2601 · the ESG form chain's submit — PC-56 TENANT-9d.
// Runs only from the REVIEW step; the writer re-takes the review and refuses with the same codes if anything moved
// (`ESG_REFUSED`, every code by name — `NUMBER_IN_DISCLOSURE` among them, and `DATABASE_REFUSED` if 0183's wall said no).
// THE IDEMPOTENCY-KEY IS THE REVIEW PAGE'S. Success drops the words from the URL — they are on the disclosure and its audit row.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { carryValues } from '../../../../features/forms/chain';
import { refusalCodesFrom } from '../../../../features/governance/resolutions';
import { ESG_HREF, MAX_CARRIED_DISCLOSURE, NEW_DISCLOSURE_HREF, carriedFrom } from '../../../../features/esg/esg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function submitDisclosureAction(formData: FormData): Promise<void> {
  await requireSession(NEW_DISCLOSURE_HREF);
  const key = opt(formData.get('idempotencyKey')) ?? randomUUID();
  const idRaw = opt(formData.get('id'));
  const id = idRaw && UUID.test(idRaw) ? idRaw : undefined;
  const metricCode = opt(formData.get('metricCode')) ?? '';
  const languages = String(formData.get('languages') ?? '').split(',').filter((l) => /^[a-z]{2,3}$/.test(l));
  const texts: Record<string, string> = {};
  for (const l of languages) { const v = String(formData.get(`text_${l}`) ?? ''); if (v.trim()) texts[l] = v; }
  let savedId: string | null = null; let failed: string[] | null = null;
  try {
    const esg = tenantClient().esg;
    savedId = (id ? await esg.updateDisclosure(id, { texts }, key) : await esg.createDisclosure({ metricCode, texts }, key)).id;
  } catch (e) { failed = e instanceof SdkError ? refusalCodesFrom(e.details, e.code || 'unknown') : ['unknown']; }
  if (failed) redirect(`${NEW_DISCLOSURE_HREF}?${carryValues('failure', { ...carriedFrom({ metricCode, texts }), ...(id ? { id } : {}) }, MAX_CARRIED_DISCLOSURE).query}&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(ESG_HREF);
  redirect(`${NEW_DISCLOSURE_HREF}?step=success&saved=${encodeURIComponent(savedId!)}`);
}
