// apps/web-admin/src/app/schemes-registry/applications/page.tsx · W074, the cross-tenant applications pipeline
// (PC-56 ADMIN-4b).
//
// THIS IS THE FIRST SCREEN IN THE ADMIN CONSOLE THAT SHOWS A FARMER'S NAME, and everything about it is arranged
// around that fact:
//   • the permission is `schemes.applications.read`, NOT the registry read permission (ADMIN-4b added it, and
//     re-gated the two pre-existing routes that had shipped under the registry one);
//   • the name and phone arrive ALREADY MASKED — the raw values never reach this process;
//   • reading a real phone number is a separate, audited act on the detail page, with a mandatory reason.
// The tab chips render NO NUMBER when the count is unknown rather than 0, because a "0" beside a tab holding 1,842
// applications makes an operator skip it.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import {
  APPLICATION_STATES, isApplicationState, chipCount, totalChip, eligibilityLabel, eligibilityClass,
  rulesRecoverable, type ApplicationRow, type StateCounts, type Rate,
} from '../../../features/schemes-registry/oversight';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sov.appsTitle'), robots: { index: false, follow: false } };
}

export default async function ApplicationsPage({ searchParams }: { searchParams: { status?: string; schemeId?: string; tenantId?: string; assisted?: string; cursor?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const status = isApplicationState(searchParams.status) ? searchParams.status : undefined;
  const schemeId = searchParams.schemeId?.trim() || undefined;
  const tenantId = searchParams.tenantId?.trim() || undefined;
  const assistedOnly = searchParams.assisted === 'true' ? 'true' : undefined;

  let rows: ApplicationRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<ApplicationRow[]>('schemes-oversight/applications', {
      status, schemeId, tenantId, assistedOnly, cursor: searchParams.cursor, limit: 50,
    });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  // Counts fetched SEPARATELY and allowed to fail on their own (Law 12): the queue is worth showing without chips.
  let counts: StateCounts | null = null; let assistedShare: Rate | null = null;
  try {
    const res = await adminGet<{ counts: StateCounts; total: number | null; assistedShare: Rate }>('schemes-oversight/applications/counts', { schemeId, tenantId, assistedOnly });
    counts = res.data?.counts ?? null;
    assistedShare = res.data?.assistedShare ?? null;
  } catch { /* chips stay blank — decoration, never blocking */ }

  const qp = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, schemeId, tenantId, assisted: assistedOnly, ...extra })) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/schemes-registry/applications${s ? `?${s}` : ''}`;
  };

  const cols: Column<ApplicationRow>[] = [
    { header: t.t('sov.filed'), cell: (r) => <Link href={`/schemes-registry/applications/${encodeURIComponent(r.id)}`}>{r.createdAt ?? t.t('common.dash')}</Link> },
    // MASKED, server-side. The class exists so the abbreviation reads as deliberate rather than as truncated data.
    {
      header: t.t('sov.applicant'),
      cell: (r) => (
        <span className="kv-masked" title={t.t('sov.maskedTitle')}>
          {r.applicant.nameMasked ?? t.t('sov.noName')} · {r.applicant.phoneMasked ?? t.t('sov.noPhone')}
        </span>
      ),
    },
    {
      header: t.t('sov.scheme'),
      cell: (r) => (
        <>
          {r.schemeCode} · v{r.schemeVersion}
          {/* ADMIN-4's pointer. Flagged when the rules this application was judged under are NOT retrievable. */}
          {!rulesRecoverable(r) && <> <span className="kv-status kv-status--warn">{t.t('sov.rulesLost')}</span></>}
        </>
      ),
    },
    {
      header: t.t('sov.aiCheck'),
      cell: (r) => {
        const l = eligibilityLabel(r.eligibility);
        return <span className={eligibilityClass(r.eligibility)}>{t.t(`sov.elig.${l.key}`)}{l.score ? ` · ${l.score}` : ''}</span>;
      },
    },
    { header: t.t('sov.assisted'), cell: (r) => (r.assisted ? (r.assistedBy ?? t.t('sov.assistedYes')) : t.t('sov.assistedSelf')) },
    { header: t.t('sov.govtRef'), cell: (r) => r.govtAppRef ?? t.t('sov.awaitingAck') },
    { header: t.t('sov.status'), cell: (r) => <span className={r.statusClass}>{t.t(`sov.state.${r.status}`)}</span> },
  ];

  const total = totalChip(counts);
  const chip = (s: 'all' | (typeof APPLICATION_STATES)[number]) => {
    const n = s === 'all' ? total : chipCount(counts, s);
    // NO number rather than a 0 when the count is unknown.
    return n === null ? null : <span className="kv-chip__count">{n}</span>;
  };

  return (
    <section>
      <p className="kv-backlink"><Link href="/schemes-registry/schemes">{t.t('sr.backSchemes')}</Link></p>
      <h1>{t.t('sov.appsTitle')}</h1>
      <p className="kv-muted">{t.t('sov.appsLead')}</p>
      {/* Said before the table, not after: the names below are abbreviated on purpose, and abbreviation is not
          anonymisation. */}
      <p className="kv-notice">{t.t('sov.maskNotice')}</p>
      {assistedShare && assistedShare.pct !== null && <p className="kv-detail__muted">{t.t('sov.assistedShare', { pct: String(assistedShare.pct), n: String(assistedShare.denominator) })}</p>}
      {!counts && <p className="kv-detail__muted">{t.t('sov.countsUnknown')}</p>}

      <nav className="kv-filters" aria-label={t.t('sov.stateFilter')}>
        <Link href={qp({ status: undefined, cursor: undefined })} className={`kv-chip${!status ? ' is-active' : ''}`} aria-current={!status ? 'true' : undefined}>
          {t.t('sov.stateAll')}{chip('all')}
        </Link>
        {APPLICATION_STATES.map((s) => (
          <Link key={s} href={qp({ status: s, cursor: undefined })} className={`kv-chip${status === s ? ' is-active' : ''}`} aria-current={status === s ? 'true' : undefined}>
            {t.t(`sov.state.${s}`)}{chip(s)}
          </Link>
        ))}
      </nav>

      <nav className="kv-filters" aria-label={t.t('sov.assistedFilter')}>
        <Link href={qp({ assisted: undefined, cursor: undefined })} className={`kv-chip${!assistedOnly ? ' is-active' : ''}`}>{t.t('sov.anyChannel')}</Link>
        <Link href={qp({ assisted: 'true', cursor: undefined })} className={`kv-chip${assistedOnly ? ' is-active' : ''}`}>{t.t('sov.assistedOnly')}</Link>
      </nav>

      <p className="kv-backlink"><Link href="/schemes-registry/oversight-exports">{t.t('sov.exportLink')}</Link></p>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('sov.appsEmpty')} />
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={qp({ cursor: nextCursor })}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}
    </section>
  );
}
