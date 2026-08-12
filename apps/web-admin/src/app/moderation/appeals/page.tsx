// apps/web-admin/src/app/moderation/appeals/page.tsx · W097, the appeals queue (PC-56 ADMIN-SWEEP-b1).
//
// This queue had writers built for it THIS WAVE. 0067 created the table (with the ≠-reviewer CHECK) and nothing ever
// wrote a row: no submit, no claim, no decision — so the trust overview's overturn rate was 0/0 forever and a farmer
// could not contest a removal the notice told them they could appeal. The canon page still carries the DELTA-024
// "not in schema yet" banner; that banner was stale the day 0067 landed, and this page exists instead of it.
//
// ORDERED BY DEADLINE, WORST FIRST — same doctrine as the held-listing queue: the 48h clock starts when the FARMER
// asks (submit), not when a reviewer picks the appeal up.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { takeNextAppealAction } from '../actions';
import { slaLabel, slaClass, neOriginalMark, statusTab, OVERTURN_EFFECT_KEYS, APPEAL_SLA_HOURS, type AppealSla } from '../../../features/moderation/appeals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ap.listTitle'), robots: { index: false, follow: false } };
}

interface Row {
  id: string; subjectRef: string; subjectAction: string; appellant: string;
  originalReviewerId: string | null; assignedTo: string | null; assignedNeOriginal: boolean;
  status: string; slaDueAt: string; sla: AppealSla;
  decidedAt: string | null; createdAt: string;
}

const EMPTY = new Set(['queueClear', 'onlyYourOwn']);
const ERR = new Set(['elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function AppealsQueuePage({ searchParams }: { searchParams: { status?: string; cursor?: string; empty?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const status = statusTab(searchParams.status);

  let rows: Row[] = []; let next: string | null = null; let notice: string | undefined;
  let counts: { pending: number; upheld: number; overturned: number } | undefined;
  try {
    const r = await adminGet<Row[]>('moderation/appeals', { status, cursor: searchParams.cursor });
    rows = r.data;
    const meta = r.meta as { nextCursor?: string | null; counts?: typeof counts } | undefined;
    next = meta?.nextCursor ?? null; counts = meta?.counts;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const emptyKey = searchParams.empty && EMPTY.has(searchParams.empty) ? searchParams.empty : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const breached = rows.filter((r) => r.status === 'pending' && r.sla?.kind === 'breached').length;

  return (
    <section>
      <p className="kv-backlink"><Link href="/moderation">{t.t('ts.backOverview')}</Link></p>
      <h1>{t.t('ap.listHeading')}</h1>
      {/* W097's lead, verbatim in substance: the SLA and the ≠-reviewer rule ARE the page. */}
      <p className="kv-muted">{t.t('ap.listLead', { h: String(APPEAL_SLA_HOURS) })}</p>
      {notice && <p className="kv-error" role="alert">{notice}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`ap.error.${errKey}`)}</p>}
      {/* The two honest empties "Take next" can land on — different mornings, different sentences. */}
      {emptyKey === 'queueClear' && <p className="kv-success" role="status">{t.t('ap.takeNext.queueClear')}</p>}
      {emptyKey === 'onlyYourOwn' && <p className="kv-notice" role="note">{t.t('ap.takeNext.onlyYourOwn')}</p>}
      {breached > 0 && <p className="kv-error" role="alert">{t.t('ap.breached', { n: String(breached) })}</p>}

      {/* W097's primary action. The server picks the appeal; see takeNextAppealAction. */}
      <form action={takeNextAppealAction}>
        <button type="submit" className="kv-btn">{t.t('ap.takeNext')}</button>
      </form>

      {/* pending | upheld | overturned — GET-links, cursor deliberately dropped on tab change. */}
      <p className="kv-tabs" role="navigation">
        {(['pending', 'upheld', 'overturned'] as const).map((s2) => (
          <Link key={s2} href={`/moderation/appeals?status=${s2}`} aria-current={status === s2 ? 'page' : undefined}
            className={status === s2 ? 'kv-btn kv-btn--link kv-tab--active' : 'kv-btn kv-btn--link'}>
            {t.t(`ap.tab.${s2}`)}{counts ? ` (${counts[s2]})` : ''}
          </Link>
        ))}
      </p>

      <table className="kv-table">
        <thead><tr>
          <th>{t.t('ap.col.sla')}</th><th>{t.t('ap.col.appeal')}</th><th>{t.t('ap.col.action')}</th>
          <th>{t.t('ap.col.appellant')}</th><th>{t.t('ap.col.originalReviewer')}</th><th>{t.t('ap.col.assignedTo')}</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const sla = slaLabel(r.sla);
            const mark = neOriginalMark(r.assignedTo, r.originalReviewerId);
            return (
              <tr key={r.id}>
                <td>{status === 'pending'
                  ? <span className={slaClass(r.sla)}>{t.t(`ap.sla.${sla.key}`, { h: String(sla.hours) })}</span>
                  : (r.decidedAt ?? t.t('common.dash'))}</td>
                <td><Link href={`/moderation/appeals/${r.id}`}>{r.id.slice(0, 8)}</Link></td>
                <td>{t.t(`ap.action.${r.subjectAction}`)} · {r.subjectRef}</td>
                <td>{r.appellant}</td>
                {/* Unresolved origin prints as "not yet resolved", never as a blank that reads like "nobody". */}
                <td>{r.originalReviewerId ?? t.t('ap.originUnresolved')}</td>
                <td>
                  {r.assignedTo ?? t.t('ap.unassigned')}
                  {mark === 'ok' && <span className="kv-status kv-status--ok">{t.t('ap.neOriginal')}</span>}
                  {mark === 'unknown' && <span className="kv-status">{t.t('ap.neUnknown')}</span>}
                </td>
                <td><Link href={`/moderation/appeals/${r.id}`} className="kv-btn kv-btn--link">{t.t('ap.review')}</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && !notice && (
        status === 'pending'
          // W097's own empty state, including its second sentence and the "View history" affordance.
          ? <p className="kv-empty">{t.t('ap.emptyPending')} <Link href="/moderation/appeals?status=overturned">{t.t('ap.viewHistory')}</Link></p>
          : <p className="kv-empty">{t.t('ap.emptyDecided')}</p>
      )}
      {next && <p className="kv-pager"><Link href={`/moderation/appeals?status=${status}&cursor=${encodeURIComponent(next)}`}>{t.t('common.next')}</Link></p>}

      {/* W097's "Overturn effects (automatic)" panel — with each effect's real provider state, because a panel that
          promises four effects is a contract this wave now signs in code. */}
      <h2>{t.t('ap.effectsHeading')}</h2>
      <ul className="kv-list">
        {OVERTURN_EFFECT_KEYS.map((k) => <li key={k}>{t.t(`ap.effect.${k}`)}</li>)}
      </ul>
      <p className="kv-detail__muted">{t.t('ap.effectsDoctrine')}</p>
      <p className="kv-detail__muted">{t.t('ap.restrictedNote')}</p>
    </section>
  );
}
