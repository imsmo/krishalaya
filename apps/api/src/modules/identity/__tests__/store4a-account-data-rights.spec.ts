// modules/identity/__tests__/store4a-account-data-rights.spec.ts · PC-56 STORE-4a — the unit half (no database; the live half is
// src/__tests__/store4a-account-addresses.integration.spec.ts):
//   • the deletion pre-check's rule (founder D1) and the service refusing with the figures, writing nothing;
//   • the export plane's PERSONAL rule (founder D2): requester-only (anybody else → 404), no tenant permission, no `tenant_exports`, from any
//     organisation; a tenant dataset unchanged (flag first, then permission); the generic enqueue refuses a personal dataset;
//   • the person-export producer's pure half (sections in order, the cap said, masked rows untouched, another id refused);
//   • the address label validated in the write's transaction (ADDRESS_LABEL_UNKNOWN), the note carried by copy-on-write, the country required;
//   • the tax invoice's buyer GSTIN read only from a VERIFIED profile (founder D5);
//   • the profile edit's audit values: field names, masked email, never a name.
import { z } from 'zod';
import { ExportPlaneService } from '../../../core/exports-plane/export-plane.service';
import { ExportJob } from '../../../core/exports-plane/domain/export-job.entity';
import { DatasetRegistry } from '../../../core/exports-plane/dataset.registry';
import { ExportJobNotFoundError, ExportPlaneDisabledError } from '../../../core/exports-plane/domain/export-plane.errors';
import { ForbiddenError } from '../../../shared/errors/app-error';
import { deletionBlocked, DsrBlockedError, PrivacyService } from '../services/privacy.service';
import { arrangeSections, personExportCsvRow, personExportNotes, DpdpPersonDataset, DPDP_SECTIONS, DPDP_PERSON_DATASET, DpdpPersonParamsSchema } from '../exports/dpdp-person.producer';
import { AddressService, AddressLabelUnknownError } from '../services/address.service';
import { Address } from '../domain/address.entity';
import { CreateAddressSchema, UpdateAddressSchema } from '../dto/create-address.dto';
import { profileAuditValues } from '../services/user.service';
import { TradeInvoiceRepository } from '../../payments/repositories/trade-invoice.repository';
import { ERASURE_COOLING_DAYS } from '../domain/data-subject-request.entity';

const SHA = 'a'.repeat(64);
const U1 = '0214a000-0000-7000-8000-000000000001';
const U2 = '0214a000-0000-7000-8000-000000000002';
const T1 = '0214b000-0000-7000-8000-000000000001';
const T2 = '0214b000-0000-7000-8000-000000000002';

/* ------------------------------------------------------------------------------------------------------------------------------- */
describe('STORE-4a · the deletion pre-check (founder D1)', () => {
  it('blocked while ANY order is open, ANY money is in escrow or ANY wallet balance is above zero; clean otherwise', () => {
    expect(deletionBlocked({ openOrders: 0, escrowMinor: '0', walletMinor: '0' })).toBe(false);
    expect(deletionBlocked({ openOrders: 1, escrowMinor: '0', walletMinor: '0' })).toBe(true);
    expect(deletionBlocked({ openOrders: 0, escrowMinor: '1', walletMinor: '0' })).toBe(true);
    expect(deletionBlocked({ openOrders: 0, escrowMinor: '0', walletMinor: '9007199254740993' })).toBe(true);   // bigint-safe
  });
  it('the service refuses with the figures (409 DSR_BLOCKED) and writes NOTHING — no request, no outbox, no audit', async () => {
    const writes: string[] = [];
    const tx = { query: async () => ({ rows: [], rowCount: 0 }) };
    const repo = {
      lockPerson: async () => undefined, findOpen: async () => null,
      commitments: async () => ({ openOrders: 2, escrowMinor: '125000', walletMinor: '0', currencyCode: 'INR', invoiceCount: 17, multiCurrency: false }),
      insert: async () => { writes.push('insert'); },
    };
    const svc = new PrivacyService(
      { run: (_t: string, fn: (tx: unknown) => unknown) => fn(tx) } as never, { write: async () => { writes.push('outbox'); } } as never,
      { remember: (_k: string, _u: string, _e: string, fn: () => unknown) => fn() } as never, { observe: () => undefined, inc: () => undefined } as never,
      repo as never, { write: async () => { writes.push('audit'); } } as never, {} as never);
    const e = await svc.requestDeletion(T1, U1, 'k').catch((x) => x);
    expect(e).toBeInstanceOf(DsrBlockedError);
    expect([e.code, e.httpStatus ?? e.status, e.details]).toEqual(['DSR_BLOCKED', 409, { openOrders: 2, escrowMinor: '125000', walletMinor: '0', currencyCode: 'INR', multiCurrency: false }]);
    expect(writes).toEqual([]);
  });
  it('the cooling is 90 days — one constant (founder D3)', () => { expect(ERASURE_COOLING_DAYS).toBe(90); });
});

