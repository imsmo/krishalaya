// apps/web-partner/src/test-render/not-yet.render.test.tsx · PC-56 PARTNER-0 · founder D8 — every page with NO partner read prints ONE honest
// "not yet available in the partner console" state and calls nothing. The list is DERIVED FROM THE ROUTES: every `app/**/page.tsx` that
// renders <NotYet> must be in features/partner/not-yet.ts with its own route, every route there must be such a page, and no such page may
// import an API client (a tenant call would be refused for a partner session). The repointed pages (dashboard, loan queue) are not on it.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotYet } from '../components/NotYet';
import { NOT_YET_ROUTES, notYetBack, surfaceKey } from '../features/partner/not-yet';
import { INSURANCE_REDIRECTS, LENDER_REDIRECTS } from '../features/partner2/refusals';
import { CLAIMS_REDIRECTS } from '../features/partner3/refusals';
import { LENDER_BOOK_REDIRECTS } from '../features/partner4/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';

const APP = path.join(__dirname, '..', 'app');
function pages(dir = APP): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return pages(full);
    return d.name === 'page.tsx' ? [full] : [];
  });
}
const routeOf = (file: string) => '/' + path.relative(APP, path.dirname(file)).split(path.sep).join('/');
const tr = (cat: Record<string, string>) => ({ t: (key: string, vars: Record<string, string | number> = {}) => (cat[key] ?? en[key] ?? key).replace(/\{(\w+)\}/g, (_m, n) => (n in vars ? String(vars[n]) : `{${n}}`)) });

