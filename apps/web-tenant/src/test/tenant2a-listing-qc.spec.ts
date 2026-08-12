// PC-56 TENANT-2a · W123 console + W126/W127 QC — the pure console logic and the page rules that must not drift.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CONSOLE_TABS, isConsoleTab, tabHref, waitingAge, QC_TARGET_HOURS, bandVerdict, parseBulkIds, BULK_MAX, statusClass,
} from '../features/listings/console';

describe('TENANT-2a · the tab vocabulary is the state machine’s, closed, with held made visible', () => {
  it('contains every status incl. held — a platform-held listing must never be unreachable by tab', () => {
    expect(CONSOLE_TABS).toEqual(['all', 'published', 'pending_approval', 'draft', 'paused', 'sold_out', 'expired', 'rejected', 'hidden', 'held', 'archived']);
  });
  it('rejects anything outside the vocabulary', () => {
    expect(isConsoleTab('published')).toBe(true);
    expect(isConsoleTab('deleted')).toBe(false);
    expect(isConsoleTab(undefined)).toBe(false);
  });
  it('tab links NEVER carry a cursor — a keyset cursor is a position in ONE ordered set (the 1b lesson)', () => {
    for (const tab of CONSOLE_TABS) expect(tabHref(tab)).not.toContain('cursor');
    expect(tabHref('all')).toBe('/listings');
    expect(tabHref('draft')).toBe('/listings?status=draft');
  });
});

describe('TENANT-2a · the waiting clock', () => {
  const now = new Date('2026-08-12T10:00:00Z');
  it('ages a clocked submission to 0.1h precision and flags the 4h target at the boundary', () => {
    expect(waitingAge('2026-08-12T07:54:00Z', now)).toEqual({ kind: 'aged', hours: 2.1, overTarget: false });
    expect(waitingAge('2026-08-12T06:00:00Z', now)).toEqual({ kind: 'aged', hours: 4, overTarget: true });
    expect(waitingAge('2026-08-12T06:06:00Z', now)).toEqual({ kind: 'aged', hours: 3.9, overTarget: false });
    expect(QC_TARGET_HOURS).toBe(4);   // W126's own target
  });
  it('a pre-0138 submission is UNCLOCKED — said, never aged into an invented number', () => {
    expect(waitingAge(null, now)).toEqual({ kind: 'unclocked' });
  });
  it('a clock skewed into the future reads 0, never negative', () => {
    expect((waitingAge('2026-08-12T11:00:00Z', now) as { hours: number }).hours).toBe(0);
  });
});

describe('TENANT-2a · the band verdict is bigint-safe and labelled', () => {
  const band = { lowMinor: '248000', highMinor: '276000' };
  it('inside / above / below with integer percentages', () => {
    expect(bandVerdict('264000', band)).toEqual({ kind: 'inside' });
    expect(bandVerdict('248000', band)).toEqual({ kind: 'inside' });   // the bounds belong to the band
    expect(bandVerdict('276000', band)).toEqual({ kind: 'inside' });
    expect(bandVerdict('287040', band)).toEqual({ kind: 'above', pct: 4 });
    expect(bandVerdict('124000', band)).toEqual({ kind: 'below', pct: 50 });
  });
  it('no comparable listings = NO BAND — unknown is never "inside"', () => {
    expect(bandVerdict('264000', null)).toEqual({ kind: 'no_band' });
  });
});

describe('TENANT-2a · bulk selection', () => {
  it('dedupes, refuses empty, caps at BULK_MAX', () => {
    expect(parseBulkIds(['a', 'a', ' b '])).toEqual({ ok: true, ids: ['a', 'b'] });
    expect(parseBulkIds([])).toEqual({ ok: false, error: 'none' });
    expect(parseBulkIds(Array.from({ length: BULK_MAX + 1 }, (_, i) => `id${i}`))).toEqual({ ok: false, error: 'toomany' });
  });
  it('rejected and held alarm; nothing celebrates', () => {
    expect(statusClass('rejected')).toContain('kv-badge--frozen');
    expect(statusClass('held')).toContain('kv-badge--frozen');
    expect(statusClass('published')).toBe('kv-badge');
  });
});

describe('TENANT-2a · the page rules that must not drift (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('the bulk actions module has NO price verb — "bulk actions never change price" is structure, not copy', () => {
    const src = read('app', 'listings', 'actions.ts');
    expect(src).not.toMatch(/price/i);
    expect(src).toMatch(/'pause'/);
    expect(src).toMatch(/'extend'/);
  });

  it('the console page paginates by keyset only — no OFFSET, no page numbers', () => {
    const src = read('app', 'listings', 'page.tsx');
    expect(src.toUpperCase()).not.toContain('OFFSET');
    expect(src).toContain('cursor');
  });

  it('the review page draws no fake AI ticks — the absent checks are NAMED via their key', () => {
    const src = read('app', 'listings', 'qc', '[id]', 'page.tsx');
    expect(src).toContain('qcr.absentChecks');
    expect(src).toContain('selfReview');       // the no-self-review state is wired, not decorative
  });
});
