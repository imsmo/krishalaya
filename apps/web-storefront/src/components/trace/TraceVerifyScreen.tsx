// apps/web-storefront/src/components/trace/TraceVerifyScreen.tsx · PC-56 STORE-5b · C2 — canon W304 "Verify the Trace Record", under either chrome.
//   • the hash list from the SERVER's recompute (`GET …/verify`, B11): per step "recomputes ✓" / "MISMATCH — every hash after it breaks" /
//     "written before version 2 — not recomputable from the stored record"; the chain's summary ("MISMATCH at step n" — shown loudly, never
//     hidden; "flagged platform-wide" refused by name);
//   • the EXACT formula and how to recompute it, step by step (static, i18n — features/store5b/verify.ts holds the canonical text the API hashes);
//   • the seal: "Sealed by the platform at <time>" when it stamps the head as it stands, else "Not yet sealed — the next seal runs daily";
//   • the honesty note kept; the canon's "raw sensor logs are platform-staff-only" reworded (the organisation's staff);
//   • "Download the record (CSV, sign in)" → the export page (signed in — the sign-in door with `next` otherwise);
//   • "Check another code" → /trace (the canon's "No verification yet" has no input — a DELTA); Retry = a reload (W3156–W3158 DECOR).
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { formatDate } from '@krishalaya/i18n';
import { getTranslator, getLang } from '../../lib/i18n';
import { env } from '../../lib/env';
import type { AccountChrome } from '../../features/store4a/account';
import { chromeField } from '../../features/store4a/account';
import { platformTraceHref, stepLabelKey, traceHref } from '../../features/store5b/trace';
import { chainSummary, verdictKey } from '../../features/store5b/verify';
import { RefusalList } from '../RefusalList';
import { TraceState } from './TraceStates';
import { loadVerification } from './load';

type SP = Record<string, string | string[] | undefined>;

export async function TraceVerifyScreen({ chrome, qrToken, searchParams = {} }: { chrome: AccountChrome; qrToken: string; searchParams?: SP }) {
  const r = await loadVerification(chrome, qrToken);
  if (r.kind === 'other_org') redirect(platformTraceHref(env.siteUrl, qrToken, 'verify'));
  if (r.kind === 'not_found') notFound();
  const t = getTranslator();
  const lang = getLang();
  const crumb = (
    <nav aria-label={t.t('store4a.crumb.label')}>
      <ol className="kv-crumb">
        <li><Link href={traceHref(chrome, qrToken)}>{t.t('store5b.trace.crumb', { token: qrToken })}</Link></li>
        <li aria-current="page">{t.t('store5b.verify.title')}</li>
      </ol>
    </nav>
  );
  if (r.kind !== 'ok') {
    return (
      <article className="kv-prose" data-kv-screen="trace-verify" data-kv-chrome={chromeField(chrome)}>
        {crumb}
        {r.kind === 'error'
          ? <div className="kv-state kv-state--error" role="alert" data-kv-trace="error"><p>{t.t('store5b.verify.error')}</p><a href={traceHref(chrome, qrToken, 'verify')} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a></div>
          : <TraceState kind={r.kind} path={traceHref(chrome, qrToken, 'verify')} sp={searchParams} />}
        <RefusalList surface="trace_verify" />
      </article>
    );
  }
  const v = r.data;
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const summary = chainSummary(v);
  return (
    <article className="kv-prose" data-kv-screen="trace-verify" data-kv-chrome={chromeField(chrome)} data-kv-chain={v.chain} data-kv-seal={v.anchor.matchesHead ? 'sealed' : 'not_sealed'}>
      {crumb}
      <h1>{t.t('store5b.verify.title')}</h1>
      <p className="kv-prose__lead">{t.t('store5b.verify.lead')}</p>
      <p>{t.t('store5b.verify.explain')}</p>
      <p className="kv-detail__muted">{t.t('store5b.trace.organisation', { org: v.organisation.displayName })}</p>

      <div className={v.chain === 'ok' ? 'kv-state' : 'kv-state kv-state--error'} role={v.chain === 'ok' ? 'status' : 'alert'} data-kv-summary={v.chain === 'ok' ? 'ok' : `broken_at:${v.brokenAt}`}>
        <p><strong>{t.t(summary.key, summary.vars)}</strong></p>
      </div>

      {v.events.length > 0 && (
        <ol className="kv-trace__list" data-kv-hashes={v.events.length}>
          {v.events.map((e) => (
            <li key={e.no} className="kv-trace__event" data-kv-recomputed={e.recomputed} data-kv-version={e.hashVersion}>
              <span>{t.t('store5b.verify.stepRow', { n: e.no, step: t.t(stepLabelKey(e.eventCode)), date: when(e.at) })}</span>
              <code className="kv-mono" data-kv-hash>{e.eventHash ?? ''}</code>
              <span className={e.recomputed === 'mismatch' ? 'kv-form__error' : 'kv-detail__muted'}>{t.t(verdictKey(e.recomputed))}</span>
            </li>
          ))}
        </ol>
      )}

      <section aria-labelledby="kv-verify-seal">
        <h2 id="kv-verify-seal">{t.t('store5b.verify.sealTitle')}</h2>
        {v.anchor.matchesHead
          ? <p data-kv-sealed="true">{t.t('store5b.verify.sealed', { time: when(v.anchor.anchoredAt) })}</p>
          : <p data-kv-sealed="false">{t.t('store5b.verify.notSealed')}</p>}
        {v.anchor.matchesHead && v.anchor.value && <p className="kv-detail__muted"><code className="kv-mono">{t.t('store5b.verify.sealValue', { hash: v.anchor.value })}</code></p>}
        <p className="kv-detail__muted">{t.t('store5b.trace.sealNote')}</p>
      </section>

      <section aria-labelledby="kv-verify-formula">
        <h2 id="kv-verify-formula">{t.t('store5b.verify.formulaTitle')}</h2>
        <p><code className="kv-mono" data-kv-formula>{t.t('store5b.verify.formula')}</code></p>
        <h3>{t.t('store5b.verify.howTitle')}</h3>
        <ol data-kv-how>
          <li>{t.t('store5b.verify.how.prev')}</li>
          <li>{t.t('store5b.verify.how.meta')}</li>
          <li>{t.t('store5b.verify.how.time')}</li>
          <li>{t.t('store5b.verify.how.join')}</li>
        </ol>
      </section>

      <p className="kv-detail__muted" data-kv-honesty>{t.t('store5b.verify.honesty')}</p>
      <p className="kv-detail__muted">{t.t('store5b.verify.logs')}</p>
      <p>
        <Link href={traceHref(chrome, qrToken, 'export')} className="kv-btn" data-kv-cta="download-record">{t.t('store5b.verify.download')}</Link>{' '}
        <Link href={traceHref(chrome, qrToken)} className="kv-btn--link">{t.t('store5b.verify.back')}</Link>{' '}
        <Link href="/trace" className="kv-btn--link" data-kv-cta="another">{t.t('store5b.verify.another')}</Link>
      </p>
      <RefusalList surface="trace_verify" />
    </article>
  );
}
