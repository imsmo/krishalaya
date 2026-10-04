// apps/web-tenant/src/app/verify/agm/[documentId]/page.tsx · the PUBLIC verify page for an issued AGM pack — PC-56 TENANT-SW-d.
// No session. The URL is the one printed in the PDF (the document id carries the organisation's slug). What it shows: the organisation,
// the FY, when it was issued, the PDF's sha256 and the content sha256 printed inside the PDF, and the addendum chain — NEVER a figure.
// A reader compares the sha256 of the file in their hand with the one here.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { AgmVerification } from '@krishalaya/sdk-js';
import { anonClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { istLabel, verifyAgmHref } from '../../../../features/swd/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swd.verify.title'), robots: { index: false, follow: false } };
}

export default async function VerifyAgmPage({ params }: { params: { documentId: string } }) {
  const t = getTranslator();
  let v: AgmVerification | null = null; let failed: 'notFound' | 'error' | null = null;
  try { v = await anonClient().agmPacks.verify(params.documentId); }
  catch (e) { const err = e instanceof SdkError ? e : null; failed = err?.status === 404 || err?.code === 'AGM_VERIFY_NOT_FOUND' ? 'notFound' : 'error'; }
  return (
    <section>
      <h1>{t.t('swd.verify.title')}</h1>
      <p className="kv-field__hint">{t.t('swd.verify.lede')}</p>
      {failed && <div className={failed === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><p>{t.t(`swd.verify.${failed}`)}</p>
        {failed === 'error' && <p><Link href={verifyAgmHref(params.documentId)} className="kv-btn--link">{t.t('swd.chain.retry')}</Link></p>}</div>}
      {v && (
        <div className="kv-card" role="status">
          <p><strong>{t.t('swd.verify.genuine')}</strong></p>
          <dl className="kv-dl">
            <dt>{t.t('swd.agm.documentId')}</dt><dd><code>{v.documentId}</code></dd>
            <dt>{t.t('swd.verify.organisation')}</dt><dd>{v.organisation}</dd>
            <dt>{t.t('swd.agm.col.fy')}</dt><dd>{v.fiscalYearLabel}</dd>
            <dt>{t.t('swd.agm.issuedAt')}</dt><dd>{istLabel(v.issuedAt)} (IST)</dd>
            <dt>{t.t('swd.agm.pdfSha')}</dt><dd><code style={{ overflowWrap: 'anywhere' }}>{v.pdfSha256}</code></dd>
            {v.contentSha256 && <><dt>{t.t('swd.agm.contentSha')}</dt><dd><code style={{ overflowWrap: 'anywhere' }}>{v.contentSha256}</code></dd></>}
            {v.addendumNo > 0 && <><dt>{t.t('swd.agm.parent')}</dt><dd>{t.t('swd.agm.addendumNo', { n: v.addendumNo })} · {v.parentDocumentId ? <Link href={verifyAgmHref(v.parentDocumentId)} className="kv-btn--link"><code>{v.parentDocumentId}</code></Link> : '—'}</dd></>}
          </dl>
          {v.supersededByDocumentId && <p className="kv-card kv-card--notice">{t.t('swd.verify.superseded')} <Link href={verifyAgmHref(v.supersededByDocumentId)} className="kv-btn--link"><code>{v.supersededByDocumentId}</code></Link></p>}
          <p className="kv-field__hint">{t.t('swd.verify.noFigures')}</p>
        </div>
      )}
    </section>
  );
}
