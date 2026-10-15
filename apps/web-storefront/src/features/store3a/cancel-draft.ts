// apps/web-storefront/src/features/store3a/cancel-draft.ts · PC-56 STORE-3a · C3 (W3085 "values kept") — the buyer's cancel NOTE survives a refused
// submit in a short-lived httpOnly cookie, never in the URL (it is the buyer's own words). PURE codec (base64url JSON), every field re-validated
// on the way in; a draft for ANOTHER order is ignored.
export const CANCEL_DRAFT_COOKIE = 'kv_cancel_draft';
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function encodeCancelDraft(d: { orderId: string; note: string }): string {
  return Buffer.from(JSON.stringify({ o: d.orderId, n: d.note.slice(0, 280) }), 'utf8').toString('base64url');
}
export function decodeCancelDraft(raw: string | null | undefined, orderId: string): string | null {
  if (!raw || raw.length > 2000) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { o?: unknown; n?: unknown };
    if (typeof v.o !== 'string' || !UUID.test(v.o) || v.o !== orderId || typeof v.n !== 'string') return null;
    return v.n.slice(0, 280);
  } catch { return null; }
}
