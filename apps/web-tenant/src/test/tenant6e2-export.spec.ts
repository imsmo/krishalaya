// apps/web-tenant/src/test/tenant6e2-export.spec.ts · PC-56 TENANT-6e-2 · W2553 + W2554, as words.
//
// The API's job is a union with a position, an ETA that may be unknown, a receipt and a fetch log. This suite is about
// the page not quietly undoing that: a helper that printed "0 s" for no history, or "position 0", or a KB for a file that
// does not fit in one, would put a number where the platform has none.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExportJob } from '@krishalaya/sdk-js';
import {
  DOWNLOAD_OUTCOME_KEYS, EXPORT_FAILURE_KEYS, EXPORTS_HREF, byteParts, byteUnitKey, downloadErrorKey, downloadStateKey, etaKey, etaParts, etaUnitKey,
  exportDownloadHref, exportEnqueueErrorKey, exportHref, exportState, exportStateKey, exportTitleKey, exportTransportState, failureKeyFor, shaGroups,
} from '../features/dairy/exports';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CAT = { en, hi, gu } as Record<string, Record<string, string>>;
const has = (key: string) => Object.keys(CAT).filter((l) => typeof CAT[l][key] === 'string' && CAT[l][key].length > 0);
const job = (over: Partial<ExportJob>): ExportJob => ({
  id: 'j', datasetCode: 'dairy.insights', params: { window: 90 }, status: 'queued', attempts: 0, requestedBy: 'u', queuedAt: '2026-09-10T04:00:00Z',
  startedAt: null, generatedAt: null, failedAt: null, expiredAt: null, expiresAt: null, receipt: null, failure: null, standing: null, fetches: null,
  download: { kind: 'not_ready' }, ...over,
});

