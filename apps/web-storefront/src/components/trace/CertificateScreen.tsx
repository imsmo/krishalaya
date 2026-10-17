// apps/web-storefront/src/components/trace/CertificateScreen.tsx · PC-56 STORE-5b · C4 — canon W305 "Certificate", under either chrome (founder D7).
//   • BY ID (`/certificates/<id>` — the trace page links here, `?lot=` carries the way back) or BY NUMBER through the lookup FORM
//     (`/certificates?no=` — within THIS store's organisation; on the platform chrome the organisation is named too, `&org=<its web name>`);
//   • the TYPE from the `cert_type` vocabulary in this page's language; the STATUS with its meaning (pending · verified · rejected with its
//     reason · expired — the badge is read from the certificate every time, so it is gone the day validity passes); "Checked by <organisation>
//     (<the verifier's role>) on <date>" — the organisation's check, never a person, never "platform-verified" (refused by name);
//   • the number, the issuing body, the validity, what it covers (a listing's title when it is a public listing);
//   • states: not published (the organisation's `certificates_public` is OFF — "not published", never "not found"), not found, "name the
//     organisation too", no certificate checked yet (the form), the error with Retry (a reload — W3086–W3088 DECOR);
//   • a store chrome showing ANOTHER organisation's certificate sends the reader to the platform's page.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatDate } from '@krishalaya/i18n';
import type { PublicCertificate } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { publicClient, publicClientIn } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { env } from '../../lib/env';
import { reloadHref } from '../../features/home/load-result';
import type { AccountChrome } from '../../features/store4a/account';
import { chromeField } from '../../features/store4a/account';
import { certificateLookupHref, isTraceToken, platformCertificateHref, traceHref } from '../../features/store5b/trace';
import { CERT_STATUSES, certFailureOf, lookupInput, meaningKey, roleKey, statusKey, subjectKey, typeLabel, type CertLoad } from '../../features/store5b/certificate';
import { RefusalList } from '../RefusalList';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type Loaded = { kind: 'ok'; c: PublicCertificate } | { kind: 'none' } | { kind: CertLoad };