describe('PC-56 PARTNER-0 · the not-yet pages, derived from the routes', () => {
  const all = pages();
  const notYet = all.filter((f) => fs.readFileSync(f, 'utf8').includes('<NotYet'));

  it('every page rendering <NotYet> is registered under its own route, and every registered route is such a page', () => {
    expect(notYet.map(routeOf).sort()).toEqual(Object.keys(NOT_YET_ROUTES).sort());
    expect(notYet.length).toBe(19);   // PC-56 PARTNER-2a: the four built insurer routes left the list (30 → 26); PARTNER-2c: /products(/[id]) left (26 → 24); PARTNER-3a: /insurance-claims(/[id]) left (24 → 22); PARTNER-4a: /portfolio(/[id]) and /servicing left (22 → 19)
  });
  it('PC-56 PARTNER-2a/3a · the six old insurance routes answer a real 307 from next.config.js (equal to the registries); their page files are gone', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(path.join(__dirname, '..', '..', 'next.config.js')) as { redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> };
    const rules = await cfg.redirects();
    expect(Object.fromEntries(rules.map((r) => [r.source, r.destination]))).toEqual({ ...INSURANCE_REDIRECTS, ...LENDER_REDIRECTS, ...CLAIMS_REDIRECTS, ...LENDER_BOOK_REDIRECTS });   // PC-56 PARTNER-2c: + the /products pair; PARTNER-3a: + the claims pair; PARTNER-4a: + the lender's book (five)
    for (const r of rules) {
      expect([r.source, r.permanent]).toEqual([r.source, false]);   // 307, not 308: the move may be revisited
      expect([r.source, fs.existsSync(path.join(APP, ...r.source.replace(':id', '[id]').slice(1).split('/'), 'page.tsx'))]).toEqual([r.source, false]);
      expect(fs.existsSync(path.join(APP, ...r.destination.replace(':id', '[id]').slice(1).split('/'), 'page.tsx'))).toBe(true);
    }
    // PC-56 PARTNER-3a: no insurance page is not-yet any more — the claims pair answers 307 to the built `insurer/claims` routes
    expect(Object.keys(NOT_YET_ROUTES).filter((r) => r.startsWith('/insurance-'))).toEqual([]);
    expect(CLAIMS_REDIRECTS).toEqual({ '/insurance-claims': '/insurer/claims', '/insurance-claims/:id': '/insurer/claims/:id' });
    expect(fs.existsSync(path.join(APP, 'insurance-book', 'actions.ts'))).toBe(false);   // the dead DEV-24 authoring action is gone (survey F-15)
    // the dead DEV-24 claims console is gone (survey F-13): its server actions, its pure helpers, its two tests
    for (const rel of [['insurance-claims', 'actions.ts'], ['insurance-claims', 'page.tsx'], ['insurance-claims', '[id]', 'page.tsx']]) expect([rel.join('/'), fs.existsSync(path.join(APP, ...rel))]).toEqual([rel.join('/'), false]);
    for (const rel of ['features/insurance/insurance.ts', 'test/insurance.spec.ts', 'test-render/insurance-console.render.test.tsx']) expect([rel, fs.existsSync(path.join(__dirname, '..', rel))]).toEqual([rel, false]);
  });
  it('no not-yet page imports an API client or the SDK (it calls nothing), and each still gates the session', () => {
    for (const f of notYet) {
      const src = fs.readFileSync(f, 'utf8');
      expect([routeOf(f), /api-client|@krishalaya\/sdk-js|partnerClient|anonClient/.test(src)]).toEqual([routeOf(f), false]);
      expect([routeOf(f), src.includes('await requirePartner()')]).toEqual([routeOf(f), true]);
      expect([routeOf(f), src.includes(`const ROUTE = '${routeOf(f)}'`)]).toEqual([routeOf(f), true]);
    }
  });
  it('the pages WITH a partner read are not on the list: dashboard, the lender\'s queue and its detail, its shelf, its portfolio and a loan; help is static', () => {
    for (const r of ['/dashboard', '/help', '/login', '/products', '/products/[id]', '/lender/products', '/lender/products/[id]',
      '/loan-queue', '/loan-queue/[id]', '/lender/queue', '/lender/queue/[id]', '/portfolio', '/portfolio/[id]', '/lender/portfolio', '/lender/portfolio/[id]', '/servicing']) {
      expect([r, NOT_YET_ROUTES[r]]).toEqual([r, undefined]);
    }
    // PC-56 PARTNER-2c: the retired pair answers 307 to the lender's shelf, and its page files are gone
    expect(LENDER_REDIRECTS).toEqual({ '/products': '/lender/products', '/products/:id': '/lender/products/:id' });
    expect([fs.existsSync(path.join(APP, 'products', 'page.tsx')), fs.existsSync(path.join(APP, 'products', '[id]', 'page.tsx'))]).toEqual([false, false]);
    // PC-56 PARTNER-4a: the queue moved to the canon's address and reads the partner applications there; the portfolio pair and /servicing
    // answer 307 to the lender's own book
    expect(LENDER_BOOK_REDIRECTS).toEqual({
      '/loan-queue': '/lender/queue', '/loan-queue/:id': '/lender/queue/:id',
      '/portfolio': '/lender/portfolio', '/portfolio/:id': '/lender/portfolio/:id',
      '/servicing': '/lender/portfolio',
    });
    const queue = fs.readFileSync(path.join(APP, 'lender', 'queue', 'page.tsx'), 'utf8');
    expect(queue).toContain('partner.applications.list');
    expect(queue).toContain('partner.loans.counts');
    expect(queue).not.toContain("'fintech/loan-applications'");
    const portfolio = fs.readFileSync(path.join(APP, 'lender', 'portfolio', 'page.tsx'), 'utf8');
    expect(portfolio).toContain('partner.loans.counts');
    expect(portfolio).toContain('partner.loans.list');
  });
  it('PC-56 PARTNER-4a · the dead lending console is gone (survey F-14 / E12): its server actions, its pure helpers, its three specs, its two retired pages', () => {
    for (const rel of [['servicing', 'actions.ts'], ['servicing', 'page.tsx'], ['portfolio', 'page.tsx'], ['portfolio', '[id]', 'page.tsx'],
      ['loan-queue', 'page.tsx'], ['loan-queue', '[id]', 'page.tsx'], ['loan-queue', 'actions.ts']]) {
      expect([rel.join('/'), fs.existsSync(path.join(APP, ...rel))]).toEqual([rel.join('/'), false]);
    }
    for (const rel of ['features/lending/servicing.ts', 'features/lending/loan.ts', 'features/lending/product.ts',
      'test/servicing.spec.ts', 'test/loan.spec.ts', 'test/product.spec.ts']) {
      expect([rel, fs.existsSync(path.join(__dirname, '..', rel))]).toEqual([rel, false]);
    }
    // the one lending helper that survives keeps no disbursal offer and no queue link of its own
    // the CODE, not the comments that record the deletion
    const app = fs.readFileSync(path.join(__dirname, '..', 'features', 'lending', 'application.ts'), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const gone of ['canDisburse', 'LENDER_BOXES', 'isLenderBox', 'buildListQuery', 'queueHref', '/loan-queue']) expect([gone, app.includes(gone)]).toEqual([gone, false]);
    // and the dead i18n families are gone from every catalogue
    for (const cat of [en, gu]) {
      expect(Object.keys(cat).filter((k) => /^(sv|prod|pf|repay|settle|lender|loan2)\./.test(k))).toEqual([]);
      expect(Object.keys(cat).filter((k) => /^loan\./.test(k) && !/^loan\.st\./.test(k))).toEqual([]);
      for (const k of ['partner.surface.products', 'partner.surface.insurance']) expect([k, k in cat]).toEqual([k, false]);
    }
  });
  it('each one renders the honest sentence with its surface name (en and gu), and its way back (kind-aware) — never an outage', () => {
    for (const [route, surface] of Object.entries(NOT_YET_ROUTES)) {
      const html = renderToStaticMarkup(<NotYet t={tr(en)} route={route} />);
      expect(html).toContain(en['partner.notYet.title'].replace('{surface}', en[surfaceKey(surface)]));
      expect(html).toContain(en['partner.notYet.body'].replace(/'/g, '&#x27;'));
      // PC-56 PARTNER-4a: PARTNER-2a's kind-aware branch is gone with the dead `'insurance'` surface — every remaining not-yet page goes
      // back to the lender's queue at the canon's own address
      expect(html).toContain(`href="${notYetBack(route).href}"`);
      expect(notYetBack(route).href).toBe('/lender/queue');
      expect([route, surface]).not.toEqual([route, 'insurance']);
      expect(html).not.toMatch(/unavailable|temporarily/i);
      const g = renderToStaticMarkup(<NotYet t={tr(gu)} route={route} />);
      expect(g).toContain(gu['partner.notYet.title'].replace('{surface}', gu[surfaceKey(surface)]));
    }
  });
});
