// apps/web-tenant/src/test/tenant13d-branding-domains.spec.ts · PC-56 TENANT-13d · W191 white-label theming and W192 domains: the pure rules
// the pages print, and their honesty properties.
//   LAW     the live contrast panel uses the SAME law as the API gate (the canon's figures; a 4.4:1 pair fails and is never shown passing);
//   TRUTH   TLS for a custom domain says "certificate issuance not yet built"; the included subdomain's TLS says "wildcard not configured";
//           the coverage list never claims a logo on PDFs or a certificate generator; the plan banner names plans READ from the API;
//   CHAIN   both chains use the shared step vocabulary; every act a row offers is one the API can perform;
//   MIRROR  every refusal code the API can answer has a sentence; every key the pages use exists in en / hi / gu.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  BRAND_REFUSAL_CODES, COVERAGE_CODES, DOMAIN_REFUSAL_CODES, brandRefusalKey, changedFields, coloursFrom, contrastFailuresFrom, coverageKey, coverageMark,
  domainActs, domainRefusalKey, domainsStateKey, failureCodesFrom, formFrom, liveContrast, pageState, pairLine, planBanner, previewVars, statusKey,
  successorCandidates, tlsKey, rollbackHref, domainActHref,
} from '../features/branding/branding';
import { brandDesignerKeys } from '../app/settings/branding/keys';

const SRC = join(__dirname, '..');
const API = join(SRC, '..', '..', 'api', 'src', 'modules', 'tenancy');
function walk(dir: string): string[] { return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); }
const read = (p: string) => readFileSync(p, 'utf8');
const PAGES = walk(join(SRC, 'app', 'settings', 'branding')).filter((f) => /\.(ts|tsx)$/.test(f));

const dom = (o: any) => ({ id: 'd1', domain: 'mandi.anand.in', kind: 'custom', isPrimary: false, tls: { status: 'pending', note: null },
  verification: { status: 'pending', verifiedAt: null, lastCheckedAt: null, error: null, expiresAt: null, token: 'a'.repeat(32), records: [], checksEvery: '5 minutes', recheckAvailableInMs: 0 },
  createdAt: '2026-10-03T00:00:00.000000Z', ...o });

describe('PC-56 TENANT-13d · the contrast panel is the API\'s own law', () => {
  it('the canon figures: primary #1E6F3F on white 6.2:1; accent #F39C12 on ink 6.6:1; AAA normal reported as "needs 7:1"', () => {
    const r = liveContrast(coloursFrom({ primary: '#1E6F3F', accent: '#F39C12', ink: '#232A33', surface: '#FFFFFF' }));
    const by = Object.fromEntries(r.pairs.map((p) => [p.code, p]));
    expect(by.primary_on_surface.display).toBe('6.2:1'); expect(by.accent_on_ink.display).toBe('6.6:1');
    expect(pairLine(by.primary_on_surface)).toMatchObject({ aaKey: 'br.contrast.aaPass', aaaLargeKey: 'br.contrast.aaaLargePass', aaaKey: 'br.contrast.aaaNeeds' });
    expect(r.passes).toBe(true);
  });
  it('a 4.4:1 pair fails the gate and is never printed as passing', () => {
    const r = liveContrast(coloursFrom({ primary: '#787878' }));
    expect(r.passes).toBe(false);
    const p = r.pairs.find((x) => x.code === 'primary_on_surface')!;
    expect(p.display).toBe('4.4:1'); expect(pairLine(p).aaKey).toBe('br.contrast.aaFail');
  });
  it('a half-typed colour never breaks the panel (falls back) and the preview carries exactly four tokens', () => {
    expect(coloursFrom({ primary: '#1e6f', accent: 'red' }).primary).toBe('#1e6f3f');
    expect(Object.keys(previewVars(coloursFrom({})))).toEqual(['--br-primary', '--br-accent', '--br-ink', '--br-surface']);
  });
  it('only what changed travels to the review', () => {
    const before = formFrom({ displayName: 'A', appShortName: 'A', logoMediaId: null, colours: { primary: '#1e6f3f', accent: '#f39c12', ink: '#232a33', surface: '#ffffff' }, poweredByHidden: false });
    expect(changedFields(before, { ...before, accentColor: '#cc810b' })).toEqual({ accentColor: '#cc810b' });
    expect(changedFields(before, before)).toEqual({});
  });
});

