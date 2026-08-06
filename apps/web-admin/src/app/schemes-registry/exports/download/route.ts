// apps/web-admin/src/app/schemes-registry/exports/download/route.ts · serves a receipted SCHEME-REGISTRY export
// (PC-56 ADMIN-4).
//
// Same shape as ADMIN-1d's billing route, ADMIN-2c's support route and ADMIN-3b's taxonomy route: a Server Action
// cannot return a file; admin-api's endpoint is a POST because it MUTATES THE AUDIT LEDGER; this handler is a GET
// reached only by a form submission, so Next's prefetcher never mints a receipt. NO RECEIPT, NO FILE.
import { NextRequest, NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { isAdminAuthenticated } from '../../../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../../../lib/admin-client';
import { buildSchemeExport } from '../../../../features/schemes-registry/version';
import { toCsv } from '../../../../features/billing/csv';

export const dynamic = 'force-dynamic';

interface Envelope {
  receipt?: { id?: string; generatedAt?: string; truncated?: boolean; rowCount?: number; fileName?: string };
  columns?: Array<[string, string]> | string[];
  rows?: Array<Record<string, unknown>>;
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!isAdminAuthenticated()) redirect('/login');
  const q = req.nextUrl.searchParams;

  const built = buildSchemeExport({ report: q.get('report') ?? '', limit: q.get('limit') ?? '' });
  // a validation failure goes back to the page, never down the wire as a CSV containing an apology
  if (!built.ok) redirect(`/schemes-registry/exports?error=sxp_${built.error}`);

  let env: Envelope | undefined;
  try { env = (await adminPost<Envelope>('schemes-registry/exports', { body: built.value })).data; }
  catch (e) {
    const status = e instanceof AdminApiError ? e.status : 0;
    redirect(`/schemes-registry/exports?error=${status === 403 ? 'elevation' : status === 422 ? 'sxp_report' : 'sxp_generic'}`);
  }

  const receipt = env?.receipt;
  if (!receipt?.id) redirect('/schemes-registry/exports?error=sxp_generic');

  // admin-api emits columns as [header, rowKey] pairs; toCsv wants headers plus keyed rows. Mapped here rather than
  // flattened server-side so the header text and the row key stay a single declaration in the domain module.
  const pairs = (env?.columns ?? []) as Array<[string, string]>;
  const headers = pairs.map((c) => (Array.isArray(c) ? c[0] : String(c)));
  const keys = pairs.map((c) => (Array.isArray(c) ? c[1] : String(c)));
  const rows = (env?.rows ?? []).map((r) => {
    const out: Record<string, unknown> = {};
    headers.forEach((h, i) => { out[h] = r[keys[i]] ?? ''; });
    return out;
  });
  const csv = toCsv(headers, rows);
  const fileName = receipt.fileName ?? `krishalaya-schemes-${built.value.report}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store, max-age=0',
      'x-kv-export-receipt': receipt.id,
      'x-kv-export-truncated': receipt.truncated ? '1' : '0',
    },
  });
}
