// apps/web-admin/src/app/cells/residency/attestation/page.tsx · W033's "Export residency attestation" (PC-56 ADMIN-8b).
//
// **THIS DOCUMENT ASSERTS A NEGATIVE**, and everything about the page follows from that. Under DPDP the claim is "no
// personal data left the country" — and a negative is evidenced by a COMPLETE RECORD OF ATTEMPTS, never by the absence of
// a record. Until this wave there was no record at all, so the export would have attested from nothing while W033's
// screen said "no violations logged" in a tone a reader takes as assurance.
//
// So the loudest state here is `no_evidence`, and the coverage check runs before anything else: a window reaching back
// further than the log does is a window with a hole in it, and the honest answer is to decline rather than to assert.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { attestationClass, attestationKey, claimKey } from '../../../../features/cells/residency-migration';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rz.attest.title'), robots: { index: false, follow: false } };
}

interface Result {
  attestation: {
    kind: string; windowFrom: string; windowTo: string;
    attempts?: number; blockedByBoundary?: number; otherRefusals?: number;
    allowed?: number; withoutBasis?: number; countries?: string[]; since?: string | null;
  };
  claim: string;
  signed: boolean;
  signingGap: string;
}

export default async function AttestationPage({ searchParams }: { searchParams: { days?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const days = searchParams.days && /^\d{1,3}$/.test(searchParams.days) ? searchParams.days : undefined;

  let r: Result | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Result>(`cells/residency-attestation${days ? `?days=${days}` : ''}`);
    r = res.data ?? null;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'rz.restricted.attest'
      : e instanceof AdminApiError && e.status === 409 ? 'rz.error.attestTooWide' : 'rz.error.attest';
  }

  const a = r?.attestation;

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/cells">{t.t('nav.cells')}</Link> <span aria-hidden="true">/</span>{' '}
        <Link href="/cells/residency/log">{t.t('rz.log.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('rz.attest.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('rz.attest.title')}</h1>
        <p className="kv-page__sub">{t.t('rz.attest.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}

      <form className="kv-filters" method="get" action="/cells/residency/attestation">
        <div className="kv-field">
          <label className="kv-field__label" htmlFor="rz-adays">{t.t('rz.filter.days')}</label>
          <input className="kv-input" id="rz-adays" name="days" type="number" min={1} max={400} defaultValue={days ?? '90'} />
        </div>
        <button className="kv-btn" type="submit">{t.t('common.apply')}</button>
      </form>

      {r && a ? (
        <>
          <section className="kv-panel" aria-labelledby="rz-verdict">
            <h2 id="rz-verdict" className="kv-panel__title">{t.t('rz.attest.verdict')}</h2>
            <p>
              <span className={attestationClass(a.kind)}>{t.t(attestationKey(a.kind))}</span>{' '}
              {a.windowFrom.slice(0, 10)} → {a.windowTo.slice(0, 10)}
            </p>
            {/* THE CLAIM, as one translatable sentence. It ends up in a compliance record and must read identically
                wherever it appears, which is why it is a key rather than assembled prose. */}
            <p className="kv-pre">{t.t(claimKey(r.claim))}</p>

            {a.kind === 'no_evidence' ? (
              <p className="kv-note is-danger" role="alert">
                {a.since
                  ? t.t('rz.attest.gap', { since: a.since.slice(0, 10) })
                  : t.t('rz.attest.noLog')}
              </p>
            ) : null}

            {a.kind === 'clean' ? (
              <dl className="kv-stat-row">
                <div><dt>{t.t('rz.attest.attempts')}</dt><dd>{a.attempts ?? 0}</dd></div>
                <div><dt>{t.t('rz.attest.byBoundary')}</dt><dd>{a.blockedByBoundary ?? 0}</dd></div>
                {/* Reported beside it rather than folded in: an attestation saying "40 attempts blocked" where 35 were
                    malformed requests would overstate what the boundary actually did. */}
                <div><dt>{t.t('rz.attest.other')}</dt><dd>{a.otherRefusals ?? 0}</dd></div>
              </dl>
            ) : null}

            {a.kind === 'transfers_occurred' ? (
              <>
                <p className="kv-note is-warn">
                  {t.t('rz.attest.transfers', { n: String(a.allowed ?? 0) })}
                </p>
                {(a.withoutBasis ?? 0) > 0 ? (
                  <p className="kv-note is-danger" role="alert">
                    {t.t('rz.attest.withoutBasis', { n: String(a.withoutBasis ?? 0) })}
                  </p>
                ) : null}
              </>
            ) : null}

            {a.countries?.length ? (
              <p className="kv-note">{t.t('rz.attest.countries', { list: a.countries.join(', ') })}</p>
            ) : null}
          </section>

          {/* **NOT SIGNED.** W033 calls this an attestation and there is still no signing key on this platform — the same
              gap W018, W039, W064 and W084 name. ADMIN-5c's content digest is not a signature, and a document labelled
              "signed attestation" without one would be worse than an unsigned honest record. */}
          <p className="kv-note is-warn">{t.t('rz.attest.unsigned')}</p>
          <p className="kv-note"><small>{r.signingGap}</small></p>
        </>
      ) : null}
    </main>
  );
}
