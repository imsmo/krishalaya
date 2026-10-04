// apps/web-tenant/src/features/swe/drop-point.ts · PC-56 TENANT-SW-e — the "Add drop point" draft (W232). The keeper's role and the
// village-on-route rule are the database's; this only names the obvious mistakes before the API is asked.
import { isHhmm, isUuid } from './console';

export interface DropPointDraft { sequence: string; regionId: string; name: string; ambassadorUserId: string; windowStart: string; windowEnd: string }
export function readDropPointDraft(q: Record<string, string | undefined>): DropPointDraft {
  const g = (k: string, max: number) => (q[k] ?? '').trim().slice(0, max);
  return { sequence: g('sequence', 3), regionId: g('regionId', 36), name: g('name', 120), ambassadorUserId: g('ambassadorUserId', 36), windowStart: g('windowStart', 5), windowEnd: g('windowEnd', 5) };
}
/** `villageIds` empty = do not judge the village (the action re-reads nothing; the database judges). */
export function dropPointRefusals(d: DropPointDraft, villageIds: string[]): Array<{ field: keyof DropPointDraft; code: string }> {
  const out: Array<{ field: keyof DropPointDraft; code: string }> = [];
  if (!/^\d{1,3}$/.test(d.sequence) || Number(d.sequence) < 1) out.push({ field: 'sequence', code: 'sequence' });
  if (!isUuid(d.regionId) || (villageIds.length > 0 && !villageIds.includes(d.regionId))) out.push({ field: 'regionId', code: 'village' });
  if (d.name.length < 2) out.push({ field: 'name', code: 'name' });
  if (!isUuid(d.ambassadorUserId)) out.push({ field: 'ambassadorUserId', code: 'keeper' });
  if (d.windowStart && !isHhmm(d.windowStart)) out.push({ field: 'windowStart', code: 'time' });
  if (d.windowEnd && (!isHhmm(d.windowEnd) || !d.windowStart || d.windowEnd <= d.windowStart)) out.push({ field: 'windowEnd', code: 'window' });
  return out;
}
