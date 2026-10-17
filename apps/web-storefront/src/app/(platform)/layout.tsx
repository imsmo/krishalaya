// apps/web-storefront/src/app/(platform)/layout.tsx · PC-56 STORE-1b · C1 — the PLATFORM's own pages (the route group adds no URL segment):
// the platform store's header (brand from packages/tokens — founder D2, the platform store name — search, categories, language, cart, sign-in)
// and the platform footer. A tenant store (/[tenantSlug]) never renders inside this layout.
// PC-56 STORE-6a:
//   • D1 — the ported `OnlineGuard` is mounted ONCE here (the web-tenant root-layout precedent; it was mounted only by the sign-in screen):
//     without signal every POST form's button holds "— needs signal", the banner says so in words and "Why?" opens `/offline`;
//     `SignalReasons` (storefront-local) prints the reason beside each money / countdown act;
//   • D4 — `UpdateNotice`: "a new version is ready", never over a form with content;
//   • D2 — a page the middleware marked cacheable (`x-kv-cacheable`) is stamped: `<meta name="kv-cacheable">`, `data-kv-rendered-at` on <main>,
//     and the hidden `CachedBand` that wakes when the page is shown from the phone's copy. (On the platform host the deciding flag reads OFF —
//     lib/offline-reads.ts — so in practice no platform page is stamped.)
// PC-56 STORE-6b · D3: the install invitation (components/install/InstallInvite.tsx) is mounted ONCE here with the platform store's name and icon
// (as the platform manifest has them) and `flagOn: false` — `storefront_install_prompt` is TENANT-scoped, so the platform host (no organisation
// in context) reads it absent → OFF (the 6a Q1 limit, named): no sheet, no listener, no cookie on the platform's own pages.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { SiteHeader } from '../../components/SiteHeader';
import { SiteFooter } from '../../components/SiteFooter';
import { OnlineGuard } from '../../components/OnlineGuard';
import { SignalReasons } from '../../components/offline/SignalReasons';
import { UpdateNotice } from '../../components/offline/UpdateNotice';
import { CachedBand } from '../../components/offline/CachedBand';
import { bandLabels, reasonWords, signalLabels, updateLabels } from '../../lib/offline-labels';
import { CACHEABLE_HEADER } from '../../features/store6/sw-rules';
import { InstallInvite } from '../../components/install/InstallInvite';
import { inviteLabels } from '../../lib/drafts-labels';
import { PLATFORM_BRAND, PLATFORM_ICONS } from '../../features/branding/brand-theme';
import { PLATFORM_CHROME } from '../../features/store4a/account';
import { appHref } from '../../features/store6b/paths';

const cacheable = () => headers().get(CACHEABLE_HEADER) === 'public';

export function generateMetadata(): Metadata {
  return cacheable() ? { other: { 'kv-cacheable': 'public' } } : {};
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const signal = signalLabels('/offline');
  const renderedAt = cacheable() ? new Date().toISOString() : null;
  return (
    <>
      <SiteHeader />
      <main className="kv-container" id="main" {...(renderedAt ? { 'data-kv-rendered-at': renderedAt } : {})}>
        <OnlineGuard labels={signal} />
        <SignalReasons words={reasonWords()} needsSignal={signal.needsSignal} />
        <UpdateNotice labels={updateLabels()} />
        {renderedAt && <CachedBand at={renderedAt} labels={bandLabels()} />}
        {children}
        <InstallInvite name={PLATFORM_BRAND.platformStoreName} iconHref={PLATFORM_ICONS[0].src} flagOn={false} appHref={appHref(PLATFORM_CHROME)} labels={inviteLabels()} />
      </main>
      <SiteFooter />
    </>
  );
}
