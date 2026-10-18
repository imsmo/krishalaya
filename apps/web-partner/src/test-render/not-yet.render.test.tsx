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
import { INSURANCE_REDIRECTS } from '../features/partner2/refusals';
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
    expect(notYet.length).toBe(26);   // PC-56 PARTNER-2a: the four built insurer routes left the list (30 → 26)
  });
  it('PC-56 PARTNER-2a · the four old insurance routes answer a real 307 from next.config.js (equal to the registry); their page files are gone; claims stay not-yet', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(path.join(__dirname, '..', '..', 'next.config.js')) as { redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> };
    const rules = await cfg.redirects();
    expect(Object.fromEntries(rules.map((r) => [r.source, r.destination]))).toEqual(INSURANCE_REDIRECTS);
    for (const r of rules) {
      expect([r.source, r.permanent]).toEqual([r.source, false]);   // 307, not 308: the move may be revisited
      expect([r.source, fs.existsSync(path.join(APP, ...r.source.replace(':id', '[id]').slice(1).split('/'), 'page.tsx'))]).toEqual([r.source, false]);
      expect(fs.existsSync(path.join(APP, ...r.destination.replace(':id', '[id]').slice(1).split('/'), 'page.tsx'))).toBe(true);
    }
    expect(Object.keys(NOT_YET_ROUTES).filter((r) => r.startsWith('/insurance-'))).toEqual(['/insurance-claims', '/insurance-claims/[id]']);
    expect(fs.existsSync(path.join(APP, 'insurance-book', 'actions.ts'))).toBe(false);   // the dead DEV-24 authoring action is gone (survey F-15)
  });
  it('no not-yet page imports an API client or the SDK (it calls nothing), and each still gates the session', () => {
    for (const f of notYet) {
      const src = fs.readFileSync(f, 'utf8');
      expect([routeOf(f), /api-client|@krishalaya\/sdk-js|partnerClient|anonClient/.test(src)]).toEqual([routeOf(f), false]);
      expect([routeOf(f), src.includes('await requirePartner()')]).toEqual([routeOf(f), true]);
      expect([routeOf(f), src.includes(`const ROUTE = '${routeOf(f)}'`)]).toEqual([routeOf(f), true]);
    }
  });
  it('the pages WITH a partner read are not on the list: dashboard, the loan queue and its detail; help is static', () => {
    for (const r of ['/dashboard', '/loan-queue', '/loan-queue/[id]', '/help', '/login']) expect(NOT_YET_ROUTES[r]).toBeUndefined();
    const queue = fs.readFileSync(path.join(APP, 'loan-queue', 'page.tsx'), 'utf8');
    expect(queue).toContain('partner.applications.list');
    expect(queue).not.toContain("'fintech/loan-applications'");
  });
  it('each one renders the honest sentence with its surface name (en and gu), and its way back (kind-aware) — never an outage', () => {
    for (const [route, surface] of Object.entries(NOT_YET_ROUTES)) {
      const html = renderToStaticMarkup(<NotYet t={tr(en)} route={route} />);
      expect(html).toContain(en['partner.notYet.title'].replace('{surface}', en[surfaceKey(surface)]));
      expect(html).toContain(en['partner.notYet.body'].replace(/'/g, '&#x27;'));
      // PC-56 PARTNER-2a: the way back is kind-aware by surface — an insurance page goes back to the insurer dashboard, the rest to the queue
      expect(html).toContain(`href="${notYetBack(route).href}"`);
      expect(notYetBack(route).href).toBe(surface === 'insurance' ? '/insurer/dashboard' : '/loan-queue');
      expect(html).not.toMatch(/unavailable|temporarily/i);
      const g = renderToStaticMarkup(<NotYet t={tr(gu)} route={route} />);
      expect(g).toContain(gu['partner.notYet.title'].replace('{surface}', gu[surfaceKey(surface)]));
    }
  });
});
