// apps/web-storefront/src/components/offline/CachedBand.tsx · PC-56 STORE-6a · D2 + D5 — A KEPT PAGE SAYS HOW OLD IT IS.
// Rendered by both chromes ONLY on a page the server marked cacheable (the middleware's `x-kv-cacheable`), which also carries
// `data-kv-rendered-at` on <main>. The band is in the HTML, hidden; a small inline script (no framework, so it works on a copy the worker served
// from its cache even when the page's JavaScript chunks are not on the phone) reads `data-kv-rendered-at` and `navigator.onLine` and applies
// features/store6/stale-tiers.ts `bandState` — whose exact text it embeds:
//   offline → the band ("No signal — this is a copy kept on this phone") + "as of <IST time> (<n> ago)", always;
//   online  → nothing while fresh (< 15 min); the "as of" line past 15 min; the band past 1 h; the full-width band + "prices may have moved"
//             past 24 h;
//   money   → past 1 h every price cell under <main> (`.kv-money`) gets `data-kv-stale="money"` AND a word beside it — never colour alone.
// It re-reads on `online` / `offline`, `pageshow` (a page restored from the back-forward cache) and every 30 s.
import { istClock } from '../../features/offline/stale';
import { bandState, type StaleTier } from '../../features/store6/stale-tiers';

export interface BandLabels { offline: string; online: string; asOf: string; now: string; minutes: string; hours: string; days: string; ago: string; pricesMoved: string; moneyWord: string; reload: string }

/** The script's body: self-contained — `B` is bandState, `L` the labels. Embedded by its text. */
export function cachedBandRun(B: typeof bandState, L: BandLabels): void {
  var run = function () {
    var el = document.querySelector('[data-kv-cached-band]') as HTMLElement | null;
    var main = document.querySelector('main[data-kv-rendered-at]');
    if (!el || !main) return;
    var at = main.getAttribute('data-kv-rendered-at');
    var online = navigator.onLine !== false;
    var s = B(at, Date.now(), online);
    el.hidden = !s.show;
    el.setAttribute('data-kv-tier', s.tier);
    el.setAttribute('data-kv-online', online ? 'true' : 'false');
    var word = el.querySelector('[data-kv-band-state]');
    if (word) word.textContent = online ? L.online : L.offline;
    var m = s.minutes;
    var rel = m < 1 ? L.now : m < 60 ? m + ' ' + L.minutes + ' ' + L.ago
      : m < 1440 ? Math.floor(m / 60) + ' ' + L.hours + (m % 60 ? ' ' + (m % 60) + ' ' + L.minutes : '') + ' ' + L.ago
      : Math.floor(m / 1440) + ' ' + L.days + ' ' + L.ago;
    var relEl = el.querySelector('[data-kv-band-rel]');
    if (relEl) relEl.textContent = rel;
    var full = el.querySelector('[data-kv-band-full]') as HTMLElement | null;
    if (full) full.hidden = s.tier !== 'full';
    var cells = main.querySelectorAll('.kv-money');
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var mark = c.querySelector('.kv-money__kept');
      if (s.show && s.money) {
        c.setAttribute('data-kv-stale', 'money');
        if (!mark) { var w = document.createElement('span'); w.className = 'kv-money__kept'; w.textContent = ' (' + L.moneyWord + ')'; c.appendChild(w); }
      } else {
        if (c.getAttribute('data-kv-stale') === 'money') c.removeAttribute('data-kv-stale');
        if (mark) mark.parentNode && mark.parentNode.removeChild(mark);
      }
    }
  };
  run();
  window.addEventListener('online', run); window.addEventListener('offline', run); window.addEventListener('pageshow', run);
  window.setInterval(run, 30000);
}

/** The inline script for a set of labels (JSON escaped so no `</script>` can close it early). */
export function cachedBandScript(labels: BandLabels): string {
  const json = JSON.stringify(labels).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `(${String(cachedBandRun)})((${String(bandState)}),${json});`;
}

/** PURE view of the band in one state (the render tests and the offline page's examples use it). */
export function CachedBandView({ at, tier, online, labels, hidden }: { at: string; tier: StaleTier; online: boolean; labels: BandLabels; hidden?: boolean }) {
  return (
    <div className={`kv-state kv-cached-band kv-cached-band--${tier}`} data-kv-cached-band="" data-kv-tier={tier} data-kv-online={online ? 'true' : 'false'} role="status" hidden={hidden}>
      <strong data-kv-band-state="">{online ? labels.online : labels.offline}</strong>{' '}
      <span>{labels.asOf} <time dateTime={at}>{istClock(at)}</time> (<span data-kv-band-rel="">{labels.now}</span>)</span>
      {' '}<span data-kv-band-full="" hidden={tier !== 'full'}>{labels.pricesMoved}</span>
      {' · '}<a href="" className="kv-btn--link">{labels.reload}</a>
    </div>
  );
}

/** The band on a kept page: hidden in the HTML, woken by the inline script. */
export function CachedBand({ at, labels }: { at: string; labels: BandLabels }) {
  return (
    <>
      <CachedBandView at={at} tier="fresh" online labels={labels} hidden />
      <script dangerouslySetInnerHTML={{ __html: cachedBandScript(labels) }} />
    </>
  );
}
