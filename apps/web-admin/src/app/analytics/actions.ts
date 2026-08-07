'use server';
// apps/web-admin/src/app/analytics/actions.ts · PC-56 ADMIN-10.
//
// **A REPORT RUN IS A POST, AND W111 MODELS IT AS ONE TOO** (`Run report` carries `chain-mutate:report`). It writes no
// business row, and it is a bounded, timed-out, audited scan of production tables — a deliberate act rather than a
// navigation, and the audit trail should be able to say who asked for it.
//
// THE EXPORT IS A SEPARATE PERMISSION AND A SEPARATE ACTION. Reading a figure and walking out with the file are
// different acts: `analytics.read` for one, `analytics.export` for the other, exactly as W111's restricted state says.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../lib/admin-client';

function apiErrorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'permission';
    if (e.status === 409) return 'conflict';
    if (e.status === 422) return 'invalid';
    if (e.status === 404) return 'notFound';
    // A statement timeout surfaces as a 500 from the driver. W111's own copy tells the operator which lever to pull:
    // "Narrow the date range or drop a dimension."
    if (e.status >= 500) return 'timeout';
  }
  return 'generic';
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

/** A date input yields `2026-08-07`; the API wants an instant. Midnight UTC at both ends, so a range means whole days
 *  and two operators in two timezones get the same report from the same inputs. */
const asInstant = (d: string, endOfDay = false) =>
  new Date(`${d}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`).toISOString();

export async function runReportAction(formData: FormData): Promise<void> {
  requireAdmin();
  const metric = str(formData, 'metric');
  const bucket = str(formData, 'bucket') || 'day';
  const from = str(formData, 'from');
  const to = str(formData, 'to');
  if (!metric || !from || !to) redirect('/analytics/reports?error=invalid');
  try {
    await adminPost('reports/builder/run', {
      body: { metric, bucket, from: asInstant(from), to: asInstant(to, true) },
    });
  } catch (e) { redirect(`/analytics/reports?error=${apiErrorKey(e)}`); }
  revalidatePath('/analytics/reports');
  redirect('/analytics/reports?ok=ran');
}

export async function saveReportAction(formData: FormData): Promise<void> {
  requireAdmin();
  const slug = str(formData, 'slug');
  const title = str(formData, 'title');
  const metric = str(formData, 'metric');
  const windowDays = Number(str(formData, 'windowDays') || '30');
  if (!slug || !title || !metric) redirect('/analytics/reports?error=invalid');
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 366) {
    redirect('/analytics/reports?error=window');
  }
  try {
    await adminPost('reports/builder/saved', { body: { slug, title, metric, windowDays } });
  } catch (e) { redirect(`/analytics/reports?error=${apiErrorKey(e)}`); }
  revalidatePath('/analytics/reports');
  redirect('/analytics/reports?ok=saved');
}

/** Archive, never delete: a schedule points at the slug by name, and the response names the schedules that will now
 *  fail — so the operator learns it here rather than when a board pack stops arriving. */
export async function archiveSavedAction(formData: FormData): Promise<void> {
  requireAdmin();
  const slug = str(formData, 'slug');
  if (!slug) redirect('/analytics/reports');
  try {
    await adminPost(`reports/builder/saved/${encodeURIComponent(slug)}/archive`, { body: {} });
  } catch (e) { redirect(`/analytics/reports?error=${apiErrorKey(e)}`); }
  revalidatePath('/analytics/reports');
  redirect('/analytics/reports?ok=archived');
}

/**
 * Generate the export. **SYNCHRONOUS, AND THE STATE PAGE SAYS SO.** W2126 promises "this job is queued with a position
 * and ETA"; a queue with a position nothing enqueues into would be the seventh status-recording-an-act-nobody-performs
 * on this platform (ADMIN-10-Q1).
 */
export async function exportReportAction(formData: FormData): Promise<void> {
  requireAdmin();
  const metric = str(formData, 'metric');
  const bucket = str(formData, 'bucket') || 'day';
  const from = str(formData, 'from');
  const to = str(formData, 'to');
  if (!metric || !from || !to) redirect('/analytics/exports?error=invalid');
  try {
    await adminPost('reports/builder/export', {
      body: { metric, bucket, from: asInstant(from), to: asInstant(to, true) },
    });
  } catch (e) { redirect(`/analytics/exports?error=${apiErrorKey(e)}`); }
  revalidatePath('/analytics/exports');
  redirect('/analytics/exports?ok=exported');
}
