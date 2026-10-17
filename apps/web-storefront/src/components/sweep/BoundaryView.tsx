'use client';
// apps/web-storefront/src/components/sweep/BoundaryView.tsx · PC-56 STORE-SWEEP-b · C2 (founder D4 — canon W316, survey F-7 / B12) — ONE VIEW FOR EVERY
// BOUNDARY: `[tenantSlug]/not-found`, `[tenantSlug]/error`, `(platform)/not-found`, `(platform)/error`, the root `not-found` / `error`, and the body of
// `global-error`. The three questions in order (features/sweep/boundary-words.ts), "Back to <organisation>" → `/<slug>` inside a store (the layout's
// BoundaryProvider) or "Back to the bazaar" → `/` on the platform; for an error a Try-again BUTTON (`reset()` — only when pressed: NO automatic retry,
// no timer, no effect — a boundary can sit over a filled form, survey E3; a money page never retries by itself, 6a) and "Your orders" (if you were
// paying, see where the payment stands before paying again); the code in small print for support.
import { useBoundary } from './BoundaryContext';
import { boundaryWords, cookieLang, type BoundaryKind } from '../../features/sweep/boundary-words';

export function BoundaryView({ kind, code, onRetry }: { kind: BoundaryKind; code?: string | null; onRetry?: () => void }) {
  const ctx = useBoundary();
  const lang = ctx?.lang ?? cookieLang(typeof document !== 'undefined' ? document.cookie : '');
  const store = ctx?.store ?? null;
  const w = boundaryWords(kind, store, lang, code);
  return (
    <section className="kv-empty-state" role={kind === 'error' ? 'alert' : undefined} data-kv-boundary={kind} data-kv-boundary-chrome={store ? 'store' : 'platform'}>
      <h1>{w.title}</h1>
      <p data-kv-q="what">{w.what}</p>
      <p data-kv-q="safe">{w.safe}</p>
      <p data-kv-q="now">{w.now}</p>
      <p className="kv-cart__actions">
        {kind === 'error' && onRetry && <button type="button" className="kv-btn" data-kv-retry="button" onClick={() => onRetry()}>{w.retry}</button>}
        {kind === 'error' && <a href={w.ordersHref} className="kv-btn--link" data-kv-link="orders">{w.orders}</a>}
        <a href={w.backHref} className={kind === 'error' ? 'kv-btn--link' : 'kv-btn'} data-kv-link="back">{w.back}</a>
      </p>
      {w.code && <p className="kv-detail__muted"><small data-kv-code="support">{w.code}</small></p>}
    </section>
  );
}
