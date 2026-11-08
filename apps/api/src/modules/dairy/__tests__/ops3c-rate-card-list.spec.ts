// modules/dairy/__tests__/ops3c-rate-card-list.spec.ts · PC-56 OPS-3c — the rate-card LIST rule (lead decision 2026-11-09, survey-ops3 F-1), unit:
//   • the query is a STRICT boolean: "false" means false (it was `z.coerce.boolean()`, where Boolean("false") is true), unknown spellings refused;
//   • THE CONSERVATIVE TRUST RULE: a caller without `dairy.manage` always gets approved-and-active cards only, whatever `activeOnly` says;
//     only a `dairy.manage` holder asking activeOnly=false widens the repository read to every card.
import { QueryRateCardsSchema } from '../dto/query-milk-rate-card.dto';
import { MilkRateCardService } from '../services/milk-rate-card.service';

function svcWith(calls: Array<{ animalType?: string; activeOnly: boolean }>) {
  const repo = { listFor: jest.fn(async (_t: string, q: { animalType?: string; activeOnly: boolean }) => { calls.push(q); return []; }) };
  return new MilkRateCardService({} as never, {} as never, {} as never, {} as never, repo as never, {} as never);
}

describe('PC-56 OPS-3c · QueryRateCardsSchema.activeOnly is a strict query boolean', () => {
  it('"false" / "0" → false; "true" / "1" → true; absent → true (the default); anything else refused', () => {
    expect(QueryRateCardsSchema.parse({ activeOnly: 'false' }).activeOnly).toBe(false);
    expect(QueryRateCardsSchema.parse({ activeOnly: '0' }).activeOnly).toBe(false);
    expect(QueryRateCardsSchema.parse({ activeOnly: 'true' }).activeOnly).toBe(true);
    expect(QueryRateCardsSchema.parse({ activeOnly: '1' }).activeOnly).toBe(true);
    expect(QueryRateCardsSchema.parse({}).activeOnly).toBe(true);
    expect(QueryRateCardsSchema.safeParse({ activeOnly: 'yes' }).success).toBe(false);
    expect(QueryRateCardsSchema.safeParse({ activeOnly: '' }).success).toBe(false);
  });
});

describe('PC-56 OPS-3c · MilkRateCardService.list — only a dairy.manage holder ever sees beyond the approved list', () => {
  it('a member WITHOUT dairy.manage asking activeOnly=false still gets the approved-and-active read', async () => {
    const calls: Array<{ animalType?: string; activeOnly: boolean }> = [];
    const s = svcWith(calls);
    await s.list('t1', { activeOnly: false }, 'member', false);
    await s.list('t1', { activeOnly: false, animalType: 'cow' }, 'member');            // canManage omitted → narrows
    await s.list('t1', { activeOnly: false }, 'member', 'yes' as never);               // anything but `true` → narrows
    expect(calls).toEqual([{ animalType: undefined, activeOnly: true }, { animalType: 'cow', activeOnly: true }, { animalType: undefined, activeOnly: true }]);
  });
  it('a dairy.manage holder asking activeOnly=false gets every card; activeOnly=true is unchanged for everyone', async () => {
    const calls: Array<{ animalType?: string; activeOnly: boolean }> = [];
    const s = svcWith(calls);
    await s.list('t1', { activeOnly: false }, 'desk', true);
    await s.list('t1', { activeOnly: true }, 'desk', true);
    await s.list('t1', { activeOnly: true }, 'member', false);
    expect(calls.map((c) => c.activeOnly)).toEqual([false, true, true]);
  });
});
