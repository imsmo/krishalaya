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
});
