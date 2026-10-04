'use server';
// apps/web-tenant/src/app/governance/register/import/actions.ts · W2626 "Import the share register" — PC-56 TENANT-SW-d. Upload the CSV
// (a file, or the text pasted) WITH the consent evidence (a board resolution or an attestation — required, refused by name without it).
// The API validates every line at once (member match by phone, duplicates against the register and within the file, numbers) and the
// person lands on the line-by-line preview. Nothing touches the register until a SECOND tenant_admin confirms.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { IMPORT_MAX_BYTES, REGISTER_IMPORT_HREF, importHref, isConsentKind, isIdemKey, isUuid } from '../../../../features/swd/console';
import { codesFrom } from '../../../../features/swc/console';

const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return codesFrom(err?.code, err?.status, err?.details); };
const fail = (codes: string) => redirect(`${REGISTER_IMPORT_HREF}?error=${encodeURIComponent(codes)}`);

export async function uploadImportAction(formData: FormData): Promise<void> {
  await requireSession(REGISTER_IMPORT_HREF);
  const file = formData.get('file');
  let csv = '';
  if (file && typeof file === 'object' && 'size' in file && (file as File).size > 0) {
    if ((file as File).size > IMPORT_MAX_BYTES) fail('IMPORT_FILE_TOO_LARGE');
    csv = await (file as File).text();
  } else csv = String(formData.get('csv') ?? '');
  if (!csv.trim()) fail('IMPORT_FILE_EMPTY');
  if (Buffer.byteLength(csv, 'utf8') > IMPORT_MAX_BYTES) fail('IMPORT_FILE_TOO_LARGE');
  const consentMediaId = formData.getAll('consentMediaId').map((x) => String(x).trim()).find(Boolean) ?? '';
  const consentKind = String(formData.get('consentKind') ?? '');
  if (!isUuid(consentMediaId)) fail('IMPORT_CONSENT_REQUIRED');
  if (!isConsentKind(consentKind)) fail('VALIDATION_FAILED');
  const k = String(formData.get('key') ?? '');
  let id = '';
  try { id = (await tenantClient().registerImports.upload({ csv, consentMediaId, consentKind: consentKind as 'attestation' }, isIdemKey(k) ? k : randomUUID())).id; }
  catch (e) { fail(codesOf(e).join(',')); }
  revalidatePath(REGISTER_IMPORT_HREF);
  redirect(importHref(id));
}
