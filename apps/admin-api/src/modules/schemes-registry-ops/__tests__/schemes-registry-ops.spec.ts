// apps/admin-api/src/modules/schemes-registry-ops/__tests__/schemes-registry-ops.spec.ts · UNIT suite (pure /
// mocked). Proves the scheme-master invariants: code/name/level/json/uuid/window/fee validation + plain-text
// (no-HTML) + safe-URL guards, entity mutation split (meta NO version bump / rules BUMPS version / window NO
// bump) + no-op guards, owner-RBAC least-privilege (no escalation, no '*'), zod .strict DTOs, and the services'
// audit-in-tx + duplicate-code / bad-category / 404 / fail-closed behaviour (pool/repo/audit mocked).
import {
  assertCode, assertSchemeName, assertLevel, assertJsonObject, assertUuidArray, assertWindow, assertFeeMinor,
  assertSourceUrl, assertPlainText,
} from '../domain/scheme-rules';
import { SchemeAuthority } from '../domain/scheme-authority.entity';
import { Scheme } from '../domain/scheme.entity';
import {
  InvalidSchemeInputError, SchemeAlreadyInStateError, DuplicateSchemeCodeError, SchemeCategoryInvalidError,
  AuthorityNotFoundError, SchemeNotFoundError,
} from '../domain/schemes-registry.errors';
import { resolveOwnerPermissions, hasOwnerPermission, OwnerPermissions } from '../../../core/rbac/owner-roles';
import { CreateSchemeSchema, CreateAuthoritySchema, UpdateSchemeRulesSchema, SetWindowSchema, UpdateSchemeMetaSchema } from '../dto/schemes-registry.dto';
import { SchemeCrudService } from '../services/scheme-crud.service';
import { EligibilityRulesEditorService } from '../services/eligibility-rules-editor.service';
import { WindowCalendarService } from '../services/window-calendar.service';

const schemeProps = (over: Partial<any> = {}) => ({
  id: 's1', code: 'pm_kisan', defaultName: 'PM-KISAN', authorityId: 'a1', categoryId: 'cat1',
  benefitSummary: { type: 'dbt_annual', amount_minor: 600000 }, eligibilityRules: { landholding_max_acres: 2 },
  requiredDocTypeIds: [], applicationWindow: null, applicableRegionIds: [], processingFeeMinor: 0n, sourceUrl: null,
  version: 1, isActive: false, ...over,
});

describe('scheme-rules — validation guards', () => {
  it('code must be a lowercase identifier', () => {
    expect(assertCode('pm_kisan')).toBe('pm_kisan');
    expect(() => assertCode('PM-KISAN')).toThrow(InvalidSchemeInputError);
    expect(() => assertCode('1bad')).toThrow();
  });
  it('names are plain-text + bounded (no HTML / control chars)', () => {
    expect(assertSchemeName('  PM-KISAN  ')).toBe('PM-KISAN');
    expect(() => assertSchemeName('<script>x</script>')).toThrow(InvalidSchemeInputError);
    expect(() => assertPlainText('ab', 'n', 50)).toThrow();
  });
  it('level enum', () => { expect(assertLevel('central')).toBe('central'); expect(() => assertLevel('galactic')).toThrow(); });
  it('json object must be non-empty + bounded', () => {
    expect(assertJsonObject({ a: 1 }, 'benefit_summary')).toBeTruthy();
    expect(() => assertJsonObject({}, 'benefit_summary')).toThrow(InvalidSchemeInputError);
    expect(() => assertJsonObject([1, 2] as any, 'benefit_summary')).toThrow();
    expect(() => assertJsonObject({ big: 'x'.repeat(9000) }, 'benefit_summary')).toThrow();
  });
  it('uuid arrays validated + capped', () => {
    expect(assertUuidArray(['11111111-1111-1111-1111-111111111111'], 'doc', 100)).toHaveLength(1);
    expect(() => assertUuidArray(['nope'], 'doc', 100)).toThrow();
    expect(() => assertUuidArray(new Array(101).fill('11111111-1111-1111-1111-111111111111'), 'doc', 100)).toThrow();
  });
  it('window is MM-DD (+optional season), year-wrap allowed', () => {
    expect(assertWindow({ opens: '06-01', closes: '07-31', season: 'kharif' })).toEqual({ opens: '06-01', closes: '07-31', season: 'kharif' });
    expect(assertWindow(null)).toBeNull();
    expect(() => assertWindow({ opens: '13-01', closes: '07-31' })).toThrow();
    expect(() => assertWindow({ opens: '06-01' })).toThrow();
  });
  it('fee is a non-negative bigint minor-unit string (never float)', () => {
    expect(assertFeeMinor('0')).toBe(0n);
    expect(assertFeeMinor('600000')).toBe(600000n);
    expect(() => assertFeeMinor('10.5')).toThrow();
    expect(() => assertFeeMinor('-1')).toThrow();
  });
  it('source url must be http(s) (no javascript: / data:)', () => {
    expect(assertSourceUrl('https://india.gov.in/pm-kisan')).toContain('https://');
    expect(assertSourceUrl(null)).toBeNull();
    expect(() => assertSourceUrl('javascript:alert(1)')).toThrow(InvalidSchemeInputError);
  });
});

