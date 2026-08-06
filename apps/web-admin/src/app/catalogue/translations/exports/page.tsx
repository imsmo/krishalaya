// apps/web-admin/src/app/catalogue/translations/exports/page.tsx · TAXONOMY EXPORTS (PC-56 ADMIN-3b, closes ADMIN-3-Q2).
//
// W019's "Export tree" and W028's "Export missing" both had nothing behind them. The missing-translations report is the
// one that matters: it is the file somebody hands to a translator, so it carries the English text and an EMPTY column to
// fill in — and a key whose only translation is an unreviewed draft still counts as missing, because no farmer can read
// it.
//
// NO EXPORT IN THIS PLANE CARRIES A PERSON. No reviewer ids, no author ids. A translator needs the words.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import {
  TAXONOMY_REPORTS, reportNeedsLanguage, MAX_EXPORT_ROWS, DEFAULT_EXPORT_ROWS, type LanguageRow,
} from '../../../../features/catalogue/translations';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('texp.title'), robots: { index: false, follow: false } };
}

export default async function TaxonomyExportsPage({ searchParams }: { searchParams: { error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let languages: LanguageRow[] = [];
  try { languages = (await adminGet<{ languages: LanguageRow[] }>('translations/coverage')).data?.languages ?? []; }
  catch { languages = []; }

  const errKey = searchParams.error?.startsWith('texp_') ? searchParams.error.slice(5) : searchParams.error;

  return (
    <section>
      <p className="kv-backlink"><Link href="/catalogue/translations">{t.t('cat.back')}</Link></p>
      <h1>{t.t('texp.title')}</h1>
      <p className="kv-muted">{t.t('texp.lead')}</p>

      {errKey && (
        <p className="kv-error" role="alert">
          {t.t(`texp.error.${['report', 'exportLanguage', 'language', 'limit', 'generic'].includes(errKey) ? errKey : 'generic'}`)}
        </p>
      )}

      {/* both stated before the control */}
      <p className="kv-notice" role="note">{t.t('texp.missingNote')}</p>
      <p className="kv-field__hint">{t.t('texp.noPeople')}</p>

      <form action="/catalogue/translations/exports/download" method="get" className="kv-form">
        <label htmlFor="x-report" className="kv-field__label">{t.t('texp.report')}</label>
        <select id="x-report" name="report" className="kv-input" required defaultValue="category_tree">
          {TAXONOMY_REPORTS.map((r) => (
            <option key={r} value={r}>{t.t(`texp.report.${r}`)}{reportNeedsLanguage(r) ? ' *' : ''}</option>
          ))}
        </select>

        <label htmlFor="x-lang" className="kv-field__label">{t.t('texp.language')}</label>
        <select id="x-lang" name="languageCode" className="kv-input" defaultValue="">
          <option value="">{t.t('common.dash')}</option>
          {languages.map((l) => <option key={l.code} value={l.code}>{l.nameNative} ({l.code})</option>)}
        </select>
        <p className="kv-field__hint">{t.t('texp.languageHint')}</p>

        <label htmlFor="x-limit" className="kv-field__label">{t.t('texp.limit')}</label>
        <input id="x-limit" name="limit" type="number" min={1} max={MAX_EXPORT_ROWS} className="kv-input"
          defaultValue={DEFAULT_EXPORT_ROWS} />
        <p className="kv-field__hint">{t.t('texp.limitNote')}</p>

        <button type="submit" className="kv-btn">{t.t('texp.download')}</button>
      </form>
    </section>
  );
}
