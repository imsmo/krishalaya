// apps/web-tenant/src/app/logistics/insights/export/route.ts · W244's [Export] (PC-56 TENANT-5d).
//
// **W2385 AND W2386 DESCRIBE AN EXPORT PLANE THIS PLATFORM DOES NOT HAVE.** W2385: "Exports are async at scale: this
// job is queued with a position and ETA; you will find the file on the ready page." W2386: "Audit-stamped receipt:
// file name, row count, sha256, generated-at, requester — delivery via 15-min signed URL, every fetch logged."
//
// What exists: `data_export_jobs` (migration 0015), touched by exactly ONE plane — admin-api's DPDP/offboarding
// approval flow. No tenant surface enqueues a job, no worker generates a file, nothing computes a sha256 of one, and
// no signed-URL delivery exists for an export (the media plane's presigned GET serves uploaded assets, which is a
// different thing). So a queued/ready chain would be two pages describing a queue that has no producer.
//
// This export is therefore SYNCHRONOUS and BOUNDED, and the screen says so before you press it: one window's tiles,
// its coded failure breakdown and its top lanes — tens of rows, kilobytes. Which makes it honest AND safe: the reason
// the canon wants a queue is unbounded exports, and this is not one. The async, checksummed, audited variant is named
// on the screen and belongs to whichever wave builds the export plane for the whole console.
//
// The rows come from the SAME read the screen renders (one API call, one set of verdicts) and are formatted by the
// same pure `insightsCsv` the tests cover — so a figure in the file cannot disagree with the figure on the page, and
// the refusals travel INTO the file rather than being silently omitted.
import { NextResponse } from 'next/server';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import { exportFileName, insightsCsv, windowOf } from '../../../../features/logistics/desk';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  // Same session gate as the page: an export is a read of the same data, and it must not be the one door that skips
  // authentication because it returns a file instead of HTML.
  await requireSession('/logistics/insights');
  const url = new URL(req.url);
  const window = windowOf(url.searchParams.get('window') ?? undefined);

  try {
    const ins = await tenantClient().logisticsDesk.insights({ window });
    const csv = insightsCsv(ins);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${exportFileName(window, ins.windowTo)}"`,
        // A desk figure is a snapshot of a moving operation; a cached CSV would hand somebody yesterday's rates.
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    });
  } catch (e) {
    // The failure states are the SCREEN's (flagged off / restricted / error), so the browser goes back to the page
    // that can say which one it is in the operator's own language — a CSV body containing an English error message
    // would be a downloaded file that looks like data.
    const err = e instanceof SdkError ? e : null;
    const code = err?.code ?? 'generic';
    return NextResponse.redirect(new URL(`/logistics/insights?window=${window}&error=${encodeURIComponent(code)}`, url), 303);
  }
}
