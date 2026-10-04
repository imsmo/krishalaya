'use server';
// apps/web-tenant/src/app/insights/governance/agm/actions.ts · W199 "AGM pack" — PC-56 TENANT-SW-d. Draft a pack for an ENDED fiscal
// year (the API assembles every section from facts — a figure only where a method meets a fact; the rest refused by name) and land on
// the pack. A refusal (FY not ended, basis undeclared, a pack already for that year) comes back to the overview as a sentence.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { AGM_HREF, agmPackHref, isIdemKey, isUuid } from '../../../../features/swd/console';
import { codesFrom } from '../../../../features/swc/console';

const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return codesFrom(err?.code, err?.status, err?.details); };

export async function draftAgmPackAction(formData: FormData): Promise<void> {
  await requireSession(AGM_HREF);
  const fyStartYear = Number(String(formData.get('fyStartYear') ?? ''));
  const lang = String(formData.get('secondLanguage') ?? '');
  const media = formData.getAll('auditorMediaId').map((x) => String(x).trim()).find(Boolean) ?? '';
  const key = String(formData.get('key') ?? '');
  if (!Number.isInteger(fyStartYear) || (lang !== 'hi' && lang !== 'gu') || (media && !isUuid(media))) redirect(`${AGM_HREF}?error=VALIDATION_FAILED`);
  let id: string;
  try {
    id = (await tenantClient().agmPacks.draft({ fyStartYear, secondLanguage: lang as 'hi', ...(media ? { auditorMediaId: media } : {}) }, isIdemKey(key) ? key : randomUUID())).id;
  } catch (e) { redirect(`${AGM_HREF}?fy=${fyStartYear}&error=${encodeURIComponent(codesOf(e).join(','))}`); }
  revalidatePath(AGM_HREF);
  redirect(agmPackHref(id));
}