describe('entities — mutation split + no-op guards', () => {
  it('Scheme.updateMeta does NOT bump version', () => {
    const s = Scheme.rehydrate(schemeProps());
    s.updateMeta({ defaultName: 'PM-KISAN (rev)' });
    expect(s.version).toBe(1);
    expect(() => s.updateMeta({ defaultName: 'PM-KISAN (rev)' })).toThrow(SchemeAlreadyInStateError);   // no-op
  });
  it('Scheme.updateRules BUMPS version + classifies fee as string', () => {
    const s = Scheme.rehydrate(schemeProps());
    const ch = s.updateRules({ eligibilityRules: { landholding_max_acres: 5 }, processingFeeMinor: '600000' });
    expect(s.version).toBe(2);
    expect(ch.version).toBe(2);
    expect((ch.new as any).processingFeeMinor).toBe('600000');   // string, not float
    expect(() => s.updateRules({ eligibilityRules: { landholding_max_acres: 5 }, processingFeeMinor: '600000' })).toThrow(SchemeAlreadyInStateError);  // identical ⇒ no-op
  });
  it('Scheme.setWindow does NOT bump version; no-op throws', () => {
    const s = Scheme.rehydrate(schemeProps());
    s.setWindow({ opens: '06-01', closes: '07-31' });
    expect(s.version).toBe(1);
    expect(() => s.setWindow({ opens: '06-01', closes: '07-31' })).toThrow(SchemeAlreadyInStateError);
  });
  it('Scheme.setActive toggles; no-op throws; toJSON emits fee as string', () => {
    const s = Scheme.rehydrate(schemeProps({ processingFeeMinor: 600000n }));
    expect(s.setActive(true).action).toBe('activated');
    expect(() => s.setActive(true)).toThrow(SchemeAlreadyInStateError);
    expect((s.toJSON() as any).processingFeeMinor).toBe('600000');
    expect(typeof (s.toJSON() as any).processingFeeMinor).toBe('string');
  });
  it('SchemeAuthority.update diffs + no-op throws', () => {
    const a = SchemeAuthority.rehydrate({ id: 'a1', defaultName: 'NABARD', level: 'body', regionId: null });
    expect(a.update({ level: 'central' }).new.level).toBe('central');
    expect(() => a.update({ level: 'central' })).toThrow(SchemeAlreadyInStateError);
  });
});

describe('owner RBAC — least privilege (Law 11, no escalation)', () => {
  it('schemes roles grant exactly schemes-registry perms, never *', () => {
    const ops = resolveOwnerPermissions(['platform_schemes_ops']);
    expect(ops.has(OwnerPermissions.SchemesRegistryManage)).toBe(true);
    expect(ops.has(OwnerPermissions.SchemesRegistryRead)).toBe(true);
    expect(ops.has('*')).toBe(false);
    const viewer = resolveOwnerPermissions(['platform_schemes_viewer']);
    expect(viewer.has(OwnerPermissions.SchemesRegistryRead)).toBe(true);
    expect(viewer.has(OwnerPermissions.SchemesRegistryManage)).toBe(false);
  });
  it('unknown / tenant roles grant nothing here', () => { expect(resolveOwnerPermissions(['tenant_admin', 'farmer']).size).toBe(0); });
  it('hasOwnerPermission honours super_admin *; plain perms scoped', () => {
    expect(hasOwnerPermission(resolveOwnerPermissions(['super_admin']), OwnerPermissions.SchemesRegistryManage)).toBe(true);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_schemes_viewer']), OwnerPermissions.SchemesRegistryManage)).toBe(false);
  });
});

