// apps/web-admin/src/app/ai-models/overview/page.tsx · W079 (PC-56 ADMIN-7).
//
// "Every consequential AI decision is audited (ai_inferences); low confidence goes to humans; humans can always
// override — and overrides teach us."
//
// EACH TILE CARRIES ITS OWN KNOWN/UNKNOWN. "0 inferences today" and "the inference log has no rows for today" render
// identically as a number and mean opposite things — a quiet Sunday versus a recording path that has stopped. 0113 found
// exactly this collapse on the recon board and 0114 on the settlement cycle; this is the third wave running.
//
// W079's "Non-negotiables (policy)" panel is DECORATIVE in the canon and is rendered from server-supplied codes rather
// than hard-coded here, so the console cannot drift from the policy it prints. Recorded as PARITY-DECOR.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import {
  formatRate, kindClass, kindKey, overrideRateClass, tileText, type Tile,
} from '../../../features/ai-governance/ai-governance';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ai.overview.title'), robots: { index: false, follow: false } };
}

interface Overview {
  inferences: Tile;
  sentToReview: { known: true; value: number; ofTotal: number };
  overrideRate: Tile | { known: true; value: number };
  queue: {
    pending: number; inReview: number; oldestPendingMinutes: number | null;
    byKind: Record<string, number>; holdsListings: number;
  };
  models: { modelId: string; code: string; version: string; status: string; inferences24h: number; overridden: number; belowThreshold: number }[];
  awaitingChecker: { id: string; code: string; version: string; proposedStatus: string; proposedByAdminId: string | null; proposedAt: string }[];
  policy: string[];
}

