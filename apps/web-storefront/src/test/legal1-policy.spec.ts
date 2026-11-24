// apps/web-storefront/src/test/legal1-policy.spec.ts · PC-56 LEGAL-1 — the policy pages' PURE parts: the safe markdown reader (what it understands,
// what it refuses — raw HTML never becomes an element, an unsafe href never becomes a link), the token substitution (a set fact, an unset fact,
// an unknown token, a fact value that looks like markdown), and the host rule for the four routes.
import type { PlatformFacts } from '@krishalaya/sdk-js';
import { MAX_MARKDOWN_CHARS, parseInlineText, parseMarkdown, plainText, safeHref, slugify, type Block, type Inline } from '../features/legal/markdown';
import { POLICY_TOKENS, substituteText, substituteTokens } from '../features/legal/tokens';
import { POLICY_PATHS, POLICY_SLUGS, policyHref } from '../features/legal/pages';
import { hostRewritePath } from '../features/branding/brand-theme';
import { platformOnlyRedirect, STORE_HOST_REWRITES } from '../features/sweep/paths';
import { STATIC_TOP_SEGMENTS, tenantSlugOfPath } from '../features/auth/redirect';
import { PLATFORM_CHROME, tenantChrome } from '../features/store4a/account';

const EMPTY: PlatformFacts = {
  legal: { entityName: null, registeredOffice: null },
  grievance: { officerName: null, address: null, email: null, ackHours: null, resolveDays: null },
  contact: { securityEmail: null, partnersEmail: null, pressEmail: null, generalEmail: null },
};
const links = (nodes: Inline[]): string[] => nodes.flatMap((n) => (n.t === 'link' ? [n.href, ...links(n.c)] : n.t === 'text' ? [] : links(n.c)));
const allInlines = (b: Block[]): Inline[] => b.flatMap((x) => (x.t === 'heading' || x.t === 'paragraph' ? x.c : x.t === 'list' ? x.items.flat() : []));
const kinds = (nodes: Inline[]): string[] => nodes.flatMap((n) => (n.t === 'text' ? ['text'] : [n.t, ...kinds(n.c)]));

