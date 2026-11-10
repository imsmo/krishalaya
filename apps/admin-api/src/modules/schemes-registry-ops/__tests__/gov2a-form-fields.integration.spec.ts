// apps/admin-api/src/modules/schemes-registry-ops/__tests__/gov2a-form-fields.integration.spec.ts · PC-56 GOV-2a · B2f — LIVE (a real Postgres
// built by apps/api's integration setup, migration 0240). The form fields a scheme version declares are authored ONLY in the admin realm's
// draft → publish plane: the maker declares them in a draft, a DIFFERENT operator publishes, and the published list is frozen (0240 replaced
// 0105's trigger to cover it). A list the database refuses (a name not personal) never reaches a draft. Runs only when DATABASE_ADMIN_URL is set.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { SchemeVersionService } from '../services/scheme-version.service';
import { SchemesRegistryRepository } from '../repositories/schemes-registry.repository';
import { SchemeCrudService } from '../services/scheme-crud.service';

const APP_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;
const operator = (userId: string) => ({ userId, roles: ['platform_schemes_ops'], amr: ['hwk'], authTimeSec: Math.floor(Date.now() / 1000), sessionId: '',
  permissions: new Set(['schemes.registry.manage']), ip: '10.0.0.1', requestId: 'itest-gov2a' }) as any;

run('GOV-2a · declared form fields through the admin draft → publish plane (integration)', () => {
  let pool: AdminPool; let inspect: Pool; let crud: SchemeCrudService; let versions: SchemeVersionService;
  const maker = operator(randomUUID()); const checker = operator(randomUUID());
  let authorityId = ''; let schemeId = '';
  const fields = [{ key: 'cropName', label: 'Crop', kind: 'text' as const, personal: false }, { key: 'farmerName', label: 'Name', kind: 'text' as const, personal: true }];

  beforeAll(async () => {
    const config = new AdminConfig({ NODE_ENV: 'test', DATABASE_ADMIN_URL: APP_URL, ADMIN_JWT_SECRET: 's'.repeat(40) });
    pool = new AdminPool(config);
    const repo = new SchemesRegistryRepository(pool); const audit = new AdminAuditWriter(pool);
    crud = new SchemeCrudService(pool, audit, repo); versions = new SchemeVersionService(pool, audit, repo);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);

  afterAll(async () => {
    if (inspect) {
      // shared tables: the rows this spec made are retired (a published version can never be edited — it is left, its scheme deactivated)
      if (schemeId) {
        await inspect.query(`UPDATE scheme_versions SET deleted_at = now() WHERE scheme_id = $1 AND status = 'draft'`, [schemeId]).catch(() => undefined);
        await inspect.query(`UPDATE schemes SET is_active = false, deleted_at = now() WHERE id = $1`, [schemeId]).catch(() => undefined);
      }
      if (authorityId) await inspect.query(`UPDATE scheme_authorities SET deleted_at = now() WHERE id = $1`, [authorityId]).catch(() => undefined);
      await inspect.end();
    }
    await pool?.onModuleDestroy();
  });

  it('the maker declares fields in a draft, a second operator publishes, the published list is frozen; a refused list never lands', async () => {
    const cat = (await inspect.query(`SELECT id FROM lookup_values WHERE type_code='scheme_category' AND tenant_id IS NULL ORDER BY code LIMIT 1`)).rows[0].id;
    authorityId = ((await crud.createAuthority(maker, { defaultName: `GOV-2a ITest Authority ${Date.now()}`, level: 'state', reason: 'register body' })) as any).id;
    const created: any = await crud.createScheme(maker, {
      code: `gov2a_ff_${randomUUID().replace(/-/g, '').slice(0, 10)}`, defaultName: 'GOV-2a ITest Scheme', authorityId, categoryId: cat,
      benefitSummary: { type: 'dbt_annual', instalments: 2 }, eligibilityRules: { roles: ['farmer'] }, requiredDocTypeIds: [], applicableRegionIds: [], processingFeeMinor: '0', reason: 'add scheme',
    });
    schemeId = created.id;
    // v1 is born a draft with NO declared field; the maker declares two
    const d = await versions.saveDraft(maker, schemeId, { formFields: fields }, 'declare the form fields');
    expect([d.opened, d.version]).toEqual([false, 1]);
    expect((await inspect.query(`SELECT form_fields FROM scheme_versions WHERE id = $1`, [d.versionId])).rows[0].form_fields).toEqual(fields);
    // the maker cannot publish their own draft; the checker can
    await expect(versions.publish(maker, schemeId, d.versionId, undefined)).rejects.toBeTruthy();
    await versions.publish(checker, schemeId, d.versionId, undefined);
    expect((await inspect.query(`SELECT status::text AS s, form_fields FROM scheme_versions WHERE id = $1`, [d.versionId])).rows[0]).toEqual({ s: 'published', form_fields: fields });
    // published means frozen — for the owner too
    await expect(inspect.query(`UPDATE scheme_versions SET form_fields = '[]'::jsonb WHERE id = $1`, [d.versionId])).rejects.toMatchObject({ code: '23514' });
    // a change of the declared fields opens v2; the review diff names it
    const d2 = await versions.saveDraft(maker, schemeId, { formFields: [fields[0]] }, 'drop the name field');
    expect([d2.opened, d2.version, d2.diff.map((x) => x.field)]).toEqual([true, 2, ['formFields']]);
    const v = await versions.getVersion(d2.versionId);
    expect([v.formFields, v.diff.map((x) => x.field)]).toEqual([[fields[0]], ['formFields']]);
    // a list the rules refuse (a person's name not personal) never reaches the draft
    await expect(versions.saveDraft(maker, schemeId, { formFields: [{ key: 'farmerName', label: 'Name', kind: 'text', personal: false }] }, 'bad list')).rejects.toThrow(/must be declared personal/);
    expect((await inspect.query(`SELECT form_fields FROM scheme_versions WHERE id = $1`, [d2.versionId])).rows[0].form_fields).toEqual([fields[0]]);
  });
});
