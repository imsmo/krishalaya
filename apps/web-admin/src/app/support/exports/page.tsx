// apps/web-admin/src/app/support/exports/page.tsx · SUPPORT EXPORTS (PC-56 ADMIN-2c, canon W1944-45, W2121-22, W2270-71).
//
// Five reports behind the W054-10 receipt law: the receipt (who, when, which filters, how many rows) is written to the
// audit ledger BEFORE a single row is handed over, and no receipt means no file.
//
// WHAT THIS PAGE DOES THAT THE BILLING EXPORT PAGE DID NOT HAVE TO:
//   • IT WARNS BEFORE THE DOWNLOAD, NOT AFTER. Two of these reports contain free text a farmer wrote about their own
//     money going missing. A warning that arrives with the file is a warning about something already done, so the notice
//     is rendered as soon as such a report is selectable, and the receipt records `containsFreeText` either way.
//   • IT NAMES WHAT IS NOT EXPORTABLE. Coaching records are readable in the console and are deliberately not offered as
//     a file — a coaching CSV is a portable spreadsheet of named people and judgements about their competence, which
//     outlives every context that made it fair. Stating that beats leaving a gap somebody later fills in.
//
// A WINDOW IS MANDATORY. There is no meaningful unbounded export of support data, and an operator who did not pick a
// period has not decided what is leaving the system.
//
// The form is a GET submission to ./download, which performs the POST that writes the receipt. No Server Action here: an
// action cannot return a file.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { getTranslator } from '../../../lib/i18n';
import { Button, Callout } from '@krishalaya/ui';
import {
  SUPPORT_REPORTS, carriesFreeText, acceptsScoreFilter, MAX_EXPORT_ROWS, DEFAULT_EXPORT_ROWS,
} from '../../../features/support/export';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sexp.title'), robots: { index: false, follow: false } };
}

/** A sensible default window: the last full month, ending today. An empty date pair is a form somebody has to fill in
 *  twice before it works, and a default month is a real choice rather than a guess about the data. */
function defaultWindow(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default async function SupportExportsPage({ searchParams }: { searchParams: { error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const win = defaultWindow();
  const errKey = searchParams.error?.startsWith('sexp_') ? searchParams.error.slice(5) : searchParams.error;

  return (
    <section>
      <p className="kv-backlink"><Link href="/support">{t.t('support.back')}</Link></p>
      <h1>{t.t('sexp.title')}</h1>
      <p className="kv-muted">{t.t('sexp.lead')}</p>

      {errKey && (
        <p className="kv-error" role="alert">
          {t.t(`sexp.error.${['window', 'report', 'generic'].includes(errKey) ? errKey : 'generic'}`)}
        </p>
      )}

      {/* Said before anything is selected, because it applies to two of the five options and the consequence is
          irreversible once a file exists. */}
      <Callout>{t.t('sexp.verbatimWarn')}</Callout>

      <form action="/support/exports/download" method="get" className="kv-form">
        <label htmlFor="report" className="kv-field__label">{t.t('sexp.report')}</label>
        <select id="report" name="report" className="kv-input" required defaultValue="csat">
          {SUPPORT_REPORTS.map((r) => (
            <option key={r} value={r}>
              {t.t(`sexp.report.${r}`)}
              {/* the warning travels with the OPTION, so it is visible at the moment of choosing */}
              {carriesFreeText(r) ? ' ⚠' : ''}
            </option>
          ))}
        </select>

        <label htmlFor="from" className="kv-field__label">{t.t('sexp.from')}</label>
        <input id="from" name="from" type="date" className="kv-input" required defaultValue={win.from} />
        <label htmlFor="to" className="kv-field__label">{t.t('sexp.to')}</label>
        <input id="to" name="to" type="date" className="kv-input" required defaultValue={win.to} />
        <p className="kv-field__hint">{t.t('sexp.windowNote')}</p>

        <label htmlFor="tenantId" className="kv-field__label">{t.t('sexp.tenantId')}</label>
        <input id="tenantId" name="tenantId" className="kv-input" />

        <label htmlFor="maxScore" className="kv-field__label">{t.t('sexp.maxScore')}</label>
        <select id="maxScore" name="maxScore" className="kv-input" defaultValue="">
          <option value="">{t.t('support.filterAll')}</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{n}</option>)}
        </select>
        {/* the filter is DROPPED for reports that cannot use it rather than silently applied — named here so nobody
            concludes their filter was ignored by accident */}
        <p className="kv-field__hint">
          {SUPPORT_REPORTS.filter((r) => !acceptsScoreFilter(r)).map((r) => t.t(`sexp.report.${r}`)).join(', ')}
          {' — '}{t.t('support.filterAll')}
        </p>

        <label htmlFor="limit" className="kv-field__label">{t.t('sexp.limit')}</label>
        <input id="limit" name="limit" type="number" min={1} max={MAX_EXPORT_ROWS} className="kv-input"
          defaultValue={DEFAULT_EXPORT_ROWS} />
        <p className="kv-field__hint">{t.t('sexp.limitNote')}</p>

        <Button type="submit">{t.t('sexp.download')}</Button>
      </form>

      {/* The refusal, named. A missing option reads as an oversight; a stated one reads as a decision. */}
      <Callout>{t.t('sexp.noCoaching')}</Callout>
    </section>
  );
}
