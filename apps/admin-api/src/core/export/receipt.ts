// apps/admin-api/src/core/export/receipt.ts · the W054-10 receipt law's missing half, extracted at its sixth surface.
//
// EVERY EXPORT CHAIN SCREEN IN THE CANON PROMISES THE SAME FOUR THINGS: "Audit-stamped receipt: file name, row count,
// **sha256**, generated-at, requester." W2058, W2103, W2132, W2218, W2252 — five different modules, the same sentence.
//
// Five export surfaces have been built against that sentence (billing in ADMIN-1d, support in 2c, taxonomy in 3b, the
// scheme registry in 4, scheme oversight in 4b) and **not one of them has ever computed a hash.** The receipt carried
// id, report, generatedAt, generatedBy, rowCount and truncated. The sha256 was in the spec, on the screen, and nowhere
// in the code — for six waves, including three of my own, until a sixth wave read the chain screen closely enough to
// notice the word.
//
// WHY IT MATTERS RATHER THAN BEING A TIDINESS POINT. A receipt without a content hash records that SOMEBODY exported
// SOMETHING. It cannot establish that the file in front of you is the file we produced. For a regulator export — the
// one surface whose entire value is that a third party can trust the artefact — that is the difference between evidence
// and a spreadsheet somebody emailed.
//
// ---------------------------------------------------------------------------
// WHAT THE DIGEST COVERS, STATED PRECISELY, BECAUSE OVERSTATING IT WOULD BE THE SAME MISTAKE
// ---------------------------------------------------------------------------
// admin-api returns `{columns, rows}` and the console renders the CSV. So a hash computed here covers the DATA, not the
// bytes the browser eventually saves: a change to the CSV renderer (a quoting rule, a line ending) would produce a
// different file with the same digest.
//
// That is a real limitation and it is NAMED in the receipt itself (`digestBasis`) rather than glossed. The alternative —
// having admin-api render the CSV so it can hash the exact bytes — would move presentation into the API for every
// surface, and the honest label is cheaper and more truthful than the architecture change. A verifier re-derives the
// digest from the same canonical form, which is what `canonicalise` exists to make reproducible.
import { createHash } from 'node:crypto';

/** What the digest is computed over. Recorded on every receipt so a verifier knows what to re-derive, and so nobody
 *  reads the hash as a guarantee about the delivered bytes. */
export const DIGEST_BASIS = 'sha256_of_canonical_json_columns_and_rows' as const;
export type DigestBasis = typeof DIGEST_BASIS;

/** Canonical JSON: object keys sorted recursively, arrays left in order.
 *
 *  The same function the scheme-version plane needed for a different reason, and duplicated here ON PURPOSE rather than
 *  imported across module boundaries — that one compares rule sets for equality inside one domain, this one produces a
 *  stable serialisation for hashing across every domain. Coupling a hash format to a comparison helper means a future
 *  change to one silently invalidates every receipt ever issued by the other.
 */
export function canonicalise(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (x === null || typeof x !== 'object') return x === undefined ? null : x;
    if (Array.isArray(x)) return x.map(walk);
    if (x instanceof Date) return x.toISOString();
    const o = x as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = walk(o[k]);
    return out;
  };
  return JSON.stringify(walk(v));
}

/** The content digest for a receipt.
 *
 *  Columns are included, not just rows: the same values under different headers are a different file to whoever reads
 *  it, and a digest that ignored the header would call them identical.
 */
export function contentDigest(columns: unknown, rows: unknown): string {
  return createHash('sha256').update(canonicalise({ columns, rows }), 'utf8').digest('hex');
}

/** The fields every receipt on this platform carries. Written down once so a sixth surface cannot quietly omit one — the
 *  way five surfaces quietly omitted the digest. */
export interface ExportReceipt {
  id: string;
  report: string;
  generatedAt: string;
  generatedBy: string;
  rowCount: number;
  truncated: boolean;
  fileName: string;
  /** sha256 over the canonical serialisation of `{columns, rows}` — see DIGEST_BASIS for what that does and does not
   *  cover. */
  contentSha256: string;
  digestBasis: DigestBasis;
  filters?: Record<string, unknown>;
  /** True when the file's person-fields are masked. Carried on the receipt so an auditor reading the ledger later knows
   *  the artefact was masked without having to find the artefact. */
  piiMasked?: boolean;
}

export function buildReceipt(v: {
  id: string; report: string; generatedAt: Date; generatedBy: string;
  columns: unknown; rows: unknown[]; truncated: boolean; fileName: string;
  filters?: Record<string, unknown>; piiMasked?: boolean;
}): ExportReceipt {
  return {
    id: v.id,
    report: v.report,
    generatedAt: v.generatedAt.toISOString(),
    generatedBy: v.generatedBy,
    rowCount: v.rows.length,
    truncated: v.truncated,
    fileName: v.fileName,
    contentSha256: contentDigest(v.columns, v.rows),
    digestBasis: DIGEST_BASIS,
    ...(v.filters ? { filters: v.filters } : {}),
    ...(v.piiMasked === undefined ? {} : { piiMasked: v.piiMasked }),
  };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE WATERMARK                                                                                                */
/* ------------------------------------------------------------------------------------------------------------ */

/** W045 and W018 both promise "every download watermarked per user", and nothing has ever marked a file.
 *
 *  The mark goes IN THE ARTEFACT, as CSV comment lines above the header. A column on the export JOB could not do it —
 *  one job is fetched many times — and a per-download table records that a download happened without changing what the
 *  downloaded file says. The point of a watermark is that the file, once it has travelled, still names who pulled it.
 *
 *  COMMENT LINES AND NOT A COLUMN, because a spreadsheet opened in Excel shows them as text at the top rather than
 *  corrupting every row, and a parser pointed at this file can skip lines beginning with '#'. It is not tamper-proof —
 *  anybody can delete four lines — and it does not claim to be. It defends against the ordinary case, which is a file
 *  forwarded one hop too far by somebody who never meant to hide where it came from.
 */
export function watermarkPreamble(r: Pick<ExportReceipt, 'id' | 'report' | 'generatedAt' | 'generatedBy' | 'contentSha256' | 'digestBasis'>): string[] {
  return [
    `# Krishalaya export · report=${r.report}`,
    `# receipt=${r.id} · generated=${r.generatedAt} · requested-by=${r.generatedBy}`,
    `# sha256=${r.contentSha256} (${r.digestBasis})`,
    '# This file is audit-logged against the receipt above. It is checksummed, NOT cryptographically signed.',
  ];
}

/** Prepend the watermark to a rendered CSV.
 *
 *  Separated from `toCsv` rather than folded into it: the CSV renderer is shared with paths that are not receipted, and a
 *  watermark on an unreceipted file would name a receipt that does not exist.
 */
export function withWatermark(csv: string, r: Parameters<typeof watermarkPreamble>[0]): string {
  return [...watermarkPreamble(r), csv].join('\r\n');
}
