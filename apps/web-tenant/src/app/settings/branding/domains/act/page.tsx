// apps/web-tenant/src/app/settings/branding/domains/act/page.tsx · the domain MUTATE chain — W2595 confirm · W2596 success · W2597 failure
// · PC-56 TENANT-13d. Three acts:
//   • make primary — only a verified domain; a PROPOSAL a second administrator confirms; the subdomain's 301 waits for the primary's
//     certificate (issuance not built — said);
//   • remove — a soft delete through a proposal; removing the PRIMARY needs a named, verified successor ("members never hit a dead URL");
//     the included subdomain is permanent;
//   • re-check now — DNS through the platform's pinned resolvers, once a minute (no checker: it changes nothing but the check).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { DomainList } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator } from '../../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../../features/mutate/chain';
import {
  DOMAINS_HREF, DOMAIN_ACT_HREF, domainProposalHref, domainRefusalKey, isUuid, pageState, parseCodes, statusKey, successorCandidates, tlsKey,
} from '../../../../../features/branding/branding';
import { proposeDomainAction, recheckDomainAction } from '../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dom.actPage.title'), robots: { index: false, follow: false } };
}

export default async function DomainActPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(DOMAIN_ACT_HREF);
  const t = getTranslator();
  const step = mutateStep(searchParams.step);
  const kind = searchParams.kind === 'remove' ? 'remove' : searchParams.kind === 'recheck' ? 'recheck' : 'make_primary';
  const failed = parseCodes(searchParams.error);
  let list: DomainList | null = null; let state: string | null = isUuid(searchParams.domain) ? null : 'notFound';
  if (!state) {
    try { list = await tenantClient().domains.list({ limit: 100 }); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }
  const d = list?.items.find((x) => x.id === searchParams.domain) ?? null;
  const successors = list && d ? successorCandidates(list.items, d.id) : [];

  return (
    <section>
      <nav aria-label={t.t('br.breadcrumb.label')} className="kv-field__hint">{t.t('br.breadcrumb.settings')} › <Link href={DOMAINS_HREF} className="kv-btn--link">{t.t('dom.title')}</Link> › {t.t(`dom.act.${kind}`)}</nav>
      <h1>{t.t(`dom.act.${kind}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('dom.new.module')}</p>
      {(state || (list && !d && step === 'confirm')) && (
        <div className="kv-card kv-card--notice" role="alert"><strong>{t.t(`dom.state.${state ?? 'notFound'}.title`)}</strong><p>{t.t(`dom.state.${state ?? 'notFound'}.body`)}</p>
          <p><Link href={DOMAINS_HREF} className="kv-btn--link">{t.t('dom.backToScreen')}</Link></p></div>
      )}

      {step === 'confirm' && d && (
        <div className="kv-card">
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('dom.col.domain')}</dt><dd><code>{d.domain}</code> · {d.isPrimary ? t.t('dom.col.primary') : ''}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('dom.col.status')}</dt><dd>{t.t(statusKey(d))}{d.verification.error ? ` · ${d.verification.error}` : ''}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('dom.col.tls')}</dt><dd>{t.t(tlsKey(d))}</dd></div>
          </dl>
          {kind === 'recheck' ? (
            <form action={recheckDomainAction} className="kv-form">
              <input type="hidden" name="domainId" value={d.id} />
              <p>{t.t('dom.actPage.recheckLede')}</p>
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('dom.actPage.recheckProceed')}</button>{' '}
              <Link href={DOMAINS_HREF} className="kv-btn--link">{t.t('br.pub.cancel')}</Link>
            </form>
          ) : (
            <form action={proposeDomainAction} className="kv-form">
              <input type="hidden" name="kind" value={kind} /><input type="hidden" name="domainId" value={d.id} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <p>{t.t(kind === 'make_primary' ? 'dom.actPage.primaryLede' : 'dom.actPage.removeLede')}</p>
              {kind === 'remove' && d.isPrimary && (
                <label className="kv-field" htmlFor="dom-successor"><span>{t.t('dom.actPage.successor')}</span>
                  <select id="dom-successor" name="successorDomainId" className="kv-input" required defaultValue={searchParams.successor ?? ''}>
                    <option value="" disabled>{t.t('dom.actPage.successorPick')}</option>
                    {successors.map((s) => <option key={s.id} value={s.id}>{s.domain}</option>)}
                  </select></label>
              )}
              <label className="kv-field" htmlFor="dom-act-reason"><span>{t.t('dom.actPage.reason')}</span>
                <textarea id="dom-act-reason" name="reason" className="kv-textarea" rows={2} minLength={20} maxLength={500} required defaultValue={searchParams.reason ?? ''} /></label>
              <p className="kv-field__hint">{t.t('dom.actPage.checker')}</p>
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('dom.actPage.propose')}</button>{' '}
              <Link href={DOMAINS_HREF} className="kv-btn--link">{t.t('br.pub.cancel')}</Link>
            </form>
          )}
        </div>
      )}

      {step === 'success' && (
        <div className="kv-card kv-success" role="status">
          <strong>{t.t(kind === 'recheck' ? `dom.actPage.recheck.${searchParams.outcome === 'verified' ? 'verified' : searchParams.outcome === 'expired' ? 'expired' : 'failed'}` : 'dom.actPage.proposed')}</strong>
          {kind !== 'recheck' && searchParams.proposal && isUuid(searchParams.proposal) && <p><Link href={domainProposalHref(searchParams.proposal, 'confirm')} className="kv-btn--link">{t.t('dom.actPage.openProposal')}</Link></p>}
          <p><Link href={DOMAINS_HREF} className="kv-btn kv-btn--primary">{t.t('dom.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('br.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(domainRefusalKey(c))}</li>)}</ul>
          <p>{t.t('br.form.failure.untouched')}</p>
          <p><Link href={`${DOMAIN_ACT_HREF}?${new URLSearchParams({ kind, domain: searchParams.domain ?? '', step: 'confirm', ...(searchParams.reason ? { reason: searchParams.reason } : {}) }).toString()}`} className="kv-btn--link">{t.t('br.pub.retry')}</Link>{' · '}
            <Link href={DOMAINS_HREF} className="kv-btn--link">{t.t('dom.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
