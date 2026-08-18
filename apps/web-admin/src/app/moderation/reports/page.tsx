// apps/web-admin/src/app/moderation/reports/page.tsx · W092, the cross-tenant report queue (PC-56 ADMIN-5f).
//
// TWO THINGS HERE ARE NEW AND BOTH ARE THE POINT OF THE SCREEN.
//
// 1. A PLATFORM OPERATOR CAN NOW BE RECORDED AS HANDLING A REPORT. `moderation_reports.handled_by` is an FK to the
//    FARMER table and admin-api has no database identity, so before 0112 a platform decision had nowhere to be
//    written. It now records `handled_by_admin_id`, and a decided report names EXACTLY ONE of the two — both kinds of
//    handler are real (the tenant's own desk works reports through apps/api) and recording either as the other would
//    be a forgery.
// 2. SAFETY BEFORE SLA. A breached SLA on a fake-review report is a process failure; a fresh harassment report is a
//    person being harassed right now. Putting the breach first would optimise the metric the desk is measured on at
//    the expense of the thing the desk exists for.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { decideReportAction } from '../actions';
import { Button, Callout, Chip, EmptyState, StatusPill } from '@krishalaya/ui';
import {
  SUBJECT_TYPES, PLATFORM_OUTCOMES, OUTCOME_MIN, priorityTone, reportSlaTone, handlerKey,
  subjectCountText, pageOrderCaveatVisible, type Priority, type ReportSla, type Handler,
} from '../../../features/moderation/queue';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mq.repTitle'), robots: { index: false, follow: false } };
}

interface Row {
  id: string; tenantId: string; subjectType: string; subjectId: string; reasonCode: string | null;
  status: string; createdAt: string; priority: Priority; sla: ReportSla; safetyDesk: boolean;
  reportsOnSubject: { known: boolean; count: number }; handler: Handler;
}
interface Meta { nextCursor: string | null; orderedWithinPageOnly: boolean; slaHours: number; openTotal: number | null }