describe('LEGAL-1 · the markdown reader', () => {
  it('headings (# and ## → h2, ### → h3, #### → h4) with slug ids, deduplicated', () => {
    const { blocks } = parseMarkdown('# Top\n## Grievances\n### Sub part\n#### Deep\n## Grievances');
    expect(blocks.map((b) => (b.t === 'heading' ? [b.level, b.id, plainText(b.c)] : b.t))).toEqual([
      [2, 'top', 'Top'], [2, 'grievances', 'Grievances'], [3, 'sub-part', 'Sub part'], [4, 'deep', 'Deep'], [2, 'grievances-2', 'Grievances'],
    ]);
    expect(slugify('शिकायत अधिकारी')).toBe('शिकायत-अधिकारी');
    expect(parseMarkdown('#nospace').blocks[0].t).toBe('paragraph');
  });
  it('paragraphs join consecutive lines; a blank line separates them', () => {
    const { blocks } = parseMarkdown('one\ntwo\n\nthree');
    expect(blocks.map((b) => (b.t === 'paragraph' ? plainText(b.c) : b.t))).toEqual(['one two', 'three']);
  });
  it('unordered and ordered single-level lists; an indented line continues the item', () => {
    const { blocks } = parseMarkdown('- a\n* b\n  more\n\n3. x\n4) y');
    expect(blocks).toHaveLength(2);
    const [ul, ol] = blocks as Array<Extract<Block, { t: 'list' }>>;
    expect([ul.ordered, ul.items.map(plainText)]).toEqual([false, ['a', 'b more']]);
    expect([ol.ordered, ol.start, ol.items.map(plainText)]).toEqual([true, 3, ['x', 'y']]);
  });
  it('bold, italic (* and _), escapes; an underscore inside a word is a letter', () => {
    expect(parseInlineText('**b** *i* _u_')).toEqual([
      { t: 'strong', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' ' }, { t: 'em', c: [{ t: 'text', v: 'i' }] }, { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'u' }] },
    ]);
    expect(parseInlineText('snake_case_word')).toEqual([{ t: 'text', v: 'snake_case_word' }]);
    expect(parseInlineText('\\*not\\*')).toEqual([{ t: 'text', v: '*not*' }]);
    expect(parseInlineText('2 * 3 * 4')).toEqual([{ t: 'text', v: '2 * 3 * 4' }]);
    expect(kinds(parseInlineText('*a **b** c*'))).toEqual(['em', 'text', 'strong', 'text', 'text']);
  });
  it('a token is kept whole — its underscores never open emphasis', () => {
    expect(parseInlineText('{{platform.legal.entity_name}} and {{platform.grievance.officer_name}}'))
      .toEqual([{ t: 'text', v: '{{platform.legal.entity_name}} and {{platform.grievance.officer_name}}' }]);
  });
  it('raw HTML is never interpreted: it stays characters in text nodes', () => {
    for (const src of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">x</a>']) {
      const { blocks } = parseMarkdown(src);
      expect(blocks).toEqual([{ t: 'paragraph', c: [{ t: 'text', v: src }] }]);
    }
  });
  it('links: http(s), mailto and same-site paths become links (external marked); the text is kept', () => {
    const n = parseInlineText('[a](https://example.test/x) [b](http://example.test) [c](mailto:x@example.test) [d](/trust-data#grievances) [e](#top)');
    expect(links(n)).toEqual(['https://example.test/x', 'http://example.test', 'mailto:x@example.test', '/trust-data#grievances', '#top']);
    expect(n.filter((x) => x.t === 'link').map((x) => (x as { external: boolean }).external)).toEqual([true, true, false, false, false]);
  });
  it('unsafe hrefs never become links — only the text is printed', () => {
    const bad = ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', '//evil.example', '/\\evil.example', 'ftp://example.test', 'file:///etc/passwd',
      'mailto:', 'https://', 'http:/x', 'tel:123', '\u0000javascript:x', 'java​script:x', 'https://exa mple.test'];
    for (const h of bad) {
      expect([h, safeHref(h)]).toEqual([h, null]);
      const n = parseInlineText(`[x](${h})`);
      expect([h, links(n)]).toEqual([h, []]);
    }
    expect(parseInlineText('[click me](javascript:alert(1)) after')).toEqual([{ t: 'text', v: 'click me after' }]);   // the balanced target is consumed whole
    expect(links(parseInlineText('[w](https://example.test/a_(b))'))).toEqual(['https://example.test/a_(b)']);
  });
  it('a link inside a link is not a link; a broken link is text', () => {
    expect(links(parseInlineText('[a [b](/x)](/y)'))).toEqual(['/x']);
    expect(parseInlineText('[a](/x')).toEqual([{ t: 'text', v: '[a](/x' }]);
  });
  it('bounded: an over-long input is cut (and said); pathological marker runs read in linear time', () => {
    const big = parseMarkdown('a'.repeat(MAX_MARKDOWN_CHARS + 10));
    expect(big.truncated).toBe(true);
    const t0 = Date.now();
    parseMarkdown(`${'*'.repeat(50_000)} ${'_a'.repeat(20_000)} ${'[x'.repeat(20_000)} ${'{{'.repeat(20_000)} ${'\\'.repeat(20_000)}*`);
    parseMarkdown('**a '.repeat(30_000));
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  it('a horizontal rule', () => {
    expect(parseMarkdown('a\n\n---\n\nb').blocks.map((b) => b.t)).toEqual(['paragraph', 'rule', 'paragraph']);
  });
});

