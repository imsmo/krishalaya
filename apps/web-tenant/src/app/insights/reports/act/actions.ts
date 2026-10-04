'use server';
// apps/web-tenant/src/app/insights/reports/act/actions.ts · W2738 → W2739 / W2740 — the report builder's acts (PC-56 TENANT-SW-f):
// run · save definition · schedule · archive · unschedule. The API owns every wall (allow-list, ≤ 92 days, the auditor's realm, platform
// rows read-only); the console carries what was confirmed. ARCHIVE and UNSCHEDULE act on a row that exists, so they VERIFY BEFORE WRITE:
// the confirm step carried what it showed (`kv_seen`), the action re-reads the row now, and a row that moved is refused STALE_ROW with
// the diff — nothing written (features/mutate/verify).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { REPORTS_HREF, daysInclusive, isReportAct, isUuid, keyList } from '../../../../features/swf/console';
import { SEEN_FIELD, staleHref, verifyBeforeWrite } from '../../../../features/mutate/verify';

export async function reportActAction(formData: FormData): Promise<void> {
  const base = `${REPORTS_HREF}/act`;
  await requireSession(base);
  const f = (k: string) => String(formData.get(k) ?? '').trim();
  const act = f('act');
  if (!isReportAct(act)) redirect(REPORTS_HREF);
  const carry: Record<string, string> = { act, def: f('def'), sched: f('sched'), dataset: f('dataset'), from: f('from'), to: f('to'), title: f('title'), reason: f('reason'),
    cadence: f('cadence'), weekday: f('weekday'), monthDay: f('monthDay'), time: f('time'), dims: keyList(formData.getAll('dims') as string[]).join(','), measures: keyList(formData.getAll('measures') as string[]).join(','),
    roles: keyList(formData.getAll('roles') as string[]).join(',') };
  const q = (extra: Record<string, string>) => new URLSearchParams(Object.fromEntries(Object.entries({ ...carry, ...extra }).filter(([, v]) => v !== ''))).toString();
  const key = f('key') || randomUUID();
  const c = tenantClient();
  let done: Record<string, string> = {};
  try {
    if (act === 'run') {
      const r = await c.reports.requestRun(isUuid(carry.def) ? { definitionId: carry.def, ...(carry.from && carry.to ? { from: carry.from, to: carry.to } : {}) }
        : { datasetCode: carry.dataset, dimensions: carry.dims ? carry.dims.split(',') : [], measures: carry.measures ? carry.measures.split(',') : [], from: carry.from, to: carry.to }, key);
      done = { run: r.id };
    } else if (act === 'save') {
      const r = await c.reports.saveDefinition({ title: carry.title, datasetCode: carry.dataset, dimensions: carry.dims ? carry.dims.split(',') : [], measures: carry.measures ? carry.measures.split(',') : [],
        rangeDays: carry.from && carry.to ? daysInclusive(carry.from, carry.to) : 30 }, key);
      done = { saved: r.id };
    } else if (act === 'schedule') {
      const r = await c.reports.createSchedule({ definitionId: carry.def, cadence: carry.cadence as 'daily' | 'weekly' | 'monthly', weekdayIso: carry.cadence === 'weekly' ? Number(carry.weekday) : null,
        monthDay: carry.cadence === 'monthly' ? Number(carry.monthDay) : null, timeIst: carry.time, recipientRoles: carry.roles ? carry.roles.split(',') : [] }, key);
      done = { next: r.nextRunAt };
    } else if (act === 'archive') {
      const v = await verifyBeforeWrite(formData.get(SEEN_FIELD), async () => (await c.reports.definition(carry.def)) as never);
      if (!v.ok) redirect(staleHref(base, carry, v));
      await c.reports.archiveDefinition(carry.def, carry.reason, key);
    } else {
      const v = await verifyBeforeWrite(formData.get(SEEN_FIELD), async () => ((await c.reports.schedules({ limit: 100 })).items.find((s) => s.id === carry.sched) ?? null) as never);
      if (!v.ok) redirect(staleHref(base, carry, v));
      await c.reports.deactivateSchedule(carry.sched, carry.reason, key);
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e && String((e as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) throw e;
    redirect(`${base}?${q({ step: 'failure', error: e instanceof SdkError ? (e.code || 'unknown') : 'unknown' })}`);
  }
  revalidatePath(REPORTS_HREF);
  redirect(`${base}?${q({ step: 'success', ...done })}`);
}
