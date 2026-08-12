// modules/payments/domain/export-receipt.ts · the export receipt every chain screen in the canon promises, on the
// TENANT realm for the first time (PC-56 TENANT-3c-1).
//
// W2435: "Audit-stamped receipt: file name, row count, sha256, generated-at, requester — delivery via 15-min signed
// URL, every fetch logged." admin-api grew this helper at its sixth export surface (core/export/receipt.ts) after
// five surfaces had shipped without ever computing the hash. apps/api has had NO export receipt at all — so this is
// the first one on the tenant side, and it is deliberately the same shape, with the same honest label about what the
// digest covers, rather than a second dialect of the same promise.
//
// **WHAT THE DIGEST COVERS, SAID PLAINLY.** The API returns DATA (sections and rows); the console renders the file.
// So the hash covers the canonical JSON of that data, not the bytes a browser saves — a change to the CSV writer
// would produce different bytes with the same digest. That limitation is named in the receipt itself (`digestBasis`)
// rather than glossed, because a receipt that overstates what it proves is worse than one that proves less.
import { createHash } from 'node:crypto';

export const DIGEST_BASIS = 'sha256_of_canonical_json_payload' as const;
export type DigestBasis = typeof DIGEST_BASIS;

/** Canonical JSON: object keys sorted recursively, arrays left in order, bigints as decimal strings. Reproducible,
 *  so a third party can re-derive the digest from the same data. */
export function canonicalise(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'bigint') return v.toString();
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = walk(o[k]); return acc; }, {});
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

export interface ExportReceipt {
  fileName: string;
  rowCount: number;
  sha256: string;
  digestBasis: DigestBasis;
  generatedAt: string;
  requestedBy: string;
  /** 'complete' | 'partial' | 'empty' — what the file actually covers. A partial artefact says so ON the receipt. */
  coverage: string;
  /** Anything the export left out, and why. Empty is a claim; a populated list is a warning the reader must see. */
  omissions: Array<{ reason: string; count: number }>;
}

export function buildReceipt(input: {
  fileName: string; payload: unknown; rowCount: number; requestedBy: string; generatedAt: Date;
  coverage: string; omissions: Array<{ reason: string; count: number }>;
}): ExportReceipt {
  return {
    fileName: input.fileName,
    rowCount: input.rowCount,
    sha256: createHash('sha256').update(canonicalise(input.payload)).digest('hex'),
    digestBasis: DIGEST_BASIS,
    generatedAt: input.generatedAt.toISOString(),
    requestedBy: input.requestedBy,
    coverage: input.coverage,
    omissions: input.omissions.filter((o) => o.count > 0),
  };
}