describe('LEGAL-1 · the tokens', () => {
  it('exactly the eleven PlatformFacts fields are tokens', () => {
    expect(Object.keys(POLICY_TOKENS)).toHaveLength(11);
    expect(Object.entries(POLICY_TOKENS).filter(([, d]) => d.mail).map(([k]) => k).sort()).toEqual([
      'platform.contact.general_email', 'platform.contact.partners_email', 'platform.contact.press_email', 'platform.contact.security_email', 'platform.grievance.email',
    ]);
  });
  it('a SET fact is substituted (whitespace inside the braces allowed); a number fact prints its figure', () => {
    const f: PlatformFacts = { ...EMPTY, grievance: { ...EMPTY.grievance, email: 'grievance@example.test', ackHours: 48 } };
    expect(substituteText('Write to {{ platform.grievance.email }} within {{platform.grievance.ack_hours}} hours.', f)).toEqual([
      { t: 'text', v: 'Write to ' }, { t: 'fact', name: 'platform.grievance.email', line: { kind: 'set', value: 'grievance@example.test' }, mail: true },
      { t: 'text', v: ' within ' }, { t: 'fact', name: 'platform.grievance.ack_hours', line: { kind: 'set', value: '48' }, mail: false }, { t: 'text', v: ' hours.' },
    ]);
  });
  it('an UNSET fact, or a failed facts read, is "unpublished"', () => {
    expect(substituteText('{{platform.legal.entity_name}}', EMPTY)).toEqual([{ t: 'fact', name: 'platform.legal.entity_name', line: { kind: 'unpublished' }, mail: false }]);
    expect(substituteText('{{platform.grievance.email}}', null)[0]).toMatchObject({ t: 'fact', line: { kind: 'unpublished' } });
  });
  it('an UNKNOWN token stays literal text; so does a prototype key', () => {
    expect(substituteText('a {{anything.else}} b {{constructor}} {{__proto__}}', EMPTY)).toEqual([{ t: 'text', v: 'a {{anything.else}} b {{constructor}} {{__proto__}}' }]);
  });
  it('a fact value that looks like markdown is NOT interpreted (substitution runs after parsing, on text nodes)', () => {
    const f: PlatformFacts = { ...EMPTY, legal: { entityName: '[a](javascript:x) **bold**', registeredOffice: '<script>x</script>' } };
    const out = substituteTokens(parseMarkdown('Run by {{platform.legal.entity_name}} at {{platform.legal.registered_office}}.').blocks, f);
    expect(out).toEqual([{ t: 'paragraph', c: [
      { t: 'text', v: 'Run by ' }, { t: 'fact', name: 'platform.legal.entity_name', line: { kind: 'set', value: '[a](javascript:x) **bold**' }, mail: false },
      { t: 'text', v: ' at ' }, { t: 'fact', name: 'platform.legal.registered_office', line: { kind: 'set', value: '<script>x</script>' }, mail: false }, { t: 'text', v: '.' },
    ] }]);
  });
  it('tokens inside emphasis, headings and list items are substituted too', () => {
    const out = substituteTokens(parseMarkdown('## {{platform.legal.entity_name}}\n\n- **{{platform.grievance.address}}**').blocks, EMPTY);
    expect(JSON.stringify(out).match(/"t":"fact"/g)).toHaveLength(2);
    expect(allInlines(parseMarkdown('## {{platform.legal.entity_name}}').blocks)).toHaveLength(1);
  });
});

describe('LEGAL-1 · the four routes and the host rule', () => {
  it('the slugs, the paths, the hrefs under both chromes', () => {
    expect([...POLICY_SLUGS]).toEqual(['terms', 'privacy', 'refunds', 'shipping']);
    expect([...POLICY_PATHS]).toEqual(['/terms', '/privacy', '/refunds', '/shipping']);
    expect(policyHref(PLATFORM_CHROME, 'terms')).toBe('/terms');
    expect(policyHref(tenantChrome('anand'), 'shipping')).toBe('/anand/shipping');
  });
  it('a store host serves its own policy pages (rewritten, never redirected); they are static segments, never a tenant slug', () => {
    for (const p of POLICY_PATHS) {
      expect(hostRewritePath('anand', p)).toBe(`/anand${p}`);
      expect(platformOnlyRedirect(p, 'https://platform.example.test')).toBeNull();
      expect(STORE_HOST_REWRITES).toContain(p);
      expect(STATIC_TOP_SEGMENTS).toContain(p.slice(1));
      expect(tenantSlugOfPath(p)).toBeNull();
      expect(tenantSlugOfPath(`/anand${p}`)).toBe('anand');
    }
    expect(hostRewritePath('anand', '/terms/x')).toBeNull();
  });
});
