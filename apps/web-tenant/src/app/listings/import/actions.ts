'use server';
// apps/web-tenant/src/app/listings/import/actions.ts · W128's three acts (PC-56 TENANT-2c).
//
// Validate, confirm, cancel — the SAME rail W156's member import walks (core/bulk's state machine), so `validated →
// processing` cannot happen twice and a nervous operator's double click reports "already running" rather than
// creating 46 drafts twice. Re-authorised server-side within the caller's own tenant (`bulk.import`, Law 11).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';

const PATH = '/listings/import';

function keyFor(e: unknown, fallback: string): string {
  if (e instanceof SdkError) {
    if (e.status === 409) return 'confirm';
    if (e.status === 422) return 'notValidatable';
    if (typeof e.message === 'string' && /changed after it was validated/i.test(e.message)) return 'changed';
  }
  return fallback;
}

function isRedirect(e: unknown): boolean {
  return typeof (e as { digest?: unknown })?.digest === 'string'
    && String((e as { digest: string }).digest).startsWith('NEXT_REDIRECT');
}

async function jobIdFrom(formData: FormData): Promise<string> {
  await requireSession(PATH);
  const id = String(formData.get('jobId') ?? '').trim();
  if (!id) redirect(PATH);
  return id;
}

export async function validateListingJobAction(formData: FormData): Promise<void> {
  const id = await jobIdFrom(formData);
  try {
    const res = await tenantClient().bulkImports.validate(id);
    revalidatePath(PATH);
    // A validation that FAILED is not a success with a sad report — the file could not be read at all.
    redirect(`${PATH}?${res.status === 'failed' ? 'error=failed' : 'ok=validated'}`);
  } catch (e) { if (isRedirect(e)) throw e; redirect(`${PATH}?error=${keyFor(e, 'validate')}`); }
}

export async function confirmListingJobAction(formData: FormData): Promise<void> {
  const id = await jobIdFrom(formData);
  try { await tenantClient().bulkImports.confirm(id); revalidatePath(PATH); redirect(`${PATH}?ok=confirmed`); }
  catch (e) { if (isRedirect(e)) throw e; redirect(`${PATH}?error=${keyFor(e, 'confirm')}`); }
}

export async function cancelListingJobAction(formData: FormData): Promise<void> {
  const id = await jobIdFrom(formData);
  try { await tenantClient().bulkImports.cancel(id); revalidatePath(PATH); redirect(`${PATH}?ok=cancelled`); }
  catch (e) { if (isRedirect(e)) throw e; redirect(`${PATH}?error=${keyFor(e, 'cancel')}`); }
}