describe('DTO — zod .strict() validation', () => {
  it('rejects unknown keys (mass-assignment)', () => {
    expect(CreateAuthoritySchema.safeParse({ defaultName: 'NABARD', level: 'body', reason: 'init', evil: 1 }).success).toBe(false);
  });
  it('create scheme requires code/name/authority/category/benefit/eligibility/reason', () => {
    const ok = CreateSchemeSchema.safeParse({ code: 'pm_kisan', defaultName: 'PM-KISAN', authorityId: '11111111-1111-1111-1111-111111111111', categoryId: '22222222-2222-2222-2222-222222222222', benefitSummary: { a: 1 }, eligibilityRules: { b: 2 }, reason: 'add scheme' });
    expect(ok.success).toBe(true);
    if (ok.success) { expect(ok.data.processingFeeMinor).toBe('0'); expect(ok.data.requiredDocTypeIds).toEqual([]); }
    expect(CreateSchemeSchema.safeParse({ code: 'BAD CODE', defaultName: 'x', authorityId: '11111111-1111-1111-1111-111111111111', categoryId: '22222222-2222-2222-2222-222222222222', benefitSummary: { a: 1 }, eligibilityRules: { b: 2 }, reason: 'r' }).success).toBe(false);
    expect(CreateSchemeSchema.safeParse({ code: 'pm_kisan', defaultName: 'x', authorityId: '11111111-1111-1111-1111-111111111111', categoryId: '22222222-2222-2222-2222-222222222222', benefitSummary: { a: 1 }, eligibilityRules: { b: 2 }, reason: 'r', processingFeeMinor: '10.5' }).success).toBe(false);
  });
  it('rules/window/meta updates require ≥1 field + valid shapes', () => {
    expect(UpdateSchemeRulesSchema.safeParse({ reason: 'noop' }).success).toBe(false);
    expect(UpdateSchemeRulesSchema.safeParse({ processingFeeMinor: '500', reason: 'fee' }).success).toBe(true);
    expect(SetWindowSchema.safeParse({ applicationWindow: { opens: '06-01', closes: '07-31' }, reason: 'win' }).success).toBe(true);
    expect(SetWindowSchema.safeParse({ applicationWindow: null, reason: 'clear' }).success).toBe(true);
    expect(UpdateSchemeMetaSchema.safeParse({ reason: 'noop' }).success).toBe(false);
  });
});

/* ---------------- services (pool/repo/audit mocked) ---------------- */
const actor = { userId: 'u1', roles: ['platform_schemes_ops'], ip: '10.0.0.1', requestId: 'rq1' } as any;
function fakeTxPool() { const client = {}; return { withTx: jest.fn(async (fn: any) => fn(client)) } as any; }

