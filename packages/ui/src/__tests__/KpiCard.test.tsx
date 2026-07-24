// packages/ui/src/__tests__/KpiCard.test.tsx · DEV-16.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KpiCard } from '../components/KpiCard';

describe('KpiCard', () => {
  it('renders label + pre-formatted value inside the canon kvw-card/kvw-kpi wrapper', () => {
    const html = renderToStaticMarkup(<KpiCard label="Rows in file" value="50" />);
    expect(html).toContain('kvw-card');
    expect(html).toContain('kvw-kpi');
    expect(html).toContain('Rows in file');
    expect(html).toContain('>50<');
  });

  it('applies the .money font class only when isMoney is set', () => {
    const html = renderToStaticMarkup(<KpiCard label="Valid" value="₹46" isMoney />);
    expect(html).toContain('class="value money"');
  });

  it('renders a delta only when deltaLabel is supplied, tone-classed from deltaDirection', () => {
    const withDelta = renderToStaticMarkup(<KpiCard label="Valid" value="46" deltaLabel="become drafts → QC" deltaDirection="up" />);
    expect(withDelta).toContain('class="delta up"');
    expect(withDelta).toContain('become drafts');
    const withoutDelta = renderToStaticMarkup(<KpiCard label="Duplicates" value="1" />);
    expect(withoutDelta).not.toContain('class="delta');
  });
});
