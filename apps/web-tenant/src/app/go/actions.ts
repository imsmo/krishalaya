'use server';
// apps/web-tenant/src/app/go/actions.ts · W2619–W2625 "Book a setup call (free)" — PC-56 TENANT-SW-d. The form chain (W2619 form-error →
// W2620 review → W2621 success / W2622 failure) and the mutate chain for CANCEL (W2623 confirm → W2624 / W2625). The review carries the
// values in the URL (nothing secret: a date, two times, a language, a note); the write takes the review's Idempotency-Key.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { GO_HREF, SETUP_CALL_LANGUAGES, isIdemKey, isUuid, slotFormProblem } from '../../features/swd/console';
import { codesFrom } from '../../features/swc/console';

const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return codesFrom(err?.code, err?.status, err?.details); };
const str = (f: FormData, k: string, max = 500) => String(f.get(k) ?? '').trim().slice(0, max);
function values(f: FormData) {
  const lang = str(f, 'languageCode', 4);
  return { date: str(f, 'date', 10), from: str(f, 'from', 5), to: str(f, 'to', 5), languageCode: (SETUP_CALL_LANGUAGES as readonly string[]).includes(lang) ? lang : 'en', notes: str(f, 'notes', 500) };
}

/** W2620: judge the form (every problem named) → the review, or back to the form with the values kept (W2619). */
export async function reviewSetupCallAction(formData: FormData): Promise<void> {
  await requireSession(GO_HREF);
  const v = values(formData);
  const problem = slotFormProblem(v.date, v.from, v.to);
  const q = new URLSearchParams({ ...v, step: problem ? 'form-error' : 'review', ...(problem ? { problem } : { key: randomUUID() }) });
  redirect(`${GO_HREF}?${q.toString()}`);
}

/** W2620 → W2621 / W2622: the request (one open per organisation — the API and its index). */
export async function requestSetupCallAction(formData: FormData): Promise<void> {
  await requireSession(GO_HREF);
  const v = values(formData);
  const k = str(formData, 'key', 120);
  try {
    await tenantClient().setupCalls.request({ date: v.date, from: v.from, to: v.to, languageCode: v.languageCode as 'en', ...(v.notes ? { notes: v.notes } : {}) }, isIdemKey(k) ? k : randomUUID());
  } catch (e) { redirect(`${GO_HREF}?${new URLSearchParams({ ...v, step: 'failure', error: codesOf(e).join(',') }).toString()}`); }
  revalidatePath(GO_HREF);
  redirect(`${GO_HREF}?step=success`);
}

/** W2623 → W2624 / W2625: cancel the open request, with a reason. */
export async function cancelSetupCallAction(formData: FormData): Promise<void> {
  await requireSession(GO_HREF);
  const id = str(formData, 'id', 40);
  const base = `${GO_HREF}?act=cancel&id=${encodeURIComponent(id)}`;
  if (!isUuid(id)) redirect(`${base}&step=failure&error=SETUP_CALL_NOT_FOUND`);
  try { await tenantClient().setupCalls.cancel(id, str(formData, 'reason', 300)); }
  catch (e) { redirect(`${base}&step=failure&error=${encodeURIComponent(codesOf(e).join(','))}`); }
  revalidatePath(GO_HREF);
  redirect(`${base}&step=success`);
}
