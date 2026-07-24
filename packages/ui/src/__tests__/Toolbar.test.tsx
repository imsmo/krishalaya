// packages/ui/src/__tests__/Toolbar.test.tsx · DEV-18.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Toolbar } from '../components/Toolbar';

describe('Toolbar', () => {
  it('renders a bare flex-wrap container when no label is supplied', () => {
    const html = renderToStaticMarkup(
      <Toolbar>
        <span className="kvw-chip kvw-chip-active">All channels</span>
        <span className="kvw-chip">push</span>
      </Toolbar>,
    );
    expect(html).toContain('kvw-toolbar');
    expect(html).not.toContain('role="toolbar"');
    expect(html).toContain('All channels');
  });

  it('renders role="toolbar" + aria-label when a label is supplied', () => {
    const html = renderToStaticMarkup(<Toolbar label="Filter notifications by channel"><span>x</span></Toolbar>);
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Filter notifications by channel"');
  });
});
