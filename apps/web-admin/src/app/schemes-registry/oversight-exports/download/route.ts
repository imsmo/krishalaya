// apps/web-admin/src/app/schemes-registry/oversight-exports/download/route.ts · serves a receipted OVERSIGHT export
// (PC-56 ADMIN-4b).
//
// Same shape as the five receipt surfaces before it: a Server Action cannot return a file; admin-api's endpoint is a
// POST because it MUTATES THE AUDIT LEDGER; this handler is a GET reached only by a form submission, so Next's
// prefetcher never mints a receipt. NO RECEIPT, NO FILE.
//
// The one thing this route adds over the registry one: the receipt carries `piiMasked`, and the header echoes it, so a
// pipeline consuming these files can assert the masking rather than trust it.
import { NextRequest, NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { isAdminAuthenticated } from '../../../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../../../lib/admin-client';
import { buildOversightExport } from '../../../../features/schemes-registry/oversight';
import { toCsv } from '../../../../features/billing/csv';

export const dynamic = 'force-dynamic';

interface Envelope {
  receipt?: { id?: string; generatedAt?: string; truncated?: boolean; rowCount?: number; fileName?: string; piiMasked?: boolean };
  columns?: Array<[string, string]>;
  rows?: Array<Record<string, unknown>>;
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!isAdminAuthenticated()) redirect('/login');
  const q = req.nextUrl.searchParams;

  const built = buildOversightExport({
    report: q.get('report') ?? '',
    limit: q.get('limit') ?? '',
    days: q.get('days') ?? '',
    status: q.get('status') ?? '',
    schemeId: q.get('schemeId') ?? '',
    assistedOnly: q.get('assistedOnly') ?? '',
  });
  // A validation failure goes back to the page, never down the wire as a CSV containing an apology. And an
  // unrecognised STATUS is a failure rather than a pass-through: silently ignored, it would produce a file of every
  // application on the platform under a filename claiming a filter.
  if (!built.ok) redirect(`/schemes-registry/oversight-exports?error=soxp_${built.error}`);

  let env: Envelope | undefined;
  try { env = (await adminPost<Envelope>('schemes-oversight/exports', { body: built.value })).data; }
  catch (e) {
    const status = e instanceof AdminApiError ? e.status : 0;
    redirect(`/schemes-registry/oversight-exports?error=${status === 403 ? 'elevation' : status === 422 ? 'soxp_report' : 'soxp_generic'}`);
  }

  const receipt = env?.receipt;
  if (!receipt?.id) redirect('/schemes-registry/oversight-exports?error=soxp_generic');

  const pairs = (env?.columns ?? []) as Array<[string, string]>;
  const headers = pairs.map((c) => (Array.isArray(c) ? c[0] : String(c)));
  const keys = pairs.map((c) => (Array.isArray(c) ? c[1] : String(c)));
  const rows = (env?.rows ?? []).map((r) => {
    const out: Record<string, unknown> = {};
    headers.forEach((h, i) => { out[h] = r[keys[i]] ?? ''; });
    return out;
  });
  const csv = toCsv(headers, rows);
  const fileName = receipt.fileName ?? `krishalaya-scheme-oversight-${built.value.report}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      // Devanagari and Gujarati names survive the mask (only the final token is initialised), so the charset has to be
      // declared or a masked name arrives as mojibake in Excel.
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store, max-age=0',
      'x-kv-export-receipt': receipt.id,
      'x-kv-export-truncated': receipt.truncated ? '1' : '0',
      // Asserted, not assumed: a downstream consumer can refuse a file that does not claim masking.
      'x-kv-pii-masked': receipt.piiMasked ? '1' : '0',
    },
  });
}
