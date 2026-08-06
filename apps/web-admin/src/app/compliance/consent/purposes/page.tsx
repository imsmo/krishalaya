// apps/web-admin/src/app/compliance/consent/purposes/page.tsx · W047, the consent purpose registry (PC-56 ADMIN-5b).
//
// W047 shows a "Notice text (12 languages)" column reading "12/12 ✓" and "9/12 partial". `consent_purposes` held
// `code`, `default_name`, `is_mandatory`, `current_version` — and **no notice-text column at all**, in any language. The
// column had nothing behind it, so this screen's first job is to say so.
//
// TWO DECISIONS THAT SHAPE EVERY CELL:
//   • `never` IS ITS OWN STATE, not 0/N. Every purpose on this platform is in it: the words its existing consents were
//     given against were never recorded anywhere, and that gap cannot be filled retroactively because the words are
//     unknowable. Rendering "0/3" would make it look like an authoring backlog.
//   • A MANDATORY purpose with an incomplete notice is a FAILURE, not a warning. `is_mandatory` gates onboarding, so a
//     missing Tamil notice means a Tamil speaker is asked to agree to something they cannot read as a condition of
//     entry. The same gap on an optional purpose is a real cost but not a wrong.
// Coverage is counted against the ACTIVE platform languages, never a hardcoded twelve: the language list is data, the
// platform launches with three, and a new one is an INSERT.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { DataTable, Column } from '../../../../components/DataTable';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { coverageState, coverageClass, coverageText, optInText, type PurposeRow } from '../../../../features/compliance/consent';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cns.purposesTitle'), robots: { index: false, follow: false } };
}

export default async function ConsentPurposesPage() {
  requireAdmin();
  const t = getTranslator();

  let rows: PurposeRow[] = []; let languages: string[] = []; let notice: string | undefined;
  try {
    const res = await adminGet<PurposeRow[]>('consent/purposes');
    rows = res.data ?? [];
    languages = (res.meta?.languages as string[] | undefined) ?? [];
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const neverRecorded = rows.filter((r) => r.noticeNeverRecorded);
  const mandatoryGaps = rows.filter((r) => r.isMandatory && coverageState(r) !== 'complete');

  const cols: Column<PurposeRow>[] = [
    { header: t.t('cns.code'), cell: (r) => <Link href={`/compliance/consent/purposes/${encodeURIComponent(r.code)}`}>{r.code}</Link> },
    { header: t.t('cns.name'), cell: (r) => r.defaultName },
    {
      header: t.t('cns.mandatory'),
      cell: (r) => (r.isMandatory
        ? <span className="kv-status kv-status--warn">{t.t('cns.isMandatory')}</span>
        : <span className="kv-status kv-status--muted">{t.t('cns.isOptional')}</span>),
    },
    { header: t.t('cns.currentVersion'), cell: (r) => r.currentVersion },
    {
      header: t.t('cns.noticeCoverage'),
      cell: (r) => {
        const st = coverageState(r);
        return (
          <span className={coverageClass(st, r.isMandatory)}>
            {st === 'never' ? t.t('cns.cov.never') : `${t.t(`cns.cov.${st}`)} ${coverageText(r)}`}
          </span>
        );
      },
    },
    {
      header: t.t('cns.optIn'),
      // NULL renders as a dash. 0% would say everybody declined, which on a mandatory purpose is impossible and on an
      // optional one is a different fact from "nobody has been asked yet".
      cell: (r) => { const o = optInText(r); return o.known ? `${o.pct}% ${t.t('cns.ofDecided', { n: String(o.base) })}` : t.t('common.dash'); },
    },
    {
      header: t.t('cns.draft'),
      cell: (r) => (r.draftVersionId
        ? <Link href={`/compliance/consent/purposes/${encodeURIComponent(r.code)}`}>{t.t('cns.draftOpen', { v: r.draftVersion ?? '' })}</Link>
        : <span className="kv-detail__muted">{t.t('common.dash')}</span>),
    },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/compliance/consent">{t.t('cns.backRegistry')}</Link></p>
      <h1>{t.t('cns.purposesTitle')}</h1>
      <p className="kv-muted">{t.t('cns.purposesLead')}</p>
      {languages.length > 0 && <p className="kv-detail__muted">{t.t('cns.activeLanguages', { list: languages.join(', '), n: String(languages.length) })}</p>}

      {/* THE HEADLINE FINDING, ABOVE THE TABLE. Not a backlog — a gap in the legal basis that cannot be back-filled. */}
      {neverRecorded.length > 0 && (
        <p className="kv-error" role="alert">
          {t.t('cns.neverRecordedWarning', { n: String(neverRecorded.length), codes: neverRecorded.map((r) => r.code).join(', ') })}
        </p>
      )}
      {/* A mandatory purpose without a complete notice is consent obtained as a condition of entry, under words somebody
          cannot read. It gets the strongest statement on the page. */}
      {mandatoryGaps.length > 0 && (
        <p className="kv-error" role="alert">
          {t.t('cns.mandatoryGapWarning', { codes: mandatoryGaps.map((r) => r.code).join(', ') })}
        </p>
      )}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <DataTable columns={cols} rows={rows} empty={t.t('cns.purposesEmpty')} />
      )}

      {/* W047's ladder, with its fourth rung named as absent. */}
      <h2>{t.t('cns.ladderHeading')}</h2>
      <ol className="kv-list">
        <li>{t.t('cns.ladder1')}</li>
        <li>{t.t('cns.ladder2')}</li>
        <li>{t.t('cns.ladder3')}</li>
        <li>{t.t('cns.ladder4')}</li>
      </ol>
      <p className="kv-notice">{t.t('cns.ladderGap')}</p>
      <p className="kv-detail__muted">{t.t('cns.oldGrantsStayValid')}</p>
    </section>
  );
}
