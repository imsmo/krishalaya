'use server';
// apps/web-tenant/src/app/content/templates/new/actions.ts · the override form chain's submit — W2781/W2782 and
// W2788/W2789 · PC-56 TENANT-8a.
//
// Runs only from the REVIEW step, and the review has already asked the API every question this action could ask — so it
// validates nothing beyond presence (6d-4's contract). The same body the review saw goes to the writer, which runs the
// same review and refuses with the same codes if anything changed underneath (a colleague's draft appeared, the event
// was locked) between the review and the click.
//
// THE IDEMPOTENCY-KEY IS THE FORM'S (F-17): minted when the review rendered, carried in a hidden input. A fresh key here
// would make a double-click two drafts — exactly what `/comms` did for broadcasts.
// SUCCESS drops the reason and the body from the URL: they are in the version and its audit row now.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/forms/chain';
import { MAX_CARRIED_LENGTH_OVERRIDE, NEW_OVERRIDE_HREF, OVERRIDE_FIELDS, TEMPLATES_HREF, templateHref } from '../../../../features/templates/override';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function saveOverrideDraftAction(formData: FormData): Promise<void> {
  await requireSession(NEW_OVERRIDE_HREF);
  const from = opt(formData.get('from'));
  const values: Record<string, string | undefined> = {};
  for (const f of OVERRIDE_FIELDS) values[f] = opt(formData.get(f));
  const carried = { ...values, from };
  if (!values.eventCode || !values.body) redirect(`${NEW_OVERRIDE_HREF}?${carryValues('review', carried, MAX_CARRIED_LENGTH_OVERRIDE).query}`);
  const key = opt(formData.get('idempotencyKey')) ?? randomUUID();

  let saved: { templateId: string; versionNo: number };
  try {
    saved = await tenantClient().notifications.saveTemplateDraft(values, key);
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'save') : 'save';
    redirect(`${NEW_OVERRIDE_HREF}?${carryValues('failure', carried, MAX_CARRIED_LENGTH_OVERRIDE).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(TEMPLATES_HREF); revalidatePath(templateHref(saved.templateId));
  redirect(`${NEW_OVERRIDE_HREF}?step=success&created=${encodeURIComponent(saved.templateId)}&version=${encodeURIComponent(String(saved.versionNo))}${from ? `&from=${encodeURIComponent(from)}` : ''}`);
}
