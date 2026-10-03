// apps/web-tenant/src/app/settings/branding/page.tsx · W191 · WHITE-LABEL THEMING — PC-56 TENANT-13d.
//
// The canon's screen, printed as built (founder decision: BRAND FOR ALL; publish needs a checker; the contrast law):
//   • the plan banner — honest: "Branding is yours on every plan; a custom domain and removing the Powered-by mark need <plan>", the plan
//     names READ from the API (plan_features), never typed;
//   • the draft editor (BrandDesigner, a client component) with the contrast panel computed LIVE by the same law the API's gate applies,
//     each pair with its ratio, AA ✓/✗ and AAA honest; the live preview — desktop, app frame (gu sample) and print header;
//   • the logo UPLOAD (SVG / PNG, ≤ 512 KB, square or wide) — judged and sanitised by the API, pending the antivirus scan;
//   • the coverage list, each line real or named; the publish flow (three steps, as built) → W2797; the live proposal; the history drawer;
//   • states: Default Krishalaya brand · restricted (tenant.settings) · flagged off (`tenant_branding`) · couldn't load (Retry) · loading.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { BrandConsole } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import {
  BRANDING_HREF, BRAND_HISTORY_HREF, BRAND_PUBLISH_HREF, DOMAINS_HREF, PLANS_HREF, brandProposalHref, brandRefusalKey, brandStateKey, coverageKey,
  coverageMark, formFrom, logoPreviewHref, logoStateKey, pageState, parseCodes, planBanner,
} from '../../../features/branding/branding';
import { BrandDesigner } from './BrandDesigner';
import { uploadLogoAction } from './actions';
import { brandDesignerKeys } from './keys';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('br.title'), robots: { index: false, follow: false } };
}

