'use client';
// apps/web-storefront/src/components/BrandChangeNote.tsx · PC-56 TENANT-13d · A4 — the ONE-TIME "same organisation, new look" note.
// Canon W191 step 3: "Members see the new brand at next app open — with a one-time note in their language". The note is shown only to
// someone who saw an EARLIER published version of this tenant's brand (a per-tenant cookie holds the last version seen); a first visit
// just records the current version. Dismissing (or seeing it once) records the new version, so it never shows twice. The in-app
// notification (`tenant.brand_published`) carries the same message to every member's inbox.
import { useEffect, useState } from 'react';
import { brandNoteDecision, brandSeenCookie } from '../features/branding/brand-theme';

const YEAR = 60 * 60 * 24 * 365;

export function BrandChangeNote({ tenantSlug, version, title, body, dismiss }: { tenantSlug: string; version: number; title: string; body: string; dismiss: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const name = brandSeenCookie(tenantSlug);
    const seen = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.split('=')[1];
    const d = brandNoteDecision(seen, version);
    if (d.remember !== null) document.cookie = `${name}=${d.remember}; path=/; max-age=${YEAR}; samesite=lax`;
    setShow(d.show);
  }, [tenantSlug, version]);
  if (!show) return null;
  return (
    <div className="kv-card" role="status" aria-live="polite">
      <strong>{title}</strong>
      <p>{body}</p>
      <button type="button" className="kv-btn--link" onClick={() => setShow(false)}>{dismiss}</button>
    </div>
  );
}
