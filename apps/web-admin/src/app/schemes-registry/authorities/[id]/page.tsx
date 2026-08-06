// apps/web-admin/src/app/schemes-registry/authorities/[id]/page.tsx · authority detail + edit + change history.
// Server component: requireAdmin gates, fetches GET /v1/schemes-registry/authorities/:id (404 → notFound) and GET
// :id/history (degrades independently). Edit (PATCH :id — name/level/region) is a Server-Action form with a
// mandatory audit reason. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { DataTable, Column } from '../../../../components/DataTable';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { AUTHORITY_LEVELS, authorityLevelKey, type AuthorityRow, type SchemeChangeRow } from '../../../../features/schemes-registry/scheme';
import { updateAuthorityAction, mapPortalAction, unmapPortalAction } from '../../actions';
import { portalState, portalClass, PORTAL_PROVIDERS } from '../../../../features/schemes-registry/version';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sr.authDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'updated', 'portalMapped', 'portalUnmapped']);
const ERR = new Set(['defaultName', 'level', 'regionId', 'reason', 'providerCode', 'externalId', 'endpointLabel', 'secretShaped', 'portalHeld', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

/** The detail payload carries the DELTA-018 mapping and the count W072 shows. */
type AuthorityDetail = AuthorityRow & {
  activeSchemes?: number;
  portalState?: string;
  portal?: { providerCode?: string | null; externalId?: string | null; endpointLabel?: string | null } | null;
};

export default async function AuthorityDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let auth: AuthorityDetail | undefined; let notice: string | undefined;
  try { auth = (await adminGet<AuthorityDetail>(`schemes-registry/authorities/${encodeURIComponent(params.id)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let history: SchemeChangeRow[] = [];
  try { history = (await adminGet<SchemeChangeRow[]>(`schemes-registry/authorities/${encodeURIComponent(params.id)}/history`, { limit: 50 })).data ?? []; } catch { /* degrade */ }

  if (!auth) {
    return <section><p className="kv-backlink"><Link href="/schemes-registry">{t.t('sr.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const lvl = authorityLevelKey(auth.level);
  const histCols: Column<SchemeChangeRow>[] = [
    { header: t.t('sr.histAction'), cell: (h) => h.action },
    { header: t.t('sr.histReason'), cell: (h) => h.reason },
    { header: t.t('sr.histWhen'), cell: (h) => h.createdAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/schemes-registry">{t.t('sr.back')}</Link></p>
      <h1>{auth.defaultName}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(okKey === 'portalMapped' ? 'sv.ok.portalMapped' : okKey === 'portalUnmapped' ? 'sv.ok.portalUnmapped' : 'sr.ok.authUpdated')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`sr.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('sr.level')}</dt><dd>{t.t(`sr.lvl.${lvl}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('sr.regionId')}</dt><dd>{auth.regionId ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('sv.activeSchemes')}</dt><dd>{String(auth.activeSchemes ?? 0)}</dd></div>
        <div className="kv-facts__row">
          <dt>{t.t('sv.portal')}</dt>
          <dd>
            <span className={portalClass(portalState(auth))}>{t.t(`sv.portalState.${portalState(auth)}`)}</span>
            {auth.portal?.providerCode ? ` · ${auth.portal.providerCode} · ${auth.portal.externalId ?? ''}` : ''}
            {auth.portal?.endpointLabel ? ` · ${auth.portal.endpointLabel}` : ''}
          </dd>
        </div>
      </dl>
      {/* Said in words on the screen, not only in the badge: a mapping is a record of intent, never evidence that a
          filing has ever succeeded. Nothing in this platform has called any of these portals. */}
      <p className="kv-notice">{t.t('sv.portalNeverSynced')}</p>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('sv.mapPortalHeading')}</summary>
        <form action={mapPortalAction} className="kv-form">
          <input type="hidden" name="id" value={auth.id} />
          <label className="kv-field__label" htmlFor="providerCode">{t.t('sv.provider')}</label>
          <select id="providerCode" name="providerCode" className="kv-input" defaultValue={auth.portal?.providerCode ?? 'pfms'}>
            {PORTAL_PROVIDERS.map((pc) => <option key={pc} value={pc}>{pc}</option>)}
          </select>
          <label className="kv-field__label" htmlFor="externalId">{t.t('sv.externalId')}</label>
          <input id="externalId" name="externalId" className="kv-input" required maxLength={200} defaultValue={auth.portal?.externalId ?? ''} />
          <label className="kv-field__label" htmlFor="endpointLabel">{t.t('sv.endpointLabel')}</label>
          <input id="endpointLabel" name="endpointLabel" className="kv-input" maxLength={200} defaultValue={auth.portal?.endpointLabel ?? ''} />
          {/* W072's own rule, restated where somebody might otherwise paste a token. */}
          <p className="kv-field__hint">{t.t('sv.credentialsElsewhere')}</p>
          <label className="kv-field__label" htmlFor="portalReason">{t.t('sr.reason')}</label>
          <input id="portalReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('sv.mapPortal')}</button>
        </form>
        {auth.portal?.providerCode && (
          <form action={unmapPortalAction} className="kv-form">
            <input type="hidden" name="id" value={auth.id} />
            <input type="hidden" name="providerCode" value={auth.portal.providerCode} />
            <label className="kv-field__label" htmlFor="unmapReason">{t.t('sr.reason')}</label>
            <input id="unmapReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
            <button type="submit" className="kv-btn kv-btn--danger">{t.t('sv.unmapPortal')}</button>
          </form>
        )}
      </details>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('sr.editAuth')}</summary>
        <form action={updateAuthorityAction} className="kv-form">
          <input type="hidden" name="id" value={auth.id} />
          <label className="kv-field__label">{t.t('sr.authName')}</label>
          <input name="defaultName" className="kv-input" required maxLength={200} defaultValue={auth.defaultName} />
          <label className="kv-field__label">{t.t('sr.level')}</label>
          <select name="level" className="kv-input" defaultValue={lvl}>{AUTHORITY_LEVELS.map((l) => <option key={l} value={l}>{t.t(`sr.lvl.${l}`)}</option>)}</select>
          <label className="kv-field__label">{t.t('sr.regionId')}</label>
          <input name="regionId" className="kv-input" defaultValue={auth.regionId ?? ''} placeholder={t.t('sr.regionHint')} />
          <label className="kv-field__label">{t.t('sr.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('sr.save')}</button>
        </form>
      </details>

      <h2>{t.t('sr.historyHeading')}</h2>
      <DataTable columns={histCols} rows={history} empty={t.t('sr.noHistory')} />
    </section>
  );
}
