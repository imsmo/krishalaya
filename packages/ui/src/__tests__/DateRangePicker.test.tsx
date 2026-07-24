// packages/ui/src/__tests__/DateRangePicker.test.tsx · DEV-17.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DateRangePicker } from '../components/DateRangePicker';

describe('DateRangePicker', () => {
  const baseProps = {
    fromLabel: 'From',
    fromValue: '01 Jul 2026',
    toLabel: 'To',
    toValue: '22 Jul 2026',
    presetsGroupLabel: 'Quick ranges',
    presets: [
      { key: 'today', label: 'Today', onSelect: () => {} },
      { key: 'last7', label: 'Last 7 days', onSelect: () => {} },
      { key: 'last30', label: 'Last 30 days', active: true, onSelect: () => {} },
    ],
  };

  it('renders linked, caller-formatted from/to inputs (never computing dates itself)', () => {
    const html = renderToStaticMarkup(<DateRangePicker {...baseProps} />);
    expect(html).toContain('value="01 Jul 2026"');
    expect(html).toContain('value="22 Jul 2026"');
    expect(html).toContain('kvw-daterange-bar');
    expect(html).toContain('readonly');
  });

  it('renders the preset group with aria-pressed reflecting the active preset', () => {
    const html = renderToStaticMarkup(<DateRangePicker {...baseProps} />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Quick ranges"');
    const buttons = html.match(/<button[^>]*class="kvw-range-preset"[^>]*>[^<]*</g) ?? [];
    expect(buttons).toHaveLength(3);
    expect(buttons.find((b) => b.includes('Last 30 days'))).toContain('aria-pressed="true"');
    expect(buttons.find((b) => b.includes('>Today<'))).toContain('aria-pressed="false"');
  });

  it('applies the RTL-mirroring icon-mirrors class to the connector arrow', () => {
    const html = renderToStaticMarkup(<DateRangePicker {...baseProps} />);
    expect(html).toContain('class="icon-mirrors"');
  });

  it('renders an optional calendar slot without computing any day cells itself (honest minimum)', () => {
    const withCalendar = renderToStaticMarkup(<DateRangePicker {...baseProps} calendar={<div>CALENDAR SLOT</div>} />);
    const withoutCalendar = renderToStaticMarkup(<DateRangePicker {...baseProps} />);
    expect(withCalendar).toContain('CALENDAR SLOT');
    expect(withoutCalendar).not.toContain('kvw-cal-month');
  });
});
