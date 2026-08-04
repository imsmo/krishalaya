// apps/web-storefront/src/app/trace/[qrToken]/page.tsx · the PUBLIC farm-to-fork QR landing (PRD §16.3). A
// consumer scans the QR on a pack → this page SSRs the provenance via the SDK's anonymous traceability.scan
// (the API returns a curated, NON-PII projection through the SECURITY DEFINER trace_scan function). No auth, no
// PII rendered. SEO-indexed (it's a public trust surface). An unknown/disabled token → 404, never an error page.
// All copy via i18n; dates localized to the active language.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatDate } from '@krishalaya/i18n';
import type { TraceProvenance } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { publicClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';

export const revalidate = 300;

async function load(qrToken: string): Promise<TraceProvenance | null> {
  try { return await publicClient().traceability.scan(qrToken); }
  catch (e) { if (e instanceof SdkError && (e.isNotFound || e.code === 'TRACE_SCAN_NOT_FOUND')) return null; throw e; }
}

export async function generateMetadata({ params }: { params: { qrToken: string } }): Promise<Metadata> {
  const t = getTranslator();
  const p = await load(params.qrToken);
  return p
    ? { title: t.t('trace.title'), description: t.t('trace.metaDescription') }
    : { title: t.t('trace.notFoundTitle'), robots: { index: false } };
}

export default async function TraceScanPage({ params }: { params: { qrToken: string } }) {
  const p = await load(params.qrToken);
  if (!p) notFound();
  const t = getTranslator();
  const lang = getLang();
  const registered = formatDate(p.createdAt, lang);

  return (
    <article className="kv-prose">
      <h1>{t.t('trace.heading')}</h1>
      <p className="kv-prose__lead">
        {p.anchored ? t.t('trace.leadAnchored', { date: registered }) : t.t('trace.lead', { date: registered })}
      </p>
      {p.events.length === 0 ? (
        <p className="kv-empty">{t.t('trace.noEvents')}</p>
      ) : (
        <ol className="kv-trace__list">
          {p.events.map((e, i) => (
            <li key={i} className="kv-trace__event">
              <strong className="kv-trace__code">{e.eventCode.replace(/_/g, ' ')}</strong>
              <span className="kv-detail__muted">{formatDate(e.at, lang, { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
