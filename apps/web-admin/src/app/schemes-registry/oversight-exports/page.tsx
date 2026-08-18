// apps/web-admin/src/app/schemes-registry/oversight-exports/page.tsx · the receipt law's SIXTH surface, and the one
// ADMIN-4's registry export refused by name (PC-56 ADMIN-4b).
//
// ADMIN-4 listed `applications` and `dbt` in `NOT_EXPORTABLE` with reasons. Both reasons are answered here rather than
// waived:
//   • applications carried cross-tenant applicant PII under the registry read permission → the route now needs
//     `schemes.applications.read`, and the FILE IS MASKED;
//   • dbt carried bank-side references → the columns are enumerated by hand and checked on the way out.
//
// AND THE FILE IS MASKED EVEN THOUGH A PERMITTED OPERATOR CAN UNMASK ON SCREEN. That is not an inconsistency, it is
// the point: an export is the artefact most likely to outlive the permission that produced it — it sits in a downloads
// folder, gets attached to an email, and is opened by somebody who never had the permission. There is no per-row audit
// trail for a CSV and an unmasked file cannot be recalled.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { getTranslator } from '../../../lib/i18n';
import { OVERSIGHT_EXPORT_REPORTS, APPLICATION_STATES } from '../../../features/schemes-registry/oversight';

import { Button, Callout } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('soxp.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['soxp_report', 'soxp_limit', 'soxp_days', 'soxp_status', 'soxp_generic', 'elevation']);

export default function OversightExportsPage({ searchParams }: { searchParams: { error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/schemes-registry/applications">{t.t('sov.backApps')}</Link></p>
      <h1>{t.t('soxp.heading')}</h1>
      <p className="kv-muted">{t.t('soxp.lead')}</p>
      {errKey && <p className="kv-error" role="alert">{t.t(`soxp.error.${errKey === 'elevation' ? 'elevation' : errKey.replace('soxp_', '')}`)}</p>}

      <Callout>{t.t('soxp.receiptPromise')}</Callout>
      {/* Stated before the button, because somebody expecting full contact details needs to know before they build a
          process on this file. */}
      <Callout>{t.t('soxp.alwaysMasked')}</Callout>
      <Callout>{t.t('soxp.noBankFields')}</Callout>

      <form action="/schemes-registry/oversight-exports/download" method="get" className="kv-card kv-action-card">
        <label className="kv-field__label" htmlFor="report">{t.t('soxp.report')}</label>
        <select id="report" name="report" className="kv-input" defaultValue="applications">
          {OVERSIGHT_EXPORT_REPORTS.map((r) => <option key={r} value={r}>{t.t(`soxp.report.${r}`)}</option>)}
        </select>

        <label className="kv-field__label" htmlFor="status">{t.t('soxp.status')}</label>
        <select id="status" name="status" className="kv-input" defaultValue="all">
          <option value="all">{t.t('sov.stateAll')}</option>
          {APPLICATION_STATES.map((s) => <option key={s} value={s}>{t.t(`sov.state.${s}`)}</option>)}
        </select>
        <p className="kv-field__hint">{t.t('soxp.statusHint')}</p>

        <label className="kv-field__label" htmlFor="days">{t.t('soxp.days')}</label>
        <input id="days" name="days" className="kv-input kv-input--sm" inputMode="numeric" placeholder="30" />
        <p className="kv-field__hint">{t.t('soxp.daysHint')}</p>

        <label className="kv-field__label" htmlFor="limit">{t.t('soxp.limit')}</label>
        <input id="limit" name="limit" className="kv-input kv-input--sm" inputMode="numeric" placeholder="5000" />
        <p className="kv-field__hint">{t.t('soxp.limitHint')}</p>

        <Button type="submit">{t.t('soxp.download')}</Button>
      </form>

      <h2>{t.t('soxp.whatsInHeading')}</h2>
      <ul>
        <li>{t.t('soxp.in.applications')}</li>
        <li>{t.t('soxp.in.dbt_credits')}</li>
        <li>{t.t('soxp.in.dbt_bounces')}</li>
        <li>{t.t('soxp.in.rejections')}</li>
      </ul>
    </section>
  );
}
