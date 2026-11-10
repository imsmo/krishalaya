// apps/web-gov/src/test-render/gov-chrome.render.test.tsx · PC-56 GOV-1b — W358 (`/canon/chrome`) and the chrome it describes (E12): the rules
// this console keeps, as facts; NO emblem (no image of any kind, and the word only in the refusal that names the Act); the language as each
// reader's; no certification claim; the GOV mark beside the authority's name, the authority first and the platform small; W358 linked from
// the footer, never the sidebar; the refusals BY NAME in en/hi/gu.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChromeCanonView } from '../components/gov1/DashboardViews';
import { GovFooter, GovShell, GovSidebar } from '../components/gov1/GovShell';
import { gov1RefusalKeys } from '../features/gov1/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_HEAD, text, tr, visible } from './gov1a-fixtures';
import { FALSE_1B } from './gov1b-fixtures';

const CATS = { en, hi, gu } as const;
const page = (cat: Record<string, string> = en) => renderToStaticMarkup(<ChromeCanonView t={tr(cat)} me={ME_HEAD} />);
const shell = (cat: Record<string, string> = en) => renderToStaticMarkup(
  <GovShell me={ME_HEAD} sidebar={<GovSidebar t={tr(cat)} me={ME_HEAD} />} footer={<GovFooter t={tr(cat)} />} skipLabel="Skip"><ChromeCanonView t={tr(cat)} me={ME_HEAD} /></GovShell>);

describe('PC-56 GOV-1b · W358 /canon/chrome — the rules this console keeps', () => {
  it('the rules as facts: the authority first, the GOV mark and blue edge, no look of its own, each reader\'s language, an aim not a certificate', () => {
    const t = text(page());
    expect(t).toContain('These rules apply to every page of this console.');
    expect(t).toContain('Test Authority One\'s name comes first, as the platform holds it. The platform\'s own name follows it, small.');
    expect(t).toContain('Every signed-in page carries the GOV mark and a blue top edge');
    expect(t).toContain('No authority has a look of its own yet');
    expect(t).toContain('Each person reads this console in the language they choose: English, हिन्दी or ગુજરાતી.');
    expect(t).toContain('The platform\'s accessibility aim is WCAG 2.2 AA. This console has not been audited against it.');
  });
  it('NO emblem: no image of any kind; the word appears only inside the refusal that names the Act', () => {
    for (const cat of Object.values(CATS)) {
      const h = shell(cat);
      expect(/<img|<svg|<picture|<object|background-image/i.test(h)).toBe(false);
      expect(FALSE_1B.test(visible(h))).toBe(false);
    }
    const refused = (page().match(/<li class="kv-refusal" data-kv-refusal="emblem">([\s\S]*?)<\/li>/) ?? [])[1] ?? '';
    expect(text(refused)).toBe('This console never shows a national or state emblem, and none can be uploaded (the State Emblem of India (Prohibition of Improper Use) Act, 2005).');
    expect((text(page()).match(/emblem/gi) ?? []).length).toBe(2);   // "emblem" and "Emblem" — both in that one refusal
  });
  it('no certification claim: the only "certif…" is the refusal saying none was obtained', () => {
    const t = text(page());
    expect((t.match(/certif/gi) ?? []).length).toBe(1);
    expect(t).toContain('No government accessibility certificate has been obtained, and no conformance audit has been done.');
  });
  it('E12 in the shell: the authority\'s name, then the GOV mark, then the platform small; the footer links W358; the sidebar does not', () => {
    const h = shell();
    expect(h.indexOf('Test Authority One')).toBeLessThan(h.indexOf('data-kv-pill="gov"'));
    expect(h.indexOf('data-kv-pill="gov"')).toBeLessThan(h.indexOf('Krishalaya government console'));
    expect(h).toContain('<span class="kv-gov-pill" data-kv-pill="gov">GOV</span>');
    const sidebar = (h.match(/<nav class="kv-sidebar"[\s\S]*?<\/nav>/) ?? [''])[0];
    expect(sidebar).not.toContain('/canon/chrome');
    expect(h).toContain('<a class="kv-link" href="/canon/chrome" data-kv-footer-link="chrome">How this console looks, and why</a>');
    expect(renderToStaticMarkup(<GovShell me={null} sidebar={null} footer={<GovFooter t={tr(en)} />} skipLabel="Skip"><p>x</p></GovShell>)).not.toContain('data-kv-footer');
  });
  it.each(Object.entries(CATS))('%s: every chrome refusal printed BY NAME; the mark in the reader\'s language', (_l, cat) => {
    const t = text(page(cat));
    for (const k of gov1RefusalKeys('chrome_canon')) expect([k, t.includes(cat[k])]).toEqual([k, true]);
    expect(shell(cat)).toContain(`data-kv-pill="gov">${cat['gov1.chrome.pill']}<`);
  });
});