describe('PC-56 TENANT-13d · truth on screen', () => {
  it('TLS words: custom → "issuance not yet built"; included → "wildcard not configured"; issued only when the API says issued', () => {
    expect(tlsKey(dom({}))).toBe('dom.tls.pendingNotBuilt');
    expect(tlsKey(dom({ kind: 'included' }))).toBe('dom.tls.pendingWildcard');
    expect(tlsKey(dom({ tls: { status: 'issued', note: null } }))).toBe('dom.tls.issued');
    expect(en['dom.tls.pendingNotBuilt']).toContain('not yet built');
    expect(en['dom.tls.pendingWildcard']).toContain('wildcard certificate not yet configured');
    // the console never prints "issued" for a custom domain on its own say-so: the word comes only from the API's status
    for (const f of PAGES) expect(read(f)).not.toMatch(/tls[^\n]*['"]issued['"]\s*[:?]/);
  });
  it('coverage: every line has its sentence; certificates are "not yet"; PDFs print the name, never a claimed logo', () => {
    const states: Record<string, string[]> = { member_app: ['live', 'after_publish'], statements_invoices: ['name_only', 'after_publish'], certificates: ['not_yet'],
      custom_domain: ['see_domains'], powered_by: ['stays', 'removable'], trust_surfaces: ['platform_marks'], sms_sender: ['dlt_registered'] };
    for (const c of COVERAGE_CODES) for (const s of states[c]) for (const cat of [en, hi, gu]) expect(cat[coverageKey(c, s)]).toEqual(expect.any(String));
    expect(en['br.cov.certificates.not_yet']).toContain('not yet');
    expect(en['br.cov.statements_invoices.name_only']).toContain('no logo');
    expect(coverageMark('not_yet')).toBe('·'); expect(coverageMark('platform_marks')).toBe('＝'); expect(coverageMark('live')).toBe('✓');
  });
  it('the plan banner names the plans the API read — branding itself is never plan-gated (Rule Zero)', () => {
    const b = planBanner({ planCode: 'growth', branding: { includedOnEveryPlan: true }, customDomain: { enabled: false, plansWith: ['professional'] }, removePoweredBy: { enabled: false, plansWith: ['professional', 'enterprise'] } });
    expect(b).toEqual({ key: 'br.plan.banner', vars: { plan: 'professional / enterprise', current: 'growth' } });
    expect(en['br.plan.banner']).toMatch(/on any plan/);
    expect(planBanner({ planCode: 'professional', branding: { includedOnEveryPlan: true }, customDomain: { enabled: true, plansWith: [] }, removePoweredBy: { enabled: true, plansWith: [] } }).key).toBe('br.plan.allIncluded');
    // no page hard-codes a plan name
    for (const f of PAGES) expect(read(f)).not.toMatch(/['"](Professional|Growth|Starter)['"]/);
  });
  it('the Gujarati preview sample is the canon\'s, in every catalogue', () => {
    for (const cat of [en, hi, gu]) expect(cat['br.preview.sample.gu']).toBe('રમેશ ભાઈ, આજનો મગફળીનો ભાવ ₹6,420');
    expect(en['br.contrast.senior']).toContain('multiplies, never fixes, contrast');
  });
});

describe('PC-56 TENANT-13d · domains rows and states', () => {
  it('acts a row offers: make primary only when verified; re-check while unproven; the included subdomain is never removable', () => {
    const list = { proposals: [] as any[] };
    expect(domainActs(dom({}) as any, list)).toEqual(['recheck', 'remove']);
    expect(domainActs(dom({ verification: { ...dom({}).verification, status: 'verified' } }) as any, list)).toEqual(['make_primary', 'remove']);
    expect(domainActs(dom({ kind: 'included', isPrimary: true, verification: { ...dom({}).verification, status: 'verified' } }) as any, list)).toEqual([]);
    expect(domainActs(dom({}) as any, { proposals: [{ domainId: 'd1', status: 'proposed' }] as any })).toEqual([]);
    expect(statusKey(dom({}) as any)).toBe('dom.status.pending');
  });
  it('states: Subdomain only without the plan; No custom domains yet; successors are verified only', () => {
    expect(domainsStateKey({ plan: { customDomain: false } as any, counts: { total: 1, custom: 0, verified: 1 } })).toBe('dom.state.subdomainOnly');
    expect(domainsStateKey({ plan: { customDomain: true } as any, counts: { total: 1, custom: 0, verified: 1 } })).toBe('dom.state.noCustom');
    const v = (id: string, s: string) => dom({ id, verification: { ...dom({}).verification, status: s } }) as any;
    expect(successorCandidates([v('a', 'verified'), v('b', 'pending'), v('c', 'verified')], 'a').map((d) => d.id)).toEqual(['c']);
  });
  it('page states and links', () => {
    expect(pageState('TENANT_FORBIDDEN', 403)).toBe('restricted'); expect(pageState(undefined, 404)).toBe('flaggedOff'); expect(pageState(undefined, 404, true)).toBe('notFound');
    expect(rollbackHref(2)).toBe('/settings/branding/publish?kind=rollback&version=2');
    expect(domainActHref('remove', 'x')).toBe('/settings/branding/domains/act?kind=remove&domain=x&step=confirm');
  });
});

describe('PC-56 TENANT-13d · mirror of the API and the catalogues', () => {
  it('every refusal code the API raises for brand and domains has a sentence (and the contrast facts survive the URL)', () => {
    const apiSrc = ['services/tenant-branding.service.ts', 'services/tenant-domain.service.ts', 'domain/brand-rules.ts', 'domain/logo-rules.ts', 'domain/tenancy.errors.ts']
      .map((f) => read(join(API, f))).join('\n');
    // trigger tokens the services MAP to another name (CHECKER_IS_MAKER, TENANT_FORBIDDEN) never reach the console under their own
    const MAPPED = new Set(['DOMAIN_CHECKER_IS_MAKER', 'DOMAIN_CHECKER_NOT_ADMIN', 'DOMAIN_PROPOSER_NOT_ADMIN']);
    const raised = new Set([...apiSrc.matchAll(/'((?:BRAND|LOGO|DOMAIN|POWERED_BY)_[A-Z_]+)'/g)].map((m) => m[1]).filter((c) => !MAPPED.has(c)));
    for (const code of raised) {
      const known = (BRAND_REFUSAL_CODES as readonly string[]).includes(code) || (DOMAIN_REFUSAL_CODES as readonly string[]).includes(code);
      expect({ code, known }).toEqual({ code, known: true });
    }
    for (const c of BRAND_REFUSAL_CODES) for (const cat of [en, hi, gu]) expect(cat[brandRefusalKey(c)]).toEqual(expect.any(String));
    for (const c of DOMAIN_REFUSAL_CODES) for (const cat of [en, hi, gu]) expect(cat[domainRefusalKey(c)]).toEqual(expect.any(String));
    expect(brandRefusalKey('WHATEVER')).toBe('br.refusal.unknown');
    expect(failureCodesFrom('X', 422, { refusals: [{ code: 'BRAND_COLOUR_INVALID' }, { code: '<script>' }] })).toEqual(['BRAND_COLOUR_INVALID', 'unknown']);
    expect(contrastFailuresFrom({ failing: [{ pair: 'primary_on_surface', display: '4.4:1' }, { pair: 'x<y', display: '1' }] })).toEqual([{ pair: 'primary_on_surface', display: '4.4:1' }]);
  });
  it('every br.* / dom.* key a page or the designer uses exists in en, hi and gu', () => {
    const used = new Set<string>(brandDesignerKeys());
    for (const f of [...PAGES, join(SRC, 'components', 'Sidebar.tsx'), join(SRC, 'app', 'settings', 'page.tsx')]) {
      // a literal that is a key FAMILY (`dom.state.subdomainOnly` → `.title` / `.body`) is not itself a key
      for (const m of read(f).matchAll(/'((?:br|dom)\.[A-Za-z0-9_.]+|nav\.(?:branding|domains)|settings\.branding\.[a-z]+)'/g)) if (!m[1].endsWith('.') && !(`${m[1]}.title` in en)) used.add(m[1]);
    }
    // the dynamic families the pages build
    for (const s of ['flaggedOff', 'restricted', 'notFound', 'error']) for (const x of ['title', 'body']) { used.add(`br.state.${s}.${x}`); used.add(`dom.state.${s}.${x}`); }
    for (const s of ['subdomainOnly', 'noCustom']) for (const x of ['title', 'body']) used.add(`dom.state.${s}.${x}`);
    for (const s of ['default', 'published']) used.add(`br.state.${s}.title`);
    for (const s of ['none', 'pending_scan', 'clean', 'infected', 'failed', 'missing']) used.add(`br.logo.state.${s}`);
    for (const s of ['proposed', 'confirmed', 'refused', 'expired']) used.add(`br.prop.status.${s}`);
    for (const s of ['pending', 'verified', 'failed', 'expired']) used.add(`dom.status.${s}`);
    for (const a of ['make_primary', 'remove', 'recheck']) used.add(`dom.act.${a}`);
    for (const a of ['make_primary', 'remove']) used.add(`dom.proposals.${a}`);
    for (const r of ['verified', 'failed', 'expired']) used.add(`dom.actPage.recheck.${r}`);
    const missing: string[] = [];
    for (const k of used) for (const [n, cat] of [['en', en], ['hi', hi], ['gu', gu]] as const) if (typeof (cat as Record<string, string>)[k] !== 'string') missing.push(`${n}:${k}`);
    expect(missing).toEqual([]);
  });
  it('the deprecated branding.* settings form is gone from /settings (it links to Branding instead)', () => {
    const page = read(join(SRC, 'app', 'settings', 'page.tsx'));
    expect(page).not.toMatch(/name="logoUrl"|branding\.logo_url/);
    expect(page).toContain('/settings/branding');
    expect(read(join(SRC, 'app', 'settings', 'actions.ts'))).toMatch(/saveBrandingAction[\s\S]*redirect\('\/settings\/branding'\)/);
  });
});
