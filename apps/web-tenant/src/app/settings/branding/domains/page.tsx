// apps/web-tenant/src/app/settings/branding/domains/page.tsx · W192 · DOMAINS — PC-56 TENANT-13d.
//
// Printed as built (founder decision: DOMAIN BY PLAN; CNAME + TXT proof; platform edge; Host routing; ACME later):
//   • the plan banner — the included subdomain works on every plan, forever; a custom domain needs the plan(s) the API names;
//   • rows: Domain · Type · TLS (+ the honest note) · Primary · Status (+ the token, the exact records, the last check, the error in words);
//   • the three steps as built — step 2 says the platform VERIFIES and that TLS issuance is not yet built; step 3 says the subdomain's
//     301 waits for the primary's certificate;
//   • acts: make primary / remove (successor for a primary) / re-check → the mutate chain W2595–W2597 (a checker for the proposals);
//   • states: Subdomain only (+ View plans) · No custom domains yet · restricted · flagged off (`tenant_domains`) · couldn't load · loading.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { DomainList } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import {
  BRANDING_HREF, DOMAINS_HREF, DOMAIN_NEW_HREF, PLANS_HREF, domainActHref, domainActs, domainProposalHref, domainTypeKey, domainsStateKey, pageState,
  statusKey, tlsKey,
} from '../../../../features/branding/branding';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dom.title'), robots: { index: false, follow: false } };
}

export default async function DomainsPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requireSession(DOMAINS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');
  let data: (DomainList & { nextCursor: string | null }) | null = null; let state: string | null = null;
  try { data = await tenantClient().domains.list({ cursor: searchParams.cursor, limit: 50 }); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const top = data ? domainsStateKey(data) : null;
  const edge = data?.platform.edgeHostname ?? '';

  return (
    <section>
      <nav aria-label={t.t('br.breadcrumb.label')} className="kv-field__hint">{t.t('br.breadcrumb.settings')} › <Link href={BRANDING_HREF} className="kv-btn--link">{t.t('br.title')}</Link> › {t.t('dom.title')}</nav>
      {data && (
        <div className="kv-card kv-card--notice" role="note">
          <strong>{t.t(data.plan.customDomain ? 'dom.plan.included' : 'dom.plan.title')}</strong>
          <p>{t.t(data.plan.customDomain ? 'dom.plan.includedBody' : 'dom.plan.body', { plan: data.plan.plansWith.join(' / ') || '—', current: data.plan.planCode ?? '—' })}</p>
        </div>
      )}
      <h1>{t.t('dom.title')}</h1>
      <p>{t.t('dom.lede')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`dom.state.${state}.title`)}</strong><p>{t.t(`dom.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={DOMAINS_HREF} className="kv-btn--link">{t.t('br.state.retry')}</Link></p>}
        </div>
      )}

      {data && top && (
        <div className="kv-card">
          <strong>{t.t(`${top}.title`)}</strong><p>{t.t(`${top}.body`)}</p>
          {top === 'dom.state.subdomainOnly' && <p><Link href={PLANS_HREF} className="kv-btn--link">{t.t('dom.viewPlans')}</Link></p>}
        </div>
      )}
      {data?.plan.customDomain && <p><Link href={DOMAIN_NEW_HREF} className="kv-btn kv-btn--primary">{t.t('dom.add')}</Link></p>}

      {data && (
        <>
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('dom.col.domain')}</th><th scope="col">{t.t('dom.col.type')}</th><th scope="col">{t.t('dom.col.tls')}</th>
              <th scope="col">{t.t('dom.col.primary')}</th><th scope="col">{t.t('dom.col.status')}</th><th scope="col">{t.t('dom.col.act')}</th>
            </tr></thead>
            <tbody>{data.items.map((d) => (
              <tr key={d.id}>
                <td><code>{d.domain}</code></td>
                <td>{t.t(domainTypeKey(d))}</td>
                <td>{t.t(tlsKey(d))}</td>
                <td>{d.isPrimary ? '✓' : '—'}</td>
                <td>
                  {t.t(statusKey(d))}
                  {d.verification.lastCheckedAt && <><br /><span className="kv-field__hint">{t.t('dom.lastCheck', { at: when(d.verification.lastCheckedAt) })}</span></>}
                  {d.verification.error && <><br /><span className="kv-error">{d.verification.error}</span></>}
                  {d.verification.expiresAt && <><br /><span className="kv-field__hint">{t.t('dom.expires', { at: when(d.verification.expiresAt) })}</span></>}
                  {d.kind === 'custom' && d.verification.status !== 'verified' && (
                    <details><summary>{t.t('dom.records')}</summary>
                      <ul className="kv-list">{d.verification.records.map((r) => <li key={r.type}><code>{r.type}</code> <code>{r.name}</code> → <code>{r.value}</code></li>)}</ul>
                    </details>
                  )}
                </td>
                <td>{domainActs(d, data!).map((a) => <span key={a}><Link href={domainActHref(a, d.id)} className="kv-btn--link">{t.t(`dom.act.${a}`)}</Link>{' '}</span>)}
                  {data!.proposals.some((p) => p.domainId === d.id) && <span className="kv-field__hint">{t.t('dom.act.waiting')}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="kv-field__hint">{t.t('dom.count', { shown: formatNumber(data.items.length, lang), total: formatNumber(data.counts.total, lang) })}</p>
          {data.nextCursor && <p><Link href={`${DOMAINS_HREF}?cursor=${encodeURIComponent(data.nextCursor)}`} className="kv-btn--link">{t.t('dom.more')}</Link></p>}

          {data.proposals.length > 0 && (
            <div className="kv-card">
              <h2>{t.t('dom.proposals.title')}</h2>
              <ul className="kv-list">{data.proposals.map((p) => (
                <li key={p.id}>{t.t(`dom.proposals.${p.kind}`, { domain: p.domain, successor: p.successorDomain ?? '' })} · {t.t('dom.proposals.by', { name: p.proposedByName ?? '—', at: when(p.proposedAt) })}
                  {' · '}<Link href={domainProposalHref(p.id, 'confirm')} className="kv-btn--link">{t.t(p.canConfirm ? 'dom.proposals.confirm' : 'dom.proposals.open')}</Link></li>
              ))}</ul>
            </div>
          )}

          <div className="kv-card">
            <h2>{t.t('dom.steps.title')}</h2>
            <ol className="kv-list">
              <li>{t.t('dom.steps.1', { edge })}</li>
              <li>{t.t('dom.steps.2')}</li>
              <li>{t.t('dom.steps.3')}</li>
            </ol>
          </div>
          <div className="kv-card">
            <h2>{t.t('dom.rails.title')}</h2>
            <ul className="kv-list"><li>✓ {t.t('dom.rails.successor')}</li><li>✓ {t.t('dom.rails.unique')}</li><li>✓ {t.t('dom.rails.release')}</li></ul>
            <p className="kv-field__hint">{t.t('dom.footnote')}</p>
          </div>
        </>
      )}
    </section>
  );
}
