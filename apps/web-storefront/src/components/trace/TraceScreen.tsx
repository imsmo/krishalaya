// apps/web-storefront/src/components/trace/TraceScreen.tsx · PC-56 STORE-5b · C1 — canon W303 "Farm-to-Fork Trace", under WHICHEVER chrome the
// reader is in (the platform's /trace/[qrToken], an organisation's /<slug>/trace/[qrToken] — founder D7: one screen, the host's chrome).
//   • the product line ("<title> · <quantity> <unit> lot") and the ONLY farmer line (founder D4): "Grown by a verified member farmer of
//     <organisation>, <village>" — never a person, a bio, an avatar or a voice;
//   • the journey: every step by its LABEL (`trace.step.*` — never the raw code, Law 7), its date, its allow-listed details with their labels,
//     "step n of N" and the short hash; the `sold` step says "Sold on the platform" and NO money (founder D5);
//   • the SEAL (founder D3): "Sealed by the platform at <time>" only when the seal stamps the chain head as it stands; else "Not yet sealed —
//     the next seal runs daily" — never "Anchored ✓", never a public ledger;
//   • the lot's certificates (type from the vocabulary · status · valid until → W305) and "Check the record yourself" → W304;
//   • states: journey in progress, not published, NO LONGER published (founder D8), not found, the error with Retry (a reload — W3156–W3158
//     DECOR); a store chrome showing ANOTHER organisation's lot sends the reader to the platform's page instead.
// No uuid in the markup but the certificates' ids (the trace token is not a uuid).
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { formatDate } from '@krishalaya/i18n';
import { getTranslator, getLang } from '../../lib/i18n';
import { env } from '../../lib/env';
import { publicClientIn } from '../../lib/api-client';
import type { AccountChrome } from '../../features/store4a/account';
import { chromeField } from '../../features/store4a/account';
import { certificateHref, farmerLine, metaLines, platformTraceHref, sealState, shortHash, stepLabelKey, traceHref } from '../../features/store5b/trace';
import { statusKey, typeLabel } from '../../features/store5b/certificate';
import { RefusalList } from '../RefusalList';
import { TraceState } from './TraceStates';
import { loadTrace } from './load';

type SP = Record<string, string | string[] | undefined>;

export async function TraceScreen({ chrome, qrToken, searchParams = {} }: { chrome: AccountChrome; qrToken: string; searchParams?: SP }) {
  const r = await loadTrace(chrome, qrToken);
  if (r.kind === 'other_org') redirect(platformTraceHref(env.siteUrl, qrToken));
  if (r.kind === 'not_found') notFound();
  const t = getTranslator();
  const lang = getLang();
  const path = traceHref(chrome, qrToken);
  if (r.kind !== 'ok') {
    return (
      <article className="kv-prose" data-kv-screen="trace" data-kv-chrome={chromeField(chrome)}>
        <TraceState kind={r.kind} path={path} sp={searchParams} />
        <RefusalList surface="trace" />
      </article>
    );
  }
  const p = r.data;
  const org = p.organisation?.displayName ?? '';
  const total = p.events.length;
  const farmer = farmerLine(org, p.place ?? null);
  const seal = sealState(p.anchor);
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const day = (d: string | null | undefined) => (d ? formatDate(`${d.slice(0, 10)}T12:00:00Z`, lang, { dateStyle: 'medium', timeZone: 'UTC' }) : '');
  const certs = p.certificates ?? [];
  let vocab: Array<{ code: string; name: string }> | null = null;
  if (certs.length) { try { vocab = await publicClientIn(lang).lookups.values('cert_type'); } catch { vocab = null; } }

  return (
    <article className="kv-prose" data-kv-screen="trace" data-kv-chrome={chromeField(chrome)} data-kv-trace="published" data-kv-seal={seal}>
      <p className="kv-detail__muted" data-kv-lot-code>{t.t('store5b.trace.lotCode', { token: p.qrToken })}</p>
      <h1>{p.product ? (p.product.quantity !== null && p.product.unit
        ? t.t('store5b.trace.lotLine', { title: p.product.title, quantity: String(p.product.quantity), unit: p.product.unit })
        : t.t('store5b.trace.lotTitle', { title: p.product.title })) : t.t('store5b.trace.title')}</h1>
      <p className="kv-prose__lead" data-kv-farmer-line>{t.t(farmer.key, farmer.vars)}</p>
      <p className="kv-detail__muted" data-kv-trace-org="true">{t.t('store5b.trace.recordedBy', { org })}</p>

      <section aria-labelledby="kv-trace-journey">
        <h2 id="kv-trace-journey">{t.t('store5b.trace.journeyTitle')}</h2>
        {total === 0 ? (
          <p className="kv-empty" data-kv-state="in-progress">{t.t('store5b.trace.inProgress')}</p>
        ) : (
          <ol className="kv-trace__list">
            {p.events.map((e, i) => (
              <li key={i} className="kv-trace__event" data-kv-step={e.eventCode}>
                <strong className="kv-trace__code">{t.t(stepLabelKey(e.eventCode))}</strong>{' '}
                <span className="kv-detail__muted">{when(e.at)}</span>
                {metaLines(e.meta).length > 0 && (
                  <ul className="kv-trace__meta">
                    {metaLines(e.meta).map((m) => <li key={m.key} data-kv-meta={m.key}>{t.t(m.labelKey)}: {m.value}</li>)}
                  </ul>
                )}
                {e.eventCode === 'sold' && <p className="kv-detail__muted" data-kv-sold-line>{t.t('store5b.trace.soldLine')}</p>}
                <p className="kv-detail__muted kv-mono" data-kv-event-hash={shortHash(e.eventHash)}>
                  {t.t('store5b.trace.eventN', { n: e.no ?? i + 1, total })} · {t.t('store5b.trace.hash', { hash: shortHash(e.eventHash) })}
                </p>
              </li>
            ))}
          </ol>
        )}
        {total > 0 && seal === 'sealed'
          ? <p data-kv-sealed="true">{t.t('store5b.trace.sealed', { time: when(p.anchor?.anchoredAt) })}</p>
          : total > 0 ? <p data-kv-sealed="false">{t.t('store5b.trace.notSealed')}</p> : null}
        {total > 0 && <p className="kv-detail__muted">{t.t('store5b.trace.sealNote')}</p>}
      </section>

      <section aria-labelledby="kv-trace-certs">
        <h2 id="kv-trace-certs">{t.t('store5b.trace.certTitle')}</h2>
        {certs.length === 0 ? <p className="kv-empty" data-kv-certs="none">{t.t('store5b.trace.certNone')}</p> : (
          <ul data-kv-certs={certs.length}>
            {certs.map((c) => (
              <li key={c.id}>
                <Link href={certificateHref(chrome, c.id, { lot: p.qrToken })} data-kv-cert-status={c.status}>
                  {c.validUntil
                    ? t.t('store5b.trace.certLine', { type: typeLabel(c.typeCode, vocab), status: t.t(statusKey(c.status)), date: day(c.validUntil) })
                    : t.t('store5b.trace.certLineNoDate', { type: typeLabel(c.typeCode, vocab), status: t.t(statusKey(c.status)) })}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p><Link href={traceHref(chrome, p.qrToken, 'verify')} className="kv-btn" data-kv-cta="verify">{t.t('store5b.trace.check')}</Link></p>
      <RefusalList surface="trace" />
    </article>
  );
}
