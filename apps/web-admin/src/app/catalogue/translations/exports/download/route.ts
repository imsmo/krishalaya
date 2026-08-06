// apps/web-admin/src/app/catalogue/translations/exports/download/route.ts · serves a receipted TAXONOMY export
// (PC-56 ADMIN-3b, closes ADMIN-3-Q2).
//
// Same shape as ADMIN-1d's billing route and ADMIN-2c's support route: a Server Action cannot return a file; admin-api's
// endpoint is a POST because it MUTATES THE AUDIT LEDGER; this handler is a GET reached only by a form submission, so
// Next's prefetcher never produces a receipt. NO RECEIPT, NO FILE.
import { NextRequest, NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { isAdminAuthenticated } from '../../../../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../../../../lib/admin-client';
import { buildTaxonomyExport, taxonomyExportFileName } from '../../../../../features/catalogue/translations';
import { toCsv } from '../../../../../features/billing/csv';

export const dynamic = 'force-dynamic';

interface Envelope {
  receipt?: { id?: string; generatedAt?: string; truncated?: boolean; rowCount?: number };
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!isAdminAuthenticated()) redirect('/login');
  const q = req.nextUrl.searchParams;

  const built = buildTaxonomyExport({
    report: q.get('report') ?? '',
    languageCode: q.get('languageCode') ?? '',
    limit: q.get('limit') ?? '',
  });
  // a validation failure goes back to the page, never down the wire as a CSV containing an apology
  if (!built.ok) redirect(`/catalogue/translations/exports?error=texp_${built.error}`);

  let env: Envelope | undefined;
  try { env = (await adminPost<Envelope>('translations/exports', { body: built.value })).data; }
  catch (e) {
    const status = e instanceof AdminApiError ? e.status : 0;
    redirect(`/catalogue/translations/exports?error=${status === 403 ? 'elevation' : status === 422 ? 'texp_exportLanguage' : 'texp_generic'}`);
  }

  const receipt = env?.receipt;
  if (!receipt?.id) redirect('/catalogue/translations/exports?error=texp_generic');

  const csv = toCsv(env?.columns ?? [], env?.rows ?? []);
  const fileName = taxonomyExportFileName(
    built.value.report, receipt.id, receipt.generatedAt ?? new Date().toISOString(), built.value.languageCode);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      // BOM-free UTF-8 with an explicit charset. The missing-translations file carries Devanagari and Gujarati source
      // text, and a translator opening it in Excel needs the encoding declared or the script arrives as mojibake.
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store, max-age=0',
      'x-kv-export-receipt': receipt.id,
      'x-kv-export-truncated': receipt.truncated ? '1' : '0',
    },
  });
}
