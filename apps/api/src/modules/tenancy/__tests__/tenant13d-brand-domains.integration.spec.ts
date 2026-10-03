// modules/tenancy/__tests__/tenant13d-brand-domains.integration.spec.ts · PC-56 TENANT-13d — LIVE proof against real Postgres + RLS (no
// infra mocks except the two the brief names: the object store (an in-memory bucket) and the DNS resolver (a fake port)). Founder
// decisions: BRAND FOR ALL, DOMAIN BY PLAN; CNAME + TXT PROOF, PLATFORM EDGE, HOST ROUTING, ACME LATER. Each block fails on HEAD 685aff2:
//   BRAND   draft save with before/after; a script-bearing SVG refused and nothing stored; publish refused on a 4.4:1 pair NAMING it (and
//           the database's own floor under it); one-admin tenant told; the maker's confirm refused by the TRIGGER (service and raw SQL);
//           a second admin publishes → version, history, tenants.display_name / logo_url synced, audit, the member notice; the published
//           logo served with its type locked; rollback through history (same checker path); the profile can no longer rename a branded
//           tenant; Powered-by removable only with the plan feature and never on trust surfaces; µs history paging.
//   DOMAINS a new tenant's included subdomain with honest TLS (and the wildcard switch); reserved names refused (service AND trigger); the
//           plan gate; a pending claim with token; a pending claim by another tenant does not block, first VERIFIED wins; fake resolver →
//           verified; wrong TXT → failed in words; no fake verified / no fake issued from kv_app; expiry releases the name; Host →
//           tenant on a verified row only (pending / unknown / suspended → 404; F-24 on X-Tenant-Id); make primary only when verified,
//           with a checker; remove a primary only with a successor; re-check once a minute; µs paging; reads gated (F-12); the clock.
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { makeTenant, makeUser, makePlan, activateSubscription } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { TenantSlugResolver } from '../../../core/tenancy-context/tenant-slug-resolver';
import { TenantContextMiddleware } from '../../../core/tenancy-context/tenant-context.middleware';
import { getRequestContext } from '../../../core/tenancy-context/request-context';
import { TRUST_SURFACES, showsPoweredBy } from '@krishalaya/tokens';
import { TenantBrandingRepository } from '../repositories/tenant-branding.repository';
import { TenantDomainRepository } from '../repositories/tenant-domain.repository';
import { SettingGovernanceRepository } from '../repositories/setting-governance.repository';
import { TenantRepository } from '../repositories/tenant.repository';
import { TenantSettingsRepository } from '../repositories/tenant-settings.repository';
import { TenantFeatureRepository } from '../repositories/tenant-feature.repository';
import { UsageCounterRepository } from '../repositories/usage-counter.repository';
import { TenantBrandingService } from '../services/tenant-branding.service';
import { TenantDomainService } from '../services/tenant-domain.service';
import { TenantService } from '../services/tenant.service';
import { NotConfiguredAcme, DomainDnsPort } from '../infra/domain-dns.port';
import { BrandDomainProposalsJob } from '../jobs/brand-domain-proposals.job';
import { DomainVerificationJob } from '../jobs/domain-verification.job';
import { hostDecision } from '../controllers/v1/storefront-brand.controller';
import { DnsObservation } from '../domain/domain-rules';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const key = () => `idem-${randomUUID()}`;
const IP = '10.0.13.4';
const WHY = 'Board resolution 21/2026: the members asked for our own name and colours';
const EDGE = 'edge.krishalaya.app';

function png(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25); ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12);
  const iend = Buffer.alloc(12); iend.write('IEND', 4, 'latin1');
  return Buffer.concat([sig, ihdr, iend]);
}

/** The object store as an in-memory bucket (the S3 boundary is not under test; what is stored is). */
class MemoryStore {
  readonly objects = new Map<string, { body: Buffer; type: string }>();
  puts = 0;
  async putObject(k: string, body: Buffer, type: string) { this.puts++; this.objects.set(k, { body: Buffer.from(body), type }); }
  async getObject(k: string) { const o = this.objects.get(k); if (!o) throw new Error('no such object'); return o.body; }
}
/** The DNS port as a table the test writes: exactly "a port with a fake in tests". */
class FakeDns implements DomainDnsPort {
  readonly answers = new Map<string, DnsObservation>();
  readonly asked: Array<{ domain: string; resolvers: readonly string[] }> = [];
  async observe(domain: string, resolvers: readonly string[]): Promise<DnsObservation> {
    this.asked.push({ domain, resolvers });
    return this.answers.get(domain) ?? { cname: { values: [], error: 'no such record (the name does not exist yet)' }, txt: { values: [], error: 'no such record (the name does not exist yet)' } };
  }
}

