// packages/ui/src/__tests__/Button.test.tsx · DEV-15. Static-markup render tests (no DOM/jsdom dependency
// needed — see jest.config.js's own comment) via `react-dom/server`'s `renderToStaticMarkup`.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../components/Button';

describe('Button', () => {
  it('renders the canon primary class by default', () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).toContain('kvw-btn');
    expect(html).toContain('kvw-btn-primary');
    expect(html).toContain('Save');
  });

  // DEV-60 (UI Port Program batch 3, Part 3): default flipped from 'button' to 'submit', matching a native
  // <button>'s own implicit behaviour, per DEV-59 QA's footgun finding — see this file's own header comment
  // for the full reasoning (99% of this console's real Button usage wants submit; the default only has any
  // effect at all when nested inside a <form>).
  it('DEV-60: defaults type to "submit" (matches native <button>, not the old "button" default)', () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).toContain('type="submit"');
  });

  it('DEV-60: an explicit type="button" still overrides the default exactly as before', () => {
    const html = renderToStaticMarkup(<Button type="button">Cancel</Button>);
    expect(html).toContain('type="button"');
  });

  it('applies variant and size modifier classes', () => {
    const html = renderToStaticMarkup(<Button variant="danger" size="lg">Delete</Button>);
    expect(html).toContain('kvw-btn-danger');
    expect(html).toContain('kvw-btn-lg');
  });

  it('Golden Law 9: pending disables the button (idempotency — no double-submit)', () => {
    const html = renderToStaticMarkup(<Button pending>Submit</Button>);
    expect(html).toContain('is-pending');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    // pending hides children/icons per the component (canon shows only the spinner while pending)
    expect(html).not.toContain('>Submit<');
  });

  it('disabled renders the disabled attribute', () => {
    const html = renderToStaticMarkup(<Button disabled>Save</Button>);
    expect(html).toContain('disabled=""');
  });

  it('gate 10: icon-only requires an aria-label (compiles only with one) and renders it', () => {
    const html = renderToStaticMarkup(
      <Button iconOnly aria-label="Close">
        <span aria-hidden="true">×</span>
      </Button>,
    );
    expect(html).toContain('kvw-btn-icon');
    expect(html).toContain('aria-label="Close"');
  });

  it('DEV-59: polymorphic `as` renders a real navigation element, not a <button>, carrying the same canon classes', () => {
    const html = renderToStaticMarkup(
      <Button as="a" href="/dashboard">
        Back to dashboard
      </Button>,
    );
    expect(html).toContain('<a');
    expect(html).not.toContain('<button');
    expect(html).toContain('kvw-btn');
    expect(html).toContain('kvw-btn-primary');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('Back to dashboard');
    // an <a> has no disabled/type/aria-busy — pending/disabled must not leak onto it
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('aria-busy');
  });

  it('DEV-59: `as` accepts a caller-supplied component (e.g. a router Link) and applies variant classes', () => {
    const FakeLink = ({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) => (
      <a data-fake-link href={href} className={className}>{children}</a>
    );
    const html = renderToStaticMarkup(
      <Button as={FakeLink} href="/next-page" variant="secondary">
        Next page
      </Button>,
    );
    expect(html).toContain('data-fake-link');
    expect(html).toContain('kvw-btn-secondary');
    expect(html).toContain('href="/next-page"');
  });
});
