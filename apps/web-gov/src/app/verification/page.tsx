// apps/web-gov/src/app/verification/page.tsx · GW-4: the KYC reviewer QUEUE (PC-55 B1, canon W335).
// Reads `kyc/review/queue` (PC-54 W54-1), which is Approve-gated server-side — this page renders what the API is
// willing to show this officer and nothing more. Status boxes live in the URL so a queue view is shareable and the
// keyset cursor preserves the filter. Row → /verification/[id], where the evidence is, because a decision without
// evidence is forbidden (Ledger Appendix 6).
//
// PII: the queue shows a TRUNCATED user id and the MASKED document number the API returns. There is no name, no
// full document number, and no image thumbnail here — the case page is where an officer opens evidence, one case
// at a time, which is also what makes the access trail meaningful.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { govClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { KYC_REVIEW_STATUSES, isKycReviewStatus, type KycReviewStatus } from '../../features/verification/review';
import type { KycReviewItem } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ver.title'), robots: { index: false, follow: false } };
}

export default async function VerificationQueuePage({ searchParams }: { searchParams: { status?: string; cursor?: string } }) {
  await requireSession('/verification');
  const t = getTranslator();
  const lang = getLang();
  const status: KycReviewStatus = isKycReviewStatus(searchParams.status) ? searchParams.status : 'pending';

  let items: KycReviewItem[] = []; let nextCursor: string | null = null; let failed = false; let forbidden = false;
  try {
    const page = await govClient().kyc.reviewQueue({ status, cursor: searchParams.cursor, limit: 50 });
    items = page.items; nextCursor = page.nextCursor;
  } catch (e) {
    // 403 is not a crash — it is the honest answer "your access grant does not include KYC review".
    forbidden = (e as { status?: number }).status === 403;
    failed = !forbidden;
  }

  const boxHref = (s: KycReviewStatus) => `/verification?status=${s}`;
  const pager = (c: string) => `/verification?status=${status}&cursor=${encodeURIComponent(c)}`;

  return (
    <section>
      <h1>{t.t('ver.title')}</h1>
      <p className="kv-field__hint">{t.t('ver.hint')}</p>

      <nav className="kv-tabs" aria-label={t.t('ver.boxesLabel')}>
        {KYC_REVIEW_STATUSES.map((s) => (
          <a key={s} href={boxHref(s)} className={`kv-tab${s === status ? ' kv-tab--active' : ''}`} aria-current={s === status ? 'page' : undefined}>
            {t.t(`ver.box.${s}`)}
          </a>
        ))}
      </nav>

      {forbidden && <p className="kv-error" role="alert">{t.t('ver.forbidden')}</p>}
      {failed && <p className="kv-error" role="alert">{t.t('ver.loadError')}</p>}
      {!forbidden && !failed && (
        <DataTable
          rows={items}
          empty={t.t(`ver.empty.${status}`)}
          columns={[
            { header: t.t('ver.colCase'), cell: (k) => <Link href={`/verification/${k.id}`} className="kv-link">{k.id.slice(0, 8)}…</Link> },
            { header: t.t('ver.colSubject'), cell: (k) => `${k.userId.slice(0, 8)}…` },
            { header: t.t('ver.colDocNo'), cell: (k) => k.docNoMasked ?? t.t('common.dash') },
            { header: t.t('ver.colEvidence'), cell: (k) => (k.mediaId ? t.t('ver.evidenceYes') : <span className="kv-badge">{t.t('ver.evidenceNo')}</span>) },
            { header: t.t('ver.colSubmitted'), cell: (k) => (k.createdAt ? formatDate(k.createdAt, lang) : t.t('common.dash')) },
            { header: t.t('ver.colValidUntil'), cell: (k) => (k.validUntil ? formatDate(k.validUntil, lang) : t.t('common.dash')) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={pager(nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
      <p className="kv-field__hint kv-note">{t.t('ver.queueNote')}</p>
    </section>
  );
}
