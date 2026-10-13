// apps/web-storefront/src/app/(platform)/layout.tsx · PC-56 STORE-1b · C1 — the PLATFORM's own pages (the route group adds no URL segment):
// the platform store's header (brand from packages/tokens — founder D2, the platform store name — search, categories, language, cart, sign-in)
// and the platform footer. A tenant store (/[tenantSlug]) never renders inside this layout.
import { SiteHeader } from '../../components/SiteHeader';
import { SiteFooter } from '../../components/SiteFooter';

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="kv-container" id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
