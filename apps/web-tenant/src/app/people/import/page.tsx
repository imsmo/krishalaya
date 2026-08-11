// apps/web-tenant/src/app/people/import/page.tsx · W156, bulk member import (PC-56 TENANT-1b-4).
//
// **THE SCREEN IS THE FEATURE, AND ITS SHAPE IS "TELL ME BEFORE YOU DO IT".** W156 shows a triage — 220 rows, 214 valid,
// 4 already members ("matched by phone — skipped, never duplicated"), 2 fixable — and only THEN a button reading "Import
// 214 valid rows". Before this wave the rail applied rows as it streamed, so the only way to learn what a file would do was
// to let it do it: 220 half-created people and a phone call from every one of them.
//
// **AND THE CONSENT PARAGRAPH IS RENDERED, NOT SUMMARISED.** W156: "the invite SMS says who added them and why, in their
// language, with a decline path. A member who never installs the app still exists for payouts and records — the app is a
// door, not a wall." Staff are about to add several hundred people who did not ask to be added; the screen says what those
// people will receive and what happens if they ignore it.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { MEMBER_IMPORT_COLUMNS, type BulkImportJob } from '@krishalaya/sdk-js';
import { importStage, issueSummary, canConfirm, hashShort } from '../../../features/people/import';
import { validateJobAction, confirmJobAction, cancelJobAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('import.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['validated', 'confirmed', 'cancelled']);
const ERR = new Set(['validate', 'confirm', 'cancel', 'notValidatable', 'changed', 'failed']);

export default async function MemberImportPage(
  { searchParams }: { searchParams: { ok?: string; error?: string } },
) {
  await requireSession('/people/import');
  const t = getTranslator();
  const lang = getLang();

  let jobs: BulkImportJob[] = [];
  let failed = false;
  try {
    jobs = (await tenantClient().bulkImports.list({ limit: 10 })).items.filter((j) => j.importType === 'members');
  } catch { failed = true; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <nav aria-label={t.t('member.breadcrumb')} className="kv-fine">
        <Link href="/people" className="kv-link">{t.t('people.title')}</Link> › {t.t('import.title')}
      </nav>

      <div className="kv-page-head">
        <h1>{t.t('import.title')}</h1>
        <p className="kv-muted">{t.t('import.subtitle')}</p>
        {okKey && <p className="kv-success" role="status">{t.t(`import.ok.${okKey}`)}</p>}
        {errorKey && <p className="kv-error" role="alert">{t.t(`import.error.${errorKey}`)}</p>}
      </div>

      {/* --- THE CONSENT PARAGRAPH, BEFORE ANYTHING ELSE. Staff are about to add people who did not ask. --- */}
      <div className="kv-notice">
        <p>{t.t('import.consent')}</p>
        <p className="kv-fine">{t.t('import.consentDoor')}</p>
      </div>

      {/* --- The template. Its columns come from the SDK constant the importer itself reads, so it cannot drift. --- */}
      <h2 className="kv-section-title">{t.t('import.templateHeading')}</h2>
      <p className="kv-fine">{t.t('import.templateNote', { columns: MEMBER_IMPORT_COLUMNS.join(', ') })}</p>
      <p className="kv-fine">{t.t('import.templateOnlyPhone')}</p>

      {failed ? (
        <p className="kv-error" role="alert">{t.t('import.loadError')}</p>
      ) : jobs.length === 0 ? (
        // W156's empty state, and its actual advice: "Drop a CSV/Excel or take the template to your SHG meeting — paper
        // first, import after, works fine."
        <p className="kv-empty-state">{t.t('import.empty')}</p>
      ) : (
        <>
          <h2 className="kv-section-title">{t.t('import.jobsHeading')}</h2>
          <ul className="kv-notif-list">
            {jobs.map((j) => {
              const stage = importStage(j);
              const v = j.validation ?? null;
              return (
                <li key={j.id} className="kv-notif-item">
                  <span className="kv-notif-title">
                    {j.originalFilename ?? t.t('import.unnamedFile')}
                    {' · '}<span className="kv-badge">{t.t(`import.stage.${stage}`)}</span>
                  </span>

                  {/* **THE TRIAGE, WITH "ALREADY MEMBERS" AS A SUCCESS RATHER THAN A FAILURE.** Four members matched by
                      phone did not fail to import — they were already there, and the screen says exactly that. */}
                  {v && (
                    <span className="kv-notif-meta">
                      {t.t('import.triage', {
                        total: v.totalRows, create: v.willCreate, dupes: v.alreadyMembers,
                        fixable: v.fixable, invalid: v.invalid,
                      })}
                    </span>
                  )}

                  {/* The file hash. W156's restricted state: "every import batch is recorded with the file hash." */}
                  {j.fileSha256 && (
                    <span className="kv-fine">
                      {t.t('import.hash', { hash: hashShort(j.fileSha256) })}
                      {j.validatedAt ? ` · ${t.t('import.validatedAt', { at: formatDate(j.validatedAt, lang) })}` : ''}
                    </span>
                  )}

                  {/* The rows a human has to fix, with the suggestion shown AS a suggestion. W156's own row: "khedut ·
                      role name in Gujarati — mapped to farmer? confirm". Nothing here applies it. */}
                  {v && v.issues.length > 0 && (
                    <>
                      <span className="kv-fine">{issueSummary(v, t)}</span>
                      <ul className="kv-prefs-list">
                        {v.issues.map((iss) => (
                          <li key={iss.rowIndex} className="kv-prefs-row">
                            {t.t('import.issueRow', { row: iss.rowIndex, message: iss.message })}
                            {iss.suggestion ? ` — ${t.t('import.issueSuggestion', { suggestion: iss.suggestion })}` : ''}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  <span className="kv-actions">
                    {stage === 'uploaded' && (
                      <form action={validateJobAction} className="kv-inline-form">
                        <input type="hidden" name="jobId" value={j.id} />
                        <button type="submit" className="kv-btn">{t.t('import.validate')}</button>
                      </form>
                    )}
                    {/* **THE BUTTON CARRIES THE NUMBER, WHICH IS W156's WORDING AND NOT DECORATION.** "Import 214 valid
                        rows" is a different act from "Import" — the operator confirms a COUNT they were shown, and the
                        audit row records the counts they saw. */}
                    {canConfirm(j) && (
                      <form action={confirmJobAction} className="kv-inline-form">
                        <input type="hidden" name="jobId" value={j.id} />
                        <button type="submit" className="kv-btn">
                          {t.t('import.confirm', { n: j.validation?.willCreate ?? 0 })}
                        </button>
                      </form>
                    )}
                    {/* A validated job with nothing to create says so instead of offering a button that would do nothing. */}
                    {stage === 'validated' && (j.validation?.willCreate ?? 0) === 0 && (
                      <span className="kv-fine">{t.t('import.nothingToCreate')}</span>
                    )}
                    {(stage === 'uploaded' || stage === 'validated') && (
                      <form action={cancelJobAction} className="kv-inline-form">
                        <input type="hidden" name="jobId" value={j.id} />
                        <button type="submit" className="kv-btn--link">{t.t('import.cancel')}</button>
                      </form>
                    )}
                    {stage === 'done' && (
                      <span className="kv-fine">
                        {t.t('import.result', { created: j.succeededRows, failed: j.failedRows })}
                      </span>
                    )}
                    {stage === 'failed' && (
                      <span className="kv-error">{j.errorSummary ?? t.t('import.error.failed')}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* Two honest absences, stated where somebody would otherwise wonder. */}
      <p className="kv-fine kv-note">{t.t('import.csvOnly')}</p>
      <p className="kv-fine kv-note">{t.t('import.uploadElsewhere')}</p>

      <p><Link href="/people" className="kv-link">{t.t('import.back')}</Link></p>
    </section>
  );
}