describe('SchemeCrudService — FK checks + duplicate + audit-in-tx + 404', () => {
  const baseCreate = { code: 'pm_kisan', defaultName: 'PM-KISAN', authorityId: '11111111-1111-1111-1111-111111111111', categoryId: '22222222-2222-2222-2222-222222222222', benefitSummary: { a: 1 }, eligibilityRules: { b: 2 }, requiredDocTypeIds: [], applicableRegionIds: [], processingFeeMinor: '0', reason: 'add' } as any;

  it('createScheme: authority+category FK ok, no dup → inserts INACTIVE + change + audit in same tx', async () => {
    const pool = fakeTxPool(); const audit = { write: jest.fn() } as any;
    const repo = {
      getAuthorityForUpdate: jest.fn().mockResolvedValue(SchemeAuthority.rehydrate({ id: 'a1', defaultName: 'A', level: 'central', regionId: null })),
      isValidCategory: jest.fn().mockResolvedValue(true),
      schemeCodeExists: jest.fn().mockResolvedValue(false),
      insertScheme: jest.fn().mockResolvedValue({ id: 's9', createdAt: new Date() }),
      // ADMIN-4: a new scheme's v1 rules are inserted as a DRAFT in the same tx — they go through a checker too.
      insertVersion: jest.fn().mockResolvedValue({ id: 'v-1' }),
      insertChange: jest.fn(),
    } as any;
    const svc = new SchemeCrudService(pool, audit, repo);
    const res: any = await svc.createScheme(actor, baseCreate);
    expect(res.id).toBe('s9'); expect(res.isActive).toBe(false); expect(res.version).toBe(1);
    expect(pool.withTx).toHaveBeenCalledTimes(1);
    // v1 is a DRAFT, drafted by the creator, awaiting a second operator
    expect(repo.insertVersion).toHaveBeenCalledTimes(1);
    expect(repo.insertVersion.mock.calls[0][1]).toMatchObject({ version: 1, draftedBy: actor.userId });
    expect(res.awaitingChecker).toBe(true);
    // two ledger rows in the one tx: the scheme, and its first version
    expect(repo.insertChange).toHaveBeenCalledTimes(2);
    expect(audit.write).toHaveBeenCalledTimes(1);
  });

  it('setActive(true) REFUSES a scheme with no published version — rules nobody signed never go live', async () => {
    const pool = fakeTxPool();
    const repo: any = {
      getSchemeForUpdate: jest.fn().mockResolvedValue(Scheme.rehydrate(schemeProps())),
      getPublishedForUpdate: jest.fn().mockResolvedValue(null),
      setSchemeActive: jest.fn(), insertChange: jest.fn(),
    };
    const svc = new SchemeCrudService(pool, { write: jest.fn() } as any, repo);
    await expect(svc.setActive(actor, 's1', { isActive: true, reason: 'go live' })).rejects.toMatchObject({ status: 409 });
    expect(repo.setSchemeActive).not.toHaveBeenCalled();
  });

  it('DEACTIVATING never needs a published version — stopping a bad scheme must not need a second signature', async () => {
    const pool = fakeTxPool();
    const repo: any = {
      getSchemeForUpdate: jest.fn().mockResolvedValue(Scheme.rehydrate({ ...schemeProps(), isActive: true })),
      getPublishedForUpdate: jest.fn().mockResolvedValue(null),
      setSchemeActive: jest.fn(), insertChange: jest.fn(),
    };
    const svc = new SchemeCrudService(pool, { write: jest.fn() } as any, repo);
    await svc.setActive(actor, 's1', { isActive: false, reason: 'suspend' });
    expect(repo.setSchemeActive).toHaveBeenCalledTimes(1);
    expect(repo.getPublishedForUpdate).not.toHaveBeenCalled();
  });
  it('createScheme fails closed: unknown authority → 404, bad category → 422, dup code → 409', async () => {
    const pool = fakeTxPool();
    const repo: any = { getAuthorityForUpdate: jest.fn().mockResolvedValue(null), isValidCategory: jest.fn().mockResolvedValue(false), schemeCodeExists: jest.fn().mockResolvedValue(true), insertScheme: jest.fn(), insertChange: jest.fn() };
    const svc = new SchemeCrudService(pool, { write: jest.fn() } as any, repo);
    await expect(svc.createScheme(actor, baseCreate)).rejects.toBeInstanceOf(AuthorityNotFoundError);
    repo.getAuthorityForUpdate.mockResolvedValue(SchemeAuthority.rehydrate({ id: 'a1', defaultName: 'A', level: 'central', regionId: null }));
    await expect(svc.createScheme(actor, baseCreate)).rejects.toBeInstanceOf(SchemeCategoryInvalidError);
    repo.isValidCategory.mockResolvedValue(true);
    await expect(svc.createScheme(actor, baseCreate)).rejects.toBeInstanceOf(DuplicateSchemeCodeError);
  });
  it('setActive 404s on unknown scheme', async () => {
    const pool = fakeTxPool();
    const repo: any = { getSchemeForUpdate: jest.fn().mockResolvedValue(null) };
    const svc = new SchemeCrudService(pool, { write: jest.fn() } as any, repo);
    await expect(svc.setActive(actor, 'missing', { isActive: true, reason: 'r' })).rejects.toBeInstanceOf(SchemeNotFoundError);
  });
});

