// modules/ambassadors/__tests__/ops1b-aeps-q7a.spec.ts · PC-56 OPS-1b · Q7-A (founder 2026-11-05 — "the AePS record keeps the least").
//   • the record route's body pipe refuses `aadhaarLast4` / `customerUserId` BY NAME (400, stable codes, the English sentence), on PRESENCE,
//     BEFORE the schema — never strips them silently; a clean body passes the schema exactly as before; an invalid clean body is still 422;
//   • the record route is wired to that pipe (route-argument metadata);
//   • the repository writes NULL into `customer_user_id` ($3) and `aadhaar_last4` ($7) whatever the caller's object carries;
//   • both reads (`/events/mine`, `/events`) return neither key, for rows whose columns are set (legacy rows) as well.
import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { AepsController, AepsRecordBodyPipe } from '../controllers/v1/aeps.controller';
import { AepsEventRepository } from '../repositories/aeps-event.repository';
import {
  AEPS_AADHAAR_NOT_RECORDED_SENTENCE, AEPS_CUSTOMER_LINK_NOT_RECORDED_SENTENCE, AepsAadhaarNotRecordedError, AepsCustomerLinkNotRecordedError, refuseAepsQ7aFields,
} from '../domain/ambassadors.errors';

const clean = { serviceKind: 'cash_withdrawal', amountMinor: '250000', bankName: 'Test Bank', accountLast4: '4321', status: 'success', attemptNo: 1, deviceCertified: true, npciRrn: 'RRN1' };
const pipe = new AepsRecordBodyPipe();
const caught = (fn: () => unknown): Record<string, unknown> => { try { fn(); } catch (e) { return e as Record<string, unknown>; } return {}; };

describe('OPS-1b · Q7-A · the record body is refused BY NAME before anything else', () => {
  it.each([['9876'], [null], [''], ['123456789012'], [{ nested: true }]])('aadhaarLast4 = %p → 400 AEPS_AADHAAR_NOT_RECORDED', (v) => {
    const e = caught(() => pipe.transform({ ...clean, aadhaarLast4: v }));
    expect(e).toBeInstanceOf(AepsAadhaarNotRecordedError);
    expect([e.code, e.httpStatus, e.message]).toEqual(['AEPS_AADHAAR_NOT_RECORDED', 400, AEPS_AADHAAR_NOT_RECORDED_SENTENCE]);
    expect(String(e.message)).not.toContain('9876');
  });
  it.each([['0190a000-0000-7000-8000-00000000c0de'], [null], ['not-a-uuid']])('customerUserId = %p → 400 AEPS_CUSTOMER_LINK_NOT_RECORDED', (v) => {
    const e = caught(() => pipe.transform({ ...clean, customerUserId: v }));
    expect(e).toBeInstanceOf(AepsCustomerLinkNotRecordedError);
    expect([e.code, e.httpStatus, e.message]).toEqual(['AEPS_CUSTOMER_LINK_NOT_RECORDED', 400, AEPS_CUSTOMER_LINK_NOT_RECORDED_SENTENCE]);
  });
  it('the named refusal comes BEFORE the schema: an otherwise-invalid body still gets it (never a generic 422)', () => {
    expect(caught(() => pipe.transform({ aadhaarLast4: '1', attemptNo: 99 })).code).toBe('AEPS_AADHAAR_NOT_RECORDED');
    expect(caught(() => pipe.transform({ customerUserId: 'x' })).code).toBe('AEPS_CUSTOMER_LINK_NOT_RECORDED');
    expect(caught(() => pipe.transform({ ...clean, aadhaarLast4: '1', customerUserId: 'x' })).code).toBe('AEPS_AADHAAR_NOT_RECORDED');   // Aadhaar named first
  });
  it('a clean body passes unchanged; an invalid clean body is the schema\'s 422; the sentences say nothing was recorded', () => {
    expect(pipe.transform(clean)).toEqual(clean);
    expect([caught(() => pipe.transform({ ...clean, attemptNo: 4 })).httpStatus, caught(() => pipe.transform({ ...clean, attemptNo: 4 })).code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(caught(() => pipe.transform({ ...clean, otherField: 1 })).code).toBe('VALIDATION_FAILED');   // still .strict()
    for (const s of [AEPS_AADHAAR_NOT_RECORDED_SENTENCE, AEPS_CUSTOMER_LINK_NOT_RECORDED_SENTENCE]) expect(s).toMatch(/Nothing was recorded\.$/);
  });
  it('refuseAepsQ7aFields ignores what is not an object (the schema answers those)', () => {
    for (const v of [undefined, null, 'x', 3, ['aadhaarLast4']]) expect(() => refuseAepsQ7aFields(v)).not.toThrow();
  });
  it('the record route\'s body runs through AepsRecordBodyPipe', () => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, AepsController, 'record') as Record<string, { pipes: unknown[] }>;
    const pipes = Object.values(args).flatMap((a) => a.pipes ?? []);
    expect(pipes.some((p) => p instanceof AepsRecordBodyPipe)).toBe(true);
  });
});

describe('OPS-1b · Q7-A · the repository writes NULL and the reads return neither field', () => {
  const legacy = { id: '7', ambassador_id: 'amb1', customer_user_id: '0190a000-0000-7000-8000-00000000c0de', service_kind: 'cash_withdrawal', bank_name: 'Test Bank',
    account_last4: '4321', aadhaar_last4: '5150', amount_minor: '100000', balance_after_minor: null, status: 'success', exception_code: null, attempt_no: 1,
    device_certified: true, npci_rrn: 'RRN7', escalation_note: null, occurred_at: '2026-11-06T05:00:00.000Z', synced_at: '2026-11-06T05:00:00.000Z' };
  const replica = { forTenant: jest.fn(() => ({ query: jest.fn(async () => ({ rows: [legacy] })) })) };
  const repo = new AepsEventRepository(replica as never);

  it('insert: $3 (customer_user_id) and $7 (aadhaar_last4) are NULL even when the object carries both', async () => {
    const tx = { query: jest.fn(async () => ({ rows: [{ id: '11' }] })) };
    const id = await repo.insert(tx as never, { tenantId: 't', ambassadorId: 'amb1', ...clean, aadhaarLast4: '9876', customerUserId: 'c0de' } as never);
    expect(id).toBe('11');
    const [sql, params] = tx.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/customer_user_id,\s*service_kind,\s*bank_name,\s*account_last4,\s*aadhaar_last4/);
    expect([params[2], params[6], params[5]]).toEqual([null, null, '4321']);
    expect(JSON.stringify(params)).not.toMatch(/9876|c0de/);
  });
  it.each([['listForAmbassador'], ['list']])('%s: a legacy row with both columns set comes back with NEITHER key', async (m) => {
    const rows = m === 'list' ? await repo.list('t', { limit: 10 }) : await repo.listForAmbassador('t', 'amb1', 10);
    expect(rows).toHaveLength(1);
    for (const k of ['aadhaarLast4', 'customerUserId', 'aadhaar_last4', 'customer_user_id']) expect([k, k in rows[0]]).toEqual([k, false]);
    expect(JSON.stringify(rows)).not.toMatch(/5150|c0de/);
    expect(rows[0]).toMatchObject({ id: '7', accountLast4: '4321', amountMinor: '100000', npciRrn: 'RRN7' });
  });
});
