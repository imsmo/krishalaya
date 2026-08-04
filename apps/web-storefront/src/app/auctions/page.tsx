// apps/web-storefront/src/app/auctions/page.tsx · public auction browse. Flag-gated: when the client switch is off
// (env.featureAuctions === false) the whole surface is hidden via notFound(). Auctions are a public read (no token),
// keyset-paged; if the API's own `auctions` flag is off the call degrades to an empty state (Law 12). Money via
// formatMoneyMinor (Law 2); the live countdown is a tiny client component (no data/secret). Indexable (SSR + ISR).
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { Auction } from '@krishalaya/sdk-js';
import { publicClient } from '../../lib/api-client';
import { env } from '../../lib/env';
import { getTranslator, getLang } from '../../lib/i18n';
import { Countdown, type CountdownLabels } from '../../components/Countdown';

export const revalidate = 30;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return env.featureAuctions
    ? { title: t.t('auctions.title'), description: t.t('auctions.lead') }
    : { title: t.t('common.notFoundTitle'), robots: { index: false } };
}

export default async function AuctionsPage({ searchParams }: { searchParams: { cursor?: string } }) {
  if (!env.featureAuctions) notFound();
  const t = getTranslator();
  const lang = getLang();
  const cd: CountdownLabels = { ended: t.t('auctions.ended'), d: t.t('auctions.cd.d'), h: t.t('auctions.cd.h'), m: t.t('auctions.cd.m'), s: t.t('auctions.cd.s') };

  let items: Auction[] = [];
  let nextCursor: string | null = null;
  try {
    const page = await publicClient().auctions.list({ cursor: searchParams.cursor, limit: 24 });
    items = page.items; nextCursor = page.nextCursor;
  } catch { items = []; }

  const statusLabel = (s: string) => { const k = `auctions.status.${s.toLowerCase()}`; const l = t.t(k); return l === k ? s : l; };
  const kindLabel = (s: string) => { const k = `auctions.kind.${s.toLowerCase()}`; const l = t.t(k); return l === k ? s : l; };

  return (
    <section>
      <h1>{t.t('auctions.title')}</h1>
      <p className="kv-prose__lead">{t.t('auctions.lead')}</p>
      {items.length === 0 ? (
        <p className="kv-empty">{t.t('auctions.empty')}</p>
      ) : (
        <div className="kv-grid">
          {items.map((a) => (
            <Link key={a.auctionId} href={`/auctions/${encodeURIComponent(a.auctionId)}`} className="kv-card">
              <h3 className="kv-card__title">{t.t('auctions.lot', { kind: kindLabel(a.kind) })}</h3>
              <div className="kv-card__price">{formatMoneyMinor(a.startPriceMinor, 'INR', lang)} <span className="kv-card__unit">{t.t('auctions.startPrice')}</span></div>
              <div className="kv-card__meta">
                <span className="kv-badge">{statusLabel(a.status)}</span>
                <span className="kv-card__qty">{t.t('auctions.endsIn')}: <Countdown endsAt={a.endsAt} labels={cd} /></span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {nextCursor && (
        <p className="kv-loadmore"><Link href={`/auctions?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn kv-btn--ghost" rel="next">{t.t('discover.nextPage')}</Link></p>
      )}
    </section>
  );
}
