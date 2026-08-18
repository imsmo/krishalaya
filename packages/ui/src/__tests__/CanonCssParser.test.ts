// packages/ui/src/__tests__/CanonCssParser.test.ts · DEV-58 (Phase D-UI-Port, batch 1).
//
// Pins the ONE documented transform the canon-CSS generator/fidelity-checker apply
// (`../../lib/canonCssParser.js`'s `normalizeCss`) and the rule-parsing behavior both
// `sync-from-design-system.js` and `verify-canon-fidelity.js` depend on — so this transform's
// behavior is TESTED, not just asserted in a comment (task's own requirement: "the transform
// must be explicit, tested, and reversible in review"). Plain `require()` of the CommonJS
// module under `packages/ui/lib/` (outside `src/`, so it is NOT part of the package's own
// compiled output) — this file is excluded from `tsc`'s program by `tsconfig.json`'s own
// `exclude: ["src/__tests__/**", ...]`, so it never needs a `.d.ts` for the required module;
// ts-jest (isolatedModules: true) transpiles it per-file without a full type-check pass.
/* eslint-disable @typescript-eslint/no-var-requires, no-restricted-syntax */
const { normalizeCss, parseRules, rulesToMap, stripComments } = require('../../lib/canonCssParser');

describe('canonCssParser.normalizeCss (the one documented whitespace transform)', () => {
  it('collapses newlines/tabs/repeated spaces to a single space', () => {
    expect(normalizeCss('a:   1;\n  b:  2;\t\tc: 3;')).toBe('a: 1; b: 2; c: 3;');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizeCss('   .foo { color: red; }   ')).toBe('.foo { color: red; }');
  });

  it('is idempotent (re-normalizing a normalized string is a no-op — reversibility check)', () => {
    const once = normalizeCss('a:  1;\n b: 2;');
    expect(normalizeCss(once)).toBe(once);
  });

  it('never touches non-whitespace characters (no re-ordering, no case-folding, no value rewriting)', () => {
    const input = '.Kvw-Btn-Primary { Background: VAR(--Color-Primary-600); }';
    expect(normalizeCss(input)).toBe(input.trim());
  });
});

describe('canonCssParser.stripComments', () => {
  it('removes /* ... */ blocks', () => {
    expect(stripComments('a { color: red; } /* a comment */ b { color: blue; }'))
      .toBe('a { color: red; }  b { color: blue; }');
  });

  it('does not corrupt a content value containing a bare slash (verified safe against canon: no\n      content string anywhere in web-frame.css/web-components.css contains the two-char sequence "/*")', () => {
    expect(stripComments('.x::before { content: "/"; }')).toBe('.x::before { content: "/"; }');
  });
});

describe('canonCssParser.parseRules', () => {
  it('parses a simple rule into selector + body', () => {
    const rules = parseRules('.kvw-btn { display: flex; gap: 4px; }');
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toBe('.kvw-btn');
    expect(rules[0].body).toBe('display: flex; gap: 4px;');
  });

  it('parses multiple top-level rules in file order', () => {
    const rules = parseRules('.a { x: 1; }\n.b { y: 2; }');
    expect(rules.map((r: any) => r.selector)).toEqual(['.a', '.b']);
  });

  it('treats @keyframes as one opaque unit (nested braces handled)', () => {
    const rules = parseRules('@keyframes spin { to { transform: rotate(360deg); } }');
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toBe('@keyframes spin');
    expect(rules[0].body).toContain('to { transform: rotate(360deg); }');
  });

  it('treats @media as one opaque unit containing its full nested body', () => {
    const css = '@media (max-width: 768px) { .a { x: 1; } .b { y: 2; } }';
    const rules = parseRules(css);
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toBe('@media (max-width: 768px)');
    // the inner rules are themselves re-parseable (this is what verify-canon-fidelity.js relies
    // on for its @-rule subset-containment check)
    const inner = parseRules(rules[0].rawBody);
    expect(inner.map((r: any) => r.selector)).toEqual(['.a', '.b']);
  });

  it('does not split a comma inside a rule body/value (only the selector prelude is a split candidate)', () => {
    const rules = parseRules('.a, .b { font-family: "Foo, Bar", sans-serif; }');
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toBe('.a, .b');
    expect(rules[0].body).toBe('font-family: "Foo, Bar", sans-serif;');
  });

  it('handles a real canon fragment with a pseudo-class and disabled-attribute selector (Button.tsx shape)', () => {
    const css = `
      .kvw-btn:focus-visible { outline: none; box-shadow: var(--web-focus-ring); }
      .kvw-btn[disabled], .kvw-btn.is-pending { opacity: 0.55; cursor: not-allowed; pointer-events: none; }
    `;
    const rules = parseRules(css);
    expect(rules).toHaveLength(2);
    expect(rules[1].selector).toBe('.kvw-btn[disabled], .kvw-btn.is-pending');
    expect(rules[1].body).toBe('opacity: 0.55; cursor: not-allowed; pointer-events: none;');
  });
});

describe('canonCssParser.rulesToMap', () => {
  it('groups repeated selectors into an array, preserving file order (the .kvw-range-presets shape)', () => {
    const rules = parseRules('.x { a: 1; }\n.x { a: 2; }');
    const map = rulesToMap(rules);
    expect(map.get('.x')).toHaveLength(2);
    expect(map.get('.x')![0].body).toBe('a: 1;');
    expect(map.get('.x')![1].body).toBe('a: 2;');
  });
});
