// apps/web-tenant/src/app/auditor/exports/page.tsx · W201 · THE AUDITOR'S EXPORTS (PC-56 TENANT-9c) — the caller's own jobs for
// the three auditor datasets on the 6e-2 plane, newest first (keyset). The canon calls them "signed exports — a sealed
// evidence bag: content hash + platform signature + generation record". Two of three are real and shown: the sha256 the
// plane computed over the stored bytes, and the generation record (the receipt + the audit row). The platform signature is
// NOT (no signing key — founder-physical): every row says "unsigned", the *Verify · verifiable* column is refused by name,
// and so are the PDF summary / watermark and "byte-identical re-run". *New export* opens the export chain's confirm step.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { AuditorExportsPage } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import { DataTable } from '../../../components/DataTable';
import { shaGroups } from '../../../features/dairy/exports';
import {
  AUDITOR_HREF, EXPORTS_HREF, MAX_EXPORT_WINDOW_DAYS, PACK_HREF, PAGE_REFUSALS, datasetKey, exportHref, newExportHref, purposeKey, realmState,
  realmStateKey, refusedKey, sectionKey, windowFilters, type RealmState,
} from '../../../features/auditor/realm';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auditor.exports.title'), robots: { index: false, follow: false } };
}

export default async function AuditorExportsPageView({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!env.featureAuditor) notFound();
  await requireSession(EXPORTS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const f = windowFilters(searchParams);
  let page: AuditorExportsPage | null = null; let state: RealmState | null = null;
  try { page = await tenantClient().auditor.exports({ cursor: f.cursor }); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = realmState(err?.code, err?.status); }
  const zone = page?.zone;
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', ...(zone ? { timeZone: zone } : {}) }) : t.t('common.dash'));
  const today = page?.today ?? '';
  const fyStart = page?.fiscalYear.declared ? page.fiscalYear.start ?? today : today;

  return (
    <section>
      <nav aria-label={t.t('auditor.breadcrumb')} className="kv-field__hint"><Link href={AUDITOR_HREF}>{t.t('auditor.title')}</Link>{' / '}{t.t('auditor.exports.title')}</nav>
      <h1>{t.t('auditor.exports.title')}</h1>
      <div className="kv-card kv-card--notice" role="note"><p>{t.t('auditor.exports.banner')}</p></div>
      <p><Link href={PACK_HREF} className="kv-btn kv-btn--secondary">{t.t('auditor.link.pack')}</Link></p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(realmStateKey(state))}</p>
          {state === 'restricted' && <p className="kv-field__hint">{t.t('auditor.exports.restricted')}</p>}
        </div>
      )}

      {page && (
        <>
          <div className="kv-card">
            <h2 className="kv-section-title">{t.t('auditor.exports.new')}</h2>
            <p className="kv-field__hint">{t.t('auditor.exports.new.lead', { max: formatNumber(MAX_EXPORT_WINDOW_DAYS, lang) })}</p>
            <ul className="kv-list">
              <li><Link href={newExportHref('ledger.entries', { from: fyStart, to: today })} className="kv-btn--link">{t.t('auditor.exports.new.ledger')}</Link></li>
              <li><Link href={newExportHref('audit.trail', { from: fyStart, to: today })} className="kv-btn--link">{t.t('auditor.exports.new.trail')}</Link></li>
              <li><Link href={PACK_HREF} className="kv-btn--link">{t.t('auditor.exports.new.pack')}</Link></li>
            </ul>
          </div>

          <DataTable
            rows={page.items}
            empty={t.t('auditor.exports.empty')}
            columns={[
              { header: t.t('auditor.exports.col.generated'), cell: (j) => <Link href={exportHref(j.id)}>{when(j.generatedAt ?? j.queuedAt)}</Link> },
              { header: t.t('auditor.exports.col.export'), cell: (j) => <>{t.t(datasetKey(j.datasetCode))}{typeof j.params.section === 'string' ? ` · ${t.t(sectionKey(j.params.section))}` : ''}</> },
              { header: t.t('auditor.exports.col.period'), cell: (j) => `${String(j.params.from ?? '')} – ${String(j.params.to ?? '')}` },
              { header: t.t('auditor.exports.col.status'), cell: (j) => t.t(`auditor.exports.status.${j.status}`) },
              { header: t.t('auditor.exports.col.hash'), cell: (j) => j.receipt ? <code className="kv-mono" style={{ overflowWrap: 'anywhere' }}>sha256:{shaGroups(j.receipt.sha256).slice(0, 9)}…{j.receipt.sha256.slice(-4)}</code> : t.t('common.dash') },
              { header: t.t('auditor.exports.col.signature'), cell: () => <span className="kv-badge kv-badge--muted">{t.t('auditor.exports.unsigned')}</span> },
            ]}
          />
          {page.nextCursor && <p><Link href={`${EXPORTS_HREF}?cursor=${encodeURIComponent(page.nextCursor)}`} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('aud.list.next')}</Link></p>}
          <p className="kv-field__hint">{t.t('auditor.exports.recorded')} · {t.t(purposeKey(page.logged.purpose))} <code>{page.logged.readId}</code></p>

          <div className="kv-card">
            <h2 className="kv-section-title">{t.t('auditor.exports.verify.title')}</h2>
            <ol className="kv-list">
              <li>{t.t('auditor.exports.verify.hash')}</li>
              <li>{t.t('auditor.exports.verify.links')}</li>
              <li>{page.unsignedNote}</li>
            </ol>
            {PAGE_REFUSALS.exports.map((r) => <p key={r} className="kv-field__hint">{t.t(refusedKey(r))}</p>)}
          </div>
          <div className="kv-card">
            <h2 className="kv-section-title">{t.t('auditor.exports.discipline.title')}</h2>
            <ul className="kv-list">
              <li>✓ {t.t('auditor.exports.discipline.masked')}</li>
              <li>✓ {t.t('auditor.exports.discipline.bounded', { max: formatNumber(MAX_EXPORT_WINDOW_DAYS, lang) })}</li>
              <li>✓ {t.t('auditor.exports.discipline.recorded')}</li>
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
