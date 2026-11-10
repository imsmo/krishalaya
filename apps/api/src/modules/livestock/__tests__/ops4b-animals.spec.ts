// modules/livestock/__tests__/ops4b-animals.spec.ts · PC-56 OPS-4b · THE RECORDS: ANIMALS — the first commit, unit:
//   "her animal, her word" (lead-applied, the HOTFIX-13 class) · editing and retiring an animal are its OWNER's acts: `assertOwner` has no
//     administrator escape — an administrator (`booking.manage`) editing or retiring another person's animal → LIVESTOCK_FORBIDDEN (403), before
//     any write; the owner → allowed. The admin READ is unchanged (recorded, OPS-4b §2).
//   Q4-A / OPS4-B14 (no-migration half) · `PASHU_AADHAAR_EXISTS` keeps its 409 and its code, and no longer says an animal exists.
// Live twin: src/__tests__/ops4b-records.integration.spec.ts.
import { AnimalService } from '../services/animal.service';
import { Animal } from '../domain/animal.entity';
import { PashuAadhaarExistsError } from '../domain/livestock.errors';

const T = 't1';
const herAnimal = () => Animal.rehydrate({ id: 'an1', tenantId: T, ownerUserId: 'farmerA', speciesId: 'sp1', breedId: null, pashuAadhaar: '123456789012', name: null,
  sex: null, dobEstimated: null, parity: null, lactationStage: null, currentYieldLpd: null, pregnancyStatus: null, bodyConditionScore: null, status: 'active', acquiredVia: null } as never);

function harness() {
  const log: string[] = [];
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => { log.push('uow'); return fn({ query: jest.fn() }); }) };
  const outbox = { write: jest.fn(async () => { log.push('outbox'); }) };
  const repo = { getForUpdate: jest.fn(async () => { log.push('lock'); return herAnimal(); }), update: jest.fn(async () => { log.push('update'); }) };
  const svc = new AnimalService(uow as never, outbox as never, {} as never, {} as never, {} as never, repo as never, {} as never, { belongsToSpecies: jest.fn(async () => true) } as never);
  return { svc, log, repo };
}
const owner = { userId: 'farmerA', canManage: true, isAdmin: false };
const admin = { userId: 'adminX', canManage: true, isAdmin: true };

describe('PC-56 OPS-4b · her animal, her word — no administrator escape on edit or retire', () => {
  it('an administrator editing another person\'s animal → LIVESTOCK_FORBIDDEN (403); nothing updated, no event', async () => {
    const h = harness();
    await expect(h.svc.update(T, admin, 'an1', { name: 'x' } as never)).rejects.toMatchObject({ code: 'LIVESTOCK_FORBIDDEN', httpStatus: 403 });
    expect(h.log).toEqual(['uow', 'lock']); expect(h.repo.update).not.toHaveBeenCalled();
  });
  it('an administrator retiring another person\'s animal → LIVESTOCK_FORBIDDEN (403); nothing updated', async () => {
    const h = harness();
    await expect(h.svc.retire(T, admin, 'an1', 'sold')).rejects.toMatchObject({ code: 'LIVESTOCK_FORBIDDEN', httpStatus: 403 });
    expect(h.log).toEqual(['uow', 'lock']);
  });
  it('the owner edits and retires her own animal', async () => {
    const h = harness();
    await h.svc.update(T, owner, 'an1', { name: 'Gauri' } as never);
    await h.svc.retire(T, owner, 'an1', 'sold');
    expect(h.repo.update).toHaveBeenCalledTimes(2);
  });
});

describe('PC-56 OPS-4b · Q4-A · a refused tag says nothing about an animal', () => {
  it('the same 409 and code; the words name no animal, organisation or owner, and never "exists"', () => {
    const e = new PashuAadhaarExistsError() as unknown as { code: string; httpStatus: number; message: string; details?: unknown };
    expect([e.code, e.httpStatus, e.message]).toEqual(['PASHU_AADHAAR_EXISTS', 409, 'This tag number cannot be registered.']);
    expect(/exist|already|animal|organi[sz]ation|tenant|owner/i.test(e.message)).toBe(false);
    expect(e.details ?? null).toBeNull();
  });
});
