'use server';
// apps/web-tenant/src/app/people/import/actions.ts · W156's three acts (PC-56 TENANT-1b-4).
//
// Validate, confirm, cancel. Each re-authorised server-side within the caller's own tenant (`bulk.import` — NOT god-mode,
// Law 11).
//
// **THE CONFIRM IS DELIBERATELY NOT MADE RETRY-SAFE IN THE UI, BECAUSE THE STATE MACHINE ALREADY IS.** `validated →
// processing` cannot happen twice, so a double click on a slow connection — which is exactly what a nervous operator
// produces — reports "already running" rather than importing 214 people twice.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';

const PATH = '/people/import';

function keyFor(e: unknown, fallback: string): string {
  if (e instanceof SdkError) {
    // 409 from the state machine = somebody already moved this job on. 422 = this import type has no validator.
    if (e.status === 409) return 'confirm';
    if (e.status === 422) return 'notValidatable';
    // The file was swapped in the object store between the validation and the confirm. Its own message, because "please
    // upload and validate it again" is the only useful instruction and a generic failure would not say it.
    if (typeof e.message === 'string' && /changed after it was validated/i.test(e.message)) return 'changed';
  }
  return fallback;
}

async function jobIdFrom(formData: FormData): Promise<string> {
  await requireSession(PATH);
  const id = String(formData.get('jobId') ?? '').trim();
  if (!id) redirect(PATH);
  return id;
}

export async function validateJobAction(formData: FormData): Promise<void> {
  const id = await jobIdFrom(formData);
  try {
    const res = await tenantClient().bulkImports.validate(id);
    revalidatePath(PATH);
    // **A VALIDATION THAT FAILED IS NOT A SUCCESS WITH A SAD REPORT.** The file could not be read at all — wrong format,
    // missing columns, unreachable object — and reporting it as "validated" would leave the operator hunting for a triage
    // that does not exist.
    redirect(`${PATH}?${res.status === 'failed' ? 'error=failed' : 'ok=validated'}`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    redirect(`${PATH}?error=${keyFor(e, 'validate')}`);
  }
}

export async function confirmJobAction(formData: FormData): Promise<void> {
  const id = await jobIdFrom(formData);
  try {
    await tenantClient().bulkImports.confirm(id);
    revalidatePath(PATH);
    redirect(`${PATH}?ok=confirmed`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    redirect(`${PATH}?error=${keyFor(e, 'confirm')}`);
  }
}

export async function cancelJobAction(formData: FormData): Promise<void> {
  const id = await jobIdFrom(formData);
  try {
    await tenantClient().bulkImports.cancel(id);
    revalidatePath(PATH);
    redirect(`${PATH}?ok=cancelled`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    redirect(`${PATH}?error=${keyFor(e, 'cancel')}`);
  }
}

/** Next signals a redirect by THROWING, so a catch-all around `redirect()` swallows the navigation and turns a success into
 *  an error banner. Checked explicitly rather than by ordering the code carefully and hoping. */
function isRedirect(e: unknown): boolean {
  return typeof (e as { digest?: unknown })?.digest === 'string'
    && String((e as { digest: string }).digest).startsWith('NEXT_REDIRECT');
}
