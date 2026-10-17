// modules/traceability/domain/trace-public.ts · PC-56 STORE-5b · B10 (founder D3 / D4 / D5) — THE PUBLIC LOT, AN ALLOW-LIST. PURE.
//
// `trace_scan_v3` (migration 0219) answers for a LIVE organisation's lot; this function is the ONLY door from that row to an anonymous caller:
// a key reaches the page only because it is written below.
//   • the ORGANISATION (display name + slug — the slug lets a store's chrome check the lot is its own), never a person: no farmer id, no name,
//     no bio, no avatar, no voice, no coordinate (founder D4 — "Grown by a verified member farmer of <organisation>, <village>" is the only
//     shape the page prints);
//   • the PRODUCT (the listing's title, the lot's quantity + unit) and the PLACE (village and district NAMES of the parcel's region);
//   • every event's number, code, instant, hash version and hash, and its meta RE-JUDGED by each key's value rule (trace-meta.ts `publicMeta`
//     — the SQL keeps allow-listed keys; a phone hidden in a "variety" is dropped here);
//   • the lot's certificates (id, type code, the EFFECTIVE status — a verified certificate past its validity reads `expired` before the clock
//     runs — and valid-until);
//   • the SEAL: the value, when, how many events, and whether it stamps the chain head as it stands (`matchesHead` — the page prints "sealed by
//     the platform at <time>" only then).
// STRIPPED: `tenantId` and `lotId` (consumed by the service — the per-organisation flag, the verify recompute), `metaHidden`, `atUs`.
// NO MONEY (founder D5): the row carries no figure, and nothing here could print one.
import { publicMeta } from './trace-meta';
import { sealMatchesHead } from './trace-chain';

export interface PublicLot {
  qrToken: string;
  organisation: { displayName: string; slug: string };
  product: { title: string; quantity: number | null; unit: string | null } | null;
  place: { village: string | null; district: string | null } | null;
  createdAt: string;
  events: Array<{ no: number; eventCode: string; at: string; meta: Record<string, string | number>; eventHash: string | null; hashVersion: number }>;
  certificates: Array<{ id: string; typeCode: string; status: 'pending' | 'verified' | 'rejected' | 'expired'; validUntil: string | null }>;
  anchor: { value: string | null; anchoredAt: string | null; anchoredEventCount: number | null; matchesHead: boolean };
  /** = anchor.matchesHead — "sealed by the platform at <time>" is printed only when true */
  sealed: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);
const day = (v: unknown): string | null => { const s = iso(v); return s ? s.slice(0, 10) : null; };
const CERT_STATUSES = ['pending', 'verified', 'rejected', 'expired'] as const;

/** The effective certificate status: the row's, except a VERIFIED certificate whose validity has passed (the SQL's `expired` — the
 *  database's own calendar day) reads `expired` even before the expiry clock has flipped it. */
export function effectiveCertStatus(status: unknown, expired: unknown): PublicLot['certificates'][number]['status'] {
  const s = (CERT_STATUSES as readonly string[]).includes(String(status)) ? (String(status) as PublicLot['certificates'][number]['status']) : 'pending';
  return s === 'verified' && expired === true ? 'expired' : s;
}

/** PURE: the v3 row (a LIVE lot) → the public answer. */
export function publicLot(row: Record<string, unknown>): PublicLot {
  const org = (row.organisation ?? {}) as Record<string, unknown>;
  const prod = row.product && typeof row.product === 'object' ? (row.product as Record<string, unknown>) : null;
  const place = row.place && typeof row.place === 'object' ? (row.place as Record<string, unknown>) : null;
  const events = Array.isArray(row.events) ? (row.events as Array<Record<string, unknown>>) : [];
  const certs = Array.isArray(row.certificates) ? (row.certificates as Array<Record<string, unknown>>) : [];
  const anchor = (row.anchor ?? {}) as Record<string, unknown>;
  const anchorValue = strOrNull(anchor.value);
  const matchesHead = sealMatchesHead(anchorValue, events.map((e) => ({ eventHash: strOrNull(e.eventHash) })));
  return {
    qrToken: str(row.qrToken),
    organisation: { displayName: str(org.displayName), slug: str(org.slug) },
    product: prod && str(prod.title) ? { title: str(prod.title), quantity: numOrNull(prod.quantity), unit: strOrNull(prod.unit) } : null,
    place: place && (strOrNull(place.village) || strOrNull(place.district)) ? { village: strOrNull(place.village), district: strOrNull(place.district) } : null,
    createdAt: iso(row.createdAt) ?? '',
    events: events.map((e, i) => ({
      no: numOrNull(e.no) ?? i + 1,
      eventCode: str(e.eventCode),
      at: iso(e.at) ?? '',
      meta: publicMeta(str(e.eventCode), e.meta),
      eventHash: strOrNull(e.eventHash),
      hashVersion: numOrNull(e.hashVersion) ?? 1,
    })),
    certificates: certs.map((c) => ({ id: str(c.id), typeCode: str(c.typeCode), status: effectiveCertStatus(c.status, c.expired), validUntil: day(c.validUntil) })),
    anchor: { value: anchorValue, anchoredAt: iso(anchor.anchoredAt), anchoredEventCount: numOrNull(anchor.anchoredEventCount), matchesHead },
    sealed: matchesHead,
  };
}
