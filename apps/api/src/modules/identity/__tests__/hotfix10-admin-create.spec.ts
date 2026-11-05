// modules/identity/__tests__/hotfix10-admin-create.spec.ts · PC-56 HOTFIX-10 · H10-1 (survey OPS-1 F-1, founder Q9-A).
// `POST /v1/users` → `UserService.adminCreate` on a phone that already has an account is REFUSED (409 USER_PHONE_ALREADY_REGISTERED,
// no field about the person) before anything is written — it used to return that person's profile. The race (a self-signup landing
// between the check and the insert → `users.phone` UNIQUE, 23505) is the same refusal. A new phone is created and audited once, as before.
import { UserService, isPhoneUniqueViolation } from '../services/user.service';
import { UserPhoneAlreadyRegisteredError } from '../domain/identity.errors';
import { User } from '../domain/user.entity';

const PERSON_NAME = 'Zarinabanu Odhavji Kanjariya';

function build(opts: { existing?: boolean; raceOnInsert?: boolean } = {}) {
  const tx = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) };
  const uow = { run: jest.fn(async (_t: string, fn: (x: unknown) => unknown) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const audit = { write: jest.fn(), log: jest.fn() };
  const someone = User.register({ id: 'u-existing', phone: '+919876543210', fullName: PERSON_NAME, languageCode: 'gu', countryCode: 'IN' });
  const users = {
    getByPhoneForUpdate: jest.fn(async () => (opts.existing ? someone : null)),
    insert: jest.fn(async () => { if (opts.raceOnInsert) throw Object.assign(new Error('duplicate key value violates unique constraint "users_phone_key"'), { code: '23505', constraint: 'users_phone_key' }); }),
    findById: jest.fn(async (_t: string, id: string) => User.register({ id, phone: '+919000000001', fullName: null, languageCode: 'hi', countryCode: 'IN' })),
  };
  const svc = new UserService(uow as never, outbox as never, audit as never, users as never, {} as never);
  return { svc, users, outbox, audit };
}

describe('HOTFIX-10 · H10-1 · adminCreate refuses an existing phone', () => {
  const dto = { phone: '9876543210', languageCode: 'gu', countryCode: 'IN' } as never;

  it('an existing phone → 409 USER_PHONE_ALREADY_REGISTERED, nothing about the person, nothing written', async () => {
    const h = build({ existing: true });
    const err = await h.svc.adminCreate('tA', 'admin', dto, null).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(UserPhoneAlreadyRegisteredError);
    expect(err).toMatchObject({ code: 'USER_PHONE_ALREADY_REGISTERED', httpStatus: 409, details: {} });
    expect((err as Error).message).toBe('This number already has an account. She signs in herself, on her own phone.');
    const said = JSON.stringify({ m: (err as Error).message, d: (err as { details?: unknown }).details });
    for (const leak of [PERSON_NAME, 'u-existing', '9876543210', 'gu']) expect(said).not.toContain(leak);
    expect(h.users.insert).not.toHaveBeenCalled(); expect(h.audit.write).not.toHaveBeenCalled(); expect(h.outbox.write).not.toHaveBeenCalled();
    expect(h.users.findById).not.toHaveBeenCalled();   // the person is never read for the answer
  });

  it('the race: the insert loses to a self-signup on users.phone UNIQUE → the same 409, no audit, no outbox', async () => {
    const h = build({ raceOnInsert: true });
    await expect(h.svc.adminCreate('tA', 'admin', dto, null)).rejects.toMatchObject({ code: 'USER_PHONE_ALREADY_REGISTERED', httpStatus: 409 });
    expect(h.users.insert).toHaveBeenCalledTimes(1);
    expect(h.audit.write).not.toHaveBeenCalled(); expect(h.outbox.write).not.toHaveBeenCalled();
  });

  it('a new phone → created, ONE user.created_assisted audit row (unchanged)', async () => {
    const h = build();
    const out = await h.svc.adminCreate('tA', 'admin', dto, '10.0.0.1');
    expect(out.id).toBeDefined();
    expect(h.users.insert).toHaveBeenCalledTimes(1);
    expect(h.audit.write).toHaveBeenCalledTimes(1);
    expect(h.audit.write.mock.calls[0][1]).toMatchObject({ action: 'user.created_assisted', actorUserId: 'admin', entityType: 'user', ip: '10.0.0.1' });
  });

  it('isPhoneUniqueViolation: only a 23505 on the phone index (any other error is rethrown as itself)', () => {
    expect(isPhoneUniqueViolation({ code: '23505', constraint: 'users_phone_key' })).toBe(true);
    expect(isPhoneUniqueViolation({ code: '23505', constraint: 'users_pkey' })).toBe(false);
    expect(isPhoneUniqueViolation({ code: '23503', constraint: 'users_phone_key' })).toBe(false);
    expect(isPhoneUniqueViolation(null)).toBe(false);
  });

  it('an unrelated insert failure is NOT dressed up as "already has an account"', async () => {
    const h = build();
    h.users.insert.mockImplementationOnce(async () => { throw Object.assign(new Error('fk'), { code: '23503', constraint: 'users_language_code_fkey' }); });
    await expect(h.svc.adminCreate('tA', 'admin', dto, null)).rejects.toMatchObject({ code: '23503' });
  });
});
