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
import { NoPublishedVersionError } from '../domain/schemes-registry.errors';

const APP_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const run = APP_URL ? describe : describe.skip;

run('schemes-registry-ops (integration, real Postgres — authority + scheme + version + window + audit)', () => {
  let pool: AdminPool; let inspect: Pool; let crud: SchemeCrudService; let rules: EligibilityRulesEditorService; let cal: WindowCalendarService;
  let versions: SchemeVersionService;
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
    versions = new SchemeVersionService(pool, audit, repo);
    rules = new EligibilityRulesEditorService(versions, repo);   // c2: the editor validates + dry-runs through the repo now
    cal = new WindowCalendarService(repo, versions);
    inspect = new Pool({ connectionString: APP_URL });
    const cat = await inspect.query(`SELECT id FROM lookup_values WHERE type_code='scheme_category' AND code='income_support' AND tenant_id IS NULL LIMIT 1`);
    categoryId = cat.rows[0]?.id;
  }, 30000);

  afterAll(async () => {
    if (inspect) {
      for (const id of [schemeId, authorityId].filter(Boolean)) await inspect.query(`DELETE FROM scheme_registry_changes WHERE entity_id=$1`, [id]).catch(() => undefined);
      if (schemeId) await inspect.query(`DELETE FROM scheme_registry_changes WHERE entity_id IN (SELECT id FROM scheme_versions WHERE scheme_id=$1)`, [schemeId]).catch(() => undefined);
      if (schemeId) await inspect.query(`DELETE FROM scheme_versions WHERE scheme_id=$1`, [schemeId]).catch(() => undefined);
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

    // PC-56 TEST-1 · ADMIN-4 put rule AND window edits through the maker-checker version plane (this spec's own beforeAll says so)
    // and a new scheme's v1 is born a DRAFT (scheme-crud.service: "setActive(true) now REFUSES until a second operator has
    // published v1"), but the assertions below still expected the LIVE row to change on the maker's edit. It no longer does — by
    // design. The flow is now proved as built: the maker's rule edit lands in the v1 draft (nothing live moves, going live is
    // refused) → the maker cannot publish their own draft → a checker publishes v1 (fee live as bigint) → the window is a new
    // draft v2 → published → activate → surfaced by the calendar; every step on the timeline and in the audit log.
    const checker = { ...actor, userId: randomUUID(), requestId: 'itest-checker' };
    const v1Id: string = created.draftVersionId;
    expect(v1Id).toBeTruthy();

    const edit: any = await rules.updateRules(actor, schemeId, { eligibilityRules: { landholding_max_acres: 5 }, processingFeeMinor: '25000', reason: 'widen + set fee' });
    expect(edit).toMatchObject({ versionId: v1Id, version: 1, opened: false, status: 'draft', publishedNothing: true });
    const r0 = await inspect.query(`SELECT version, processing_fee_minor::text AS fee, is_active FROM schemes WHERE id=$1`, [schemeId]);
    expect(r0.rows[0]).toEqual({ version: 1, fee: '0', is_active: false });
    await expect(crud.setActive(actor, schemeId, { isActive: true, reason: 'too early' })).rejects.toBeInstanceOf(NoPublishedVersionError);
    await expect(versions.publish(actor, schemeId, v1Id, 'self-approval attempt')).rejects.toBeTruthy();   // maker ≠ checker
    await versions.publish(checker, schemeId, v1Id, 'checked the widened cohort');
    const r1 = await inspect.query(`SELECT version, processing_fee_minor::text AS fee, is_active FROM schemes WHERE id=$1`, [schemeId]);
    expect(r1.rows[0].version).toBe(1);
    expect(r1.rows[0].fee).toBe('25000');
    expect(r1.rows[0].is_active).toBe(false);

    // the window is a rule too: a NEW draft (v2), published by the checker; then the scheme goes live
    const draft2: any = await cal.setWindow(actor, schemeId, { applicationWindow: { opens: '01-01', closes: '12-31' }, reason: 'year round' });
    expect(draft2).toMatchObject({ version: 2, opened: true, status: 'draft', publishedNothing: true });
    await versions.publish(checker, schemeId, draft2.versionId, 'window checked');
    await crud.setActive(actor, schemeId, { isActive: true, reason: 'go live' });
    const r2 = await inspect.query(`SELECT version, is_active, application_window->>'opens' AS opens, processing_fee_minor::text AS fee FROM schemes WHERE id=$1`, [schemeId]);
    expect(r2.rows[0]).toEqual({ version: 2, is_active: true, opens: '01-01', fee: '25000' });   // v2 carries v1's fee forward

    const live: any = await cal.calendar({ onDate: '06-15', limit: 100 });
    expect(live.items.some((s: any) => s.id === schemeId)).toBe(true);   // active + in-window ⇒ surfaced

    const ch = await inspect.query(`SELECT action FROM scheme_registry_changes WHERE entity_id=$1 ORDER BY created_at, action`, [schemeId]);
    expect(ch.rows.map((r: any) => r.action)).toEqual(['created', 'versioned', 'versioned', 'activated']);
    const v1ch = await inspect.query(`SELECT action FROM scheme_registry_changes WHERE entity_id=$1 ORDER BY created_at, action`, [v1Id]);
    expect(v1ch.rows.map((r: any) => r.action)).toEqual(['draft_opened', 'draft_updated', 'published']);
    const au = await inspect.query(`SELECT action FROM audit_log WHERE entity_id = ANY($1::uuid[]) AND action LIKE 'schemes.%' ORDER BY created_at, action`, [[schemeId, v1Id, draft2.versionId]]);
    expect(au.rows.map((r: any) => r.action)).toEqual(['schemes.scheme.created', 'schemes.version.draft_updated', 'schemes.version.published', 'schemes.version.draft_opened', 'schemes.version.published', 'schemes.scheme.activated']);
  });
});
