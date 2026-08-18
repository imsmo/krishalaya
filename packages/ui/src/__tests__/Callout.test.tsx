// packages/ui/src/__tests__/Callout.test.tsx · DEV-16.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Callout } from '../components/Callout';

describe('Callout', () => {
  it('defaults to the warning tone (bare .kvw-callout, matching the canon\'s own default)', () => {
    const html = renderToStaticMarkup(<Callout>Some caller-resolved note.</Callout>);
    expect(html).toContain('class="kvw-callout"');
    expect(html).not.toContain('kvw-callout-warning'); // no such modifier class exists — bare class IS warning
    expect(html).toContain('Some caller-resolved note.');
  });

  it('applies a modifier class for non-warning tones', () => {
    const html = renderToStaticMarkup(<Callout tone="info">Idempotent upload note.</Callout>);
    expect(html).toContain('kvw-callout-info');
  });

  it('renders role="note"', () => {
    const html = renderToStaticMarkup(<Callout tone="danger">x</Callout>);
    expect(html).toContain('role="note"');
  });

  // DEV-60: `live` prop — the fix for the 68 blocked `role="alert"`/`role="status"` sites.
  it('defaults `live` to "off" (role="note"), unchanged from pre-DEV-60 behavior', () => {
    const html = renderToStaticMarkup(<Callout>Some caller-resolved note.</Callout>);
    expect(html).toContain('role="note"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });

  it('live="assertive" renders role="alert"', () => {
    const html = renderToStaticMarkup(
      <Callout tone="danger" live="assertive">This action moves money.</Callout>,
    );
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('role="note"');
    expect(html).not.toContain('role="status"');
  });

  it('live="polite" renders role="status"', () => {
    const html = renderToStaticMarkup(
      <Callout tone="success" live="polite">Payout confirmed.</Callout>,
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="note"');
    expect(html).not.toContain('role="alert"');
  });

  it('never renders an explicit aria-live attribute (role alone carries the implicit value)', () => {
    const assertiveHtml = renderToStaticMarkup(<Callout live="assertive">x</Callout>);
    const politeHtml = renderToStaticMarkup(<Callout live="polite">x</Callout>);
    expect(assertiveHtml).not.toContain('aria-live');
    expect(politeHtml).not.toContain('aria-live');
  });

  it('tone styling is unaffected by `live` — same tone classes regardless of role', () => {
    const off = renderToStaticMarkup(<Callout tone="danger" live="off">x</Callout>);
    const polite = renderToStaticMarkup(<Callout tone="danger" live="polite">x</Callout>);
    const assertive = renderToStaticMarkup(<Callout tone="danger" live="assertive">x</Callout>);
    const classOf = (html: string) => html.match(/class="([^"]*)"/)?.[1];
    expect(classOf(off)).toBe(classOf(polite));
    expect(classOf(off)).toBe(classOf(assertive));
    expect(classOf(off)).toContain('kvw-callout-danger');
  });
});