describe('EligibilityRulesEditorService — now a DRAFT, not a live edit (ADMIN-4 / migration 0105)', () => {
  // BEHAVIOUR CHANGED ON PURPOSE. This service used to lock the live `schemes` row, bump `schemes.version` and
  // overwrite the rule jsonb in place — which is precisely what made `scheme_applications.scheme_version` a number
  // pointing at rules nothing could retrieve. The old assertions below (version becomes 2, updateSchemeRules called)
  // encoded that defect, so they are replaced rather than adapted.
  it('delegates to the version plane and publishes NOTHING', async () => {
    const versions: any = { saveDraft: jest.fn().mockResolvedValue({ versionId: 'v-7', version: 7, opened: true, diff: [] }) };
    const svc = new EligibilityRulesEditorService(versions, {} as any);
    const res: any = await svc.updateRules(actor, 's1', { processingFeeMinor: '500', reason: 'fee change' } as any);
    expect(versions.saveDraft).toHaveBeenCalledTimes(1);
    expect(versions.saveDraft.mock.calls[0][2]).toMatchObject({ processingFeeMinor: '500' });
    expect(res.status).toBe('draft');
    // Blunt in the payload so a caller written against the old response cannot mistake a queued draft for a live
    // rule change.
    expect(res.publishedNothing).toBe(true);
    expect(res.version).toBe(7);
  });
  it('does not swallow the version plane errors (404 on an unknown scheme still 404s)', async () => {
    const versions: any = { saveDraft: jest.fn().mockRejectedValue(new SchemeNotFoundError('x')) };
    const svc = new EligibilityRulesEditorService(versions, {} as any);
    await expect(svc.updateRules(actor, 'x', { processingFeeMinor: '1', reason: 'r' } as any)).rejects.toBeInstanceOf(SchemeNotFoundError);
  });
});

describe('WindowCalendarService — the window is VERSIONED now (ADMIN-4)', () => {
  // W073's own locked state says "Window dates come from scheme versions — edit via the scheme (checker-gated)".
  // The old test asserted the opposite (persists straight to the live row, no version bump) because the old code did.
  it('setWindow opens a draft rather than editing the live scheme row', async () => {
    const versions: any = { saveDraft: jest.fn().mockResolvedValue({ versionId: 'v-2', version: 2, opened: true, diff: [] }) };
    const repo: any = { schemesOpenOn: jest.fn().mockResolvedValue([]) };
    const svc = new WindowCalendarService(repo, versions);
    const res: any = await svc.setWindow(actor, 's1', { applicationWindow: { opens: '06-01', closes: '07-31' }, reason: 'open kharif' } as any);
    expect(versions.saveDraft.mock.calls[0][2]).toMatchObject({ applicationWindow: { opens: '06-01', closes: '07-31' } });
    expect(res.status).toBe('draft');
    expect(res.publishedNothing).toBe(true);
  });
  it('calendar defaults onDate to today (MM-DD) and passes it to the repo', async () => {
    const repo: any = { schemesOpenOn: jest.fn().mockResolvedValue([]) };
    const svc = new WindowCalendarService(repo, { saveDraft: jest.fn() } as any);
    const res: any = await svc.calendar({ limit: 50 });
    expect(res.onDate).toMatch(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
    expect(repo.schemesOpenOn.mock.calls[0][0].onDate).toBe(res.onDate);
  });
  it('the nudge queue declares itself unavailable — never an empty list', async () => {
    const repo: any = { schemesOpenOn: jest.fn().mockResolvedValue([]) };
    const svc = new WindowCalendarService(repo, { saveDraft: jest.fn() } as any);
    const res: any = await svc.calendar({ limit: 50 });
    expect(res.nudgeQueue.available).toBe(false);
    expect(res.closingSoon).toEqual([]);
  });
});
