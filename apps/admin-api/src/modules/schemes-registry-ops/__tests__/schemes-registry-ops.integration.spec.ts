// apps/admin-api/src/modules/schemes-registry-ops/__tests__/schemes-registry-ops.integration.spec.ts
// REAL end-to-end proof against a live Postgres (the schema apps/api builds + seeds + migration 0042). Proves the
// scheme-master write paths: register an authority, create a scheme (INACTIVE, version 1) against the SEEDED
// 'scheme_category' lookup, version-bump its rules, set + read the application window via the calendar, and
// activate it — asserting the persisted rows (version increment, fee as bigint, window), the
// scheme_registry_changes timeline, and the audit_log rows. scheme_authorities/schemes/scheme_registry_changes are
// GLOBAL/god-mode (no tenant_id ⇒ no RLS — kv_admin-only). Runs only when DATABASE_ADMIN_URL is set.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { SchemeVersionService } from '../services/scheme-version.service';
import { SchemesRegistryRepository } from '../repositories/schemes-registry.repository';
import { SchemeCrudService } from '../services/scheme-crud.service';
import { EligibilityRulesEditorService } from '../services/eligibility-rules-editor.service';
import { WindowCalendarService } from '../services/window-calendar.service';

const APP_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const run = APP_URL ? describe : describe.skip;

run('schemes-registry-ops (integration, real Postgres — authority + scheme + version + window + audit)', () => {
  let pool: AdminPool; let inspect: Pool; let crud: SchemeCrudService; let rules: EligibilityRulesEditorService; let cal: WindowCalendarService;
  const actor = { userId: randomUUID(), roles: ['platform_schemes_ops'], amr: ['hwk'], authTimeSec: Math.floor(Date.now() / 1000), sessionId: '', permissions: new Set(['schemes.registry.manage']), ip: '10.0.0.1', requestId: 'itest' } as any;
  const tag = String(Date.now());
  const code = `itest_scheme_${tag}`.slice(0, 60);
  let authorityId = ''; let schemeId = ''; let categoryId = '';

  beforeAll(async () => {
    const config = new AdminConfig({ NODE_ENV: 'test', DATABASE_ADMIN_URL: APP_URL, ADMIN_JWT_SECRET: 's'.repeat(40) });
    pool = new AdminPool(config);
    const repo = new SchemesRegistryRepository(pool); const audit = new AdminAuditWriter(pool);
    crud = new SchemeCrudService(pool, audit, repo);
    // ADMIN-4: both of these now route through the maker-checker version plane rather than editing the live row.
    const versions = new SchemeVersionService(pool, audit, repo);
    rules = new EligibilityRulesEditorService(versions, repo);   // c2: the editor validates + dry-runs through the repo now
    cal = new WindowCalendarService(repo, versions);
    inspect = new Pool({ connectionString: APP_URL });
    const cat = await inspect.query(`SELECT id FROM lookup_values WHERE type_code='scheme_category' AND code='income_support' AND tenant_id IS NULL LIMIT 1`);
    categoryId = cat.rows[0]?.id;
  }, 30000);

  afterAll(async () => {
    if (inspect) {
      for (const id of [schemeId, authorityId].filter(Boolean)) await inspect.query(`DELETE FROM scheme_registry_changes WHERE entity_id=$1`, [id]).catch(() => undefined);
      if (schemeId) await inspect.query(`DELETE FROM schemes WHERE id=$1`, [schemeId]).catch(() => undefined);
      if (authorityId) await inspect.query(`DELETE FROM scheme_authorities WHERE id=$1`, [authorityId]).catch(() => undefined);
      await inspect.end();
    }
    await pool?.onModuleDestroy();
  });

  it('authority→scheme(inactive,v1)→version-bump→window→activate: rows + timeline + audit', async () => {
    expect(categoryId).toBeTruthy();   // seeded 'scheme_category' lookup must exist

    const authority: any = await crud.createAuthority(actor, { defaultName: `ITest Authority ${tag}`, level: 'central', reason: 'register body' });
    authorityId = authority.id;

    const created: any = await crud.createScheme(actor, {
      code, defaultName: 'ITest Income Support', authorityId, categoryId,
      benefitSummary: { type: 'dbt_annual', amount_minor: 600000 }, eligibilityRules: { landholding_max_acres: 2 },
      requiredDocTypeIds: [], applicableRegionIds: [], processingFeeMinor: '0', reason: 'add scheme',
    });
    schemeId = created.id;
    expect(created.version).toBe(1);
    expect(created.isActive).toBe(false);   // created INACTIVE (fail-safe)

    // rule edit ⇒ version 2 + fee persisted as bigint
    await rules.updateRules(actor, schemeId, { eligibilityRules: { landholding_max_acres: 5 }, processingFeeMinor: '25000', reason: 'widen + set fee' });
    const r1 = await inspect.query(`SELECT version, processing_fee_minor::text AS fee, is_active FROM schemes WHERE id=$1`, [schemeId]);
    expect(r1.rows[0].version).toBe(2);
    expect(r1.rows[0].fee).toBe('25000');
    expect(r1.rows[0].is_active).toBe(false);

    // window set (no version bump) + calendar surfaces it on an in-window date
    await cal.setWindow(actor, schemeId, { applicationWindow: { opens: '01-01', closes: '12-31' }, reason: 'year round' });
    await crud.setActive(actor, schemeId, { isActive: true, reason: 'go live' });
    const r2 = await inspect.query(`SELECT version, is_active, application_window->>'opens' AS opens FROM schemes WHERE id=$1`, [schemeId]);
    expect(r2.rows[0].version).toBe(2);          // window edit did NOT bump version
    expect(r2.rows[0].is_active).toBe(true);
    expect(r2.rows[0].opens).toBe('01-01');

    const live: any = await cal.calendar({ onDate: '06-15', limit: 100 });
    expect(live.items.some((s: any) => s.id === schemeId)).toBe(true);   // active + in-window ⇒ surfaced

    const ch = await inspect.query(`SELECT count(*)::int AS c FROM scheme_registry_changes WHERE entity_id=$1 AND action IN ('created','versioned','updated','activated')`, [schemeId]);
    expect(ch.rows[0].c).toBe(4);   // created + versioned(rules) + updated(window) + activated
    const au = await inspect.query(`SELECT count(*)::int AS c FROM audit_log WHERE entity_id=$1 AND action LIKE 'schemes.scheme.%'`, [schemeId]);
    expect(au.rows[0].c).toBe(4);
  });
});
