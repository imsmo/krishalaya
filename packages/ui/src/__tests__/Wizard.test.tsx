// packages/ui/src/__tests__/Wizard.test.tsx · DEV-18.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Wizard, Stepper } from '../components/Wizard';

describe('Wizard', () => {
  it('renders the full-bleed shell with an optional header + content', () => {
    const html = renderToStaticMarkup(
      <Wizard header={<strong>Step 1 of 4 · Create account</strong>}>
        <p>Onboarding content</p>
      </Wizard>,
    );
    expect(html).toContain('kvw-wizard-shell');
    expect(html).toContain('kvw-topbar');
    expect(html).toContain('Step 1 of 4');
    expect(html).toContain('Onboarding content');
  });

  it('omits the topbar when no header is supplied', () => {
    const html = renderToStaticMarkup(<Wizard><p>x</p></Wizard>);
    expect(html).not.toContain('kvw-topbar');
  });
});

describe('Stepper', () => {
  it('renders complete/active/upcoming steps with the correct classes + aria-current only on active', () => {
    const html = renderToStaticMarkup(
      <Stepper
        label="Tenant signup progress"
        steps={[
          { key: 'kyc', label: 'KYC', status: 'complete', completeMark: '✓' },
          { key: 'bank', label: 'Bank account', status: 'complete', completeMark: '✓' },
          { key: 'plan', label: 'Plan selection', status: 'active' },
          { key: 'live', label: 'Go live', status: 'upcoming' },
        ]}
      />,
    );
    expect(html).toContain('kvw-stepper');
    expect(html).toContain('aria-label="Tenant signup progress"');
    expect(html).toContain('is-complete');
    expect(html).toContain('is-active');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('KYC');
    expect(html).toContain('Go live');
    // Only exactly one step carries aria-current.
    expect((html.match(/aria-current="step"/g) || []).length).toBe(1);
  });

  it('falls back to the 1-based index when no completeMark is supplied for a complete step', () => {
    const html = renderToStaticMarkup(
      <Stepper label="x" steps={[{ key: 'a', label: 'A', status: 'complete' }]} />,
    );
    expect(html).toContain('>1<');
  });
});