export default async function BrandingPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(BRANDING_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');

  let data: BrandConsole | null = null; let state: string | null = null;
  try { data = await tenantClient().branding.console(); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const labels = Object.fromEntries(brandDesignerKeys().map((k) => [k, t.t(k)]));
  const logoErrors = parseCodes(searchParams.logoError);
  const found = (searchParams.found ?? '').split(',').filter((x) => /^[a-z_:-]{1,40}$/.test(x));
  const banner = data ? planBanner(data.plan) : null;
  const live = data?.liveProposal ?? null;

  return (
    <section>
      <nav aria-label={t.t('br.breadcrumb.label')} className="kv-field__hint">{t.t('br.breadcrumb.settings')} › {t.t('br.title')}</nav>
      {banner && (
        <div className="kv-card kv-card--notice" role="note">
          <strong>{t.t('br.plan.title')}</strong>
          <p>{t.t(banner.key, banner.vars)} {!(data!.plan.customDomain.enabled && data!.plan.removePoweredBy.enabled) && <Link href={PLANS_HREF} className="kv-btn--link">{t.t('br.plan.compare')}</Link>}</p>
        </div>
      )}
      <h1>{t.t('br.title')} {data && <span className="kv-badge">{t.t(data.draft.status === 'published' ? 'br.badge.published' : 'br.badge.draft')}</span>}</h1>
      <p>{t.t('br.lede')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`br.state.${state}.title`)}</strong><p>{t.t(`br.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={BRANDING_HREF} className="kv-btn--link">{t.t('br.state.retry')}</Link></p>}
        </div>
      )}

      {data && (
        <div className="kv-card">
          <strong>{t.t(`${brandStateKey(data)}.title`)}</strong>
          <p>{data.published
            ? t.t('br.state.published.body', { v: formatNumber(data.published.version, lang), at: when(data.published.publishedAt), maker: data.published.proposedByName ?? '—', checker: data.published.confirmedByName ?? '—' })
            : t.t('br.state.default.body')}</p>
          {!data.exists && <p className="kv-field__hint">{t.t('br.state.startDesigning')}</p>}
        </div>
      )}

      {data && (
        <BrandDesigner initial={formFrom(data.draft.values)} labels={labels} idempotencyKey={randomUUID()}
          logoSrc={data.draft.logo.mediaId && data.draft.logo.state === 'clean' ? logoPreviewHref(data.draft.logo.mediaId) : null}
          logoStateLabel={t.t(logoStateKey(data.draft.logo.state))} canHidePoweredBy={data.plan.removePoweredBy.enabled}
          auditHrefBase="/auditor?entityType=tenant_branding" sample={{ line: t.t('br.preview.sample.gu'), cta: t.t('br.preview.sample.cta.gu') }} />
      )}

      {data && (
        <div className="kv-card" id="logo">
          <h2>{t.t('br.logo.title')}</h2>
          <p>{t.t('br.logo.rules', { kb: formatNumber(data.discipline.logo.maxBytes / 1024, lang) })}</p>
          <p className="kv-field__hint">{t.t(logoStateKey(data.draft.logo.state))}</p>
          {searchParams.logoOk && <p className="kv-success" role="status">{t.t('br.logo.uploaded')}{searchParams.stripped ? ` ${t.t('br.logo.stripped', { what: searchParams.stripped })}` : ''}</p>}
          {logoErrors.length > 0 && (
            <div className="kv-error" role="alert">
              <ul className="kv-list">{logoErrors.map((c) => <li key={c}>{t.t(brandRefusalKey(c))}</li>)}</ul>
              {found.length > 0 && <p>{t.t('br.logo.found', { what: found.join(', ') })}</p>}
            </div>
          )}
          <form action={uploadLogoAction} className="kv-form">
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <label className="kv-field" htmlFor="br-logo"><span>{t.t('br.logo.file')}</span>
              <input id="br-logo" name="logo" type="file" accept="image/png,image/svg+xml" required /></label>
            <p className="kv-field__hint">{t.t('br.logo.sms')}</p>
            <button type="submit" className="kv-btn">{t.t('br.logo.upload')}</button>
          </form>
        </div>
      )}

      {data && (
        <div className="kv-card">
          <h2>{t.t('br.cov.title')}</h2>
          <ul className="kv-list">
            {data.coverage.map((c) => (
              <li key={c.code}>
                <span aria-hidden="true">{coverageMark(c.state)}</span> {c.code === 'custom_domain'
                  ? <>{t.t(coverageKey(c.code, c.state))} (<Link href={DOMAINS_HREF} className="kv-btn--link">{t.t('br.cov.domainsLink')}</Link>)</>
                  : t.t(coverageKey(c.code, c.state))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && (
        <div className="kv-card">
          <h2>{t.t('br.publish.title')}</h2>
          <ol className="kv-list">
            <li>{t.t('br.publish.step1')}</li>
            <li>{t.t('br.publish.step2', { n: formatNumber(data.admins.count, lang) })}</li>
            <li>{t.t('br.publish.step3')}</li>
          </ol>
          {data.draft.publishChecks.length > 0 && (
            <div className="kv-card kv-card--notice" role="note">
              <strong>{t.t('br.publish.blocked')}</strong>
              <ul className="kv-list">{data.draft.publishChecks.map((r, i) => (
                <li key={`${r.code}${i}`}>{t.t(brandRefusalKey(r.code))}{r.code === 'BRAND_CONTRAST_FAILED' && r.detail ? ` — ${t.t(`br.pair.${String(r.detail.pair)}`)} ${String(r.detail.display)}` : ''}</li>
              ))}</ul>
            </div>
          )}
          {data.admins.count < 2 && <p className="kv-field__hint">{t.t('br.publish.secondAdmin', { n: formatNumber(data.admins.count, lang) })}</p>}
          {live ? (
            <div className="kv-card">
              <strong>{t.t('br.proposal.waiting', { v: formatNumber(live.publishesVersion, lang), by: live.proposedByName ?? '—', at: when(live.proposedAt) })}</strong>
              <p className="kv-field__hint">{t.t('br.proposal.reason', { reason: live.reason })} · {t.t('br.proposal.expires', { at: when(live.expiresAt) })}</p>
              <p><Link href={brandProposalHref(live.id, 'confirm')} className="kv-btn kv-btn--primary">{t.t(live.canConfirm ? 'br.proposal.confirm' : 'br.proposal.open')}</Link></p>
            </div>
          ) : (
            data.draft.status !== 'published' && <p><Link href={`${BRAND_PUBLISH_HREF}?step=confirm`} className="kv-btn kv-btn--primary">{t.t('br.publish.button')}</Link></p>
          )}
          <p className="kv-field__hint">{t.t('br.footnote')} · <Link href={BRAND_HISTORY_HREF} className="kv-btn--link">{t.t('br.history.link')}</Link></p>
        </div>
      )}
    </section>
  );
}
