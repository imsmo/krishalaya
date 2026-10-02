// apps/web-tenant/src/app/people/ambassadors/formOptions.ts · what the recruit / edit forms offer, from the API's own reads
// (PC-56 TENANT-10a): the `ambassador_tier` lookup (seed 0005), the admin regions under the chosen parent (top level =
// states), and the active ambassadors a mentor can be chosen from. Each read degrades on its own (an empty list), and the
// review step — not this list — is what decides whether a value can be written.
import type { AmbassadorRosterRow, LookupValue, RegionNode } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { isUuid } from '../../../features/ambassadors/console';

export interface FormOptions { tiers: LookupValue[]; regions: RegionNode[]; parents: RegionNode[]; mentors: AmbassadorRosterRow[]; under: string | null; names: Record<string, string> }

export async function loadFormOptions(underRaw: string | undefined, chosenRegionIds: string[]): Promise<FormOptions> {
  const c = tenantClient();
  const under = isUuid(underRaw) ? underRaw : null;
  const [tiers, top, children, mentors] = await Promise.allSettled([
    c.lookups.values('ambassador_tier'),
    c.lookups.regions({}),
    under ? c.lookups.regions({ parentId: under }) : Promise.resolve([] as RegionNode[]),
    c.ambassadors.list({ activeOnly: true, limit: 100 }),
  ]);
  const tierList = tiers.status === 'fulfilled' ? tiers.value : [];
  const parents = top.status === 'fulfilled' ? top.value : [];
  const regions = under ? (children.status === 'fulfilled' ? children.value : []) : parents;
  const mentorList = mentors.status === 'fulfilled' ? mentors.value.items : [];
  const names: Record<string, string> = {};
  for (const x of tierList) names[x.id] = x.name;
  for (const r of [...parents, ...regions]) names[r.id] = r.name;
  for (const m of mentorList) names[m.id] = `${m.displayName ?? m.phoneMasked} · ${m.phoneMasked}`;
  // a region chosen under a different parent than the one now listed must stay selectable (its name, not its id)
  const missing = chosenRegionIds.filter((id) => !regions.some((r) => r.id === id));
  const extra: RegionNode[] = missing.map((id) => ({ id, code: null, level: 0, parentId: null, name: names[id] ?? id, lat: null, lng: null }));
  return { tiers: tierList, regions: [...regions, ...extra], parents, mentors: mentorList, under, names };
}
