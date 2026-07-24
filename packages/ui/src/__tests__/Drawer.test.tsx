// packages/ui/src/__tests__/Drawer.test.tsx · DEV-17.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Drawer, isCloseKey } from '../components/Drawer';

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <Drawer open={false} onClose={() => {}} title="Listing detail">
        body
      </Drawer>,
    );
    expect(html).toBe('');
  });

  it('renders a labelled dialog with backdrop + header/body/footer when open', () => {
    const html = renderToStaticMarkup(
      <Drawer open onClose={() => {}} title="Listing detail — LST-2026-084512" footer={<button type="button">Close</button>}>
        <p>Opens from the reading-end.</p>
      </Drawer>,
    );
    expect(html).toContain('kvw-drawer-backdrop');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Listing detail — LST-2026-084512');
    expect(html).toContain('Opens from the reading-end.');
    expect(html).toContain('kvw-drawer-footer');
    // aria-labelledby must reference the actual header element's id.
    const labelledbyMatch = html.match(/aria-labelledby="([^"]+)"/);
    expect(labelledbyMatch).not.toBeNull();
    expect(html).toContain(`id="${labelledbyMatch![1]}"`);
  });

  it('omits the footer container when none supplied', () => {
    const html = renderToStaticMarkup(<Drawer open onClose={() => {}} title="x">body</Drawer>);
    expect(html).not.toContain('kvw-drawer-footer');
  });
});

describe('isCloseKey', () => {
  it('is true only for Escape', () => {
    expect(isCloseKey('Escape')).toBe(true);
    expect(isCloseKey('Enter')).toBe(false);
    expect(isCloseKey('a')).toBe(false);
  });
});
