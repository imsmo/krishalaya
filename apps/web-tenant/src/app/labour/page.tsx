// apps/web-tenant/src/app/labour/page.tsx · the labour employer-admin console (P1-12). Server-first,
// requireSession-gated, behind the `labour` flag (NEXT_PUBLIC_FEATURE_LABOUR + the API's own flag). Sections —
// my bookings (+ post a booking), the worker roster (+ assign), and a selected booking's assignments with the
// per-day attendance dual-confirm + a payroll preview. Each section loads independently + degrades on its own
// (Law 12). Every write is a Server Action → the audited, RBAC-gated API, which owns the statutory min-wage
// floor, the state machines, and the wallet payout (Law 2/11). Money via formatMoneyMinor; all copy via i18n; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { env } from '../../lib/env';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { SKILL_LEVELS, WAGE_KINDS, bookingActions, previewPayrollMinor } from '../../features/labour/employer';
import {
  createBookingAction, assignWorkerAction, startBookingAction, completeBookingAction,
  cancelBookingAction, payWagesAction, confirmAttendanceAction,
} from './actions';
import type { LabourBooking, LabourAssignment, WorkerCard, LabourLookups } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('labour.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['booking', 'assigned', 'started', 'completed', 'cancelled', 'paid', 'confirmed']);

export default async function LabourPage({ searchParams }: { searchParams: { ok?: string; error?: string; booking?: string } }) {
  if (!env.featureLabour) notFound();
  await requireSession('/labour');
  const t = getTranslator();
  const lang = getLang();
  const selected = searchParams.booking || null;

  let bookings: LabourBooking[] = []; // P0-2: employer browse returns the consented marketplace CARD (WorkerCard), not the full WorkerProfile
  let workers: WorkerCard[] = []; let lookups: LabourLookups | null = null;
  let assignments: LabourAssignment[] = [];
  let bookingsFailed = false; let workersFailed = false; let lookupsFailed = false;
  const [bRes, wRes, lRes] = await Promise.allSettled([
    tenantClient().labour.listBookings({ box: 'mine', limit: 100 }),
    tenantClient().labour.listWorkers({ limit: 100 }),
    tenantClient().labour.lookups(),
  ]);
  if (bRes.status === 'fulfilled') bookings = bRes.value.items; else bookingsFailed = true;
  if (wRes.status === 'fulfilled') workers = wRes.value.items; else workersFailed = true;
  if (lRes.status === 'fulfilled') lookups = lRes.value; else lookupsFailed = true;
  if (selected) {
    try { assignments = (await tenantClient().labour.bookingAssignments(selected, { limit: 100 })).items; } catch { assignments = []; }
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error || null;
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);

  return (
    <section>
      <h1>{t.t('labour.title')}</h1>
      <p className="kv-muted">{t.t('labour.subtitle')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`labour.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t('labour.error')}: {errorKey}</p>}

      {/* ---- my bookings ---- */}
      <h2 className="kv-section-title">{t.t('labour.booking.title')}</h2>
      {bookingsFailed ? <p className="kv-error" role="alert">{t.t('labour.loadError')}</p> : (
        <DataTable
          rows={bookings}
          empty={t.t('labour.booking.empty')}
          columns={[
            { header: t.t('labour.booking.no'), cell: (b) => <Link href={`/labour?booking=${encodeURIComponent(b.id)}`}>{b.bookingNo}</Link> },
            { header: t.t('labour.booking.workers'), cell: (b) => `${b.workersNeeded}` },
            { header: t.t('labour.booking.dates'), cell: (b) => `${b.startDate}${b.endDate ? ` → ${b.endDate}` : ''}` },
            { header: t.t('labour.booking.wage'), cell: (b) => `${money(b.wageOfferedMinor)} (${t.t(`labour.wageKind.${b.wageKind}`)})` },
            { header: t.t('labour.status'), cell: (b) => <span className="kv-badge">{t.t(`labour.bookingStatus.${b.status}`)}</span> },
            { header: '', cell: (b) => (
              <span className="kv-actions">
                {bookingActions(b.status).map((a) => a === 'assign' ? (
                  <Link key={a} href={`/labour?booking=${encodeURIComponent(b.id)}`} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('labour.booking.assign')}</Link>
                ) : (
                  <form key={a} action={a === 'start' ? startBookingAction : a === 'complete' ? completeBookingAction : a === 'pay' ? payWagesAction : cancelBookingAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className={`kv-btn kv-btn--sm${a === 'cancel' ? ' kv-btn--muted' : ''}`}>{t.t(`labour.booking.${a}`)}</button>
                  </form>
                ))}
              </span>
            ) },
          ]}
        />
      )}
      <details className="kv-disclosure">
        <summary>{t.t('labour.booking.add')}</summary>
        {lookupsFailed || !lookups ? <p className="kv-error" role="alert">{t.t('labour.loadError')}</p> : (
          <form action={createBookingAction} className="kv-form kv-form--grid">
            <label className="kv-label">{t.t('labour.booking.demand')}
              <select className="kv-input" name="demandTypeCode" required defaultValue="">
                <option value="" disabled>{t.t('labour.booking.pickDemand')}</option>
                {lookups.workTypes.map((w) => <option key={w.id} value={w.code}>{w.name}</option>)}
              </select>
            </label>
            <label className="kv-label">{t.t('labour.booking.skill')}
              <select className="kv-input" name="taskSkillId" required defaultValue="">
                <option value="" disabled>{t.t('labour.booking.pickSkill')}</option>
                {lookups.skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="kv-label">{t.t('labour.booking.region')}
              <select className="kv-input" name="regionId" required defaultValue="">
                <option value="" disabled>{t.t('labour.booking.pickRegion')}</option>
                {lookups.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="kv-label">{t.t('labour.booking.level')}
              <select className="kv-input" name="skillLevel" defaultValue="unskilled">{SKILL_LEVELS.map((s) => <option key={s} value={s}>{t.t(`labour.level.${s}`)}</option>)}</select>
            </label>
            <label className="kv-label">{t.t('labour.booking.workers')}<input className="kv-input" name="workersNeeded" type="number" min={1} max={500} defaultValue={1} required /></label>
            <label className="kv-label">{t.t('labour.booking.startDate')}<input className="kv-input" name="startDate" type="date" required /></label>
            <label className="kv-label">{t.t('labour.booking.endDate')}<input className="kv-input" name="endDate" type="date" required /></label>
            <label className="kv-label">{t.t('labour.booking.wageKind')}
              <select className="kv-input" name="wageKind" defaultValue="per_day">{WAGE_KINDS.map((w) => <option key={w} value={w}>{t.t(`labour.wageKind.${w}`)}</option>)}</select>
            </label>
            <label className="kv-label">{t.t('labour.booking.wage')} ({t.t('labour.minor')})<input className="kv-input" name="wageOfferedMinor" inputMode="numeric" pattern="[0-9]*" required /></label>
            <label className="kv-label">{t.t('labour.booking.farmLat')}<input className="kv-input" name="farmLat" inputMode="decimal" required placeholder="22.30" /></label>
            <label className="kv-label">{t.t('labour.booking.farmLng')}<input className="kv-input" name="farmLng" inputMode="decimal" required placeholder="70.80" /></label>
            <p className="kv-fine kv-muted">{t.t('labour.booking.wageNote')}</p>
            <button type="submit" className="kv-btn">{t.t('labour.booking.post')}</button>
          </form>
        )}
      </details>

      {/* ---- worker roster + assign ---- */}
      <h2 className="kv-section-title">{t.t('labour.worker.title')}</h2>
      {workersFailed ? <p className="kv-error" role="alert">{t.t('labour.loadError')}</p> : (
        <DataTable
          rows={workers}
          empty={t.t('labour.worker.empty')}
          columns={[
            { header: t.t('labour.worker.id'), cell: (w) => <code className="kv-code kv-code--inline">{w.id}</code> },
            { header: t.t('labour.worker.verified'), cell: (w) => w.ageVerified ? t.t('labour.worker.yes') : t.t('labour.worker.no') },
            { header: t.t('labour.worker.completed'), cell: (w) => `${w.bookingsCompleted ?? 0}` },
            { header: t.t('labour.worker.rating'), cell: (w) => w.ratingAvg != null ? w.ratingAvg.toFixed(1) : t.t('common.dash') },
          ]}
        />
      )}
      <details className="kv-disclosure">
        <summary>{t.t('labour.assign.title')}</summary>
        <form action={assignWorkerAction} className="kv-form kv-form--grid">
          <label className="kv-label">{t.t('labour.booking.title')}
            <select className="kv-input" name="bookingId" required defaultValue={selected ?? ''}>
              <option value="" disabled>{t.t('labour.assign.pickBooking')}</option>
              {bookings.filter((b) => b.status === 'open').map((b) => <option key={b.id} value={b.id}>{b.bookingNo}</option>)}
            </select>
          </label>
          <label className="kv-label">{t.t('labour.worker.title')}
            <select className="kv-input" name="workerId" required defaultValue="">
              <option value="" disabled>{t.t('labour.assign.pickWorker')}</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.id}</option>)}
            </select>
          </label>
          <label className="kv-label">{t.t('labour.assign.wageOverride')} ({t.t('labour.minor')})<input className="kv-input" name="wageMinor" inputMode="numeric" pattern="[0-9]*" placeholder={t.t('labour.assign.wageOptional')} /></label>
          <button type="submit" className="kv-btn">{t.t('labour.assign.assign')}</button>
        </form>
      </details>

      {/* ---- selected booking: assignments + attendance confirm ---- */}
      {selected && (
        <>
          <h2 className="kv-section-title">{t.t('labour.assignments.title')}</h2>
          <p className="kv-muted kv-fine">{t.t('labour.assignments.payroll')}: <strong>{money(previewPayrollMinor(assignments))}</strong> · <Link href="/labour">{t.t('labour.assignments.clear')}</Link></p>
          <DataTable
            rows={assignments}
            empty={t.t('labour.assignments.empty')}
            columns={[
              { header: t.t('labour.worker.id'), cell: (a) => <code className="kv-code kv-code--inline">{a.workerId}</code> },
              { header: t.t('labour.assignments.wage'), cell: (a) => money(a.wageMinor) },
              { header: t.t('labour.status'), cell: (a) => <span className="kv-badge">{t.t(`labour.assignStatus.${a.status}`)}</span> },
            ]}
          />
          <details className="kv-disclosure">
            <summary>{t.t('labour.attendance.title')}</summary>
            <p className="kv-fine kv-muted">{t.t('labour.attendance.help')}</p>
            <form action={confirmAttendanceAction} className="kv-form kv-form--grid">
              <label className="kv-label">{t.t('labour.attendance.assignment')}
                <select className="kv-input" name="assignmentId" required defaultValue="">
                  <option value="" disabled>{t.t('labour.attendance.pickAssignment')}</option>
                  {assignments.filter((a) => a.status === 'accepted').map((a) => <option key={a.id} value={a.id}>{a.workerId}</option>)}
                </select>
              </label>
              <label className="kv-label">{t.t('labour.attendance.date')}<input className="kv-input" name="workDate" type="date" required /></label>
              <button type="submit" className="kv-btn">{t.t('labour.attendance.confirm')}</button>
            </form>
          </details>
        </>
      )}
    </section>
  );
}
