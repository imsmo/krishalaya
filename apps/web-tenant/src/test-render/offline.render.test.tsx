// apps/web-tenant/src/test-render/offline.render.test.tsx · PC-56 TENANT-SW-f · W318 (offline canon) + W2553 / W2554 (record-only).
// Render proofs (node env + renderToStaticMarkup — the same zero-new-dependency harness this config's header documents):
//   • DEGRADED MODE renders: the banner names it in words ("No signal — read-only … — needs signal") with the policy link; LIVE renders nothing.
//   • AS OF renders the absolute IST instant + the relative age, and past one hour the WORD "stale" (not colour alone) + the stale class.
//   • THE DIFF CHIP renders field · was · now, "nothing was written", and the re-check link back to the confirm step.
//   • W2553 / W2554 (closed at 6e-2): the dairy export screen's state → canon-screen sentences still resolve against the CURRENT plane's
//     `ExportJob` shape (typed fixtures — `tsc` checks them against the SDK) in all three catalogues. The page itself is a server component
//     (next/headers) and cannot render outside a request; its decisions live in `features/dairy/exports`, which is what is rendered here.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Translator } from '@krishalaya/i18n';
import type { ExportJob } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { AsOfView } from '../components/AsOf';
import { SignalBanner } from '../components/OnlineGuard';
import { StaleDiffChip } from '../components/StaleDiffChip';
import { asOfLabels, signalLabels, staleLabels } from '../features/swf/console';
import { downloadStateKey, exportState, exportStateKey, exportTitleKey, shaGroups } from '../features/dairy/exports';

const tr = (lang: string) => new Translator(lang).register('en', en).register('hi', hi).register('gu', gu);
const t = tr('en');

describe('W318 §2 · degraded mode renders, in words', () => {
  it('degraded: the banner, the "— needs signal" word and the policy link', () => {
    const html = renderToStaticMarkup(<SignalBanner mode="degraded" labels={signalLabels(t)} />);
    expect(html).toContain('data-kv-signal="degraded"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('No signal — read-only');
    expect(html).toContain('— needs signal');
    expect(html).toContain('href="/canon/offline"');
  });
  it('live: nothing at all', () => {
    expect(renderToStaticMarkup(<SignalBanner mode="live" labels={signalLabels(t)} />)).toBe('');
  });
  it('hi / gu: the same banner in the reader\'s language', () => {
    expect(renderToStaticMarkup(<SignalBanner mode="degraded" labels={signalLabels(tr('hi'))} />)).toContain('सिग्नल नहीं');
    expect(renderToStaticMarkup(<SignalBanner mode="degraded" labels={signalLabels(tr('gu'))} />)).toContain('સિગ્નલ નથી');
  });
});

describe('W318 §1 · "as of" renders absolute + relative, and STALE in words past one hour', () => {
  const at = '2026-10-04T09:48:00.000Z';
  it('fresh (3 min): the IST instant and "3 min ago", no stale word, the plain class', () => {
    const html = renderToStaticMarkup(<AsOfView at={at} now={new Date(Date.parse(at) + 3 * 60_000)} labels={asOfLabels(t)} />);
    expect(html).toContain('2026-10-04 15:18 IST');
    expect(html).toContain('(3 min ago)');
    expect(html).toContain('data-kv-stale="false"');
    expect(html).not.toContain('Stale');
  });
  it('old (1 h 22 min): the stale class AND the word', () => {
    const html = renderToStaticMarkup(<AsOfView at={at} now={new Date(Date.parse(at) + 82 * 60_000)} labels={asOfLabels(t)} />);
    expect(html).toContain('(1 h 22 min ago)');
    expect(html).toContain('kv-asof--stale');
    expect(html).toContain('data-kv-stale="true"');
    expect(html).toContain('Stale — older than one hour');
  });
});

describe('W318 §3 · the diff chip', () => {
  it('STALE_ROW: field · was · now, nothing written, re-check link', () => {
    const html = renderToStaticMarkup(<StaleDiffChip code="STALE_ROW" diffs={[{ field: 'status', was: 'proposed', now: 'confirmed' }]} labels={staleLabels(t)} recheckHref="/x/act?step=confirm" />);
    expect(html).toContain('data-kv-stale-row="STALE_ROW"');
    expect(html).toContain('Changed while you were looking');
    expect(html).toMatch(/<td><code>status<\/code><\/td><td>proposed<\/td><td><strong>confirmed<\/strong><\/td>/);
    expect(html).toContain('Nothing was written.');
    expect(html).toContain('href="/x/act?step=confirm"');
  });
  it('SEEN_MISSING: its own sentence, no table', () => {
    const html = renderToStaticMarkup(<StaleDiffChip code="SEEN_MISSING" diffs={[]} labels={staleLabels(t)} recheckHref="/x" />);
    expect(html).toContain('did not carry what it showed you');
    expect(html).not.toContain('<table');
  });
});

describe('W2553 / W2554 · the dairy export screen still renders against the current exports plane (record-only)', () => {
  const base: ExportJob = {
    id: '01a1-export', datasetCode: 'dairy_payment_cycle', params: {}, status: 'queued', attempts: 0, requestedBy: 'u1',
    queuedAt: '2026-10-04T05:00:00Z', startedAt: null, generatedAt: null, failedAt: null, expiredAt: null, expiresAt: null,
    receipt: null, failure: null, standing: { position: 2, ahead: 1, eta: { kind: 'no_history' } }, fetches: null, download: { kind: 'not_ready' },
  };
  const ready: ExportJob = {
    ...base, status: 'ready', startedAt: '2026-10-04T05:00:05Z', generatedAt: '2026-10-04T05:00:09Z', expiresAt: '2026-10-11T05:00:09Z', standing: null,
    receipt: { fileName: 'dairy.csv', rowCount: 12, sha256: 'a'.repeat(64), byteSize: 2048, contentType: 'text/csv', generatedAt: '2026-10-04T05:00:09Z', requestedBy: 'u1', notes: [] },
    fetches: { attempts: 0, served: 0, refused: 0, mismatched: 0, lastServedAt: null }, download: { kind: 'available', linkTtlSec: 900 },
  };
  const Screen = ({ job, lang }: { job: ExportJob; lang: string }) => {
    const tt = tr(lang); const s = exportState(job); const dl = downloadStateKey(job.download);
    return (
      <section>
        <h1>{tt.t(exportTitleKey(s))}</h1>
        <p data-state={s}>{tt.t(exportStateKey(s))}</p>
        {job.receipt && <p><code>{shaGroups(job.receipt.sha256)}</code></p>}
        {dl && <p>{tt.t(dl)}</p>}
      </section>
    );
  };
  it.each(['en', 'hi', 'gu'])('W2553 (queued) and W2554 (ready) resolve to their canon sentences — %s', (lang) => {
    const q = renderToStaticMarkup(<Screen job={base} lang={lang} />);
    const r = renderToStaticMarkup(<Screen job={ready} lang={lang} />);
    const cat = ({ en, hi, gu } as Record<string, Record<string, string>>)[lang];
    expect(q).toContain(`<h1>${cat['dairy.export.title.queued']}</h1>`);
    expect(q).toContain('data-state="queued"');
    expect(r).toContain(`<h1>${cat['dairy.export.title.ready']}</h1>`);
    expect(r).toContain('data-state="ready"');
    expect(r).toContain('aaaaaaaa aaaaaaaa');
    for (const html of [q, r]) expect(html).not.toMatch(/dairy\.export\./);   // no raw key leaks: every sentence resolved
  });
});
