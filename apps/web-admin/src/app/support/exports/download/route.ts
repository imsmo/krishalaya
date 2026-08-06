// apps/web-admin/src/app/support/exports/download/route.ts · serves an audit-stamped SUPPORT export as a CSV download
// (PC-56 ADMIN-2c, closes ADMIN-2-Q5).
//
// Same shape as ADMIN-1d's billing route, for the same reasons: a Server Action cannot return a file; admin-api's
// endpoint is a POST because it MUTATES THE AUDIT LEDGER; this handler is a GET reached only by a form SUBMISSION, so
// Next's prefetcher never triggers an export receipt.
//
// IT LIVES IN A `download/` SUBDIRECTORY because a Next route segment cannot hold both a page and a route handler, and
// the page at /support/exports is the form that submits here.
//
// NO RECEIPT, NO FILE — the receipt law is not decoration. And nothing is stored: the bytes exist for one response,
// because keeping a file would mean deciding how long a snapshot of farmers' written complaints lives in a bucket, which
// is a retention decision with a named owner rather than a side effect of a download button.
import { NextRequest, NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { isAdminAuthenticated } from '../../../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../../../lib/admin-client';
import { buildSupportExport, supportExportFileName, toCsv, carriesFreeText } from '../../../../features/support/export';

export const dynamic = 'force-dynamic';

interface ExportEnvelope {
  receipt?: { id?: string; generatedAt?: string; rowCount?: number; truncated?: boolean; containsFreeText?: boolean };
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!isAdminAuthenticated()) redirect('/login');
  const q = req.nextUrl.searchParams;

  const built = buildSupportExport({
    report: q.get('report') ?? '',
    from: q.get('from') ?? '',
    to: q.get('to') ?? '',
    tenantId: q.get('tenantId') ?? '',
    maxScore: q.get('maxScore') ?? '',
    limit: q.get('limit') ?? '',
  });
  // a validation failure goes back to the page, never down the wire as a CSV containing an apology — a file like that is
  // one somebody will later treat as data
  if (!built.ok) redirect(`/support/exports?error=sexp_${built.error}`);

  let env: ExportEnvelope | undefined;
  try { env = (await adminPost<ExportEnvelope>('support/exports', { body: built.value })).data; }
  catch (e) {
    const status = e instanceof AdminApiError ? e.status : 0;
    redirect(`/support/exports?error=${status === 403 ? 'elevation' : status === 422 ? 'sexp_window' : 'sexp_generic'}`);
  }

  const receipt = env?.receipt;
  if (!receipt?.id) redirect('/support/exports?error=sexp_generic');

  const csv = toCsv(env?.columns ?? [], env?.rows ?? []);
  const fileName = supportExportFileName(built.value.report, receipt.id, receipt.generatedAt ?? new Date().toISOString());

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store, max-age=0',
      'x-kv-export-receipt': receipt.id,
      'x-kv-export-truncated': receipt.truncated ? '1' : '0',
      // the header a scripted consumer can act on: this file contains words people wrote about their own problems
      'x-kv-export-free-text': (receipt.containsFreeText ?? carriesFreeText(built.value.report)) ? '1' : '0',
    },
  });
}
