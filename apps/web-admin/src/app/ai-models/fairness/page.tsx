// apps/web-admin/src/app/ai-models/fairness/page.tsx · W085 (PC-56 ADMIN-7).
//
// "Policy: no model reaches production with >5pp accuracy gap across any protected slice — the audit is a HARD gate."
//
// IT WAS NOT A GATE AND THERE WERE NO AUDITS. `ModelRegistryService.promote` never read `fairness_audit`, and the only
// writer of that column — `runFairnessAudit` in apps/api — is called from nowhere, so the column is NULL for every model
// on the platform. **And what that job would have written contains no slices at all**: counts and an override rate, under
// a column named `fairness_audit`, which a console would have rendered as "audited".
//
// SO THE UNAUDITED LIST IS THE HEADLINE OF THIS SCREEN, and it is currently every model. A board that listed only audited
// models would be empty and would imply there was nothing to worry about.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { Callout, EmptyState, StatusPill } from '@krishalaya/ui';
import {
  caveatKeys, formatGap, gapTone, gateTone, gateKey, legacyKey, unauditedClass, unauditedKey,
  verdictTone, verdictKey,
} from '../../../features/ai-governance/ai-governance';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ai.fairness.title'), robots: { index: false, follow: false } };
}

interface Board {
  audited: {
    modelId: string; code: string; version: string; status: string; auditId: string;
    verdict: string; maxGapPp: number; sampleSize: number;
    slices: Record<string, { maxGapPp: number; worst: string | null; best: string | null; groups: number; smallestGroup: number }>;
    verdictNote: string | null; slicesApproved: boolean; auditedAt: string;
    gateOpen: boolean; gateReason: string | null;
  }[];
  unaudited: {
    modelId: string; code: string; version: string; status: string; inProduction: boolean;
    legacyColumn: { kind: string; overrideRate?: number | null; total?: number | null; sliceNames?: string[] };
  }[];
  policy: {
    maxSliceGapPp: number; auditMaxAgeDays: number; proxyBasis: string; proxyCaveats: string[];
    measurableSlices: string[]; canonSlicesNotYetMeasurable: { slice: string; reason: string }[];
  };
  platformDecisionsAwaitingFlag: number;
}

