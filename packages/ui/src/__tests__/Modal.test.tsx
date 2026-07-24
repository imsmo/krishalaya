// packages/ui/src/__tests__/Modal.test.tsx · DEV-18.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Modal, isCloseKey, getFocusableElements, shouldWrapFocus } from '../components/Modal';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <Modal open={false} onClose={() => {}} title="Suspend tenant?">body</Modal>,
    );
    expect(html).toBe('');
  });

  it('renders a labelled dialog with backdrop + title/body/footer when open', () => {
    const html = renderToStaticMarkup(
      <Modal
        open
        onClose={() => {}}
        title='Suspend tenant "Anand FPO"?'
        footer={<button type="button">Request suspension</button>}
      >
        <p>All 1,842 farmers lose marketplace access immediately.</p>
      </Modal>,
    );
    expect(html).toContain('kvw-backdrop');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Suspend tenant &quot;Anand FPO&quot;?');
    expect(html).toContain('kvw-modal-footer');
    const labelledbyMatch = html.match(/aria-labelledby="([^"]+)"/);
    expect(labelledbyMatch).not.toBeNull();
    expect(html).toContain(`id="${labelledbyMatch![1]}"`);
  });

  it('applies kvw-confirm-danger + role="alertdialog" for a danger/alert confirmation', () => {
    const html = renderToStaticMarkup(
      <Modal open onClose={() => {}} title="Suspend?" danger alert>body</Modal>,
    );
    expect(html).toContain('kvw-confirm-danger');
    expect(html).toContain('role="alertdialog"');
  });

  it('omits the footer container when none supplied', () => {
    const html = renderToStaticMarkup(<Modal open onClose={() => {}} title="x">body</Modal>);
    expect(html).not.toContain('kvw-modal-footer');
  });
});

describe('isCloseKey (reused from Drawer)', () => {
  it('is true only for Escape', () => {
    expect(isCloseKey('Escape')).toBe(true);
    expect(isCloseKey('Enter')).toBe(false);
  });
});

describe('getFocusableElements', () => {
  it('queries the container with the expected selector and returns its results as-is', () => {
    const fakeButton = { tag: 'button' };
    const fakeInput = { tag: 'input' };
    const seenSelectors: string[] = [];
    const fakeContainer = {
      querySelectorAll: (selector: string) => {
        seenSelectors.push(selector);
        return [fakeButton, fakeInput];
      },
    };
    const result = getFocusableElements(fakeContainer);
    expect(result).toEqual([fakeButton, fakeInput]);
    expect(seenSelectors[0]).toContain('button:not([disabled])');
    expect(seenSelectors[0]).toContain('a[href]');
    expect(seenSelectors[0]).toContain('[tabindex]:not([tabindex="-1"])');
  });

  it('returns an empty array when nothing matches', () => {
    const result = getFocusableElements({ querySelectorAll: () => [] });
    expect(result).toEqual([]);
  });
});

describe('shouldWrapFocus (pure focus-trap decision, DOM-free)', () => {
  it('wraps to last when Shift+Tab from the first focusable', () => {
    expect(shouldWrapFocus(true, false, true)).toBe('last');
  });
  it('wraps to first when Tab from the last focusable', () => {
    expect(shouldWrapFocus(false, true, false)).toBe('first');
  });
  it('does nothing when active is neither first nor last', () => {
    expect(shouldWrapFocus(false, false, false)).toBeNull();
    expect(shouldWrapFocus(false, false, true)).toBeNull();
  });
  it('does nothing for a lone focusable element hit by plain Tab (is both first and last)', () => {
    // Tab (not shift) on the only focusable element: it IS the last -> wraps to first (itself), a no-op in
    // practice but the decision function still reports 'first' honestly (caller re-focuses the same node).
    expect(shouldWrapFocus(true, true, false)).toBe('first');
    // Shift+Tab on the only focusable element: it IS the first -> wraps to last (itself).
    expect(shouldWrapFocus(true, true, true)).toBe('last');
  });
});
