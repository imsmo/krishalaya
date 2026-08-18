// apps/web-admin/src/app/schemes-registry/exports/page.tsx · W069's "Export" and W078's "Export report", under the
// W054-10 audit-receipt law (chain W2251 queued → W2252 ready). Fifth surface of the same law.
//
// A plain GET form to a route handler, not a Server Action, because a Server Action cannot return a file. NO RECEIPT,
// NO FILE — the handler refuses to emit a byte unless admin-api returned a receipt id.
//
// TWO REPORTS THE CANON SHOWS ARE DELIBERATELY NOT OFFERED HERE, and the page says which and why rather than leaving
// an operator to conclude the feature is broken: scheme APPLICATIONS carry cross-tenant applicant PII and need their
// own permission, and DBT transfers carry bank-side references W076 forbids on that surface entirely. Both belong to
// the oversight plane, with their own permission and their own forbidden-column rule.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { getTranslator } from '../../../lib/i18n';
import { SCHEME_EXPORT_REPORTS } from '../../../features/schemes-registry/version';

import { Button, Callout } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sxp.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['sxp_report', 'sxp_limit', 'sxp_generic', 'elevation']);

export default function SchemeExportsPage({ searchParams }: { searchParams: { error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/schemes-registry/schemes">{t.t('sr.backSchemes')}</Link></p>
      <h1>{t.t('sxp.heading')}</h1>
      <p className="kv-muted">{t.t('sxp.lead')}</p>
      {errKey && <p className="kv-error" role="alert">{t.t(`sxp.error.${errKey === 'elevation' ? 'elevation' : errKey.replace('sxp_', '')}`)}</p>}

      {/* The receipt promise, stated before the button rather than after the download. */}
      <Callout>{t.t('sxp.receiptPromise')}</Callout>

      <form action="/schemes-registry/exports/download" method="get" className="kv-card kv-action-card">
        <label className="kv-field__label" htmlFor="report">{t.t('sxp.report')}</label>
        <select id="report" name="report" className="kv-input" defaultValue="schemes">
          {SCHEME_EXPORT_REPORTS.map((r) => <option key={r} value={r}>{t.t(`sxp.report.${r}`)}</option>)}
        </select>
        <label className="kv-field__label" htmlFor="limit">{t.t('sxp.limit')}</label>
        <input id="limit" name="limit" className="kv-input kv-input--sm" inputMode="numeric" placeholder="5000" />
        <p className="kv-field__hint">{t.t('sxp.limitHint')}</p>
        <Button type="submit">{t.t('sxp.download')}</Button>
      </form>

      {/* No date window, and the reason — a registry is a current state, not a stream of events. */}
      <p className="kv-detail__muted">{t.t('sxp.noDateWindow')}</p>

      <h2>{t.t('sxp.notHereHeading')}</h2>
      <ul>
        <li>{t.t('sxp.notHere.applications')}</li>
        <li>{t.t('sxp.notHere.dbt')}</li>
      </ul>
    </section>
  );
}
