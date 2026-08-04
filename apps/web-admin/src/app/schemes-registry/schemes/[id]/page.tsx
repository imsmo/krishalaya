// apps/web-admin/src/app/schemes-registry/schemes/[id]/page.tsx · scheme detail + meta/rules/window/active edits +
// change history. Server component: requireAdmin gates, fetches GET /v1/schemes-registry/schemes/:id (404 →
// notFound) and GET :id/history (degrades independently). updateMeta (PATCH :id, no version bump), updateRules
// (POST :id/rules, BUMPS version — snapshot integrity), setWindow (POST :id/window) and activate/deactivate (POST
// :id/active) are Server-Action forms with a mandatory audit reason. processing_fee_minor is minor-unit digit
// string, shown via formatMoneyMinor (Law 2). Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { DataTable, Column } from '../../../../components/DataTable';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { SchemeRow, SchemeChangeRow } from '../../../../features/schemes-registry/scheme';
import { updateMetaAction, updateRulesAction, setWindowAction, setSchemeActiveAction } from '../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sr.schemeDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'meta', 'rules', 'window', 'activated', 'deactivated']);
const ERR = new Set(['defaultName', 'authorityId', 'categoryId', 'sourceUrl', 'benefitSummary', 'eligibilityRules', 'requiredDocTypeIds', 'applicableRegionIds', 'processingFeeMinor', 'window', 'isActive', 'reason', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function SchemeDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let s: SchemeRow | undefined; let notice: string | undefined;
  try { s = (await adminGet<SchemeRow>(`schemes-registry/schemes/${encodeURIComponent(params.id)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let history: SchemeChangeRow[] = [];
  try { history = (await adminGet<SchemeChangeRow[]>(`schemes-registry/schemes/${encodeURIComponent(params.id)}/history`, { limit: 50 })).data ?? []; } catch { /* degrade */ }

  if (!s) {
    return <section><p className="kv-backlink"><Link href="/schemes-registry/schemes">{t.t('sr.backSchemes')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const win = s.applicationWindow;
  const benefitJson = JSON.stringify(s.benefitSummary ?? {});
  const eligJson = JSON.stringify(s.eligibilityRules ?? {});
  const docsCsv = (s.requiredDocTypeIds ?? []).join(', ');
  const regionsCsv = (s.applicableRegionIds ?? []).join(', ');
  const histCols: Column<SchemeChangeRow>[] = [
    { header: t.t('sr.histAction'), cell: (h) => h.action },
    { header: t.t('sr.histReason'), cell: (h) => h.reason },
    { header: t.t('sr.histWhen'), cell: (h) => h.createdAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/schemes-registry/schemes">{t.t('sr.backSchemes')}</Link></p>
      <h1>{s.code} <span className="kv-muted">v{s.version}</span></h1>
      {okKey && <p className="kv-success" role="status">{t.t(`sr.ok.${okKey === 'created' ? 'schemeCreated' : okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`sr.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('sr.schemeName')}</dt><dd>{s.defaultName}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('sr.active')}</dt><dd><span className={`kv-status ${s.isActive ? 'kv-status--ok' : 'kv-status--muted'}`}>{s.isActive ? t.t('sr.activeYes') : t.t('sr.activeNo')}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('sr.fee')}</dt><dd>{formatMoneyMinor(s.processingFeeMinor, 'INR')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('sr.window')}</dt><dd>{win ? `${win.opens} → ${win.closes}${win.season ? ` (${win.season})` : ''}` : t.t('sr.windowNone')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('sr.authorityId')}</dt><dd>{s.authorityId}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('sr.categoryId')}</dt><dd>{s.categoryId}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('sr.sourceUrl')}</dt><dd>{s.sourceUrl ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('sr.benefitSummary')}</dt><dd><pre className="kv-pre">{benefitJson}</pre></dd></div>
        <div className="kv-facts__row"><dt>{t.t('sr.eligibilityRules')}</dt><dd><pre className="kv-pre">{eligJson}</pre></dd></div>
      </dl>

      <h2>{t.t('sr.editHeading')}</h2>
      <div className="kv-action-cards">
        <form action={updateMetaAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={s.id} />
          <p className="kv-field__hint">{t.t('sr.metaHint')}</p>
          <label className="kv-field__label">{t.t('sr.schemeName')}</label>
          <input name="defaultName" className="kv-input" required maxLength={250} defaultValue={s.defaultName} />
          <label className="kv-field__label">{t.t('sr.authorityId')}</label>
          <input name="authorityId" className="kv-input" required defaultValue={s.authorityId} />
          <label className="kv-field__label">{t.t('sr.categoryId')}</label>
          <input name="categoryId" className="kv-input" required defaultValue={s.categoryId} />
          <label className="kv-field__label">{t.t('sr.sourceUrl')}</label>
          <input name="sourceUrl" className="kv-input" defaultValue={s.sourceUrl ?? ''} placeholder="https://…" />
          <label className="kv-field__label">{t.t('sr.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('sr.saveMeta')}</button>
        </form>

        <form action={updateRulesAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={s.id} />
          <p className="kv-field__hint">{t.t('sr.rulesHint')}</p>
          <label className="kv-field__label">{t.t('sr.benefitSummary')}</label>
          <input name="benefitSummary" className="kv-input" required defaultValue={benefitJson} placeholder={t.t('sr.jsonHint')} />
          <label className="kv-field__label">{t.t('sr.eligibilityRules')}</label>
          <input name="eligibilityRules" className="kv-input" required defaultValue={eligJson} placeholder={t.t('sr.jsonHint')} />
          <label className="kv-field__label">{t.t('sr.requiredDocTypeIds')}</label>
          <input name="requiredDocTypeIds" className="kv-input" defaultValue={docsCsv} placeholder={t.t('sr.uuidListHint')} />
          <label className="kv-field__label">{t.t('sr.applicableRegionIds')}</label>
          <input name="applicableRegionIds" className="kv-input" defaultValue={regionsCsv} placeholder={t.t('sr.uuidListHint')} />
          <label className="kv-field__label">{t.t('sr.feeMinor')}</label>
          <input name="processingFeeMinor" className="kv-input" inputMode="numeric" defaultValue={s.processingFeeMinor} />
          <label className="kv-field__label">{t.t('sr.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('sr.saveRules')}</button>
        </form>

        <form action={setWindowAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={s.id} />
          <p className="kv-field__hint">{t.t('sr.windowHint')}</p>
          <label className="kv-field__label">{t.t('sr.windowOpens')}</label>
          <input name="opens" className="kv-input" defaultValue={win?.opens ?? ''} placeholder={t.t('sr.mmddHint')} />
          <label className="kv-field__label">{t.t('sr.windowCloses')}</label>
          <input name="closes" className="kv-input" defaultValue={win?.closes ?? ''} placeholder={t.t('sr.mmddHint')} />
          <label className="kv-field__label">{t.t('sr.season')}</label>
          <input name="season" className="kv-input" defaultValue={win?.season ?? ''} placeholder={t.t('sr.seasonHint')} />
          <label className="kv-field__label">{t.t('sr.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('sr.saveWindow')}</button>
        </form>

        <form action={setSchemeActiveAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={s.id} />
          <input type="hidden" name="isActive" value={s.isActive ? 'false' : 'true'} />
          <p className="kv-field__hint">{s.isActive ? t.t('sr.deactivateHint') : t.t('sr.activateHint')}</p>
          <label className="kv-field__label">{t.t('sr.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className={`kv-btn${s.isActive ? ' kv-btn--danger' : ''}`}>{s.isActive ? t.t('sr.deactivate') : t.t('sr.activate')}</button>
        </form>
      </div>

      <h2>{t.t('sr.historyHeading')}</h2>
      <DataTable columns={histCols} rows={history} empty={t.t('sr.noHistory')} />
    </section>
  );
}