/* ------------------------------------------------------------------------------------------------------------------------------- */
describe('STORE-4a · the export plane\'s PERSONAL rule (founder D2)', () => {
  const personal = { code: DPDP_PERSON_DATASET, permission: 'identity.dpdp_self', personal: true, params: DpdpPersonParamsSchema, datasetName: async () => ({ en: 'x' }), produce: async () => ({ kind: 'refused' as const, code: 'dataset_disabled' as const, detail: '' }) };
  const tenantDs = { code: 'dairy.insights', permission: 'dairy.manage', params: z.object({}).strict(), datasetName: async () => ({ en: 'y' }), produce: async () => ({ kind: 'refused' as const, code: 'dataset_disabled' as const, detail: '' }) };
  const job = (tenantId: string, datasetCode: string, requestedBy: string) => ExportJob.create({ id: 'j1', tenantId, datasetCode, params: { userId: requestedBy }, paramsSha256: SHA, requestedBy });
  function plane(rows: Record<string, ExportJob | undefined>, homes: Record<string, string> = {}, flagOn = false) {
    const reg = new DatasetRegistry(); reg.register(personal); reg.register(tenantDs);
    const svc = Object.create(ExportPlaneService.prototype) as ExportPlaneService;
    Object.assign(svc, {
      registry: reg,
      flags: { isEnabled: async () => flagOn },
      jobs: {
        getById: async (t: string) => rows[t] ?? null,
        personalJobTenant: async (_t: string, _id: string, user: string) => homes[user] ?? null,
        queueStanding: async () => ({ ahead: 0, sample: 0, medianRunMs: null }),
      },
      downloads: { countsFor: async () => null },
    });
    return svc;
  }
  it('the REQUESTER reads their personal job with NO permission and the plane flag OFF', async () => {
    const v = await plane({ [T1]: job(T1, DPDP_PERSON_DATASET, U1) }).view(T1, { userId: U1, permissions: new Set() }, 'j1');
    expect([v.status, v.datasetCode, v.requestedBy]).toEqual(['queued', DPDP_PERSON_DATASET, U1]);
  });
  it('ANYBODY ELSE → 404 — even a holder of every permission (`*`), and whatever the flag', async () => {
    for (const flag of [false, true]) {
      await expect(plane({ [T1]: job(T1, DPDP_PERSON_DATASET, U1) }, {}, flag).view(T1, { userId: U2, permissions: new Set(['*']) }, 'j1')).rejects.toBeInstanceOf(ExportJobNotFoundError);
      await expect(plane({ [T1]: job(T1, DPDP_PERSON_DATASET, U1) }, {}, flag).mintLink(T1, { userId: U2, permissions: new Set(['*']) }, 'j1', null)).rejects.toBeInstanceOf(ExportJobNotFoundError);
    }
  });
  it('a requester whose session is in ANOTHER organisation reaches their own job (0214 kv_personal_export_job_tenant); a stranger does not', async () => {
    const v = await plane({ [T1]: job(T1, DPDP_PERSON_DATASET, U1) }, { [U1]: T1 }).view(T2, { userId: U1, permissions: new Set() }, 'j1');
    expect(v.id).toBe('j1');
    await expect(plane({ [T1]: job(T1, DPDP_PERSON_DATASET, U1) }, {}, true).view(T2, { userId: U2, permissions: new Set(['*']) }, 'j1')).rejects.toBeInstanceOf(ExportJobNotFoundError);
    // with the plane flag OFF at that organisation, an id it cannot see answers as every unknown id does there (disabled) — never the job
    await expect(plane({ [T1]: job(T1, DPDP_PERSON_DATASET, U1) }, {}, false).view(T2, { userId: U2, permissions: new Set(['*']) }, 'j1')).rejects.toBeInstanceOf(ExportPlaneDisabledError);
  });
  it('a TENANT dataset is unchanged: the plane flag first (fail closed), then the dataset\'s permission', async () => {
    await expect(plane({ [T1]: job(T1, 'dairy.insights', U1) }, {}, false).view(T1, { userId: U1, permissions: new Set(['dairy.manage']) }, 'j1')).rejects.toBeInstanceOf(ExportPlaneDisabledError);
    await expect(plane({ [T1]: job(T1, 'dairy.insights', U1) }, {}, true).view(T1, { userId: U1, permissions: new Set() }, 'j1')).rejects.toBeInstanceOf(ForbiddenError);
    expect((await plane({ [T1]: job(T1, 'dairy.insights', U1) }, {}, true).view(T1, { userId: U2, permissions: new Set(['dairy.manage']) }, 'j1')).id).toBe('j1');
  });
  it('the generic enqueue refuses a personal dataset (it is born of its owner\'s own act only)', async () => {
    const svc = plane({}, {}, true);
    await expect(svc.enqueue(T1, { userId: U1, permissions: new Set(['*']) }, 'k', { datasetCode: DPDP_PERSON_DATASET, params: { userId: U1 } }, null)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('viewPersonal answers null — never a throw — for a job that is not the caller\'s', async () => {
    expect(await plane({ [T1]: job(T1, DPDP_PERSON_DATASET, U1) }).viewPersonal(T1, U2, 'j1')).toBeNull();
    expect(await plane({ [T1]: job(T1, 'dairy.insights', U1) }, {}, true).viewPersonal(T1, U1, 'j1')).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------- */
describe('STORE-4a · the person-export producer (pure half)', () => {
  const row = (section: string, n: number) => ({ section, organisation: section === 'order' ? 'Anand FPO' : null, record_id: `r${n}`, recorded_at: new Date(Date.UTC(2026, 9, 16, 5, 0, n)), details: { n } });
  it('sections in the file\'s order, each capped, the capped ones named, counts per section', () => {
    const rows = [row('notification', 1), row('order', 2), row('order', 3), row('order', 4), row('profile', 5), row('data_request', 6)];
    const a = arrangeSections(rows, 2);
    expect(a.rows.map((r) => r.section)).toEqual(['profile', 'order', 'order', 'notification', 'data_request']);
    expect(a.capped).toEqual(['order']);
    expect(a.counts).toEqual({ profile: 1, address: 0, order: 2, message: 0, consent: 0, notification: 1, data_request: 1 });
    expect(DPDP_SECTIONS).toEqual(['profile', 'address', 'order', 'message', 'consent', 'notification', 'data_request']);
  });
  it('one CSV row = section, organisation, id, ISO instant, the details as JSON; the notes say what the file admits', () => {
    expect(personExportCsvRow(row('order', 7))).toEqual(['order', 'Anand FPO', 'r7', '2026-10-16T05:00:07.000Z', '{"n":7}']);
    const notes = personExportNotes({ profile: 1, address: 2, order: 3, message: 0, consent: 1, notification: 4, data_request: 1 }, ['order'], 3);
    expect(notes.join(' | ')).toMatch(/masked/); expect(notes.join(' | ')).toMatch(/capped at the newest 3 rows: order/); expect(notes.join(' | ')).toMatch(/never a person/);
  });
  it('produce() refuses a file about anybody but its requester (the job then fails — never a file about somebody else)', async () => {
    const ds = new DpdpPersonDataset({ run: async () => { throw new Error('must not read'); } } as never, {} as never);
    await expect(ds.produce({ tenantId: T1, requestedBy: U1, today: '2026-10-16' }, { userId: U2 })).rejects.toThrow(/requester only/);
    expect(ds.personal).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------- */
describe('STORE-4a · addresses: the label, the note, the country (founder D4 · Rule Zero)', () => {
  const base = { line1: 'Plot 14, GIDC Vadal', pincode: '362001' };
  it('the schema: countryCode REQUIRED on create (upper-cased), optional on an edit; the note ≤ 280 ("" clears); the label nullable', () => {
    expect(CreateAddressSchema.safeParse(base).success).toBe(false);
    expect(CreateAddressSchema.parse({ ...base, countryCode: 'gb' }).countryCode).toBe('GB');
    expect(CreateAddressSchema.safeParse({ ...base, countryCode: 'GBR' }).success).toBe(false);
    expect(CreateAddressSchema.safeParse({ ...base, countryCode: 'IN', deliveryNote: 'x'.repeat(281) }).success).toBe(false);
    expect(CreateAddressSchema.parse({ ...base, countryCode: 'IN', deliveryNote: '  ' }).deliveryNote).toBeNull();
    expect(UpdateAddressSchema.parse({ deliveryNote: 'Gate 2' })).toEqual({ deliveryNote: 'Gate 2' });
    expect(UpdateAddressSchema.parse({ labelId: null })).toEqual({ labelId: null });
  });
  function service(opts: { label: string | null; inUse?: boolean; row?: Address }) {
    const inserted: Address[] = [];
    const repo = {
      labelCodeTx: async () => opts.label, unsetDefaults: async () => undefined, insert: async (_tx: unknown, a: Address) => { inserted.push(a); },
      getForUpdate: async () => opts.row ?? null, isInUse: async () => opts.inUse === true, retire: async () => undefined, update: async () => undefined,
    };
    const svc = new AddressService({ run: (_t: string, fn: (tx: unknown) => unknown) => fn({}) } as never, { remember: (_k: string, _u: string, _e: string, fn: () => unknown) => fn() } as never, repo as never);
    return { svc, inserted };
  }
  it('an unknown label → ADDRESS_LABEL_UNKNOWN (422) and nothing inserted; a known one stores the label and the note', async () => {
    const bad = service({ label: null });
    const e = await bad.svc.create(T1, U1, CreateAddressSchema.parse({ ...base, countryCode: 'IN', labelId: U2 })).catch((x) => x);
    expect(e).toBeInstanceOf(AddressLabelUnknownError); expect([e.code, e.httpStatus ?? e.status]).toEqual(['ADDRESS_LABEL_UNKNOWN', 422]);
    expect(bad.inserted).toHaveLength(0);
    const ok = service({ label: 'farm' });
    await ok.svc.create(T1, U1, CreateAddressSchema.parse({ ...base, countryCode: 'IN', labelId: U2, deliveryNote: 'Gate 2' }));
    expect([ok.inserted[0].toProps().labelId, ok.inserted[0].toProps().deliveryNote, ok.inserted[0].toProps().countryCode]).toEqual([U2, 'Gate 2', 'IN']);
  });
  it('copy-on-write CARRIES the note and the label to the copy of an address in use', async () => {
    const row = Address.create({ id: '0214c000-0000-7000-8000-000000000001', userId: U1, tenantId: null, labelId: null, line1: 'Plot 14', line2: null, village: null, regionId: null, pincode: '362001', countryCode: 'IN', lat: null, lng: null, contactName: null, contactPhone: null, deliveryNote: 'old note' });
    const s = service({ label: 'warehouse', inUse: true, row });
    const r = await s.svc.update(T1, U1, row.id, UpdateAddressSchema.parse({ deliveryNote: 'Gate 3', labelId: U2 }));
    expect(r.copied).toBe(true);
    expect([s.inserted[0].toProps().deliveryNote, s.inserted[0].toProps().labelId]).toEqual(['Gate 3', U2]);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------- */
describe('STORE-4a · the tax invoice takes ONLY a verified buyer GSTIN (founder D5)', () => {
  it('resolveParties filters business_kyc_profiles to status = verified', async () => {
    let sql = '';
    const repo = Object.create(TradeInvoiceRepository.prototype) as TradeInvoiceRepository;
    await repo.resolveParties({ query: async (q: string) => { sql = q; return { rows: [{}], rowCount: 1 }; } } as never, { tenantId: T1, buyerUserId: U1, deliveryAddressId: null });
    expect(sql.replace(/\s+/g, ' ')).toContain("b.deleted_at IS NULL AND b.status = 'verified'");
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------- */
describe('STORE-4a · the profile edit\'s audit values (B4)', () => {
  const view = (o: Partial<Record<string, unknown>>) => ({ fullName: 'Asha', gender: null, dob: null, languageCode: 'en', email: 'asha@x.in', emailMasked: 'a***@x.in', photoMediaId: null, ...o });
  it('field NAMES; the language as it is; the email MASKED; a name, gender, birth date or photo never valued', () => {
    const a = profileAuditValues(view({}), view({ fullName: 'Asha Patel', email: 'new@y.in', emailMasked: 'n***@y.in', languageCode: 'gu', dob: '1990-01-01' }));
    expect(a.fields).toEqual(['fullName', 'dob', 'languageCode', 'email']);
    expect(a.newValue).toEqual({ fields: a.fields, languageCode: 'gu', email: 'n***@y.in' });
    expect(a.oldValue).toEqual({ fields: a.fields, languageCode: 'en', email: 'a***@x.in' });
    expect(JSON.stringify(a)).not.toMatch(/Asha|1990|new@y|asha@x/);
  });
  it('nothing changed → no fields (no audit row is written)', () => { expect(profileAuditValues(view({}), view({})).fields).toEqual([]); });
});
