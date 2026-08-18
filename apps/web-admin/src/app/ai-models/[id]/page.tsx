// apps/web-admin/src/app/ai-models/[id]/page.tsx · god-mode model detail + fairness report + lifecycle mutations.
// Server component: requireAdmin gates, GET /v1/ai/models/:id/fairness (model + stored monthly fairness audit + a
// fresh 30-day inference roll-up; 404 → notFound, other failures → localized notice via adminNoticeKey). The two
// consequential writes are surfaced as Server-Action forms: PROMOTE (POST :id/promote — offers ONLY the model
// state machine's legal next states) and TUNE THRESHOLD (PATCH :id/threshold — a 0..1 confidence ratio, blank
// clears it). Both carry a mandatory audit reason; admin-api re-checks ai.model.manage + FIDO2 + step-up.
// confidenceThreshold + overrideRate are RATIOS (0..1), rendered via the feature module's float-free formatters
// (integer math, no float-format helper). Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import {
  transitionTargets, modelStatusKey, modelStatusTone, formatThreshold4, formatPercent2,
  isModelStatus, type ModelStatus, type FairnessReport,
} from '../../../features/ai-models/model';
import { promoteModelAction, tuneThresholdAction } from '../actions';

import { Button, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

// modelStatusTone (features/ai-models/model.ts) predates the StatusPill canon and still returns the old
// kv-status--* token name ('ok' | 'warn' | 'muted'); mapped here rather than editing that shared helper.
const MODEL_TONE: Record<'ok' | 'warn' | 'muted', StatusTone> = { ok: 'success', warn: 'warning', muted: 'neutral' };

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('aiModels.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['promoted', 'threshold', 'thresholdCleared']);
const ERR = new Set(['status', 'illegal', 'threshold', 'reason', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="kv-card kv-stat">
      <div className="kv-stat__label">{label}</div>
      <div className="kv-stat__value">{value}</div>
    </div>
  );
}

export default async function AiModelDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let report: FairnessReport | undefined;
  let notice: string | undefined;
  try {
    report = (await adminGet<FairnessReport>(`ai/models/${encodeURIComponent(params.id)}/fairness`)).data;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  if (!report) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/ai-models">{t.t('aiModels.back')}</Link></p>
        <p className="kv-error" role="alert">{notice}</p>
      </section>
    );
  }

  const m = report.model;
  const r = report.recent;
  const threshold = formatThreshold4(m.confidenceThreshold) ?? t.t('common.dash');
  const fromStatus = (isModelStatus(m.status) ? m.status : 'shadow') as ModelStatus;
  const targets = transitionTargets(fromStatus);
  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/ai-models">{t.t('aiModels.back')}</Link></p>
      <h1>{m.code} <span className="kv-muted">v{m.version}</span></h1>
      <p>
        <StatusPill tone={MODEL_TONE[modelStatusTone(m.status)]} label={t.t(modelStatusKey(m.status))} />
        <span className="kv-muted"> · {t.t('aiModels.providerLabel')}: {m.provider ?? t.t('common.dash')} · {t.t('aiModels.colThreshold')}: {threshold}</span>
      </p>
      {okKey && <p className="kv-success" role="status">{t.t(`aiModels.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`aiModels.err.${errKey}`)}</p>}

      <h2>{t.t('aiModels.rollup', { window: r.window })}</h2>
      <div className="kv-stat-row">
        <Stat label={t.t('aiModels.statInferences')} value={r.total.toLocaleString()} />
        <Stat label={t.t('aiModels.statOverridden')} value={r.overridden.toLocaleString()} />
        <Stat label={t.t('aiModels.statOverrideRate')} value={formatPercent2(r.overrideRate)} />
        <Stat label={t.t('aiModels.statLowConfidence')} value={r.lowConfidence.toLocaleString()} />
      </div>

      <h2>{t.t('aiModels.manageHeading')}</h2>
      {targets.length > 0 ? (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('aiModels.promoteTitle')}</summary>
          <p className="kv-field__hint">{t.t('aiModels.promoteHint')}</p>
          <form action={promoteModelAction} className="kv-form">
            <input type="hidden" name="id" value={m.id} />
            <input type="hidden" name="from" value={fromStatus} />
            <label className="kv-field__label">{t.t('aiModels.promoteTo')}</label>
            <select name="to" className="kv-input" defaultValue={targets[0]}>
              {targets.map((s) => <option key={s} value={s}>{t.t(modelStatusKey(s))}</option>)}
            </select>
            <label className="kv-field__label">{t.t('aiModels.reason')}</label>
            <input name="reason" className="kv-input" required minLength={1} maxLength={500} />
            <Button type="submit">{t.t('aiModels.promoteSubmit')}</Button>
          </form>
        </details>
      ) : <p className="kv-muted">{t.t('aiModels.terminal')}</p>}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('aiModels.thresholdTitle')}</summary>
        <p className="kv-field__hint">{t.t('aiModels.thresholdHint')}</p>
        <form action={tuneThresholdAction} className="kv-form">
          <input type="hidden" name="id" value={m.id} />
          <label className="kv-field__label">{t.t('aiModels.thresholdField')}</label>
          <input name="confidenceThreshold" className="kv-input" inputMode="decimal" defaultValue={formatThreshold4(m.confidenceThreshold) ?? ''} placeholder={t.t('aiModels.thresholdPlaceholder')} />
          <label className="kv-field__label">{t.t('aiModels.reason')}</label>
          <input name="reason" className="kv-input" required minLength={1} maxLength={500} />
          <Button type="submit">{t.t('aiModels.thresholdSubmit')}</Button>
        </form>
      </details>

      <h2>{t.t('aiModels.fairnessHeading')}</h2>
      {report.storedFairnessAudit
        ? <pre className="kv-card kv-pre">{JSON.stringify(report.storedFairnessAudit, null, 2)}</pre>
        : <p className="kv-muted">{t.t('aiModels.fairnessEmpty')}</p>}
    </section>
  );
}