describe('PC-56 TENANT-6e-2 · one URL, the state decides which canon screen it is', () => {
  it('routes: the job page, and the download proxied through the console with the token', () => {
    expect(exportHref('abc')).toBe('/dairy/insights/exports/abc');
    expect(exportDownloadHref('abc', 'p.s/x')).toBe('/dairy/insights/exports/abc/download?token=p.s%2Fx');
    expect(EXPORTS_HREF).toBe('/dairy/insights/exports');
  });

  it('maps every job status, and every transport failure, to a state with words in three languages', () => {
    for (const s of ['queued', 'running', 'ready', 'failed', 'expired'] as const) expect(exportState(job({ status: s }))).toBe(s);
    expect(exportTransportState('FORBIDDEN', 403)).toBe('restricted');
    expect(exportTransportState('EXPORT_PLANE_DISABLED', 404)).toBe('notEnabled');
    expect(exportTransportState('EXPORT_JOB_NOT_FOUND', 404)).toBe('notFound');   // RLS: not ours — distinct from OFF
    expect(exportTransportState('NOT_FOUND', 404)).toBe('notEnabled');            // the module guard
    expect(exportTransportState('X', 500)).toBe('error');
    expect(exportTransportState(null)).toBeNull();
    for (const s of ['queued', 'running', 'ready', 'expired', 'failed', 'notEnabled', 'restricted', 'notFound', 'error'] as const) {
      expect(has(exportStateKey(s))).toEqual(['en', 'hi', 'gu']);
    }
    // The canon's two titles, and the honest third.
    expect(exportTitleKey('queued')).toBe('dairy.export.title.queued'); expect(exportTitleKey('running')).toBe('dairy.export.title.queued');
    expect(exportTitleKey('ready')).toBe('dairy.export.title.ready'); expect(exportTitleKey('expired')).toBe('dairy.export.title.ready');
    expect(exportTitleKey('failed')).toBe('dairy.export.title.failed');
    expect(en['dairy.export.title.queued']).toBe('Export queued'); expect(en['dairy.export.title.ready']).toBe('Export ready');
  });

  it('the flagged-off sentence says OFF, not "no exports"; the not-found sentence says no such export', () => {
    expect(en[exportStateKey('notEnabled')]).toMatch(/not switched on/);
    expect(en[exportStateKey('notEnabled')]).not.toMatch(/\b0\b/);
    expect(en[exportStateKey('notFound')]).toMatch(/no export with this reference/);
  });

  it('ETA: no history is a sentence, never a zero; durations round UP', () => {
    expect(etaKey({ kind: 'no_history' })).toBe('dairy.export.eta.none');
    expect(en['dairy.export.eta.none']).toMatch(/no estimate yet/);
    expect(en['dairy.export.eta.none']).not.toMatch(/\b0\b/);
    expect(etaKey({ kind: 'estimate', seconds: 5, basis: 'median_of_recent_runs', sample: 1, runsIncluded: 1 })).toBe('dairy.export.eta.estimate');
    expect(etaParts(0)).toEqual({ unit: 'seconds', value: 0 });
    expect(etaParts(59)).toEqual({ unit: 'seconds', value: 59 });
    expect(etaParts(60)).toEqual({ unit: 'minutes', value: 1 });
    expect(etaParts(61)).toEqual({ unit: 'minutes', value: 2 });       // up, never "1 min" for 61 s
    expect(etaParts(3540)).toEqual({ unit: 'minutes', value: 59 });
    expect(etaParts(3599)).toEqual({ unit: 'hours', value: 1, minutes: 0 });   // 59:59 rounds UP to the hour
    expect(etaParts(3600)).toEqual({ unit: 'hours', value: 1, minutes: 0 });
    expect(etaParts(5400)).toEqual({ unit: 'hours', value: 1, minutes: 30 });
    expect(etaParts(-5)).toEqual({ unit: 'seconds', value: 0 });
    for (const u of ['seconds', 'minutes', 'hours'] as const) expect(has(etaUnitKey(u))).toEqual(['en', 'hi', 'gu']);
  });

  it('every failure code, download state and refusal has a sentence ×3, and unknown codes fall to a generic one', () => {
    for (const k of Object.values(EXPORT_FAILURE_KEYS)) expect(has(k)).toEqual(['en', 'hi', 'gu']);
    expect(failureKeyFor('storage_failed')).toBe('dairy.export.failure.storageFailed');
    expect(failureKeyFor('something_new')).toBe('dairy.export.failure.generic');
    expect(has('dairy.export.failure.generic')).toEqual(['en', 'hi', 'gu']);
    expect(downloadStateKey({ kind: 'available', linkTtlSec: 900 })).toBeNull();
    expect(downloadStateKey({ kind: 'not_ready' })).toBe('dairy.export.download.notReady');
    expect(downloadStateKey({ kind: 'file_expired', expiredAt: null })).toBe('dairy.export.download.fileExpired');
    expect(downloadStateKey({ kind: 'failed' })).toBe('dairy.export.download.failed');
    for (const k of Object.values(DOWNLOAD_OUTCOME_KEYS)) expect(has(k)).toEqual(['en', 'hi', 'gu']);
    expect(downloadErrorKey('refused_expired')).toBe('dairy.export.refused.expired');
    expect(downloadErrorKey('EXPORT_FILE_EXPIRED')).toBe('dairy.export.refused.fileExpired');
    expect(downloadErrorKey('EXPORT_NOT_READY')).toBe('dairy.export.refused.notReady');
    expect(downloadErrorKey('weird')).toBe('dairy.export.refused.generic');
    expect(downloadErrorKey(null)).toBeNull(); expect(downloadErrorKey('')).toBeNull();
    for (const c of ['EXPORT_PLANE_DISABLED', 'FORBIDDEN', 'EXPORT_TOO_MANY_OPEN', 'NOT_FOUND', 'other']) expect(has(exportEnqueueErrorKey(c)!)).toEqual(['en', 'hi', 'gu']);
    expect(exportEnqueueErrorKey(undefined)).toBeNull();
  });

  it('the sha256 is grouped for the eye and unchanged in value; sizes round UP with a unit key', () => {
    const s = 'a'.repeat(64);
    expect(shaGroups(s).replace(/ /g, '')).toBe(s);
    expect(shaGroups(s).split(' ')).toHaveLength(8);
    expect(byteParts(0)).toEqual({ value: 0, unit: 'b' });
    expect(byteParts(1023)).toEqual({ value: 1023, unit: 'b' });
    expect(byteParts(1024)).toEqual({ value: 1, unit: 'kb' });
    expect(byteParts(1025)).toEqual({ value: 2, unit: 'kb' });             // does not fit in one
    expect(byteParts(1024 ** 2)).toEqual({ value: 1, unit: 'mb' });
    expect(byteParts(3 * 1024 ** 3 + 1)).toEqual({ value: 4, unit: 'gb' });
    for (const u of ['b', 'kb', 'mb', 'gb'] as const) expect(has(byteUnitKey(u))).toEqual(['en', 'hi', 'gu']);
  });

  it('the canon\'s own words are on the buttons, in three languages', () => {
    for (const k of ['dairy.export.checkReady', 'dairy.export.back', 'dairy.export.backToScreen', 'dairy.export.download.button', 'dairy.export.button']) {
      expect(has(k)).toEqual(['en', 'hi', 'gu']);
    }
    expect(en['dairy.export.checkReady']).toBe('Check ready page');
    expect(en['dairy.export.back']).toBe('Back');
    expect(en['dairy.export.backToScreen']).toBe('Back to the screen');
    expect(en['dairy.export.download.button']).toBe('Download (link valid 15 min)');
    // The receipt's five canon fields.
    for (const k of ['fileName', 'rowCount', 'sha256', 'generatedAt', 'requester']) expect(has(`dairy.export.receipt.${k}`)).toEqual(['en', 'hi', 'gu']);
  });

  it('the page, the actions and the download route exist and are wired the way the header says', () => {
    const root = path.join(__dirname, '..', 'app', 'dairy', 'insights');
    const page = fs.readFileSync(path.join(root, 'exports', '[id]', 'page.tsx'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'exports', '[id]', 'download', 'route.ts'), 'utf8');
    const w172 = fs.readFileSync(path.join(root, 'page.tsx'), 'utf8');
    // No client JS: server component + server actions; the two canon buttons are links/forms.
    expect(page).not.toMatch(/'use client'/);
    expect(page).toMatch(/requireSession\(/); expect(page).toMatch(/robots: \{ index: false/);
    expect(page).toMatch(/mintDownloadLinkAction/);
    expect(page).toMatch(/dairy\.export\.checkReady/); expect(page).toMatch(/dairy\.export\.backToScreen/);
    // The download is proxied and never buffered; refusals go back to the page, never out as a file.
    expect(route).toMatch(/exportsPlane\.openDownload/); expect(route).toMatch(/new Response\(upstream\.body/);
    expect(route).toMatch(/NextResponse\.redirect/);
    expect(route).toMatch(/x-export-sha256/);
    // W172 gained the Export button as a form POST to the enqueue action.
    expect(w172).toMatch(/enqueueInsightsExportAction/); expect(w172).toMatch(/dairy\.export\.button/);
    // RTL-safe: no physical-direction CSS in the new page.
    expect(page).not.toMatch(/margin-left|margin-right|padding-left|padding-right|text-align: ?left|text-align: ?right/);
  });
});
