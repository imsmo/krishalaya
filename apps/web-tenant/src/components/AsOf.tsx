'use client';
// apps/web-tenant/src/components/AsOf.tsx · PC-56 TENANT-SW-f · W318 §1 — "Showing data as of 15:18 (1 h 22 min ago)".
//
// Sits directly above the table / tiles it describes (never global-only). The absolute IST instant is rendered on the server; the relative
// "n min ago" is re-read in the browser every 30 s, because the page may be looked at long after it was rendered (a tab left open at a
// mandi gate, the back button, a page restored offline). Past ONE HOUR (`STALE_AFTER_MS`) the region is marked stale: a class AND a word
// on the banner, and every money cell under it (`.kv-money`) gets the word "stale" — never colour alone (W318 "badge every stale money
// figure individually"). The "Refresh" link reloads the page: the server reads again.
import { useEffect, useRef, useState } from 'react';
import { isStale, istClock, relativeParts, staleClass, STALE_ATTR } from '../features/offline/stale';

export interface AsOfLabels { asOf: string; now: string; minutes: string; hours: string; days: string; ago: string; stale: string; staleCell: string; refresh: string }

/** PURE view — the server render and the render test use it directly. */
export function AsOfView({ at, now, labels }: { at: string; now: Date; labels: AsOfLabels }) {
  const stale = isStale(at, now);
  const r = relativeParts(at, now);
  const rel = r.unit === 'now' ? labels.now
    : r.unit === 'hours' ? `${r.value} ${labels.hours}${r.minutes ? ` ${r.minutes} ${labels.minutes}` : ''} ${labels.ago}`
    : `${r.value} ${r.unit === 'minutes' ? labels.minutes : labels.days} ${labels.ago}`;
  return (
    <p className={staleClass(stale)} {...{ [STALE_ATTR]: stale ? 'true' : 'false' }} role="status">
      {labels.asOf} <time dateTime={at}>{istClock(at)}</time> <span className="kv-asof__rel">({rel})</span>
      {stale && <> · <strong className="kv-asof__stale">{labels.stale}</strong></>}
      {' · '}<a href="" className="kv-btn--link">{labels.refresh}</a>
    </p>
  );
}

export function AsOf({ at, labels }: { at: string; labels: AsOfLabels }) {
  const [now, setNow] = useState<Date>(() => new Date(at));
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30_000);
    const onShow = () => tick();
    window.addEventListener('pageshow', onShow);          // a page restored from the back-forward cache re-reads its age at once
    return () => { window.clearInterval(id); window.removeEventListener('pageshow', onShow); };
  }, []);
  const stale = isStale(at, now);
  useEffect(() => {
    // the region this banner describes: its parent section; every money cell in it carries the word, not only a tint
    const region = ref.current?.closest('section');
    if (!region) return;
    region.setAttribute(STALE_ATTR, stale ? 'true' : 'false');
    region.querySelectorAll<HTMLElement>('.kv-money').forEach((cell) => {
      const mark = cell.querySelector('.kv-money__stale');
      if (stale && !mark) { const s = document.createElement('span'); s.className = 'kv-money__stale'; s.textContent = ` (${labels.staleCell})`; cell.appendChild(s); }
      if (!stale && mark) mark.remove();
    });
  }, [stale, labels.staleCell]);
  return <div ref={ref}><AsOfView at={at} now={now} labels={labels} /></div>;
}