export async function CertificateScreen({ chrome, id, searchParams, orgName }: { chrome: AccountChrome; id?: string; searchParams: SP; orgName?: string | null }) {
  const t = getTranslator();
  const lang = getLang();
  const lot = one(searchParams.lot);
  const input = lookupInput(searchParams);
  let r: Loaded;
  try {
    if (id) {
      r = UUID.test(id) ? { kind: 'ok', c: await publicClient().certificates.public(id) } : { kind: 'not_found' };
    } else if (!input.no) {
      r = { kind: 'none' };
    } else {
      const slug = chrome.kind === 'tenant' ? chrome.slug : input.org;
      r = slug ? { kind: 'ok', c: await publicClient(slug).certificates.publicByNo({ no: input.no }) } : { kind: 'need_org' };
    }
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    r = { kind: certFailureOf(err?.code ?? null, err?.status ?? null) };
  }
  if (r.kind === 'ok' && chrome.kind === 'tenant' && r.c.organisation.slug !== chrome.slug) redirect(platformCertificateHref(env.siteUrl, r.c.id));
  const day = (d: string | null | undefined) => (d ? formatDate(`${d.slice(0, 10)}T12:00:00Z`, lang, { dateStyle: 'medium', timeZone: 'UTC' }) : '');
  const path = id ? `${chrome.kind === 'tenant' ? `/${chrome.slug}` : ''}/certificates/${id}` : certificateLookupHref(chrome, { no: input.no, org: input.org });

  const form = (
    <form method="get" action={certificateLookupHref(chrome)} className="kv-trace-entry" data-kv-form="certificate-lookup">
      <h2>{t.t('store5b.cert.formTitle')}</h2>
      <span className="kv-field">
        <label htmlFor="kv-cert-no" className="kv-field__label">{t.t('store5b.cert.formNo')}</label>
        <input id="kv-cert-no" name="no" type="text" required maxLength={100} autoComplete="off" className="kv-field__input" defaultValue={input.no ?? ''} />
      </span>
      {chrome.kind === 'platform' ? (
        <span className="kv-field">
          <label htmlFor="kv-cert-org" className="kv-field__label">{t.t('store5b.cert.formOrg')}</label>
          <input id="kv-cert-org" name="org" type="text" required maxLength={63} autoComplete="off" className="kv-field__input" defaultValue={input.org ?? ''} aria-describedby="kv-cert-org-hint" />
          <span id="kv-cert-org-hint" className="kv-field__hint">{t.t('store5b.cert.formOrgHint')}</span>
        </span>
      ) : orgName ? <p className="kv-detail__muted">{t.t('store5b.cert.formWithin', { org: orgName })}</p> : null}
      <button type="submit" className="kv-btn" data-kv-cta="lookup">{t.t('store5b.cert.formSubmit')}</button>
    </form>
  );
  const backToLot = isTraceToken(lot) ? <p><Link href={traceHref(chrome, lot)} className="kv-btn--link" data-kv-cta="back-to-lot">{t.t('store5b.cert.backToLot')}</Link></p> : null;

  if (r.kind !== 'ok') {
    return (
      <section className="kv-prose" data-kv-screen="certificate" data-kv-chrome={chromeField(chrome)} data-kv-state={r.kind}>
        <h1>{t.t('store5b.cert.title')}</h1>
        {r.kind === 'not_published' && <div className="kv-state" role="status" data-kv-cert="not-published"><h2>{t.t('store5b.cert.notPublishedTitle')}</h2><p>{t.t('store5b.cert.notPublishedBody')}</p></div>}
        {r.kind === 'not_found' && <div className="kv-state" role="status" data-kv-cert="not-found"><h2>{t.t('store5b.cert.notFoundTitle')}</h2><p>{t.t('store5b.cert.notFoundBody')}</p></div>}
        {r.kind === 'need_org' && <p className="kv-form__error" role="alert" data-kv-cert="need-org">{t.t('store5b.cert.needOrg')}</p>}
        {r.kind === 'none' && <p className="kv-empty" data-kv-cert="none-yet">{t.t('store5b.cert.noneYet')}</p>}
        {r.kind === 'error' && <div className="kv-state kv-state--error" role="alert" data-kv-cert="error"><p>{t.t('store5b.cert.error')}</p><a href={reloadHref(path, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a></div>}
        {form}
        {backToLot}
        <RefusalList surface="certificate" />
      </section>
    );
  }
  const c = r.c;
  let vocab: Array<{ code: string; name: string }> | null = null;
  try { vocab = await publicClientIn(lang).lookups.values('cert_type'); } catch { vocab = null; }
  const valid = c.validFrom && c.validUntil ? t.t('store5b.cert.validRange', { from: day(c.validFrom), to: day(c.validUntil) })
    : c.validUntil ? t.t('store5b.cert.validUntil', { to: day(c.validUntil) })
      : c.validFrom ? t.t('store5b.cert.validFrom', { from: day(c.validFrom) }) : t.t('store5b.cert.validNone');
  const checked = c.checkedBy
    ? (c.checkedBy.at
      ? t.t('store5b.cert.checkedBy', { org: c.checkedBy.organisation, role: t.t(roleKey(c.checkedBy.role)), date: formatDate(c.checkedBy.at, lang, { dateStyle: 'medium' }) })
      : t.t('store5b.cert.checkedByNoDate', { org: c.checkedBy.organisation, role: t.t(roleKey(c.checkedBy.role)) }))
    : t.t('store5b.cert.notChecked', { org: c.organisation.displayName });
  return (
    <section className="kv-prose" data-kv-screen="certificate" data-kv-chrome={chromeField(chrome)} data-kv-state="ok" data-kv-status={c.status}>
      <h1>{t.t('store5b.cert.title')}</h1>
      <p className="kv-prose__lead">{t.t('store5b.cert.lead')}</p>
      <p className="kv-detail__muted" data-kv-holder>{t.t('store5b.cert.holder', { org: c.organisation.displayName })}</p>
      <table className="kv-table" data-kv-certificate>
        <tbody>
          <tr><th scope="row">{t.t('store5b.cert.type')}</th><td data-kv-type={c.typeCode}>{typeLabel(c.typeCode, vocab)}</td></tr>
          <tr><th scope="row">{t.t('store5b.cert.status')}</th><td><span className="kv-badge" data-kv-cert-status={c.status}>{t.t(statusKey(c.status))}</span> {t.t(meaningKey(c.status))}</td></tr>
          {c.certNo && <tr><th scope="row">{t.t('store5b.cert.no')}</th><td><code className="kv-mono">{c.certNo}</code></td></tr>}
          {c.issuingBody && <tr><th scope="row">{t.t('store5b.cert.issuer')}</th><td>{c.issuingBody}</td></tr>}
          <tr><th scope="row">{t.t('store5b.cert.valid')}</th><td>{valid}</td></tr>
          <tr><th scope="row">{t.t('store5b.cert.covers')}</th><td data-kv-subject={c.subjectType ?? 'unknown'}>{c.coversListing ? t.t('store5b.cert.coversListing', { subject: t.t(subjectKey(c.subjectType)), title: c.coversListing }) : t.t(subjectKey(c.subjectType))}</td></tr>
          {c.status === 'rejected' && c.rejectionReason && <tr><th scope="row">{t.t('store5b.cert.reason')}</th><td data-kv-reason>{c.rejectionReason}</td></tr>}
        </tbody>
      </table>
      <p data-kv-checked-by={c.checkedBy ? (c.checkedBy.role ?? 'staff') : 'none'}>{checked}</p>
      <section aria-labelledby="kv-cert-meanings">
        <h2 id="kv-cert-meanings">{t.t('store5b.cert.meaningsTitle')}</h2>
        <dl>{CERT_STATUSES.map((s) => <div key={s}><dt>{t.t(statusKey(s))}</dt><dd>{t.t(meaningKey(s))}</dd></div>)}</dl>
      </section>
      {backToLot}
      {form}
      <RefusalList surface="certificate" />
    </section>
  );
}
