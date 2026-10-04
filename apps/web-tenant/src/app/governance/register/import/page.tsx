// apps/web-tenant/src/app/governance/register/import/page.tsx · W2626 "Import the share register" — PC-56 TENANT-SW-d.
// Upload: CSV (columns phone, folio, shares, paid_up; ≤ 5,000 rows, ≤ 1 MiB) + the consent evidence (REQUIRED). Then the preview,
// propose, and a SECOND tenant_admin's confirm — the database refuses a confirmer who is the proposer. Phones are never shown in full.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { RegisterImport } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { MediaUploader } from '../../../../components/MediaUploader';
import { CONSENT_KINDS, IMPORT_MAX_ROWS, REGISTER_HREF, REGISTER_IMPORT_HREF, importHref, importStatusKey, istLabel, swdCodeKey, swdPageState } from '../../../../features/swd/console';
import { parseCodes } from '../../../../features/swc/console';
import { uploadImportAction } from './actions';
import { AsOf } from '../../../../components/AsOf';
import { asOfLabels } from '../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swd.import.title'), robots: { index: false, follow: false } };
}

export default async function RegisterImportPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(REGISTER_IMPORT_HREF);
  const t = getTranslator();
  let items: RegisterImport[] = []; let nextCursor: string | null = null; let state: string | null = null;
  try { const r = await tenantClient().registerImports.list(searchParams.cursor); items = r.items; nextCursor = r.nextCursor; }
  catch (e) { const err = e instanceof SdkError ? e : null; state = swdPageState(err?.code, err?.status); }
  const errors = parseCodes(searchParams.error);

  return (
    <section>
      <nav className="kv-field__hint"><Link href={REGISTER_HREF} className="kv-btn--link">{t.t('reg.title')}</Link> › {t.t('swd.import.title')}</nav>
      <h1>{t.t('swd.import.title')}</h1>
      {/* PC-56 TENANT-SW-f · W318 §1: when this page's data was read — absolute IST + relative; stale past 1 h */}
      <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
      <p className="kv-field__hint">{t.t('swd.import.lede')}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swd.state.${state}.title`)}</strong><p>{t.t(`swd.state.${state}.body`)}</p>
        {state === 'error' && <p><Link href={REGISTER_IMPORT_HREF} className="kv-btn--link">{t.t('swd.chain.retry')}</Link> <span className="kv-field__hint">{t.t('swd.refused.retry')}</span></p>}</div>}
      {errors.length > 0 && <div className="kv-error" role="alert"><strong>{t.t('swd.chain.failure')}</strong><ul className="kv-list">{errors.map((c) => <li key={c}>{t.t(swdCodeKey(c))}</li>)}</ul><p>{t.t('swd.chain.untouched')}</p></div>}

      {!state && (
        <form action={uploadImportAction} className="kv-form kv-form__card">
          <input type="hidden" name="key" value={randomUUID()} />
          <p>{t.t('swd.import.columns', { max: IMPORT_MAX_ROWS })}</p>
          <label className="kv-field" htmlFor="imp-file"><span>{t.t('swd.import.field.file')}</span><input id="imp-file" name="file" type="file" accept=".csv,text/csv" className="kv-input" /></label>
          <label className="kv-field" htmlFor="imp-csv"><span>{t.t('swd.import.field.csv')}</span><textarea id="imp-csv" name="csv" className="kv-textarea" rows={5} placeholder="phone,folio,shares,paid_up" /></label>
          <fieldset className="kv-fieldset"><legend>{t.t('swd.import.consent.title')}</legend>
            <p className="kv-field__hint">{t.t('swd.import.consent.hint')}</p>
            <label className="kv-field" htmlFor="imp-kind"><span>{t.t('swd.import.field.consentKind')}</span>
              <select id="imp-kind" name="consentKind" className="kv-select">{CONSENT_KINDS.map((k) => <option key={k} value={k}>{t.t(`swd.import.consent.${k}`)}</option>)}</select></label>
            <MediaUploader labels={{ add: t.t('swd.upload.add'), hint: t.t('swd.upload.hint'), uploading: t.t('swd.upload.uploading'), failed: t.t('swd.upload.failed'), remove: t.t('swd.upload.remove') }} fieldName="consentMediaId" single kind="document" inputId="imp-consent-file" />
            <label className="kv-field" htmlFor="imp-consent"><span>{t.t('swd.import.field.consentMediaId')}</span><input id="imp-consent" name="consentMediaId" className="kv-input" pattern="[0-9a-fA-F-]{36}" autoComplete="off" /></label>
          </fieldset>
          <p className="kv-field__hint">{t.t('swd.import.uploadHint')}</p>
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('swd.import.upload')}</button>
        </form>
      )}

      {!state && items.length > 0 && (
        <>
          <h2>{t.t('swd.import.history')}</h2>
          <table className="kv-table"><thead><tr><th>{t.t('swd.import.col.when')}</th><th>{t.t('swd.import.col.status')}</th><th>{t.t('swd.import.col.counts')}</th></tr></thead>
            <tbody>{items.map((x) => (
              <tr key={x.id}><td><Link href={importHref(x.id)} className="kv-btn--link">{istLabel(x.createdAt)}</Link></td><td>{t.t(importStatusKey(x.status))}</td>
                <td>{t.t('swd.import.counts', { rows: x.rowCount, valid: x.validCount, errors: x.errorCount, dup: x.duplicateCount })}</td></tr>))}</tbody></table>
          {nextCursor && <p><Link href={`${REGISTER_IMPORT_HREF}?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('swd.more')}</Link></p>}
        </>
      )}
    </section>
  );
}