run('PC-56 TENANT-13d · white-label branding and domains (integration, real Postgres)', () => {
  let admin: Pool; let pools: PgPoolProvider; let uow: PgUnitOfWork; let replica: PgReadReplicaProvider;
  let brand: TenantBrandingService; let domains: TenantDomainService; let tenants: TenantService; let slugs: TenantSlugResolver;
  let brandRepo: TenantBrandingRepository; let domainRepo: TenantDomainRepository;
  const store = new MemoryStore(); const dns = new FakeDns();
  const A = randomUUID(); const B = randomUUID(); const C = randomUUID(); const D = randomUUID(); const E = randomUUID();
  const a1 = randomUUID(); const a2 = randomUUID(); const b1 = randomUUID(); const b2 = randomUUID(); const c1 = randomUUID();
  const d1 = randomUUID(); const d2 = randomUUID(); const farmerA = randomUUID();
  const mgr = (u: string) => ({ userId: u, canManage: true });
  const errOf = (p: Promise<unknown>) => p.then(() => null, (e: any) => e);
  const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => e.code ?? String(e.message ?? e));
  const addRole = async (u: string, role: string, tenant: string) => {
    const r = (await admin.query(`SELECT id FROM roles WHERE code=$1`, [role])).rows[0].id;
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING`, [u, tenant, r]);
  };
  async function asApp<T>(tenantId: string, userId: string | null, fn: (probe: (sql: string, p?: unknown[]) => Promise<string>, c: PoolClient) => Promise<T>): Promise<T> {
    const c: PoolClient = await admin.connect();
    try {
      await c.query('SET SESSION AUTHORIZATION kv_app');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await c.query(`SELECT set_config('app.user_id', $1, true)`, [userId ?? '']);
      const probe = async (sql: string, p: unknown[] = []) => {
        await c.query('SAVEPOINT p');
        try { await c.query(sql, p); await c.query('RELEASE SAVEPOINT p'); return 'ok'; }
        catch (e) { await c.query('ROLLBACK TO SAVEPOINT p'); const x = e as { code?: string; message?: string; constraint?: string }; return `${x.code}:${(x.message ?? '').match(/\[([A-Z_]+)\]/)?.[1] ?? x.constraint ?? ''}`; }
      };
      return await fn(probe, c);
    } finally { await c.query('ROLLBACK').catch(() => undefined); await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
  }
  /** The antivirus scanner's verdict (the media plane's signed callback writes exactly this column). */
  const scanClean = (mediaId: string) => admin.query(`UPDATE media_assets SET scan_status='clean' WHERE id=$1`, [mediaId]);
  const domainRow = async (t: string, d: string) => (await admin.query(`SELECT * FROM tenant_domains WHERE tenant_id=$1 AND domain=$2 ORDER BY created_at DESC LIMIT 1`, [t, d])).rows[0];
  const includedOf = async (t: string) => (await admin.query(`SELECT * FROM tenant_domains WHERE tenant_id=$1 AND kind='included' AND deleted_at IS NULL`, [t])).rows[0];
  const proof = (domain: string, token: string, edge = EDGE): DnsObservation => ({ cname: { values: [`${edge}.`], error: null }, txt: { values: ['v=spf1 -all', token], error: null } });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, A, 'Anand FPO 13d'); await makeTenant(admin, B, 'Growth FPO 13d'); await makeTenant(admin, C, 'Solo FPO 13d');
    await makeTenant(admin, D, 'Rival FPO 13d'); await makeTenant(admin, E, 'Paused FPO 13d');
    for (const u of [a1, a2, b1, b2, c1, d1, d2, farmerA]) await makeUser(admin, u as ReturnType<typeof randomUUID>);
    await admin.query(`UPDATE users SET full_name = 'Hetal Admin' WHERE id = $1`, [a1]); await admin.query(`UPDATE users SET full_name = 'Raman Admin' WHERE id = $1`, [a2]);
    for (const [u, t] of [[a1, A], [a2, A], [b1, B], [b2, B], [c1, C], [d1, D], [d2, D]] as const) await addRole(u, 'tenant_admin', t);
    await addRole(farmerA, 'farmer', A);
    // A and D: a plan with custom_domain AND white_label_unbranded (read for real); B: a plan with neither; C: no subscription at all
    const pro = await makePlan(admin);
    await admin.query(`INSERT INTO plan_features (plan_id, feature_code, is_included) VALUES ($1,'custom_domain',true), ($1,'white_label_unbranded',true)`, [pro]);
    const growth = await makePlan(admin);
    await activateSubscription(admin, A, pro); await activateSubscription(admin, D, pro); await activateSubscription(admin, B, growth);
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config); const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards); replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    const gov = new SettingGovernanceRepository(replica as never);
    brandRepo = new TenantBrandingRepository(replica as never); domainRepo = new TenantDomainRepository(replica as never);
    brand = new TenantBrandingService(uow, outbox, idem, metrics, audit, brandRepo, gov, store as never);
    domains = new TenantDomainService(uow, outbox, idem, metrics, audit, domainRepo, brandRepo, gov, dns, new NotConfiguredAcme());
    tenants = new TenantService(uow, outbox, idem, metrics, audit, new TenantRepository(replica as never), new TenantSettingsRepository(replica as never),
      new TenantFeatureRepository(replica as never), new UsageCounterRepository(replica as never));
    slugs = new TenantSlugResolver(pools);
  }, 60_000);
  afterAll(async () => { await admin.end(); await pools.onModuleDestroy?.(); });

  /* ==================================================================================================================== */
  /* BRAND                                                                                                                */
  /* ==================================================================================================================== */

  let logoId = '';
  it('BRAND · reads gated; "Default Krishalaya brand" until published; the plan facts read for real; branding on EVERY plan (Rule Zero)', async () => {
    expect(await codeOf(brand.console(A, { userId: farmerA, canManage: false }))).toBe('TENANT_FORBIDDEN');
    const c = await brand.console(A, mgr(a1));
    expect(c).toMatchObject({ exists: false, membersSee: 'platform_brand_with_your_name', published: null, admins: { count: 2 } });
    expect(c.draft.values.displayName).toBe('Anand FPO 13d');
    expect(c.plan).toMatchObject({ branding: { includedOnEveryPlan: true }, customDomain: { enabled: true }, removePoweredBy: { enabled: true } });
    expect(c.draft.contrast.passes).toBe(true);
    const b = await brand.console(B, mgr(b1));
    expect(b.plan).toMatchObject({ customDomain: { enabled: false }, removePoweredBy: { enabled: false } });
    // Rule Zero: a tenant on a plan without either feature still designs, saves and can publish a brand
    expect((await brand.saveDraft(B, mgr(b1), key(), { displayName: 'Growth Mandi', primaryColor: '#195a34' }, IP)).status).toBe('draft');
    expect(c.coverage.find((x) => x.code === 'certificates')!.state).toBe('not_yet');
    expect(c.coverage.find((x) => x.code === 'sms_sender')!.state).toBe('dlt_registered');
  });

  it('BRAND · draft save is direct and audited before → after; every invalid field refused; kv_app cannot be born published', async () => {
    const s1 = await brand.saveDraft(A, mgr(a1), key(), { displayName: 'Anand FPO Mandi', appShortName: 'Anand Mandi', reason: 'first design' }, IP);
    expect(s1).toMatchObject({ status: 'draft', draftRevision: 1 });
    const s2 = await brand.saveDraft(A, mgr(a1), key(), { accentColor: '#CC810B' }, IP);
    expect(s2.diff).toEqual([{ field: 'accentColor', before: '#f39c12', after: '#cc810b' }]);
    const au = (await admin.query(`SELECT old_value, new_value, reason, ip FROM audit_log WHERE tenant_id=$1 AND action='tenancy.brand_draft_saved' ORDER BY created_at`, [A])).rows;
    expect(au).toHaveLength(2);
    expect(au[0].old_value).toMatchObject({ values: null });
    expect(au[0]).toMatchObject({ reason: 'first design', ip: IP });
    expect(au[1].old_value.values.colours.accent).toBe('#f39c12'); expect(au[1].new_value.values.colours.accent).toBe('#cc810b');
    const bad = await errOf(brand.saveDraft(A, mgr(a1), key(), { displayName: 'x', primaryColor: 'url(javascript:1)', inkColor: '#12345' }, IP));
    expect(bad.code).toBe('BRAND_DRAFT_INVALID');
    expect(bad.details.refusals.map((r: any) => `${r.field}:${r.code}`)).toEqual(['displayName:BRAND_NAME_TOO_SHORT', 'primaryColor:BRAND_COLOUR_INVALID', 'inkColor:BRAND_COLOUR_INVALID']);
    expect(await codeOf(brand.saveDraft(A, mgr(a1), key(), { accentColor: '#cc810b' }, IP))).toBe('BRAND_UNCHANGED');
    await asApp(C, c1, async (probe) => {
      expect(await probe(`INSERT INTO tenant_branding (tenant_id, display_name, app_short_name, primary_color, accent_color, ink_color, surface_color, version, status, published_at, published_by, checker_user_id)
                          VALUES ($1,'Solo','Solo','#1e6f3f','#f39c12','#232a33','#ffffff',1,'published',now(),$2,$3)`, [C, c1, a1])).toBe('23514:BRAND_BORN_DRAFT');
      expect(await probe(`INSERT INTO tenant_branding (tenant_id, display_name, app_short_name, primary_color, accent_color, ink_color, surface_color)
                          VALUES ($1,'Solo','Solo','red','#f39c12','#232a33','#ffffff')`, [C])).toMatch(/^23514:/);
    });
    await asApp(A, a1, async (probe) => {
      expect(await probe(`UPDATE tenant_branding SET version=1, status='published', published_at=now(), published_by=$2, checker_user_id=$3 WHERE tenant_id=$1`, [A, a1, a2]))
        .toBe('23514:BRAND_PUBLISH_NEEDS_CHECKER');
      expect(await probe(`DELETE FROM tenant_branding WHERE tenant_id=$1`, [A])).toBe('42501:');
    });
  });

  it('BRAND · a script-bearing SVG is refused by name and NOTHING is stored; a clean PNG is stored pending the antivirus scan', async () => {
    const evil = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><script>alert(1)</script><rect width="9" height="9" onclick="x()"/></svg>');
    const e = await errOf(brand.uploadLogo(A, mgr(a1), key(), evil, 'image/svg+xml', IP));
    expect(e.code).toBe('LOGO_SVG_UNSAFE');
    expect(e.details.found).toEqual(expect.arrayContaining(['element:script', 'attribute:onclick']));
    expect(store.puts).toBe(0);
    expect((await admin.query(`SELECT count(*)::int n FROM media_assets WHERE tenant_id=$1`, [A])).rows[0].n).toBe(0);
    expect(await codeOf(brand.uploadLogo(A, mgr(a1), key(), png(100, 300), 'image/png', IP))).toBe('LOGO_NOT_SQUARE_OR_WIDE');
    const up = await brand.uploadLogo(A, mgr(a1), key(), png(512, 256), 'image/png', IP);
    expect(up).toMatchObject({ mime: 'image/png', width: 512, height: 256, state: 'pending_scan' });
    logoId = up.mediaId;
    const m = (await admin.query(`SELECT kind, mime_type, scan_status, s3_key FROM media_assets WHERE id=$1`, [logoId])).rows[0];
    expect(m).toMatchObject({ kind: 'image', mime_type: 'image/png', scan_status: 'pending' });
    expect(store.objects.get(m.s3_key)!.type).toBe('image/png');
    // not clean yet: the console preview withholds it, and a publish is refused by name
    expect(await codeOf(brand.draftLogo(A, mgr(a1), logoId))).toBe('BRAND_LOGO_NOT_READY');
    const pr = await errOf(brand.propose(A, mgr(a1), key(), { reason: WHY }, IP));
    expect(pr.code).toBe('BRAND_PUBLISH_REFUSED');
    expect(pr.details.refusals).toEqual([{ field: 'logoMediaId', code: 'BRAND_LOGO_NOT_READY', detail: { state: 'pending_scan' } }]);
    await scanClean(logoId);
    expect((await brand.draftLogo(A, mgr(a1), logoId)).mime).toBe('image/png');
  });

  it('BRAND · publish is refused on a 4.4:1 pair NAMING it — and the database\'s own floor stands under the service', async () => {
    await brand.saveDraft(A, mgr(a1), key(), { primaryColor: '#787878' }, IP);
    const e = await errOf(brand.propose(A, mgr(a1), key(), { reason: WHY }, IP));
    expect(e.code).toBe('BRAND_CONTRAST_FAILED');
    expect(e.details.failing[0]).toMatchObject({ pair: 'primary_on_surface', display: '4.4:1' });
    expect(e.details.failing.map((f: any) => f.pair)).toEqual(['primary_on_surface', 'surface_on_primary']);
    expect(e.message).toContain('primary_on_surface 4.4:1');
    expect((await admin.query(`SELECT count(*)::int n FROM tenant_branding_proposals WHERE tenant_id=$1`, [A])).rows[0].n).toBe(0);
    // the review says the same thing before anyone presses Publish
    const pv = await brand.preview(A, mgr(a1), { displayName: 'Anand FPO Mandi 2' });
    expect(pv.contrast.passes).toBe(false); expect(pv.publishChecks.map((r) => r.code)).toContain('BRAND_CONTRAST_FAILED');
    await asApp(A, a1, async (probe) => {
      expect(await probe(`INSERT INTO tenant_branding_proposals (tenant_id, kind, publishes_version, display_name, app_short_name, logo_media_id, logo_mime, primary_color, accent_color,
                            ink_color, surface_color, powered_by_hidden, contrast, contrast_min, draft_revision, reason, proposed_by, proposed_at, expires_at)
                          VALUES ($1,'publish',1,'X','X',$2,'image/png','#787878','#f39c12','#232a33','#ffffff',false,'{}',4.415,1,$3,$4, now(), now() + interval '7 days')`,
        [A, logoId, WHY, a1])).toBe('23514:ck_tbp_contrast_floor');
    });
    await brand.saveDraft(A, mgr(a1), key(), { primaryColor: '#1e6f3f' }, IP);
  });

  it('BRAND · a one-admin tenant is told it needs a second administrator', async () => {
    await brand.saveDraft(C, mgr(c1), key(), { displayName: 'Solo Mandi' }, IP);
    const up = await brand.uploadLogo(C, mgr(c1), key(), png(64, 64), 'image/png', IP); await scanClean(up.mediaId);
    expect(await codeOf(brand.propose(C, mgr(c1), key(), { reason: WHY }, IP))).toBe('NEEDS_SECOND_ADMIN');
  });

  let p1 = '';
  it('BRAND · the MAKER\'s confirm is refused by the TRIGGER (service and raw SQL); a second proposal waits', async () => {
    expect(await codeOf(brand.propose(A, mgr(a1), key(), { reason: 'too short' }, IP))).toBe('BRAND_PUBLISH_REFUSED');
    const p = await brand.propose(A, mgr(a1), key(), { reason: WHY }, IP);
    p1 = p.id;
    expect(p).toMatchObject({ status: 'proposed', kind: 'publish', publishesVersion: 1, youProposed: true, canConfirm: false });
    expect(await codeOf(brand.propose(A, mgr(a2), key(), { reason: WHY }, IP))).toBe('BRAND_PROPOSAL_LIVE');
    expect(await codeOf(brand.confirm(A, mgr(a1), key(), p1, IP))).toBe('CHECKER_IS_MAKER');
    await asApp(A, a1, async (probe) => {
      expect(await probe(`UPDATE tenant_branding_proposals SET status='confirmed', confirmed_by=$2, confirmed_at=now() WHERE id=$1`, [p1, a1])).toBe('23514:BRAND_CHECKER_IS_MAKER');
    });
    expect((await brand.console(A, mgr(a1))).published).toBeNull();
  });

  it('BRAND · a SECOND admin publishes: version, history, tenants.display_name / logo_url in sync, audit, the member notice, the locked logo', async () => {
    const r = await brand.confirm(A, mgr(a2), key(), p1, IP);
    expect(r).toMatchObject({ version: 1, kind: 'publish', membersSeeIt: 'next_app_open', logoUrl: `https://api.krishalaya.app/v1/storefront/branding/logo/${A}/1` });
    expect(r.noticeRecipients).toBeGreaterThanOrEqual(3);
    const tb = (await admin.query(`SELECT version, status, published_by, checker_user_id FROM tenant_branding WHERE tenant_id=$1`, [A])).rows[0];
    expect(tb).toEqual({ version: 1, status: 'published', published_by: a1, checker_user_id: a2 });
    const h = (await admin.query(`SELECT version, kind, display_name, accent_color, proposed_by, confirmed_by, reason, contrast_min FROM tenant_branding_history WHERE tenant_id=$1`, [A])).rows;
    expect(h).toEqual([{ version: 1, kind: 'publish', display_name: 'Anand FPO Mandi', accent_color: '#cc810b', proposed_by: a1, confirmed_by: a2, reason: WHY, contrast_min: expect.any(String) }]);
    const t = (await admin.query(`SELECT display_name, logo_url FROM tenants WHERE id=$1`, [A])).rows[0];
    expect(t).toEqual({ display_name: 'Anand FPO Mandi', logo_url: `https://api.krishalaya.app/v1/storefront/branding/logo/${A}/1` });
    const au = (await admin.query(`SELECT actor_user_id, old_value, new_value, reason FROM audit_log WHERE tenant_id=$1 AND action='tenancy.brand_published'`, [A])).rows[0];
    expect(au.actor_user_id).toBe(a2); expect(au.reason).toBe(WHY);
    expect(au.old_value).toMatchObject({ version: 0, tenants: { displayName: 'Anand FPO 13d', logoUrl: null } });
    expect(au.new_value).toMatchObject({ version: 1, proposedBy: a1, confirmedBy: a2, tenants: { displayName: 'Anand FPO Mandi' } });
    const ev = (await admin.query(`SELECT payload FROM outbox_events WHERE tenant_id=$1 AND event_type='tenancy.brand_published'`, [A])).rows[0].payload;
    expect(ev).toMatchObject({ version: 1, displayName: 'Anand FPO Mandi' });
    expect(ev.recipientUserIds).toEqual(expect.arrayContaining([farmerA, a1, a2]));
    // the in-app copy exists in three languages (seed 0007) and is mapped (communication's event map)
    const tpl = (await admin.query(`SELECT language_code FROM notification_templates WHERE event_code='tenant.brand_published' AND channel='inapp' ORDER BY 1`)).rows.map((x) => x.language_code);
    expect(tpl).toEqual(['en', 'gu', 'hi']);
    // the storefront's read: the PUBLISHED version (never the draft)
    const pub = await slugs.getBranding(A);
    expect(pub!.brand).toMatchObject({ version: 1, displayName: 'Anand FPO Mandi', appShortName: 'Anand Mandi', logoMime: 'image/png', colours: { accent: '#cc810b' } });
    const logo = await brand.publicLogo(A, 1);
    expect(logo!.mime).toBe('image/png'); expect(logo!.bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(await brand.publicLogo(A, 2)).toBeNull();
    expect((await brand.console(A, mgr(a1))).membersSee).toBe('published_brand');
  });

  it('BRAND · once published, the name members see has ONE writer: the profile edit and a raw kv_app write are refused', async () => {
    expect(await codeOf(tenants.updateProfile(A, mgr(a1), key(), { displayName: 'Sneaky Rename' } as never, IP))).toBe('TENANT_NAME_IS_BRAND');
    await asApp(A, a1, async (probe) => {
      expect(await probe(`UPDATE tenants SET logo_url='https://evil.example/x.png' WHERE id=$1`, [A])).toBe('23514:TENANT_LOGO_IS_BRAND');
      expect(await probe(`UPDATE tenants SET display_name='Sneaky' WHERE id=$1`, [A])).toBe('23514:TENANT_NAME_IS_BRAND');
      expect(await probe(`INSERT INTO tenant_branding_history (tenant_id, version, kind, display_name, app_short_name, logo_media_id, logo_mime, primary_color, accent_color, ink_color,
                            surface_color, powered_by_hidden, contrast, contrast_min, proposal_id, proposed_by, confirmed_by, reason)
                          VALUES ($1, 9, 'publish', 'X', 'X', $2, 'image/png', '#1e6f3f', '#f39c12', '#232a33', '#ffffff', false, '{}', 6, $3, $4, $5, $6)`,
        [A, logoId, p1, a1, a2, WHY])).toBe('23514:BRAND_PUBLISH_NEEDS_CHECKER');
    });
    // a tenant with no published brand keeps its pre-13d profile edit
    await tenants.updateProfile(D, mgr(d1), key(), { displayName: 'Rival FPO Renamed' } as never, IP);
  });

  it('BRAND · rollback re-publishes a history version through the SAME checker path; µs history paging', async () => {
    await brand.saveDraft(A, mgr(a1), key(), { accentColor: '#f7b32b', displayName: 'Anand Mandi Two' }, IP);
    expect((await brand.console(A, mgr(a1))).draft.status).toBe('draft');
    const p2 = await brand.propose(A, mgr(a2), key(), { reason: WHY }, IP);
    await brand.confirm(A, mgr(a1), key(), p2.id, IP);
    expect((await admin.query(`SELECT display_name FROM tenants WHERE id=$1`, [A])).rows[0].display_name).toBe('Anand Mandi Two');
    expect(await codeOf(brand.proposeRollback(A, mgr(a1), key(), { version: 2, reason: WHY }, IP))).toBe('BRAND_ROLLBACK_CURRENT');
    const rb = await brand.proposeRollback(A, mgr(a1), key(), { version: 1, reason: 'Members found version two hard to read on old phones' }, IP);
    expect(rb).toMatchObject({ kind: 'rollback', rollbackTo: 1, publishesVersion: 3 });
    expect(await codeOf(brand.confirm(A, mgr(a1), key(), rb.id, IP))).toBe('CHECKER_IS_MAKER');
    const done = await brand.confirm(A, mgr(a2), key(), rb.id, IP);
    expect(done).toMatchObject({ version: 3, kind: 'rollback' });
    const h3 = (await admin.query(`SELECT kind, rolled_back_to, display_name, accent_color FROM tenant_branding_history WHERE tenant_id=$1 AND version=3`, [A])).rows[0];
    expect(h3).toEqual({ kind: 'rollback', rolled_back_to: 1, display_name: 'Anand FPO Mandi', accent_color: '#cc810b' });
    const working = (await admin.query(`SELECT display_name, accent_color, status, version FROM tenant_branding WHERE tenant_id=$1`, [A])).rows[0];
    expect(working).toEqual({ display_name: 'Anand FPO Mandi', accent_color: '#cc810b', status: 'published', version: 3 });
    expect((await admin.query(`SELECT display_name FROM tenants WHERE id=$1`, [A])).rows[0].display_name).toBe('Anand FPO Mandi');
    expect((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND action='tenancy.brand_rolled_back'`, [A])).rows[0].n).toBe(1);
    // µs keyset: the three versions page exactly once at limit 2
    const pg1 = await brand.history(A, mgr(a1), { limit: 2 });
    const pg2 = await brand.history(A, mgr(a1), { limit: 2, cursor: pg1.nextCursor! });
    expect([...pg1.items, ...pg2.items].map((x) => x.version)).toEqual([3, 2, 1]);
    expect(pg2.nextCursor).toBeNull();
    expect(pg1.items[0].current).toBe(true);
  });

  it('BRAND · Powered-by: removable ONLY with white_label_unbranded (read for real), NEVER on trust surfaces', async () => {
    expect(await codeOf(brand.saveDraft(B, mgr(b1), key(), { poweredByHidden: true }, IP))).toBe('BRAND_DRAFT_INVALID');
    const e = await errOf(brand.saveDraft(B, mgr(b1), key(), { poweredByHidden: true }, IP));
    expect(e.details.refusals).toEqual([{ field: 'poweredByHidden', code: 'POWERED_BY_PLAN_REQUIRED', detail: { feature: 'white_label_unbranded' } }]);
    await brand.saveDraft(A, mgr(a1), key(), { poweredByHidden: true }, IP);
    const p = await brand.propose(A, mgr(a1), key(), { reason: WHY }, IP);
    await brand.confirm(A, mgr(a2), key(), p.id, IP);
    expect((await slugs.getBranding(A))?.brand).toBeTruthy();
    const fresh = new TenantSlugResolver(pools);   // a fresh cache
    expect((await fresh.getBranding(A))!.brand!.poweredByHidden).toBe(true);
    // the plan lapses → the mark comes back by itself (read at render time, never stored as a permission)
    await admin.query(`UPDATE plan_features SET is_included=false WHERE feature_code='white_label_unbranded' AND plan_id=(SELECT plan_id FROM subscriptions WHERE tenant_id=$1 AND deleted_at IS NULL LIMIT 1)`, [A]);
    expect((await new TenantSlugResolver(pools).getBranding(A))!.brand!.poweredByHidden).toBe(false);
    await admin.query(`UPDATE plan_features SET is_included=true WHERE feature_code='white_label_unbranded' AND plan_id=(SELECT plan_id FROM subscriptions WHERE tenant_id=$1 AND deleted_at IS NULL LIMIT 1)`, [A]);
    for (const s of TRUST_SURFACES) expect(showsPoweredBy(s, true, true)).toBe(true);
    expect(showsPoweredBy('storefront', true, true)).toBe(false);
  });

  /* ==================================================================================================================== */
  /* DOMAINS                                                                                                              */
  /* ==================================================================================================================== */

  it('DOMAINS · a new tenant is born with its included subdomain — verified, primary, permanent, TLS honest (and the wildcard switch)', async () => {
    const T = randomUUID(); await makeTenant(admin, T, 'Brand New FPO');
    const inc = await includedOf(T);
    expect(inc).toMatchObject({ kind: 'included', is_primary: true, verification_status: 'verified', tls_status: 'pending', tls_note: 'platform wildcard certificate not yet configured', verification_token: null });
    expect(inc.domain).toMatch(/^t[0-9a-f]{20}\.krishalaya\.app$/);
    // the platform installs the wildcard certificate → the next sweep marks the included row issued; withdrawn → pending again
    await admin.query(`INSERT INTO platform_setting_values (key, value, set_by_admin_id, reason) VALUES ('platform.wildcard_tls_ready', 'true', $1, 'wildcard certificate installed at the edge (test)')
                       ON CONFLICT (key) DO UPDATE SET value='true', deleted_at=NULL`, [randomUUID()]);
    try {
      expect((await domains.sweepTenant(T)).tlsSynced).toBe(1);
      expect((await includedOf(T)).tls_status).toBe('issued');
    } finally { await admin.query(`DELETE FROM platform_setting_values WHERE key='platform.wildcard_tls_ready'`); }
    await domains.sweepTenant(T);
    expect(await includedOf(T)).toMatchObject({ tls_status: 'pending', tls_note: 'platform wildcard certificate not yet configured' });
    await asApp(T, null, async (probe) => {
      expect(await probe(`UPDATE tenant_domains SET deleted_at=now(), deleted_by=$2, delete_reason='x' WHERE id=$1`, [inc.id, a1])).toBe('23514:DOMAIN_CHANGE_NEEDS_CHECKER');
      expect(await probe(`INSERT INTO tenant_domains (tenant_id, domain, kind, is_primary, verification_status, verified_at) VALUES ($1,'second.krishalaya.app','included',false,'verified',now())`, [T]))
        .toBe('23514:DOMAIN_INCLUDED_BY_PLATFORM');
    });
  });

  it('DOMAINS · reads gated (F-12); the plan gate first; reserved names refused by the service AND the trigger', async () => {
    expect(await codeOf(domains.list(A, { userId: farmerA, canManage: false }, { limit: 10 }))).toBe('TENANT_FORBIDDEN');
    const list = await domains.list(B, mgr(b1), { limit: 10 });
    expect(list.plan.customDomain).toBe(false); expect(list.items.map((i) => i.kind)).toEqual(['included']);
    expect(list.tls).toEqual({ customIssuance: 'not_built', note: 'certificate issuance not yet built (own infrastructure wave)' });
    expect(await codeOf(domains.add(B, mgr(b1), key(), { domain: 'mandi.growth.in', reason: 'our own address' }, IP))).toBe('PLAN_FEATURE_REQUIRED');
    expect((await admin.query(`SELECT count(*)::int n FROM tenant_domains WHERE tenant_id=$1 AND kind='custom'`, [B])).rows[0].n).toBe(0);
    for (const [d, problem] of [['mandi.krishalaya.com', 'reserved:krishalaya'], ['shop.krishalaya.app', 'included_suffix'], ['api.anandfpo.in', 'reserved:api'], ['edge.krishalaya.app', 'included_suffix']]) {
      const e = await errOf(domains.add(A, mgr(a1), key(), { domain: d, reason: 'our own address' }, IP));
      expect({ d, code: e.code, problem: e.details.problem }).toEqual({ d, code: 'DOMAIN_RESERVED', problem });
    }
    const pv = await domains.previewAdd(B, mgr(b1), { domain: 'Mandi.Growth.in.', reason: 'our own address' });
    expect(pv.refusals.map((r) => r.code)).toEqual(['PLAN_FEATURE_REQUIRED']);
    expect(pv.domain).toBe('mandi.growth.in');
    expect(pv.records[0]).toEqual({ type: 'CNAME', name: 'mandi.growth.in', value: EDGE });
    await asApp(A, a1, async (probe) => {
      expect(await probe(`INSERT INTO tenant_domains (tenant_id, domain, kind, verification_token, expires_at) VALUES ($1,'x.krishalaya.in','custom',$2, now() + interval '7 days')`,
        [A, 'a'.repeat(32)])).toBe('23514:DOMAIN_RESERVED');
    });
  });

  let mandi = { id: '', token: '' };
  it('DOMAINS · add a custom claim: pending, a 32-hex token, the exact records, 7 days; idempotent; audited with the reason', async () => {
    const k = key();
    const d = await domains.add(A, mgr(a1), k, { domain: 'Mandi.AnandFPO.in', reason: 'the address on our printed receipts' }, IP);
    expect(d).toMatchObject({ domain: 'mandi.anandfpo.in', kind: 'custom', isPrimary: false, tls: { status: 'pending' }, verification: { status: 'pending', checksEvery: '5 minutes' } });
    expect(d.verification.token).toMatch(/^[0-9a-f]{32}$/);
    expect(d.verification.records).toEqual([{ type: 'CNAME', name: 'mandi.anandfpo.in', value: EDGE }, { type: 'TXT', name: '_krishalaya-verify.mandi.anandfpo.in', value: d.verification.token }]);
    const span = Date.parse(d.verification.expiresAt!) - Date.now();
    expect(span).toBeGreaterThan(6.9 * 86_400_000); expect(span).toBeLessThan(7.01 * 86_400_000);
    mandi = { id: d.id, token: d.verification.token! };
    expect((await domains.add(A, mgr(a1), k, { domain: 'Mandi.AnandFPO.in', reason: 'the address on our printed receipts' }, IP)).id).toBe(d.id);
    expect(await codeOf(domains.add(A, mgr(a1), key(), { domain: 'mandi.anandfpo.in', reason: 'again' }, IP))).toBe('DOMAIN_ALREADY_YOURS');
    const au = (await admin.query(`SELECT reason, ip FROM audit_log WHERE tenant_id=$1 AND action='tenancy.tenant_domain_added' AND entity_id=$2`, [A, d.id])).rows[0];
    expect(au).toEqual({ reason: 'the address on our printed receipts', ip: IP });
  });

  it('DOMAINS · a pending claim by another tenant does NOT block; the first VERIFIED wins; the loser fails in words', async () => {
    const rival = await domains.add(D, mgr(d1), key(), { domain: 'mandi.anandfpo.in', reason: 'we think this is ours' }, IP);
    expect(rival.verification.status).toBe('pending');
    // wrong TXT → failed, in words
    dns.answers.set('mandi.anandfpo.in', proof('mandi.anandfpo.in', 'f'.repeat(32)));
    expect(await domains.verifyOne(A, mandi.id)).toBe('failed');
    expect((await domainRow(A, 'mandi.anandfpo.in')).check_error).toBe('TXT at _krishalaya-verify.mandi.anandfpo.in does not contain the verification token');
    expect(dns.asked.at(-1)!.resolvers).toEqual(['1.1.1.1', '8.8.8.8']);   // pinned to the platform resolvers
    // the right records → verified (never anything less); TLS stays pending and says why
    dns.answers.set('mandi.anandfpo.in', proof('mandi.anandfpo.in', mandi.token));
    expect(await domains.verifyOne(A, mandi.id)).toBe('verified');
    const row = await domainRow(A, 'mandi.anandfpo.in');
    expect(row).toMatchObject({ verification_status: 'verified', tls_status: 'pending', tls_note: 'certificate issuance not yet built (own infrastructure wave)', check_error: null });
    // the rival's claim cannot be proven any more (its TXT would carry its own token; even with it, A won)
    dns.answers.set('mandi.anandfpo.in', proof('mandi.anandfpo.in', rival.verification.token!));
    expect(await domains.verifyOne(D, rival.id)).toBe('failed');
    expect((await domainRow(D, 'mandi.anandfpo.in')).check_error).toContain('another organisation proved this domain first');
    // a new claim on a domain already verified elsewhere is refused at add — by name
    expect(await codeOf(domains.add(D, mgr(d1), key(), { domain: 'MANDI.anandfpo.in', reason: 'second try' }, IP))).toBe('DOMAIN_CLAIMED_ELSEWHERE');
  });

  it('DOMAINS · no fake verified, no fake issued, no delete — from kv_app directly', async () => {
    const c = await domains.add(A, mgr(a1), key(), { domain: 'shop.anandfpo.in', reason: 'the shop address' }, IP);
    await asApp(A, a1, async (probe) => {
      expect(await probe(`UPDATE tenant_domains SET verification_status='verified', verified_at=now(), last_checked_at=now() WHERE id=$1`, [c.id])).toBe('23514:DOMAIN_VERIFY_BY_DNS_ONLY');
      expect(await probe(`UPDATE tenant_domains SET tls_status='issued' WHERE id=$1`, [mandi.id])).toBe('23514:DOMAIN_TLS_NOT_BUILT');
      expect(await probe(`DELETE FROM tenant_domains WHERE id=$1`, [c.id])).toBe('42501:');
      expect(await probe(`UPDATE tenant_domains SET is_primary=true WHERE id=$1`, [mandi.id])).toBe('23514:DOMAIN_CHANGE_NEEDS_CHECKER');
    });
  });

  it('DOMAINS · an unproven claim past 7 days EXPIRES and is RELEASED — the name is free again', async () => {
    const c = await domains.add(A, mgr(a1), key(), { domain: 'old.anandfpo.in', reason: 'an address we stopped using' }, IP);
    await admin.query(`UPDATE tenant_domains SET expires_at = now() - interval '1 minute' WHERE id=$1`, [c.id]);   // time travel (owner role)
    expect(await domains.verifyOne(A, c.id)).toBe('expired');
    const row = (await admin.query(`SELECT verification_status, deleted_at IS NOT NULL AS released FROM tenant_domains WHERE id=$1`, [c.id])).rows[0];
    expect(row).toEqual({ verification_status: 'expired', released: true });
    expect((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE entity_id=$1 AND action='tenancy.tenant_domain_released'`, [c.id])).rows[0].n).toBe(1);
    // released → the same tenant (or another) can claim it afresh
    const again = await domains.add(D, mgr(d1), key(), { domain: 'old.anandfpo.in', reason: 'now it is ours' }, IP);
    expect(again.verification.status).toBe('pending');
  });

  it('DOMAINS · Host → tenant ONLY on a verified row (pending / unknown → 404; a suspended tenant → 404; F-24 on X-Tenant-Id)', async () => {
    const flags = { isEnabled: async (k: string) => k === 'tenant_host_routing' } as never;
    const config = { platformHosts: ['store.krishalaya.app'] } as never;
    const mw = new TenantContextMiddleware({ fromAuthHeader: () => null } as never, slugs, { shardFor: () => 0 } as never, { effectiveAccess: jest.fn() } as never, undefined, flags, config);
    const call = async (host: string, headers: Record<string, string> = {}) => {
      let seen: { tenantId: string } | null = null; let status = 200; let body = '';
      const res = { status: (s: number) => { status = s; return res; }, setHeader: () => res, end: (b: string) => { body = b; } } as never;
      await mw.use({ headers: { host, ...headers }, hostname: host, requestId: 'r' } as never, res, () => { seen = getRequestContext(); });
      return { tenantId: (seen as { tenantId: string } | null)?.tenantId ?? null, status, code: body ? JSON.parse(body).error.code : null };
    };
    expect(await call('mandi.anandfpo.in')).toEqual({ tenantId: A, status: 200, code: null });
    const incA = (await includedOf(A)).domain;
    expect((await call(incA)).tenantId).toBe(A);
    expect(await call('shop.anandfpo.in')).toEqual({ tenantId: null, status: 404, code: 'TENANT_NOT_FOUND' });   // pending claim
    expect(await call('nobody.example.in')).toEqual({ tenantId: null, status: 404, code: 'TENANT_NOT_FOUND' });
    // a Host request cannot be steered to another tenant by a header
    expect((await call('mandi.anandfpo.in', { 'x-tenant-id': B })).tenantId).toBe(A);
    // platform hosts are never looked up
    expect((await call('127.0.0.1:4000', { 'x-tenant-id': B })).tenantId).toBe(B);
    expect((await call('store.krishalaya.app')).tenantId).toBe('');
    // the status filter (F-24) on the Host path AND the header path
    const incE = (await includedOf(E)).domain;
    expect((await call(incE)).tenantId).toBe(E);
    await admin.query(`UPDATE tenants SET status='suspended' WHERE id=$1`, [E]);
    const fresh = new TenantSlugResolver(pools);
    const mw2 = new TenantContextMiddleware({ fromAuthHeader: () => null } as never, fresh, { shardFor: () => 0 } as never, { effectiveAccess: jest.fn() } as never, undefined, flags, config);
    let status = 200; let seen: string | null = null;
    const res = { status: (s: number) => { status = s; return res; }, setHeader: () => res, end: () => undefined } as never;
    await mw2.use({ headers: { host: incE }, hostname: incE, requestId: 'r' } as never, res, () => { seen = getRequestContext().tenantId; });
    expect({ status, seen }).toEqual({ status: 404, seen: null });
    await mw2.use({ headers: { host: '127.0.0.1', 'x-tenant-id': E }, hostname: '127.0.0.1', requestId: 'r' } as never, res, () => { seen = getRequestContext().tenantId; });
    expect(seen).toBe('');
    // routing OFF (the default): Host is never consulted
    const off = new TenantContextMiddleware({ fromAuthHeader: () => null } as never, fresh, { shardFor: () => 0 } as never, { effectiveAccess: jest.fn() } as never, undefined, { isEnabled: async () => false } as never, config);
    await off.use({ headers: { host: 'nobody.example.in' }, hostname: 'nobody.example.in', requestId: 'r' } as never, res, () => { seen = getRequestContext().tenantId; });
    expect(seen).toBe('');
  });

  let mkPrimary = '';
  it('DOMAINS · make primary only when verified, with a checker (maker refused by the trigger); the 301 waits for a certificate', async () => {
    const shop = await domainRow(A, 'shop.anandfpo.in');
    const e = await errOf(domains.propose(A, mgr(a1), key(), { kind: 'make_primary', domainId: shop.id, reason: WHY }, IP));
    expect(e.code).toBe('DOMAIN_NOT_VERIFIED');
    expect(await codeOf(domains.propose(A, mgr(a1), key(), { kind: 'make_primary', domainId: mandi.id, reason: 'short' }, IP))).toBe('DOMAIN_REASON_INVALID');
    const p = await domains.propose(A, mgr(a1), key(), { kind: 'make_primary', domainId: mandi.id, reason: WHY }, IP);
    mkPrimary = p.id;
    expect(await codeOf(domains.confirm(A, mgr(a1), key(), p.id, IP))).toBe('CHECKER_IS_MAKER');
    const done = await domains.confirm(A, mgr(a2), key(), p.id, IP);
    expect(done).toMatchObject({ status: 'confirmed', kind: 'make_primary', domain: 'mandi.anandfpo.in' });
    expect((await domainRow(A, 'mandi.anandfpo.in')).is_primary).toBe(true);
    expect((await includedOf(A)).is_primary).toBe(false);
    const au = (await admin.query(`SELECT old_value, new_value, reason FROM audit_log WHERE tenant_id=$1 AND action='tenancy.tenant_domain_primary_changed'`, [A])).rows[0];
    expect(au.old_value.primary).toBe((await includedOf(A)).domain); expect(au.new_value).toMatchObject({ primary: 'mandi.anandfpo.in', proposedBy: a1, confirmedBy: a2 });
    // the included subdomain would 301 to the primary — but the primary has no certificate (ACME not built): said, not done
    const r = await new TenantSlugResolver(pools).resolveHost((await includedOf(A)).domain);
    expect(hostDecision((await includedOf(A)).domain, r.value)).toEqual({ tenant: { slug: expect.any(String) }, redirectTo: null, redirectBlockedBy: 'primary_certificate_not_issued' });
  });

  it('DOMAINS · removing a PRIMARY needs a named successor; the included subdomain is permanent; removal is a soft delete', async () => {
    expect(await codeOf(domains.propose(A, mgr(a1), key(), { kind: 'remove', domainId: mandi.id, reason: WHY }, IP))).toBe('DOMAIN_SUCCESSOR_REQUIRED');
    const shop = await domainRow(A, 'shop.anandfpo.in');
    expect(await codeOf(domains.propose(A, mgr(a1), key(), { kind: 'remove', domainId: mandi.id, successorDomainId: shop.id, reason: WHY }, IP))).toBe('DOMAIN_SUCCESSOR_NOT_VERIFIED');
    const inc = await includedOf(A);
    expect(await codeOf(domains.propose(A, mgr(a1), key(), { kind: 'remove', domainId: inc.id, reason: WHY }, IP))).toBe('DOMAIN_INCLUDED_PERMANENT');
    const p = await domains.propose(A, mgr(a2), key(), { kind: 'remove', domainId: mandi.id, successorDomainId: inc.id, reason: WHY }, IP);
    await domains.confirm(A, mgr(a1), key(), p.id, IP);
    const gone = (await admin.query(`SELECT deleted_at IS NOT NULL AS removed, deleted_by, delete_reason, is_primary FROM tenant_domains WHERE id=$1`, [mandi.id])).rows[0];
    expect(gone).toEqual({ removed: true, deleted_by: a1, delete_reason: WHY, is_primary: false });
    expect((await includedOf(A)).is_primary).toBe(true);
    // a non-primary remove needs no successor
    const p2 = await domains.propose(A, mgr(a1), key(), { kind: 'remove', domainId: shop.id, reason: WHY }, IP);
    expect(await codeOf(domains.refuse(A, mgr(a2), key(), p2.id, 'no', IP))).toBe('DOMAIN_REASON_INVALID');
    expect((await domains.refuse(A, mgr(a2), key(), p2.id, 'we still print it', IP)).status).toBe('refused');
  });

  it('DOMAINS · re-check now: once a minute', async () => {
    const shop = await domainRow(A, 'shop.anandfpo.in');
    const r1 = await domains.recheck(A, mgr(a1), shop.id, IP);
    expect(r1.outcome).toBe('failed');
    expect(r1.domain!.verification.error).toContain('CNAME for shop.anandfpo.in: no such record');
    const e = await errOf(domains.recheck(A, mgr(a1), shop.id, IP));
    expect(e.code).toBe('DOMAIN_RECHECK_TOO_SOON'); expect(e.details.retryAfterSec).toBeGreaterThan(0);
  });

  it('DOMAINS · µs keyset: claims written in ONE transaction page exactly once', async () => {
    await admin.query(`INSERT INTO tenant_domains (tenant_id, domain, kind, verification_token, expires_at)
                       SELECT $1, 'p' || g || '.paging-anand.in', 'custom', md5(random()::text), now() + interval '7 days' FROM generate_series(1, 5) g`, [D]);
    const seen: string[] = []; let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await domains.list(D, mgr(d1), { limit: 2, cursor });
      seen.push(...page.items.map((x) => x.domain));
      if (!page.nextCursor) break; cursor = page.nextCursor;
    }
    const paging = seen.filter((d) => d.endsWith('.paging-anand.in'));
    expect(paging.sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'].map((p) => `${p}.paging-anand.in`));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('CLOCK · brand and domain proposals unconfirmed for 7 days expire; the verifier job sweeps through the registered class', async () => {
    const bp = await brand.saveDraft(A, mgr(a1), key(), { appShortName: 'Anand M' }, IP);
    expect(bp.status).toBe('draft');
    const prop = await brand.propose(A, mgr(a1), key(), { reason: WHY }, IP);
    await admin.query(`ALTER TABLE tenant_branding_proposals DISABLE TRIGGER trg_tbp_moves`);
    try { await admin.query(`UPDATE tenant_branding_proposals SET proposed_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id=$1`, [prop.id]); }
    finally { await admin.query(`ALTER TABLE tenant_branding_proposals ENABLE TRIGGER trg_tbp_moves`); }
    const job = new BrandDomainProposalsJob(60_000, uow, brandRepo, domainRepo, brand, domains);
    const r = await job.sweep(admin);
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect((await admin.query(`SELECT status FROM tenant_branding_proposals WHERE id=$1`, [prop.id])).rows[0].status).toBe('expired');
    const vj = new DomainVerificationJob(60_000, domainRepo, domains);
    const v = await vj.sweep(admin);
    expect(v.errors).toBe(0);
  });
});
