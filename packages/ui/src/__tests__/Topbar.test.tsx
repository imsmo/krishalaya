// packages/ui/src/__tests__/Topbar.test.tsx · DEV-17.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Topbar, Avatar } from '../components/Topbar';

describe('Topbar', () => {
  it('renders the search slot with role=search + aria-label only when supplied', () => {
    const withSearch = renderToStaticMarkup(<Topbar search={<span>search box</span>} searchLabel="Search everything" />);
    const withoutSearch = renderToStaticMarkup(<Topbar />);
    expect(withSearch).toContain('role="search"');
    expect(withSearch).toContain('aria-label="Search everything"');
    expect(withSearch).toContain('search box');
    expect(withoutSearch).not.toContain('kvw-topbar-search');
  });

  it('renders the notification bell with the caller-supplied accessible label + unread dot', () => {
    const html = renderToStaticMarkup(
      <Topbar notification={{ label: 'Notifications (3 unread)', hasUnread: true, onClick: () => {} }} />,
    );
    expect(html).toContain('aria-label="Notifications (3 unread)"');
    expect(html).toContain('class="dot"');
  });

  it('does not render an unread dot when hasUnread is falsy', () => {
    const html = renderToStaticMarkup(<Topbar notification={{ label: 'Notifications', onClick: () => {} }} />);
    expect(html).not.toContain('class="dot"');
  });

  it('renders the userMenu slot verbatim (white-label: no baked avatar/initials scheme)', () => {
    const html = renderToStaticMarkup(<Topbar userMenu={<span>Custom user chip</span>} />);
    expect(html).toContain('Custom user chip');
  });
});

describe('Avatar', () => {
  it('renders caller-supplied initials, never derived from a name-splitting heuristic', () => {
    const html = renderToStaticMarkup(<Avatar label="PO" />);
    expect(html).toContain('kvw-avatar');
    expect(html).toContain('>PO<');
  });

  it('applies kvw-avatar-lg for the lg size', () => {
    const html = renderToStaticMarkup(<Avatar label="DK" size="lg" />);
    expect(html).toContain('kvw-avatar-lg');
  });
});
