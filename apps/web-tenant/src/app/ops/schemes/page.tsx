// apps/web-tenant/src/app/ops/schemes/page.tsx · W202 · THE SCHEMES DESK · PC-56 TENANT-SW-b (F-8).
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • tiles from GET /schemes/desk/summary: open applications, the rejection rate this financial year (rejected ÷ decided, or "no
//     decisions yet"), BENEFITS LANDED this FY — a FACT with its method (the sum of recorded DBT transfers credited in the FY, less
//     bounced ones), or "no transfers recorded" — never an estimate; "eligible but not applied" from the latest sweeps, or "no sweep
//     yet";
//   • the per-scheme table (real counts) → each scheme's pipeline (W203, `/ops/schemes/[code]`), where "Run eligibility sweep" lives;
//   • the scheme registry is the platform's (admin-api): this desk cannot edit a scheme — the database refuses it (REVOKE, F-8);
//   • the camp-day worklist is REFUSED BY NAME (no camp object exists on this platform).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { SchemeDeskRow, SchemeDeskSummary } from '@krishalaya/sdk-js';
import { formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import { SCHEMES_DESK_HREF, schemeHref, swbState } from '../../../features/swb/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swb.scm.title'), robots: { index: false, follow: false } };
}

export default async function SchemesDeskPage() {
  await requireSession(SCHEMES_DESK_HREF);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m && /^-?\d+$/.test(m) ? m : '0', 'INR', lang);
  const n = (v: number) => formatNumber(v, lang);
  const crumbs = <nav className="kv-breadcrumb" aria-label={t.t('swb.scm.breadcrumb')}><span>{t.t('lab.breadcrumb.operations')}</span> / <span aria-current="page">{t.t('swb.scm.title')}</span></nav>;
  const flaggedOff = <section>{crumbs}<h1>{t.t('swb.scm.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('swb.scm.state.flaggedOff.title')}</strong><p>{t.t('swb.scm.state.flaggedOff.body')}</p></div></section>;
  if (!env.featureSchemes) return flaggedOff;

  let summary: SchemeDeskSummary | null = null; let rows: SchemeDeskRow[] = []; let state: string | null = null;
  const [s, r] = await Promise.allSettled([tenantClient().schemes.deskSummary(), tenantClient().schemes.deskSchemes()]);
  if (s.status === 'fulfilled') summary = s.value; else { const e = s.reason instanceof SdkError ? s.reason : null; state = swbState(e?.code, e?.status); }
  if (r.status === 'fulfilled') rows = r.value; else if (!state) { const e = r.reason instanceof SdkError ? r.reason : null; state = swbState(e?.code, e?.status); }
  if (state === 'flaggedOff') return flaggedOff;

  return (
    <section>
      {crumbs}
      <div className="kv-page-head">
        <h1>{t.t('swb.scm.title')}</h1>
        <p className="kv-actions"><Link href="/schemes" className="kv-btn--link">{t.t('swb.scm.toOfficer')}</Link></p>
      </div>
      <p className="kv-field__hint">{t.t('swb.scm.lede')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`swb.scm.state.${state}.title`)}</strong><p>{t.t(`swb.scm.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={SCHEMES_DESK_HREF} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('lab.retry')}</Link></p>}
        </div>
      )}
      {summary && (
        <>
          <dl className="kv-tiles">
            <div className="kv-tile"><dt>{t.t('swb.scm.tile.open')}</dt><dd><strong>{n(summary.openApplications)}</strong></dd><dd className="kv-field__hint">{t.t('swb.scm.tile.openSub', { n: n(summary.openSchemes) })}</dd></div>
            <div className="kv-tile"><dt>{t.t('swb.scm.tile.rejection')}</dt>
              <dd><strong>{summary.rejectionRateFy.ratePct === null ? t.t('swb.scm.tile.noDecisions') : `${summary.rejectionRateFy.ratePct}%`}</strong></dd>
              <dd className="kv-field__hint">{t.t('swb.scm.tile.rejectionSub', { rejected: n(summary.rejectionRateFy.rejected), decided: n(summary.rejectionRateFy.decided), fy: summary.fy.label ?? summary.fy.start })}</dd></div>
            <div className="kv-tile"><dt>{t.t('swb.scm.tile.landed')}</dt>
              <dd><strong>{summary.benefitsLandedFy.minor === null ? t.t('swb.scm.tile.noTransfers') : money(summary.benefitsLandedFy.minor)}</strong></dd>
              <dd className="kv-field__hint">{summary.benefitsLandedFy.minor === null ? t.t('swb.scm.method') : t.t('swb.scm.tile.landedSub', { transfers: n(summary.benefitsLandedFy.transfers), members: n(summary.benefitsLandedFy.members) })}</dd></div>
            <div className="kv-tile"><dt>{t.t('swb.scm.tile.notApplied')}</dt>
              <dd><strong>{summary.eligibleNotApplied.count === null ? t.t('swb.scm.tile.noSweep') : n(summary.eligibleNotApplied.count)}</strong></dd>
              <dd className="kv-field__hint">{t.t('swb.scm.tile.notAppliedSub')}</dd></div>
          </dl>
          <p className="kv-field__hint">{t.t('swb.scm.method')}</p>
        </>
      )}
      {!state && (
        rows.length === 0 ? <div className="kv-card"><p className="kv-detail__muted">{t.t('swb.scm.empty')}</p></div> : (
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('swb.scm.col.scheme')}</th><th scope="col">{t.t('swb.scm.col.open')}</th><th scope="col">{t.t('swb.scm.col.all')}</th>
              <th scope="col">{t.t('swb.scm.col.landed')}</th><th scope="col">{t.t('swb.scm.col.active')}</th></tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.schemeId}>
                <th scope="row"><Link href={schemeHref(x.code)} className="kv-link">{x.name}</Link><div className="kv-field__hint"><code>{x.code}</code>{x.category ? ` · ${x.category}` : ''}</div></th>
                <td>{n(x.openApplications)}</td><td>{n(x.allApplications)}</td>
                <td>{x.fyBenefitMinor === null ? t.t('swb.scm.tile.noTransfers') : <>{money(x.fyBenefitMinor)}<div className="kv-field__hint">{t.t('swb.scm.transfers', { n: n(x.fyTransfers) })}</div></>}</td>
                <td>{t.t(x.isActive ? 'swb.scm.active' : 'swb.scm.inactive')}</td>
              </tr>
            ))}</tbody>
          </table>
        )
      )}
      <div className="kv-card kv-card--notice">
        <p className="kv-field__hint">{t.t('swb.scm.registry')}</p>
        <p className="kv-field__hint">{t.t('swb.scm.refused.campWorklist')}</p>
      </div>
    </section>
  );
}
