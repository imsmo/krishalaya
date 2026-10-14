// apps/web-storefront/src/app/(platform)/cart/page.tsx · PC-56 STORE-2b · C1 (founder D3) — THE PLATFORM'S /cart IS A DOOR, NOT A CART.
// A cart belongs to ONE organisation's store and lives under its own header at /<slug>/cart. This route sends a signed-in buyer to the cart of
// the organisation their session was minted for (`kv_tid` → `GET /v1/storefront/tenant` → its slug), carrying the query along (checkout sends
// a refused buyer back here with ?status=…); an anonymous visitor goes to the platform sign-in with `next=/cart` (requireSession). If the
// session's organisation cannot be read, the page says so with a Retry (a reload) — never a guessed store.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { sessionTenantClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { reloadHref } from '../../../features/home/load-result';
import { cartHref } from '../../../features/store2b/cart';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('cart.title'), robots: { index: false, follow: false } };
}

export default async function PlatformCartDoor({ searchParams }: { searchParams: SP }) {
  await requireSession('/cart');
  let slug: string | null = null;
  try { slug = (await sessionTenantClient().storefront.tenant()).slug ?? null; } catch { slug = null; }
  if (slug) {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(searchParams)) { const s = Array.isArray(v) ? v[0] : v; if (typeof s === 'string') q[k] = s; }
    redirect(cartHref(slug, q));
  }
  const t = getTranslator();
  return (
    <section className="kv-cart">
      <h1>{t.t('cart.title')}</h1>
      <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
        <p>{t.t('cart.doorError')}</p>
        <a href={reloadHref('/cart', searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
      </div>
    </section>
  );
}