export default async function FairnessBoardPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let b: Board | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Board>('ai/models/fairness/board');
    b = res.data ?? null;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'ai.restricted.fairness' : 'ai.error.fairness';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/ai-models">{t.t('nav.aiModels')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('ai.fairness.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('ai.fairness.title')}</h1>
        <p className="kv-page__sub">{t.t('ai.fairness.sub')}</p>
      </header>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {searchParams.ok ? <Callout tone="success" live="polite">{t.t(`ai.ok.${searchParams.ok}`)}</Callout> : null}
      {searchParams.error ? <Callout tone="danger" live="assertive">{t.t(`ai.err.${searchParams.error}`)}</Callout> : null}

      {b ? (
        <>
          {/* ---------------- THE POLICY, AND WHAT THE FIGURES ARE MADE OF ---------------- */}
          <section className="kv-panel" aria-labelledby="ai-policy">
            <h2 id="ai-policy" className="kv-panel__title">{t.t('ai.policy.title')}</h2>
            <p>{t.t('ai.policy.gap', { limit: String(b.policy.maxSliceGapPp), days: String(b.policy.auditMaxAgeDays) })}</p>
            {/* THE PROXY AND ITS BIASES TRAVEL WITH EVERY GAP ON THIS SCREEN. The platform has no labelled eval set, so
                the figure is a HUMAN-CORRECTION RATE — and its worst bias is that a group whose cases are reviewed less
                often looks BETTER, not worse. A gap presented as accuracy would be the most misleading number here. */}
            <Callout tone="warning">{t.t('ai.policy.proxy')}</Callout>
            <ul>
              {caveatKeys(b.policy.proxyCaveats).map((k) => <li key={k}>{t.t(k)}</li>)}
            </ul>
            <Callout>
              {t.t('ai.policy.measurable', { slices: b.policy.measurableSlices.join(', ') })}
            </Callout>
            {/* The canon's slices this platform cannot yet measure, each with its reason — rather than three slices
                labelled with the canon's names and computed from something else. */}
            <ul>
              {b.policy.canonSlicesNotYetMeasurable.map((s) => (
                <li key={s.slice}>{s.slice} — {s.reason}</li>
              ))}
            </ul>
          </section>

          {/* ---------------- THE UNAUDITED, FIRST ---------------- */}
          {b.unaudited.length > 0 ? (
            <section className="kv-panel is-danger" aria-labelledby="ai-unaudited">
              <h2 id="ai-unaudited" className="kv-panel__title">
                {t.t('ai.unaudited.title', { n: String(b.unaudited.length) })}
              </h2>
              <Callout tone="danger">{t.t('ai.unaudited.why')}</Callout>
              <table className="kv-table">
                <caption className="kv-table__caption">{t.t('ai.unaudited.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t.t('ai.col.model')}</th>
                    <th scope="col">{t.t('ai.col.status')}</th>
                    <th scope="col">{t.t('ai.col.legacyColumn')}</th>
                    <th scope="col">{t.t('ai.col.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {b.unaudited.map((m) => (
                    <tr key={m.modelId}>
                      <td><Link href={`/ai-models/${encodeURIComponent(m.modelId)}`}>{m.code} {m.version}</Link></td>
                      <td>
                        <span className={unauditedClass(m.inProduction)}>{t.t(unauditedKey(m.inProduction))}</span>
                      </td>
                      {/* WHAT THE OLD COLUMN ACTUALLY HOLDS. `usage_rollup` means an override-rate summary with no
                          slices — a number that looks like diligence and measures something else. */}
                      <td>{t.t(legacyKey(m.legacyColumn.kind))}</td>
                      <td><Link href={`/ai-models/${encodeURIComponent(m.modelId)}/rollout`}>{t.t('ai.audit.run')}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {/* ---------------- THE AUDITS ---------------- */}
          {/* NOT "no audits scheduled" — no audit has EVER been run, because the writer was never wired. The empty
              state names the defect rather than describing a backlog. */}
          {b.audited.length === 0 ? (
            <EmptyState title={t.t('ai.fairness.empty.title')} body={t.t('ai.fairness.empty.body')} />
          ) : (
            <table className="kv-table">
              <caption className="kv-table__caption">{t.t('ai.fairness.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.t('ai.col.model')}</th>
                  <th scope="col">{t.t('ai.col.audited')}</th>
                  <th scope="col">{t.t('ai.col.slices')}</th>
                  <th scope="col">{t.t('ai.col.maxGap')}</th>
                  <th scope="col">{t.t('ai.col.verdict')}</th>
                  <th scope="col">{t.t('ai.col.dpo')}</th>
                  <th scope="col">{t.t('ai.col.gate')}</th>
                </tr>
              </thead>
              <tbody>
                {b.audited.map((a) => (
                  <tr key={a.auditId}>
                    <td>
                      <Link href={`/ai-models/${encodeURIComponent(a.modelId)}/rollout`}>{a.code} {a.version}</Link>
                      <br /><small>{a.status}</small>
                    </td>
                    <td>
                      {a.auditedAt.slice(0, 10)}
                      <br /><small>{t.t('ai.sample', { n: a.sampleSize.toLocaleString('en-IN') })}</small>
                    </td>
                    <td>
                      {Object.entries(a.slices).map(([name, s]) => (
                        <div key={name}>
                          {name}: <StatusPill tone={gapTone(s.maxGapPp, b!.policy.maxSliceGapPp)} label={formatGap(s.maxGapPp)} />
                          {s.worst ? <> · {t.t('ai.worstServed', { group: s.worst })}</> : null}
                        </div>
                      ))}
                    </td>
                    <td><StatusPill tone={gapTone(a.maxGapPp, b.policy.maxSliceGapPp)} label={formatGap(a.maxGapPp)} /></td>
                    <td>
                      <StatusPill tone={verdictTone(a.verdict)} label={t.t(verdictKey(a.verdict))} />
                      {a.verdictNote ? <><br /><small>{a.verdictNote}</small></> : null}
                    </td>
                    {/* The DPO's sign-off on the SLICE DEFINITIONS is a separate act from the audit: measuring accuracy
                        by gender means processing gender, so which slices are measured is a privacy decision. Without it
                        the gate stays shut on an otherwise passing audit. */}
                    <td>{a.slicesApproved ? t.t('common.yes') : t.t('ai.dpo.pending')}</td>
                    <td>
                      <StatusPill tone={gateTone(a.gateOpen)} label={t.t(gateKey(a.gateOpen, a.gateReason))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ADMIN-7-Q8 made visible: platform-side rejections that have not reached the inference log, so a reader knows
              the override rate under-counts rather than discovering it later. */}
          {b.platformDecisionsAwaitingFlag > 0 ? (
            <Callout tone="warning">
              {t.t('ai.awaitingFlag', { n: String(b.platformDecisionsAwaitingFlag) })}
            </Callout>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
