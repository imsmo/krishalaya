// apps/web-storefront/src/app/(platform)/trace/[qrToken]/page.tsx · the PUBLIC farm-to-fork QR landing (PRD §16.3). A
// consumer scans the QR on a pack → this page SSRs the provenance via the SDK's anonymous traceability.scan
// (the API returns a curated, NON-PII projection through a SECURITY DEFINER function). No auth, no PII rendered. All copy via i18n; dates
// localized to the active language.
//
// PC-56 HOTFIX-7 · B10 / B25 (survey STORE-5 F-8) — MINIMAL, the v2 shape (STORE-5b rebuilds this page):
//   • the ORGANISATION that recorded the journey is named (`organisation.displayName`), never a person; NO uuid reaches the DOM (the v2 answer
//     carries none — no listingId, declaredInputs or certificateIds);
//   • OFF ≠ NOT FOUND: an organisation that has not published traces answers TRACE_NOT_PUBLISHED and the page says so (noindex); an unknown token
//     (or a lot of an organisation that is not live) is the 404 it always was;
//   • the allow-listed meta is not printed yet (its labels need the per-step vocabulary 5b adds — Law 7); event codes print as before.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatDate } from '@krishalaya/i18n';
import type { TraceProvenance } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { publicClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';

export const revalidate = 300;

type Loaded = { kind: 'ok'; p: TraceProvenance } | { kind: 'not_found' } | { kind: 'not_published' };

async function load(qrToken: string): Promise<Loaded> {
  try { return { kind: 'ok', p: await publicClient().traceability.scan(qrToken) }; }
  catch (e) {
    if (e instanceof SdkError && e.code === 'TRACE_NOT_PUBLISHED') return { kind: 'not_published' };
    if (e instanceof SdkError && (e.isNotFound || e.code === 'TRACE_SCAN_NOT_FOUND')) return { kind: 'not_found' };
    throw e;
  }
}

export async function generateMetadata({ params }: { params: { qrToken: string } }): Promise<Metadata> {
  const t = getTranslator();
  const r = await load(params.qrToken);
  if (r.kind === 'ok') return { title: t.t('trace.title'), description: t.t('trace.metaDescription', { platform: t.t('brand.platform') }) };
  return { title: t.t(r.kind === 'not_published' ? 'trace.notPublishedTitle' : 'trace.notFoundTitle'), robots: { index: false } };
}

export default async function TraceScanPage({ params }: { params: { qrToken: string } }) {
  const r = await load(params.qrToken);
  if (r.kind === 'not_found') notFound();
  const t = getTranslator();
  if (r.kind === 'not_published') {
    return (
      <article className="kv-prose" data-kv-trace="not-published">
        <h1>{t.t('trace.notPublishedTitle')}</h1>
        <p className="kv-prose__lead">{t.t('trace.notPublishedBody')}</p>
      </article>
    );
  }
  const p = r.p;
  const lang = getLang();
  const registered = formatDate(p.createdAt, lang);

  return (
    <article className="kv-prose" data-kv-trace="published">
      <h1>{t.t('trace.heading')}</h1>
      {p.organisation?.displayName ? <p className="kv-detail__muted" data-kv-trace-org="true">{t.t('trace.recordedBy', { organisation: p.organisation.displayName })}</p> : null}
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
