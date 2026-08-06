// apps/web-admin/src/app/support/insights/page.tsx · AGENT PERFORMANCE (PC-56 ADMIN-2, canon W055). Server component:
// requireAdmin gates, adminGet hits GET /v1/support/insights/agents over a bounded window.
//
// THIS PAGE IS READ BY PEOPLE WHO THEN JUDGE OTHER PEOPLE, so it is built to refuse three specific distortions:
//   1. `handled` counts RESOLVED tickets. An agent whose queue is full of hard open cases is not a slow agent, and a
//      count that included them would say exactly that.
//   2. First response is a real MEDIAN (percentile_cont in SQL), not a mean — one ticket answered on Monday after a
//      weekend would drag a mean into fiction and follow somebody into a review.
//   3. A CSAT figure below the sample threshold is shown WITH ITS COUNT and without ranking. One five-star rating does
//      not make somebody the best agent on the desk, and a dashboard that ranks on it produces agents who chase
//      ratings instead of answering questions.
// A p50 of null renders as "not enough answered yet" — never 0s, which would read as instant.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { bpsToPercent } from '../../../features/reports/report';
import {
  humanSeconds, csatIsIndicative, reopenRateBps, sortAgentsByLoad, CSAT_MIN_SAMPLE, type AgentRow,
} from '../../../features/support/desk';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ins.title'), robots: { index: false, follow: false } };
}

/** The default window: the last 30 days. Bounded because an "all time" agent query is a full scan whose answer nobody
 *  asked for — and because performance a year ago is not a coaching signal today. */
const DEFAULT_DAYS = 30;

interface AgentsView { window: { from: string; to: string }; agents: AgentRow[] }

export default async function AgentInsightsPage({ searchParams }: { searchParams: { days?: string } }) {
  requireAdmin();
  const t = getTranslator();

  const days = /^\d{1,3}$/.test(searchParams.days ?? '') ? Math.min(Math.max(Number(searchParams.days), 1), 365) : DEFAULT_DAYS;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  let view: AgentsView | null = null; let notice: string | undefined;
  try {
    view = (await adminGet<AgentsView>('support/insights/agents', {
      from: from.toISOString(), to: to.toISOString(), limit: 100,
    })).data ?? null;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const agents = sortAgentsByLoad(view?.agents ?? []);

  return (
    <section>
      <p className="kv-backlink"><Link href="/support">{t.t('support.back')}</Link></p>
      <h1>{t.t('ins.title')}</h1>
      <p className="kv-field__hint">{t.t('ins.hint', { days: String(days) })}</p>

      {/* Window switcher as links: the view stays shareable, which matters when somebody is asked to look at a month. */}
      <nav className="kv-tabs" aria-label={t.t('ins.window')}>
        {[7, 30, 90].map((d) => (
          <Link key={d} href={`/support/insights?days=${d}`} className={`kv-tab${d === days ? ' kv-tab--active' : ''}`}
            aria-current={d === days ? 'page' : undefined}>
            {t.t('ins.lastDays', { n: String(d) })}
          </Link>
        ))}
        <Link href="/support/insights/csat" className="kv-tab">{t.t('ins.csatLink')}</Link>
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : agents.length === 0 ? (
        <p className="kv-empty">{t.t('ins.none')}</p>
      ) : (
        <>
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('ins.agent')}</th>
              <th scope="col">{t.t('ins.handled')}</th>
              <th scope="col">{t.t('ins.firstResponse')}</th>
              <th scope="col">{t.t('ins.csat')}</th>
              <th scope="col">{t.t('ins.reopen')}</th>
            </tr></thead>
            <tbody>
              {agents.map((a) => {
                const p50 = humanSeconds(a.firstResponseP50Sec);
                const reopen = reopenRateBps(a);
                const indicative = csatIsIndicative(a);
                return (
                  <tr key={a.agentUserId}>
                    <td><code>{String(a.agentUserId ?? '').slice(0, 8)}</code></td>
                    <td>{String(a.handled ?? 0)}</td>
                    {/* null p50 → words, not "0s" */}
                    <td>{p50 ?? <span className="kv-detail__muted">{t.t('ins.noP50')}</span>}</td>
                    <td>
                      {a.csatAvgBps === null || a.csatAvgBps === undefined
                        ? <span className="kv-detail__muted">{t.t('ins.noCsat')}</span>
                        : (
                          <>
                            {bpsToPercent(a.csatAvgBps)}%
                            {' '}<span className="kv-detail__muted">({t.t('ins.ratings', { n: String(a.csatCount ?? 0) })})</span>
                            {/* the sample warning travels WITH the number, not in a footnote */}
                            {!indicative && <> <span className="kv-status kv-status--warn">{t.t('ins.thinSample')}</span></>}
                          </>
                        )}
                    </td>
                    <td>{reopen === null ? t.t('common.dash') : `${bpsToPercent(reopen)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t('ins.basisNote', { min: String(CSAT_MIN_SAMPLE) })}</p>
        </>
      )}
    </section>
  );
}
