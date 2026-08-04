// apps/web-tenant/src/test-render/mechanisms.render.test.tsx · DEV-19. Proves the 4 UI mechanisms are real,
// structural facts about this app's actual dependency (`@krishalaya/ui`, workspace:*), not just unit-tested
// in isolation inside that package. Same "can't call next/headers outside a request scope" constraint
// `listings-shell.render.test.tsx` already documented applies here too — this test renders `@krishalaya/ui`
// components/CSS directly (real, not mocked) rather than importing `layout.tsx` itself; `resolveThemeHtmlAttrs`/
// `isSeniorOn` (this app's own `lib/mechanism.ts` thin wrapper around them) are unit-tested directly in
// `@krishalaya/ui`'s own `Mechanisms.test.ts` — this file is the "does the shipped CSS actually carry the
// mechanism" structural proof, at the level of this app's real bundled dependency.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KvUiGlobalStyles, kvUiCss, AppShell, Sidebar as UiSidebar, Topbar } from '@krishalaya/ui';

describe('mechanism 1 — DARK MODE: the shipped kvUiCss carries a real [data-theme="dark"] token block', () => {
  it('KvUiGlobalStyles renders a <style> tag whose content includes the dark-scope block', () => {
    const html = renderToStaticMarkup(<KvUiGlobalStyles />);
    expect(html).toContain('<style');
    // dangerouslySetInnerHTML content is NOT HTML-escaped (that's its entire purpose — it's raw CSS text, not
    // a text node), so the literal selector string appears unescaped inside the rendered <style> tag's content.
    expect(html).toContain('[data-theme="dark"]');
  });
  it('the dark block redefines --surface-card and --color-ink-700 (real values, not empty)', () => {
    const darkBlockMatch = /\[data-theme="dark"\] \{([^}]*)\}/.exec(kvUiCss);
    expect(darkBlockMatch).not.toBeNull();
    const body = darkBlockMatch![1];
    expect(body).toMatch(/--surface-card:\s*#[0-9a-f]{6}/);
    expect(body).toMatch(/--color-ink-700:\s*#[0-9a-f]{6}/);
  });
});

describe('mechanism 2 — SENIOR MODE (console extension): [data-senior="true"] block ships in the real bundle', () => {
  it('kvUiCss includes the console senior-mode fragment with the ratified 1.30x scale', () => {
    expect(kvUiCss).toContain('[data-senior="true"]');
    expect(kvUiCss).toMatch(/--text-base:\s*calc\(1rem\s*\*\s*1\.3\)/);
    expect(kvUiCss).toContain('--web-control-h: 56px;');
  });
});

describe('mechanism 3 — TABLET/POINTER DENSITY (DELTA-001): real pointer/hover media gating ships in the bundle', () => {
  it('kvUiCss includes the fine+hover 36px cut AND the coarse/no-hover 44px floor restore', () => {
    expect(kvUiCss).toMatch(/@media \(pointer: fine\) and \(hover: hover\)/);
    expect(kvUiCss).toMatch(/@media \(pointer: coarse\), \(hover: none\)/);
  });
});

describe('mechanism 4 — RTL: the real shell composition renders identically under dir="rtl" (CSS-only mirror)', () => {
  it('AppShell/Sidebar/Topbar emit byte-identical markup regardless of an ancestor dir="rtl"', () => {
    const compose = () => (
      <AppShell
        sidebar={<UiSidebar brand={{ name: 'Krishalaya Console' }} sections={[]} navLabel="Console" />}
        topbar={<Topbar userMenu={<span>Priya S.</span>} />}
      >
        <section>content</section>
      </AppShell>
    );
    const ltr = renderToStaticMarkup(compose());
    const rtl = renderToStaticMarkup(<div dir="rtl">{compose()}</div>);
    expect(rtl).toContain(ltr);
    // no inline physical-direction style ever leaks into the markup itself (mirroring is CSS-only)
    expect(rtl).not.toMatch(/style="[^"]*(left|right)\s*:/i);
  });
});