const OK = new Set(['actioned', 'dismissed']);
const ERR = new Set(['status', 'outcome', 'note', 'language', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);
const LANGS = ['en', 'hi', 'gu'];

export default async function ReportQueuePage({ searchParams }: { searchParams: { subjectType?: string; cursor?: string; ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const subjectType = searchParams.subjectType && (SUBJECT_TYPES as readonly string[]).includes(searchParams.subjectType) ? searchParams.subjectType : undefined;

  let rows: Row[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const r = await adminGet<Row[]>('moderation/reports', { subjectType, cursor: searchParams.cursor });
    rows = r.data; meta = r.meta as unknown as Meta;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const safety = rows.filter((r) => r.safetyDesk).length;

  return (
    <section>
      <p className="kv-backlink"><Link href="/moderation">{t.t('ts.backOverview')}</Link></p>
      <h1>{t.t('mq.repHeading')}</h1>
      <p className="kv-muted">{t.t('mq.repLead')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`mq.repOk.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`mq.error.${errKey}`)}</p>}
      {notice && <p className="kv-error" role="alert">{notice}</p>}

      {safety > 0 && <p className="kv-error" role="alert">{t.t('mq.safetyWaiting', { n: String(safety) })}</p>}
      {meta?.openTotal !== null && meta?.openTotal !== undefined && (
        <p className="kv-detail__muted">{t.t('mq.openTotal', { n: String(meta.openTotal) })}</p>
      )}

      <nav className="kv-filters">
        <Chip as={Link} href="/moderation/reports" active={!subjectType}>{t.t('mq.filter.all')}</Chip>
        {SUBJECT_TYPES.map((s) => (
          <Chip as={Link} key={s} href={`/moderation/reports?subjectType=${s}`} active={subjectType === s}>
            {t.t(`mq.subject.${s}`)}
          </Chip>
        ))}
      </nav>

      <table className="kv-table">
        <thead><tr>
          <th>{t.t('mq.col.age')}</th><th>{t.t('mq.col.report')}</th><th>{t.t('mq.col.subject')}</th>
          <th>{t.t('mq.col.reason')}</th><th>{t.t('mq.col.tenant')}</th><th>{t.t('mq.col.onSubject')}</th>
          <th>{t.t('mq.col.priority')}</th><th>{t.t('mq.col.decide')}</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.createdAt}<div><StatusPill tone={reportSlaTone(r.sla)} label={t.t(`mq.repSla.${r.sla?.kind ?? 'unmeasured'}`)} /></div></td>
              <td><code>{r.id}</code></td>
              <td>{t.t(`mq.subject.${r.subjectType}`)}<div className="kv-detail__muted">{r.subjectId}</div></td>
              <td>{r.reasonCode ?? t.t('mq.reasonUnresolved')}</td>
              <td>{r.tenantId}</td>
              {/* Unknown is a dash, never 1 — "this is the only report" is the reading that makes an operator dismiss
                  something eighteen people flagged. */}
              <td>{subjectCountText(r.reportsOnSubject)}</td>
              <td>
                <StatusPill tone={priorityTone(r.priority)} label={t.t(`mq.priority.${r.priority}`)} />
                {/* Message bodies need `moderation.messages` and this queue does not show them. The line says so
                    rather than leaving an operator wondering where the thread is. */}
                {r.subjectType === 'message' && <div className="kv-detail__muted">{t.t('mq.messageBodyGated')}</div>}
              </td>
              <td>
                <details>
                  <summary>{t.t('mq.decide')}</summary>
                  <form action={decideReportAction} className="kv-form">
                    <input type="hidden" name="id" value={r.id} />
                    <label htmlFor={`st-${r.id}`} className="kv-field__label">{t.t('mq.decision')}</label>
                    <select id={`st-${r.id}`} name="status" className="kv-input" required defaultValue="">
                      <option value="" disabled>{t.t('common.choose')}</option>
                      <option value="actioned">{t.t('mq.decision.actioned')}</option>
                      <option value="dismissed">{t.t('mq.decision.dismissed')}</option>
                    </select>
                    <label htmlFor={`oc-${r.id}`} className="kv-field__label">{t.t('mq.outcome')}</label>
                    <select id={`oc-${r.id}`} name="outcome" className="kv-input" defaultValue="">
                      <option value="">{t.t('mq.outcomeNone')}</option>
                      {PLATFORM_OUTCOMES.map((o) => <option key={o} value={o}>{t.t(`mq.outcome.${o}`)}</option>)}
                    </select>
                    <label htmlFor={`nt-${r.id}`} className="kv-field__label">{t.t('mq.outcomeNote')}</label>
                    <textarea id={`nt-${r.id}`} name="outcomeNote" className="kv-input" required minLength={OUTCOME_MIN} maxLength={2000} />
                    <label htmlFor={`lg-${r.id}`} className="kv-field__label">{t.t('mq.language')}</label>
                    <select id={`lg-${r.id}`} name="languageCode" className="kv-input" required defaultValue="en">
                      {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <Button type="submit">{t.t('mq.recordDecision')}</Button>
                  </form>
                </details>
                {handlerKey(r.handler) === 'neither' && <div className="kv-error">{t.t('mq.handlerMissing')}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && !notice && <EmptyState variant="empty" title={t.t('mq.repEmpty')} />}

      {/* An honest limitation: the keyset is oldest-first for stability, so triage orders WITHIN a page. A
          safety-desk report on page 3 is not lifted to page 1, and the count above is read across the whole open set
          so the desk is told it exists even when this page does not show it. */}
      {pageOrderCaveatVisible(meta?.orderedWithinPageOnly, !!meta?.nextCursor) && (
        <Callout tone="warning">{t.t('mq.pageOrderCaveat')}</Callout>
      )}
      {meta?.nextCursor && (
        <p className="kv-pager">
          <Link href={`/moderation/reports?${new URLSearchParams({ ...(subjectType ? { subjectType } : {}), cursor: meta.nextCursor }).toString()}`}>{t.t('common.next')}</Link>
        </p>
      )}
      <p className="kv-detail__muted">{t.t('mq.reportersHearBack')}</p>
    </section>
  );
}
