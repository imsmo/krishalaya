// packages/ui/src/__tests__/Tabs.test.tsx · DEV-17.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tabs, nextTabKey, type TabItem } from '../components/Tabs';

const items: TabItem[] = [
  { key: 'orders', label: 'Orders', count: '1,204' },
  { key: 'disputes', label: 'Disputes', count: '12' },
  { key: 'settlements', label: 'Settlements' },
];

describe('Tabs — static render', () => {
  it('renders role=tablist/tab, aria-selected on the active tab only, and a roving tabIndex', () => {
    const html = renderToStaticMarkup(<Tabs items={items} activeKey="disputes" onChange={() => {}} ariaLabel="Sections" />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Sections"');
    const buttons = html.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    expect(buttons[1]).toContain('aria-selected="true"');
    expect(buttons[1]).toContain('tabindex="0"');
    expect(buttons[0]).toContain('aria-selected="false"');
    expect(buttons[0]).toContain('tabindex="-1"');
  });

  it('renders the count badge only when supplied', () => {
    const html = renderToStaticMarkup(<Tabs items={items} activeKey="orders" onChange={() => {}} ariaLabel="Sections" />);
    expect(html).toContain('>1,204<');
    expect(html).toContain('>12<');
  });

  it('disables a disabled tab', () => {
    const disabledItems: TabItem[] = [...items, { key: 'archived', label: 'Archived', disabled: true }];
    const html = renderToStaticMarkup(<Tabs items={disabledItems} activeKey="orders" onChange={() => {}} ariaLabel="Sections" />);
    expect(html).toContain('disabled=""');
  });
});

describe('Tabs — keyboard behavior (nextTabKey, WAI-ARIA tabs pattern)', () => {
  it('ArrowRight/ArrowLeft move to the adjacent tab, wrapping at the ends', () => {
    expect(nextTabKey(items, 'orders', 'ArrowRight')).toBe('disputes');
    expect(nextTabKey(items, 'settlements', 'ArrowRight')).toBe('orders'); // wraps
    expect(nextTabKey(items, 'orders', 'ArrowLeft')).toBe('settlements'); // wraps
  });

  it('Home/End jump to the first/last non-disabled tab', () => {
    expect(nextTabKey(items, 'disputes', 'Home')).toBe('orders');
    expect(nextTabKey(items, 'disputes', 'End')).toBe('settlements');
  });

  it('skips disabled tabs in either direction', () => {
    const withDisabled: TabItem[] = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B', disabled: true },
      { key: 'c', label: 'C' },
    ];
    expect(nextTabKey(withDisabled, 'a', 'ArrowRight')).toBe('c');
    expect(nextTabKey(withDisabled, 'c', 'ArrowRight')).toBe('a');
  });

  it('returns the current key unchanged when every tab is disabled', () => {
    const allDisabled: TabItem[] = [{ key: 'a', label: 'A', disabled: true }, { key: 'b', label: 'B', disabled: true }];
    expect(nextTabKey(allDisabled, 'a', 'ArrowRight')).toBe('a');
  });
});
