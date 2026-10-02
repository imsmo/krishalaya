// apps/web-tenant/src/app/ops/labour/[id]/page.tsx · W164 · JOB DETAIL & ROSTER · PC-56 TENANT-11b.
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • header facts from GET /labour/bookings/:id: employer · starts <date> <time>, N days · wage /unit (floor) · daily hours ·
//     OT × · declarations · respond by — every one the API's;
//   • "Confirm roster" → the mutate chain (W2654 confirm shows the escrow + fee the act will set aside, and the refusal with the
//     shortfall when the employer's wallet cannot cover it); start / complete / pay / confirm a day are the same chain;
//   • "Broadcast to crews (Gujarati voice)" — REFUSED BY NAME (no crew object); "Widen radius" and invite fan-out — not built;
//   • the roster (booking_assignments): worker as a SHORT name + MASKED phone, status, confirmed days, planned / paid / awaiting —
//     "Skill match" and "Distance" are refused by name (no skill-rating or geo join is recorded for a worker);
//   • the cost lines: workers × days × rate, the platform fee (flat ₹20; the "₹100 cap rule" printed as NOT SET), the employer
//     total — and, once confirmed, the REAL escrow from the ledger-of-record row (held / paid / topped up / returned);
//   • dignity lines: each declaration real or "not declared"; the pay rule as it is (paid when the employer confirms each day
//     and the desk / employer runs pay — not "within 24 h", which no clock enforces);
//   • "Cancel job" → the form chain W2650–W2653 (reason lookup + text; workers told; escrow back; the FEE IS KEPT, said); the
//     same-day fairness fee is REFUSED BY NAME;
//   • states: content, Loading, Flagged off, Job not found, Couldn't load roster (distinct from "No workers assigned yet"),
//     Roster restricted (403).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { LabourAssignment, LabourBooking, LabourDay, WorkerCard } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import {
  DECLARATIONS, LABOUR_HREF, actHref, assignmentStatusKey, cancelHref, consoleState, detailActs, isUuid, perKey, plannedDays, statusKey, wageKindKey,
} from '../../../../features/labour/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('lab.detail.title'), robots: { index: false, follow: false } };
}

