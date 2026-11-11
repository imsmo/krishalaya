// apps/web-gov/src/test-render/gov-shell.render.test.tsx · PC-56 GOV-1a · E2 — the persona gate as a person sees it: the sidebar is drawn ONLY
// with the API's answer for this session (`me`); with none (anonymous, a farmer's or an organisation's session, a partner's, an ended one) the
// page is bare. The sidebar names the AUTHORITY first, the platform after it, and links only to /dashboard and /access — and, since PC-56
// GOV-2b (brief §E first commit), /schemes; NAMED UPDATE, PC-56 GOV-2c (brief §E first commit): /applications; NAMED UPDATE, PC-56 GOV-3a
// (brief §E first commit): /dbt; NAMED UPDATE, PC-56 GOV-4a (brief §E first commit): /verification ("Field visits"); NAMED UPDATE, PC-56 GOV-5a (brief §E
// first commit): /mgnrega ("MGNREGA").
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GovFooter, GovShell, GovSidebar } from '../components/gov1/GovShell';
import { en } from '../i18n/en';
import { text, tr, ME_HEAD } from './gov1a-fixtures';

const shell = (me: typeof ME_HEAD | null) => renderToStaticMarkup(
  <GovShell me={me} sidebar={me ? <GovSidebar t={tr(en)} me={me} /> : <nav className="kv-sidebar">SHOULD NOT SHOW</nav>} skipLabel="Skip"><p>page</p></GovShell>);

describe('PC-56 GOV-1a · the shell and the persona gate', () => {
  it('no verified gov session → no sidebar at all (even if one is handed in)', () => {
    const h = shell(null);
    expect(h).toContain('data-kv-shell="bare"'); expect(h).not.toContain('kv-sidebar'); expect(h).not.toContain('SHOULD NOT SHOW');
  });
  it('a verified gov session → the sidebar, the authority\'s name first, the platform after; Dashboard, Schemes (GOV-2b), Applications (GOV-2c), Benefit payments (GOV-3a), Field visits (GOV-4a) and Access only; sign out', () => {
    const h = shell(ME_HEAD);
    expect(h).toContain('data-kv-shell="gov"'); expect(h).toContain(`data-kv-sidebar="${ME_HEAD.authority!.id}"`);
    expect(h.indexOf('Test Authority One')).toBeLessThan(h.indexOf('Krishalaya government console'));
    expect((h.match(/class="kv-sidebar__link"/g) ?? []).length).toBe(7);   // NAMED UPDATE, PC-56 GOV-3a: + /dbt; PC-56 GOV-4a: + /verification; PC-56 GOV-5a: + /mgnrega
    expect(h).toContain('href="/mgnrega"'); expect(text(h)).toContain('MGNREGA');
    expect(h).toContain('href="/verification"'); expect(text(h)).toContain('Field visits');
    expect(h).toContain('href="/dbt"'); expect(text(h)).toContain('Benefit payments');
    expect(h).toContain('href="/access"'); expect(h).toContain('href="/dashboard"'); expect(h).toContain('href="/schemes"'); expect(h).toContain('href="/applications"');
    expect(h).not.toMatch(/href="\/(registers|mgnrega\/)/);   // NAMED UPDATE, PC-56 GOV-4a: /verification is now the authority's page; PC-56 GOV-5a: /mgnrega too (never a /mgnrega/… sub-address)
    expect(h).toContain('name="_action" value="logout"');
  });
  it('GOV-1b: the footer (W358 link) is drawn only with a verified session, and never names the old wave table or internal files', () => {
    const on = renderToStaticMarkup(<GovShell me={ME_HEAD} sidebar={<GovSidebar t={tr(en)} me={ME_HEAD} />} footer={<GovFooter t={tr(en)} />} skipLabel="Skip"><p>page</p></GovShell>);
    expect(on).toContain('data-kv-footer-link="chrome"'); expect(on).toContain('data-kv-pill="gov"');
    const off = renderToStaticMarkup(<GovShell me={null} sidebar={null} footer={<GovFooter t={tr(en)} />} skipLabel="Skip"><p>page</p></GovShell>);
    expect(off).not.toContain('data-kv-footer'); expect(off).not.toContain('data-kv-pill');
    expect(text(on)).not.toMatch(/Live|DBT|PFMS|GOV_BUILD_BACKLOG|Ledger/);
    // NAMED UPDATE, PC-56 GOV-5a: "MGNREGA" is now the sidebar's label for /mgnrega — it appears EXACTLY once, as that link's text, and nowhere else.
    expect(text(on).split('MGNREGA').length - 1).toBe(1); expect(on).toMatch(/<a href="\/mgnrega" class="kv-sidebar__link">MGNREGA<\/a>/);
  });
});
