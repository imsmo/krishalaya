// apps/web-storefront/src/app/(platform)/organisations/page.tsx · PC-56 STORE-1b · C2 (founder D1) — "Browse all organisations": the public
// directory of VERIFIED live organisations (the platform's own approval — 0204), each linking to its own store. Name, district, logo and the
// member-farmer count only (no owner, phone, tax or registration field). Keyset "Show more" (µs cursor) with the direction-safe arrow.
// EMPTY and ERROR are different sentences; Retry reloads the same URL.
import type { Metadata } from 'next';
import type { OrganisationCard } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { publicClient } from '../../../lib/api-client';
import { env } from '../../../lib/env';
import { getTranslator, getLang } from '../../../lib/i18n';
import { DirArrow } from '../../../components/DirArrow';
import { loadResult, listState, reloadHref } from '../../../features/home/load-result';

export const dynamic = 'force-dynamic';
const PAGE = 24;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => { const s = (Array.isArray(v) ? v[0] : v)?.trim(); return s ? s : undefined; };
/** the version-pinned published logo (13d) wins; the 0075 https logo otherwise; none → the name alone (never the platform's mark) */
const logoOf = (o: OrganisationCard) => (o.logoPath && /^\/v1\/storefront\/branding\/logo\/[0-9a-f-]{36}\/\d+$/.test(o.logoPath) ? `${env.publicApiUrl.replace(/\/+$/, '')}${o.logoPath}` : o.logoUrl);

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('orgs.title'), description: t.t('orgs.lead') };
}

export default async function OrganisationsPage({ searchParams }: { searchParams: SP }) {
  const t = getTranslator();
  const lang = getLang();
  const after = one(searchParams.after);
  const dir = await loadResult(() => publicClient().storefront.organisations({ after, limit: PAGE }));
  const state = listState(dir);
  const orgs: OrganisationCard[] = dir.ok ? dir.data.items : [];
  const next = dir.ok ? dir.data.nextCursor : null;
  return (
    <section aria-labelledby="kv-orgs-title">
      <h1 id="kv-orgs-title">{t.t('orgs.title')}</h1>
      <p className="kv-prose__lead">{t.t('orgs.lead')}</p>
      {state === 'error' && (
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('orgs.error')}</p>
          <a href={reloadHref('/organisations', searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
      )}
      {state === 'empty' && <p className="kv-empty" data-kv-state="empty">{t.t('orgs.empty')}</p>}
      {state === 'ok' && (
        <>
          <div className="kv-grid">
            {orgs.map((o) => {
              const logo = logoOf(o);
              return (
                <a key={o.slug} href={`/${o.slug}`} className="kv-card" data-kv-card="organisation">
                  {logo && <img className="kv-tenant-header__logo" src={logo} alt="" loading="lazy" decoding="async" />}
                  <h2 className="kv-card__title">{o.displayName}</h2>
                  {o.district && <p className="kv-card__org">{o.district}</p>}
                  <p className="kv-card__meta">{t.t('orgs.members', { count: formatNumber(o.memberFarmers, lang) })}</p>
                </a>
              );
            })}
          </div>
          {next && (
            <p className="kv-loadmore">
              <a href={`/organisations?after=${encodeURIComponent(next)}`} className="kv-btn" rel="next">{t.t('discover.showMore')} <DirArrow /></a>
            </p>
          )}
        </>
      )}
    </section>
  );
}
