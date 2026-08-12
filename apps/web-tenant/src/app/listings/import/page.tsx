// apps/web-tenant/src/app/listings/import/page.tsx · W128, bulk listing upload (PC-56 TENANT-2c).
//
// **THE SCREEN IS "TELL ME BEFORE YOU DO IT", AND W128'S OWN SENTENCE IS THE LAW IT ENFORCES:** "Bulk-created
// listings still walk the normal path: draft → member consent (voice/app) → QC → published. Bulk speeds entry,
// never skips trust." So the triage is shown first (rows, valid, fixable, duplicates), the confirm button carries
// the COUNT the operator was shown, and every created row is a DRAFT that must still clear QC.
//
// TWO OF THE CANON'S FOUR FLAGGED ROWS ARE BUILT AS REAL VERDICTS (member not found; a per-quintal sheet holding a
// per-kilo price, caught only against a REAL peer band and offered as a suggestion nothing applies automatically),
// one is the duplicate column (same member + product + quantity, already live — skipped, never duplicated), and the
// fourth — "member KYC pending · draft allowed, publish blocks until verified" — is drawn as the HALF that is true
// plus the half that is NOT BUILT ANYWHERE: no KYC gate exists on publish on this platform (0125's per-role KYC map
// governs payouts and has no listing purpose), so the draft is allowed and the missing gate is named here rather
// than faked for imported lots only.
//
// The template downloads for real (generated from the SAME column list the importer parses, inline data URL, no JS,
// no queue) — W2355/W2356's export chain met as the synchronous truth: a static template is not tenant data, so
// there is nothing to enqueue and nothing to receipt.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { LISTING_IMPORT_COLUMNS, listingImportTemplateCsv, type BulkImportJob } from '@krishalaya/sdk-js';
import { importStage, issueSummary, canConfirm, hashShort } from '../../../features/people/import';
import { validateListingJobAction, confirmListingJobAction, cancelListingJobAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('limport.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['validated', 'confirmed', 'cancelled']);
const ERR = new Set(['validate', 'confirm', 'cancel', 'notValidatable', 'changed', 'failed']);

export default async function ListingImportPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/listings/import');
  const t = getTranslator();
  const lang = getLang();

  let jobs: BulkImportJob[] = []; let failed = false;
  try { jobs = (await tenantClient().bulkImports.list({ limit: 10 })).items.filter((j) => j.importType === 'listings'); }
  catch { failed = true; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(listingImportTemplateCsv())}`;

  return (
    <section>
      <nav aria-label={t.t('limport.title')} className="kv-fine">
        <Link href="/listings" className="kv-link">{t.t('listings.title')}</Link> › {t.t('limport.title')}
      </nav>

      <div className="kv-page-head">
        <h1>{t.t('limport.title')}</h1>
        <p className="kv-muted">{t.t('limport.subtitle')}</p>
        {okKey && <p className="kv-success" role="status">{t.t(`limport.ok.${okKey}` as never)}</p>}
        {errorKey && <p className="kv-error" role="alert">{t.t(`limport.error.${errorKey}` as never)}</p>}
      </div>

      {/* W128's own banner: bulk speeds entry, never skips trust. Rendered, not summarised. */}
      <div className="kv-card">
        <p>{t.t('limport.trustPath')}</p>
        <p className="kv-fine">{t.t('limport.consentNote')}</p>
        <p className="kv-fine">{t.t('limport.kycGap')}</p>
      </div>

      <h2 className="kv-section-title">{t.t('limport.templateHeading')}</h2>
      <p className="kv-fine">{t.t('limport.templateNote', { columns: LISTING_IMPORT_COLUMNS.join(', ') })}</p>
      <p className="kv-fine">{t.t('limport.templateRequired')}</p>
      <p><a className="kv-btn" href={templateHref} download="krishalaya_listings_template.csv">{t.t('limport.templateDownload')}</a></p>

      {failed ? (
        <p className="kv-error" role="alert">{t.t('limport.loadError')}</p>
      ) : jobs.length === 0 ? (
        <p className="kv-empty-state">{t.t('limport.empty')}</p>
      ) : (
        <>
          <h2 className="kv-section-title">{t.t('limport.jobsHeading')}</h2>
          <ul className="kv-notif-list">
            {jobs.map((j) => {
              const stage = importStage(j);
              const v = j.validation ?? null;
              return (
                <li key={j.id} className="kv-notif-item">
                  <span className="kv-notif-title">
                    {j.originalFilename ?? t.t('limport.unnamedFile')}
                    {' · '}<span className="kv-badge">{t.t(`import.stage.${stage}` as never)}</span>
                  </span>

                  {/* The triage — duplicates are a SUCCESS that creates nothing, not a failure. */}
                  {v && (
                    <span className="kv-notif-meta">
                      {t.t('limport.triage', { total: v.totalRows, create: v.willCreate, dupes: v.alreadyMembers, fixable: v.fixable, invalid: v.invalid })}
                    </span>
                  )}

                  {/* The file hash — the bytes that were validated are the bytes that get applied. */}
                  {j.fileSha256 && (
                    <span className="kv-fine">
                      {t.t('limport.hash', { hash: hashShort(j.fileSha256) })}
                      {j.validatedAt ? ` · ${t.t('limport.validatedAt', { at: formatDate(j.validatedAt, lang) })}` : ''}
                    </span>
                  )}

                  {/* Rows a human fixes in the FILE. A suggestion is shown AS a suggestion — nothing applies it. */}
                  {v && v.issues.length > 0 && (
                    <>
                      <span className="kv-fine">{issueSummary(v, t)}</span>
                      <ul className="kv-prefs-list">
                        {v.issues.map((iss) => (
                          <li key={iss.rowIndex} className="kv-prefs-row">
                            {t.t('limport.issueRow', { row: iss.rowIndex, message: iss.message })}
                            {iss.suggestion ? ` — ${t.t('limport.issueSuggestion', { suggestion: iss.suggestion })}` : ''}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  <span className="kv-actions">
                    {stage === 'uploaded' && (
                      <form action={validateListingJobAction} className="kv-inline-form">
                        <input type="hidden" name="jobId" value={j.id} />
                        <button type="submit" className="kv-btn">{t.t('limport.validate')}</button>
                      </form>
                    )}
                    {/* The button carries the COUNT the operator was shown — a different act from "Import". */}
                    {canConfirm(j) && (
                      <form action={confirmListingJobAction} className="kv-inline-form">
                        <input type="hidden" name="jobId" value={j.id} />
                        <button type="submit" className="kv-btn">{t.t('limport.confirm', { n: j.validation?.willCreate ?? 0 })}</button>
                      </form>
                    )}
                    {stage === 'validated' && (j.validation?.willCreate ?? 0) === 0 && (
                      <span className="kv-fine">{t.t('limport.nothingToCreate')}</span>
                    )}
                    {(stage === 'uploaded' || stage === 'validated') && (
                      <form action={cancelListingJobAction} className="kv-inline-form">
                        <input type="hidden" name="jobId" value={j.id} />
                        <button type="submit" className="kv-btn kv-btn--muted">{t.t('limport.cancel')}</button>
                      </form>
                    )}
                    {stage === 'done' && <Link href="/listings?status=draft" className="kv-link">{t.t('limport.seeDrafts')}</Link>}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="kv-fine kv-note">{t.t('limport.idempotentNote')}</p>
    </section>
  );
}