export default async function JobDetailPage({ params }: { params: { id: string } }) {
  const base = `${LABOUR_HREF}/${encodeURIComponent(params.id)}`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const n = (v: number) => formatNumber(v, lang);
  const day = (ymd: string) => formatDate(`${ymd}T00:00:00+05:30`, lang, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const when = (iso: string) => formatDate(iso, lang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const crumbs = (no?: string) => (
    <nav className="kv-breadcrumb" aria-label={t.t('lab.breadcrumb')}>
      <span>{t.t('lab.breadcrumb.operations')}</span> / <Link href={LABOUR_HREF}>{t.t('lab.breadcrumb.labour')}</Link> / <span aria-current="page">{no ?? t.t('lab.detail.title')}</span>
    </nav>
  );
  const notice = (key: string, alert = false, retry = false) => (
    <section>{crumbs()}<h1>{t.t('lab.detail.title')}</h1>
      <div className={alert ? 'kv-error' : 'kv-card kv-card--notice'} role={alert ? 'alert' : 'status'}><strong>{t.t(`${key}.title`)}</strong><p>{t.t(`${key}.body`)}</p>
        {retry && <p><Link href={base} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('lab.retry')}</Link></p>}
        <p><Link href={LABOUR_HREF} className="kv-btn--link">{t.t('lab.detail.back')}</Link></p></div></section>
  );
  if (!env.featureLabour) return notice('lab.detail.state.flaggedOff');
  if (!isUuid(params.id)) return notice('lab.detail.state.notFound');

  let b: LabourBooking | null = null;
  try { b = await tenantClient().labour.getBooking(params.id); }
  catch (e) {
    const err = e instanceof SdkError ? e : null; const s = consoleState(err?.code, err?.status, true, err?.details);
    return notice(`lab.detail.state.${s}`, s === 'error', s === 'error');
  }
  let roster: LabourAssignment[] = []; let rosterState: string | null = null;
  try { roster = (await tenantClient().labour.bookingAssignments(params.id, { limit: 100 })).items; }
  catch (e) { const err = e instanceof SdkError ? e : null; rosterState = consoleState(err?.code, err?.status); }
  // the per-day confirm list for each accepted worker (employer / desk), only while days can still be confirmed
  const days = new Map<string, LabourDay[]>();
  if (!rosterState && (b.status === 'in_progress' || b.status === 'completed')) {
    await Promise.all(roster.filter((a) => a.status === 'accepted' || a.status === 'paid').map(async (a) => {
      try { days.set(a.id, await tenantClient().labour.assignmentDays(a.id)); } catch { /* the row says the days could not be read */ }
    }));
  }
  // the worker pool for "Assign a worker" (open jobs only)
  let pool: WorkerCard[] | null = null;
  if (b.status === 'open' && b.viewerCan?.assign) { try { pool = (await tenantClient().labour.listWorkers({ ageVerified: true, limit: 25 })).items; } catch { pool = null; } }

  const span = b.endDate ? plannedDays(b.startDate, b.endDate) : 1;
  const d = b.declarations;
  const acts = detailActs(b.viewerCan);
  const accepted = roster.filter((a) => a.status === 'accepted' || a.status === 'paid').length;
  const open = Math.max(0, b.workersNeeded - accepted);
  const cp = b.costPreview;
  const esc = b.escrow;

  return (
    <section>
      {crumbs(b.bookingNo)}
      <div className="kv-page-head">
        <h1>{[b.taskName ?? t.t('lab.taskUnnamed'), b.villageLabel].filter(Boolean).join(' — ')}</h1>
        <p className="kv-actions">
          {acts.map((a) => <Link key={a} href={actHref(b!.id, a)} className={a === 'confirmRoster' || a === 'pay' ? 'kv-btn kv-btn--primary' : 'kv-btn'}>{t.t(`lab.act.${a}`)}</Link>)}{' '}
          <span className="kv-btn kv-btn--muted" aria-disabled="true">{t.t('lab.broadcast')}</span>
        </p>
      </div>
      <p>{t.t(statusKey(b.status))} · {t.t('lab.detail.filledOf', { filled: n(accepted), needed: n(b.workersNeeded) })}</p>
      <p className="kv-field__hint">{t.t('lab.broadcast.refused')}</p>
      <p className="kv-card">
        {[b.bookingNo, b.employerName ?? t.t('lab.employerUnnamed'),
          t.t('lab.detail.starts', { date: day(b.startDate), time: b.startTime ?? t.t('lab.detail.timeUnset'), days: n(span) }),
          `${t.t(perKey(b.wageKind), { amount: money(b.wageOfferedMinor) })} (${t.t('lab.floor', { amount: money(b.minWageMinor) })})`,
          t.t('lab.detail.hours', { h: String(b.dailyHours ?? 8) }), t.t('lab.detail.ot', { x: String(b.overtimeRateMultiplier ?? 1.5) }),
          t.t(wageKindKey(b.wageKind)),
          ...(b.womenOnly ? [t.t('lab.type.womenOnly')] : []),
          ...(d?.transport ? [t.t('lab.type.transport')] : []), ...(d?.toilet ? [t.t('lab.type.toilet')] : []),
          b.respondBy ? t.t('lab.detail.respondBy', { at: when(b.respondBy) }) : t.t('lab.detail.noRespondBy')].join(' · ')}
        {b.onBehalf && <><br /><span className="kv-field__hint">{t.t('lab.detail.postedByDesk')}</span></>}
      </p>

      <h2>{t.t('lab.roster.title')}</h2>
      {rosterState ? (
        <div className={rosterState === 'restricted' ? 'kv-card kv-card--notice' : 'kv-error'} role={rosterState === 'restricted' ? 'status' : 'alert'}>
          <strong>{t.t(`lab.roster.state.${rosterState === 'restricted' ? 'restricted' : 'error'}.title`)}</strong>
          <p>{t.t(`lab.roster.state.${rosterState === 'restricted' ? 'restricted' : 'error'}.body`)}</p>
          {rosterState !== 'restricted' && <p><Link href={base} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('lab.retry')}</Link></p>}
        </div>
      ) : roster.length === 0 ? (
        <div className="kv-card"><strong>{t.t('lab.roster.empty.title')}</strong><p className="kv-detail__muted">{t.t('lab.roster.empty.body')}</p></div>
      ) : (
        <table className="kv-table">
          <caption className="kv-detail__muted">{t.t('lab.roster.summary', { accepted: n(accepted), total: n(roster.length), open: n(open) })}</caption>
          <thead><tr>
            <th scope="col">{t.t('lab.roster.col.worker')}</th><th scope="col">{t.t('lab.roster.col.status')}</th><th scope="col">{t.t('lab.roster.col.days')}</th>
            <th scope="col">{t.t('lab.roster.col.owed')}</th><th scope="col">{t.t('lab.roster.col.match')}</th>
          </tr></thead>
          <tbody>{roster.map((a) => (
            <tr key={a.id}>
              <th scope="row">{a.workerShortName ?? t.t('lab.roster.nameUnknown')}<div className="kv-field__hint">{a.workerPhoneMasked ?? t.t('lab.roster.phoneUnknown')}</div></th>
              <td>{t.t(assignmentStatusKey(a.status))}{a.zeroReason && <div className="kv-field__hint">{t.t(`lab.zero.${a.zeroReason}`)}</div>}</td>
              <td>{t.t('lab.roster.daysLine', { confirmed: n(a.confirmedDays ?? 0), awaiting: n(a.awaitingConfirmDays ?? 0), paid: n(a.paidDays ?? 0) })}
                {(days.get(a.id) ?? []).filter((x) => x.status === 'clocked_out').map((x) => (
                  <div key={x.id}><Link href={actHref(b!.id, 'confirmDay', { assignmentId: a.id, workDate: x.workDate })} className="kv-btn--link">{t.t('lab.roster.confirmDay', { date: day(x.workDate) })}</Link></div>
                ))}</td>
              <td>{t.t('lab.roster.owedLine', { planned: money(a.plannedMinor), paid: money(a.paidMinor) })}
                {a.awaitingTopupMinor && a.awaitingTopupMinor !== '0' && <div className="kv-field__hint">{t.t('lab.roster.awaitingTopup', { amount: money(a.awaitingTopupMinor) })}</div>}</td>
              <td className="kv-field__hint">{t.t('lab.roster.matchRefused')}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {b.status === 'open' && b.viewerCan?.assign && (
        <div className="kv-card">
          <h3>{t.t('lab.assign.title')}</h3>
          {pool === null ? <p className="kv-field__hint">{t.t('lab.assign.poolError')}</p> : pool.length === 0 ? <p className="kv-field__hint">{t.t('lab.assign.poolEmpty')}</p> : (
            <ul className="kv-list">{pool.filter((w) => !roster.some((a) => a.workerId === w.id)).slice(0, 12).map((w) => (
              <li key={w.id}><Link href={actHref(b!.id, 'assign', { workerId: w.id })} className="kv-link">{w.displayName ?? t.t('lab.assign.anon', { ref: w.id.slice(0, 6).toUpperCase() })}</Link></li>
            ))}</ul>
          )}
          <p className="kv-field__hint">{t.t('lab.assign.radiusRefused')}</p>
        </div>
      )}

      {cp && (
        <div className="kv-card">
          <h2>{t.t('lab.cost.title', { days: n(cp.days) })}</h2>
          <p>{t.t('lab.cost.wages', { workers: n(cp.workers), days: n(cp.days), rate: t.t(perKey(b.wageKind), { amount: money(cp.rateMinor) }), amount: money(cp.wagesMinor) })}</p>
          <p>{t.t('lab.cost.fee', { amount: money(cp.platformFeeMinor) })} <span className="kv-field__hint">{cp.feeRule?.capMinor ? t.t('lab.cost.capSet', { cap: money(cp.feeRule.capMinor) }) : t.t('lab.cost.capNotSet')}</span></p>
          <p><strong>{t.t('lab.cost.total', { amount: money(cp.employerTotalMinor) })}</strong></p>
          {esc ? (
            <p>{t.t(esc.status === 'held' ? 'lab.escrow.held' : 'lab.escrow.released', { expected: money(esc.expectedMinor), fee: money(esc.feeMinor), held: money(esc.heldMinor), paid: money(esc.paidMinor), topped: money(esc.toppedUpMinor), released: money(esc.releasedMinor) })}
              {esc.releaseReason === 'cancelled' && <><br /><span className="kv-field__hint">{t.t('lab.escrow.feeKept', { fee: money(esc.feeMinor) })}</span></>}</p>
          ) : <p className="kv-field__hint">{t.t(b.rosterConfirmedAt ? 'lab.escrow.legacy' : 'lab.escrow.notYet')}</p>}
          <p className="kv-field__hint">{t.t('lab.escrow.note')}</p>
        </div>
      )}

      <div className="kv-card">
        <h2>{t.t('lab.dignity.title')}</h2>
        <ul className="kv-list">
          <li>{t.t(b.womenOnly ? 'lab.dignity.womenOnly' : 'lab.dignity.notWomenOnly')} · {t.t(d?.womanSupervisor ? 'lab.dignity.supervisor' : 'lab.dignity.supervisorNot')}</li>
          {DECLARATIONS.filter((k) => k !== 'womanSupervisor').map((k) => (
            <li key={k}>{t.t(d?.[k] ? `lab.dignity.${k}` : `lab.dignity.${k}Not`)}{k === 'transport' && d?.pickupPoint && ` · ${t.t('lab.dignity.pickup', { point: d.pickupPoint, time: d.pickupTime ?? t.t('lab.detail.timeUnset') })}`}</li>
          ))}
          <li>{t.t('lab.dignity.floor', { floor: money(b.minWageMinor) })}</li>
          <li>{t.t('lab.dignity.payRule')}</li>
        </ul>
      </div>

      {b.cancel ? (
        <div className="kv-card kv-card--notice"><strong>{t.t('lab.cancelled.title')}</strong>
          <p>{t.t('lab.cancelled.body', { reason: b.cancel.reasonText ?? (b.cancel.reasonCode ? t.t(`lab.reason.${b.cancel.reasonCode}`) : t.t('lab.reason.none')), at: when(b.cancel.at) })}</p></div>
      ) : b.viewerCan?.cancel && (
        <div className="kv-card">
          <h2>{t.t('lab.cancel.title')}</h2>
          <p><Link href={`${cancelHref(b.id)}?step=edit`} className="kv-btn kv-btn--danger">{t.t('lab.cancel.open')}</Link></p>
          <p className="kv-field__hint">{t.t('lab.cancel.recorded')}</p>
          <p className="kv-field__hint">{t.t('lab.fairnessFee.refused')}</p>
        </div>
      )}
      <p className="kv-field__hint">{t.t('lab.retention.refused')}</p>
      <p><Link href={LABOUR_HREF} className="kv-btn--link">{t.t('lab.detail.back')}</Link></p>
    </section>
  );
}
