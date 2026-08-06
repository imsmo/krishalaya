// apps/web-admin/src/app/billing/reports/export/route.ts · serves the audit-stamped export as a CSV DOWNLOAD
// (PC-56 ADMIN-1d, closes ADMIN-1-Q3).
//
// WHY A ROUTE HANDLER AND NOT A SERVER ACTION: a Server Action cannot return a file. This handler is reached by a GET
// form submission, calls the API's POST /billing/exports (which writes the audit RECEIPT before returning a single
// row), and streams the CSV back with the receipt id in the filename.
//
// ON THE GET/POST QUESTION: the admin-api endpoint is a POST precisely because it mutates the audit ledger, and a GET
// that mutates gets prefetched and repeated by proxies. This handler is a GET — but it is only ever reached by a form
// SUBMISSION, never by a <Link>, so Next's prefetcher does not touch it. The write still happens exactly once per
// click, inside the POST this handler makes.
//
// NOTHING IS STORED. The bytes exist for one response. Generating and keeping a file server-side would mean deciding
// how long a snapshot of every tenant's billing lives in a bucket — a retention decision with a named owner, not a
// side effect of a download button.
import { NextRequest, NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { isAdminAuthenticated } from '../../../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../../../lib/admin-client';
import { buildExport } from '../../../../features/billing/reporting';
import { toCsv, exportFileName } from '../../../../features/billing/csv';

export const dynamic = 'force-dynamic';

interface ExportEnvelope {
  receipt?: { id?: string; report?: string; generatedAt?: string; rowCount?: number; truncated?: boolean };
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!isAdminAuthenticated()) redirect('/login');
  const q = req.nextUrl.searchParams;

  const built = buildExport({
    report: q.get('report') ?? '',
    from: q.get('from') ?? '',
    to: q.get('to') ?? '',
    limit: q.get('limit') ?? '',
  });
  // Validation failures go back to the page with a named error rather than downloading an error document — a CSV
  // containing an apology is a file somebody will later treat as data.
  if (!built.ok) redirect(`/billing/reports?error=exp_${built.error}`);

  let env: ExportEnvelope | undefined;
  try { env = (await adminPost<ExportEnvelope>('billing/exports', { body: built.value })).data; }
  catch (e) {
    const status = e instanceof AdminApiError ? e.status : 0;
    redirect(`/billing/reports?error=${status === 403 ? 'elevation' : status === 422 ? 'exp_report' : 'generic'}`);
  }

  const receipt = env?.receipt;
  // NO RECEIPT, NO FILE. The receipt law is not decoration: if the export could not be recorded, it must not happen.
  if (!receipt?.id) redirect('/billing/reports?error=generic');

  const csv = toCsv(env?.columns ?? [], env?.rows ?? []);
  const fileName = exportFileName(built.value.report, receipt.id, receipt.generatedAt ?? new Date().toISOString());

  return new NextResponse(csv, {
    status: 200,
    headers: {
      // text/csv with an explicit charset: Excel opens UTF-8 CSV correctly only when told
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      // never cached: it is one tenant-billing snapshot for one operator at one moment
      'cache-control': 'no-store, max-age=0',
      // the receipt id in a header too, so a scripted consumer can record provenance without parsing the filename
      'x-kv-export-receipt': receipt.id,
      'x-kv-export-truncated': receipt.truncated ? '1' : '0',
    },
  });
}
