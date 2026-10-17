'use client';
// apps/web-storefront/src/components/drafts/DraftsChip.tsx · PC-56 STORE-6b · B8 / C2 — "N on this phone", beside the cart in BOTH headers
// (SiteHeader → `/sync`, every store's drafts on this host; TenantHeader → `/<slug>/sync`, THIS organisation's only — never another's on its
// page). NEVER in the offline shell (TenantShellHeader, the `(shell)` layout): that chrome is session-free and the same for every person.
// It is also the page's SWEEPER: on every load it honours the wipe marker and removes another owner's drafts unseen and expired ones
// (components/drafts/phone.ts). Nothing is rendered at 0, with no owner marker, before the phone answers, or without JavaScript — so the
// server's HTML never carries a count (a kept public page stays the same for everyone).
import { useEffect, useState } from 'react';
import { DRAFTS_EVENT, settlePhone } from './phone';

export interface ChipLabels { chip: string; aria: string }

/** PURE view. */
export function DraftsChipView({ n, href, labels, fmt = String }: { n: number | null; href: string; labels: ChipLabels; fmt?: (n: number) => string }) {
  if (!n || n <= 0) return null;
  return (
    <a href={href} className="kv-header__link kv-header__drafts" data-kv-nav="drafts" data-kv-drafts={n} aria-label={labels.aria.replace('{n}', fmt(n))}>
      {labels.chip.replace('{n}', fmt(n))}
    </a>
  );
}

export function DraftsChip({ slug, href, labels, lang }: { slug: string | null; href: string; labels: ChipLabels; lang: string }) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let stopped = false;
    const count = () => {
      settlePhone().then((p) => {
        if (stopped) return;
        setN(p ? p.kept.filter((d) => d.owner === p.owner && (slug === null || d.slug === slug)).length : 0);
      }).catch(() => { if (!stopped) setN(0); });
    };
    count();
    window.addEventListener(DRAFTS_EVENT, count);
    return () => { stopped = true; window.removeEventListener(DRAFTS_EVENT, count); };
  }, [slug]);
  let fmt: (v: number) => string = String;
  try { const nf = new Intl.NumberFormat(lang); fmt = (v) => nf.format(v); } catch { fmt = String; }
  return <DraftsChipView n={n} href={href} labels={labels} fmt={fmt} />;
}