export default async function AiOverviewPage() {
  requireAdmin();
  const t = getTranslator();

  let o: Overview | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Overview>('ai/models/overview');
    o = res.data ?? null;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'ai.restricted.overview' : 'ai.error.overview';
  }

  const inf = o ? tileText(o.inferences) : { value: '—', unknownKey: null };
  const rate = o && 'value' in o.overrideRate ? o.overrideRate.value : null;

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/ai-models">{t.t('nav.aiModels')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('ai.overview.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('ai.overview.title')}</h1>
        <p className="kv-page__sub">{t.t('ai.overview.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}

      {o ? (
        <>
          {/* ---------------- THE FOUR TILES ---------------- */}
          <section className="kv-panel" aria-labelledby="ai-tiles">
            <h2 id="ai-tiles" className="kv-panel__title">{t.t('ai.tiles.title')}</h2>
            <dl className="kv-stat-row">
              <div>
                <dt>{t.t('ai.tile.inferences')}</dt>
                <dd>{inf.value}</dd>
                {/* THE UNKNOWN IS WORDS, NOT 0. */}
                {inf.unknownKey ? <dd className="kv-note is-warn">{t.t(inf.unknownKey)}</dd> : null}
              </div>
              <div>
                <dt>{t.t('ai.tile.sentToReview')}</dt>
                <dd>{o.sentToReview.value.toLocaleString('en-IN')}</dd>
                <dd><small>{t.t('ai.tile.ofTotal', { n: o.sentToReview.ofTotal.toLocaleString('en-IN') })}</small></dd>
              </div>
              <div>
                <dt>{t.t('ai.tile.overrideRate')}</dt>
                {/* A HIGH override rate is a WARNING and not a success. It is easy to read "humans are catching things" as
                    reassurance; what it means is that the model is wrong that often and every case cost somebody time. */}
                <dd><span className={overrideRateClass(rate)}>{formatRate(rate)}</span></dd>
              </div>
              <div>
                <dt>{t.t('ai.tile.queue')}</dt>
                <dd>{o.queue.pending.toLocaleString('en-IN')}</dd>
                <dd>
                  <small>
                    {/* NULL for an empty queue rather than 0: zero would read as "a case arrived this second", the
                        opposite of "there is nothing waiting". */}
                    {o.queue.oldestPendingMinutes === null
                      ? t.t('ai.queue.empty')
                      : t.t('ai.queue.oldest', { m: String(o.queue.oldestPendingMinutes) })}
                  </small>
                </dd>
              </div>
            </dl>
            {/* A fraud case waiting is a farmer's listing off the market. Read across the whole open queue, not a page. */}
            {o.queue.holdsListings > 0 ? (
              <p className="kv-note is-warn" role="status">
                {t.t('ai.queue.holdsListings', { n: String(o.queue.holdsListings) })}{' '}
                <Link href="/ai-models/review">{t.t('ai.queue.open')}</Link>
              </p>
            ) : null}
            <ul className="kv-stat-row">
              {Object.entries(o.queue.byKind).map(([k, n]) => (
                <li key={k}><span className={kindClass(k)}>{t.t(kindKey(k))}</span> {n}</li>
              ))}
            </ul>
          </section>

          {/* ---------------- MODELS ---------------- */}
          <table className="kv-table">
            <caption className="kv-table__caption">{t.t('ai.overview.models')}</caption>
            <thead>
              <tr>
                <th scope="col">{t.t('ai.col.model')}</th>
                <th scope="col">{t.t('ai.col.status')}</th>
                <th scope="col">{t.t('ai.col.inferences24h')}</th>
                <th scope="col">{t.t('ai.col.belowThreshold')}</th>
                <th scope="col">{t.t('ai.col.overrides')}</th>
              </tr>
            </thead>
            <tbody>
              {o.models.map((m) => (
                <tr key={m.modelId}>
                  <td><Link href={`/ai-models/${encodeURIComponent(m.modelId)}/rollout`}>{m.code} {m.version}</Link></td>
                  <td>{m.status}</td>
                  <td>{m.inferences24h.toLocaleString('en-IN')}</td>
                  <td>{m.belowThreshold.toLocaleString('en-IN')}</td>
                  <td>
                    <span className={overrideRateClass(m.inferences24h > 0 ? m.overridden / m.inferences24h : null)}>
                      {m.inferences24h > 0 ? formatRate(m.overridden / m.inferences24h) : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {o.models.length === 0 ? (
            <div className="kv-empty">
              <h2>{t.t('ai.overview.empty.title')}</h2>
              <p>{t.t('ai.overview.empty.body')}</p>
            </div>
          ) : null}

          {/* W088's alert strip, on the overview too — a transition awaiting a checker is a model waiting to serve or to
              stop serving, and it should not need somebody to open the rollout page to be noticed. */}
          {o.awaitingChecker.length > 0 ? (
            <section className="kv-panel is-warn" aria-labelledby="ai-awaiting-ov">
              <h2 id="ai-awaiting-ov" className="kv-panel__title">{t.t('ai.awaiting.title')}</h2>
              <ul>
                {o.awaitingChecker.map((a) => (
                  <li key={a.id}>
                    <Link href={`/ai-models/${encodeURIComponent(a.id)}/rollout`}>{a.code} {a.version}</Link>
                    {' → '}{a.proposedStatus}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ---------------- THE NON-NEGOTIABLES (PARITY-DECOR) ---------------- */}
          <section className="kv-panel" aria-labelledby="ai-nonneg">
            <h2 id="ai-nonneg" className="kv-panel__title">{t.t('ai.policy.nonNegotiables')}</h2>
            <ul>
              {o.policy.map((p) => <li key={p}>{t.t(`ai.nonneg.${p}`)}</li>)}
            </ul>
            {/* THE THIRD ONE IS NOW TRUE. "Fairness audits per model version — district/gender skew checked before
                production" had nothing behind it until 0115: no gate read the column, and the column's only writer was
                never scheduled. The line stays, and the board says which models have actually been audited. */}
            <p className="kv-note">
              <Link href="/ai-models/fairness">{t.t('ai.policy.seeBoard')}</Link>
            </p>
          </section>
        </>
      ) : null}
    </main>
  );
}
