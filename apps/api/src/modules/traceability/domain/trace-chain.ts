// modules/traceability/domain/trace-chain.ts · PC-56 STORE-5b · B11 (founder D3, survey F-9) — THE CHAIN YOU CAN CHECK. PURE (node:crypto only).
//
// VERSION 1 (every event written before migration 0219): sha256(`${prev}|${lotId}|${code}|${JSON.stringify(meta)}`) over the meta as the API
// held it. The meta is stored as jsonb, which re-orders keys, and the event's time was not hashed — so v1 cannot be recomputed from the
// stored row for a multi-key meta, and the printed times were not tamper-evident. A v1 event is reported `unverifiable_v1` — never "mismatch":
// the record is not proven wrong, it is not provable.
//
// VERSION 2 (every event the API writes from 0219 on — `hash_version = 2`):
//     sha256(`${prev}|${lotId}|${code}|${canonicalJson(meta)}|${createdAt}`)
//   • `prev` — the previous event's hash (the FIRST event chains off the lot's id);
//   • `canonicalJson` — shared/hash/canonical-json.ts (sorted keys at every depth, no whitespace);
//   • `createdAt` — the event's instant as `YYYY-MM-DDTHH:MM:SS.ffffffZ` (UTC, six fractional digits — exactly the text `trace_scan_v3`
//     prints as `atUs`). The API INSERTS the event with that instant, so the hashed instant IS the stored instant (the 5a review precedent).
//
// VERIFYING (`verifyChain`) walks the events in order and RECOMPUTES forward: event n is recomputed from the RECOMPUTED hash of event n−1, so a
// change to one event breaks that event and EVERY hash after it ("change one gram in one record and every hash after it breaks" — canon W304,
// true now). A v1 event cannot be recomputed: the walk carries its STORED hash forward (the best the record allows) and says so. An event whose
// stored meta carries a key the public allow-list drops (`metaHidden` — impossible through the API's strict per-step door) cannot be recomputed
// from what is public: it is reported `mismatch` (the record is not what was written through the door).
//
// THE SEAL (`matchesHead`): the platform's daily seal stamps the lot's chain head (`blockchain_anchor`) — it matches when it equals the last
// event's STORED hash. A platform seal, never "a public ledger".
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../shared/hash/canonical-json';

export const HASH_V1 = 1 as const;
export const HASH_V2 = 2 as const;
export type Recompute = 'ok' | 'mismatch' | 'unverifiable_v1';

/** The v1 formula, unchanged (kept for the record and the v1 vectors). */
export function chainHashV1(prevHash: string, lotId: string, eventCode: string, meta: Record<string, unknown>): string {
  return createHash('sha256').update(`${prevHash}|${lotId}|${eventCode}|${JSON.stringify(meta ?? {})}`).digest('hex');
}

/** The instant as the v2 hash reads it: UTC, six fractional digits. A JS Date has milliseconds — the three further digits are zeros, exactly
 *  what PostgreSQL prints for the instant the API inserted. */
export function hashInstant(d: Date): string {
  const iso = d.toISOString();                       // YYYY-MM-DDTHH:MM:SS.mmmZ
  return `${iso.slice(0, 23)}000Z`;
}

/** The v2 formula. */
export function chainHashV2(prevHash: string, lotId: string, eventCode: string, meta: Record<string, unknown>, createdAtIso: string): string {
  return createHash('sha256').update(`${prevHash}|${lotId}|${eventCode}|${canonicalJson(meta ?? {})}|${createdAtIso}`).digest('hex');
}

/** One event as the v3 projection carries it (the verify read's input). */
export interface ChainEvent {
  no: number; eventCode: string; at: string; atUs: string; hashVersion: number; eventHash: string | null;
  meta: Record<string, unknown>; metaHidden?: boolean;
}
export interface AnchorFacts { value: string | null; anchoredAt: string | null; anchoredEventCount: number | null }

export interface VerifiedEvent {
  no: number; eventCode: string; at: string; hashVersion: number; eventHash: string | null;
  /** the previous event's stored hash; NULL for the first event (it chains off the lot's internal id, which no public answer carries) */
  prevHash: string | null;
  recomputed: Recompute;
}
export interface ChainVerdict {
  events: VerifiedEvent[];
  chain: 'ok' | 'broken_at';
  /** the number of the FIRST event that does not recompute — every event after it breaks too; null when the chain holds */
  brokenAt: number | null;
  anchor: AnchorFacts & { matchesHead: boolean };
  /** how many events could not be recomputed because they were written before version 2 */
  v1Count: number;
}

/** Does the seal stamp the chain head as it stands (the last event's STORED hash)? */
export function sealMatchesHead(anchorValue: string | null | undefined, events: readonly Pick<ChainEvent, 'eventHash'>[]): boolean {
  const head = events.length ? events[events.length - 1].eventHash : null;
  return Boolean(anchorValue) && Boolean(head) && anchorValue === head;
}

/** PURE: recompute the chain forward (see the header). `events` in chain order (no ascending). */
export function verifyChain(lotId: string, events: readonly ChainEvent[], anchor: AnchorFacts): ChainVerdict {
  let prevComputed = lotId;
  let prevStored: string | null = null;
  let brokenAt: number | null = null;
  let v1Count = 0;
  const out: VerifiedEvent[] = [];
  for (const e of events) {
    let recomputed: Recompute;
    if (e.hashVersion !== HASH_V2) {
      recomputed = 'unverifiable_v1';
      v1Count += 1;
      prevComputed = e.eventHash ?? prevComputed;       // carry the STORED hash forward — the best a v1 record allows
    } else {
      const computed = chainHashV2(prevComputed, lotId, e.eventCode, e.meta ?? {}, e.atUs);
      recomputed = !e.metaHidden && e.eventHash !== null && computed === e.eventHash ? 'ok' : 'mismatch';
      prevComputed = computed;                           // forward: a break here breaks every hash after it
    }
    if (recomputed === 'mismatch' && brokenAt === null) brokenAt = e.no;
    out.push({ no: e.no, eventCode: e.eventCode, at: e.at, hashVersion: e.hashVersion, eventHash: e.eventHash, prevHash: prevStored, recomputed });
    prevStored = e.eventHash;
  }
  return {
    events: out,
    chain: brokenAt === null ? 'ok' : 'broken_at',
    brokenAt,
    anchor: { value: anchor.value ?? null, anchoredAt: anchor.anchoredAt ?? null, anchoredEventCount: anchor.anchoredEventCount ?? null, matchesHead: sealMatchesHead(anchor.value, events) },
    v1Count,
  };
}
