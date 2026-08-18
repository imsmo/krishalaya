// packages/ui/src/__tests__/EmptyState.test.tsx · DEV-16.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from '../components/EmptyState';

describe('EmptyState', () => {
  it('empty variant renders role="status"', () => {
    const html = renderToStaticMarkup(<EmptyState variant="empty" title="No listings yet" body="Invite farmers to publish produce." />);
    expect(html).toContain('role="status"');
    expect(html).toContain('No listings yet');
    expect(html).not.toContain('kvw-state-error');
  });

  it('error variant renders role="alert" and the kvw-state-error marker class', () => {
    const html = renderToStaticMarkup(<EmptyState variant="error" title="Couldn't load listings" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('kvw-state-error');
  });

  it('denied variant renders with no action when none supplied (canon shows none)', () => {
    const html = renderToStaticMarkup(<EmptyState variant="denied" title="Permission needed" body="Ask your admin." />);
    expect(html).toContain('Permission needed');
    expect(html).not.toContain('<button');
  });

  it('flagged-off variant renders informational copy only', () => {
    const html = renderToStaticMarkup(<EmptyState variant="flagged-off" title="Flagged off — Bulk Upload disabled" />);
    expect(html).toContain('Flagged off — Bulk Upload disabled');
  });

  it('renders an action button when both actionLabel and onAction are supplied', () => {
    const html = renderToStaticMarkup(<EmptyState variant="empty" title="x" actionLabel="Invite farmers" onAction={() => {}} />);
    expect(html).toContain('Invite farmers');
    expect(html).toContain('kvw-btn-secondary');
  });

  // DEV-60 (UI Port Program batch 3, Part 2): `children` lets a caller supply a navigation action (`as={Link}`)
  // or more than one action — the built-in `actionLabel`/`onAction` slot is a single plain `onClick` button and
  // cannot express either, and real web-admin call sites (`not-found.tsx`, `error.tsx`) need exactly this.
  it('renders children alongside (not instead of) the built-in action', () => {
    const html = renderToStaticMarkup(
      <EmptyState variant="empty" title="x" actionLabel="Built-in" onAction={() => {}}>
        <a href="/dashboard">Back to dashboard</a>
      </EmptyState>,
    );
    expect(html).toContain('Built-in');
    expect(html).toContain('Back to dashboard');
  });

  it('renders children with no actionLabel/onAction supplied (error-boundary shape: two custom actions)', () => {
    const html = renderToStaticMarkup(
      <EmptyState variant="error" title="Something went wrong">
        <button type="button">Retry</button>
        <a href="/login">Sign in again</a>
      </EmptyState>,
    );
    expect(html).not.toContain('kvw-btn-secondary'); // no built-in action rendered
    expect(html).toContain('Retry');
    expect(html).toContain('Sign in again');
  });

  // DEV-61 Part 0 (fixing a DEV-60 QA-escalated P0 candidate): `title` defaults to a plain `<div>` — canon-
  // exact, byte-identical to every prior render — but a caller whose EmptyState IS the entire page (404/error
  // boundary, no other heading anywhere) must be able to render a real heading so a screen-reader user
  // navigating by heading (the `H` key) finds something.
  it('titleAs defaults to a plain div (canon-exact, no heading tag)', () => {
    const html = renderToStaticMarkup(<EmptyState variant="empty" title="No listings yet" />);
    expect(html).toContain('<div class="title">No listings yet</div>');
    expect(html).not.toMatch(/<h[1-4][^>]*class="title"/);
  });

  it('titleAs="h1" renders a real <h1> for the title (not-found.tsx/error.tsx shape)', () => {
    const html = renderToStaticMarkup(<EmptyState variant="empty" title="Page not found" titleAs="h1" />);
    expect(html).toContain('<h1 class="title">Page not found</h1>');
  });

  it('titleAs="h2" renders a real <h2> for the title', () => {
    const html = renderToStaticMarkup(<EmptyState variant="error" title="Something went wrong" titleAs="h2" />);
    expect(html).toContain('<h2 class="title">Something went wrong</h2>');
  });
});
