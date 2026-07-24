// packages/ui/src/__tests__/Input.test.tsx · DEV-15.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Input } from '../components/Input';

describe('Input', () => {
  it('renders label + field wrapper with canon classes', () => {
    const html = renderToStaticMarkup(<Input id="name" label="Farmer name" onChange={() => {}} value="" />);
    expect(html).toContain('kvw-field');
    expect(html).toContain('kvw-label');
    expect(html).toContain('kvw-input');
    expect(html).toContain('Farmer name');
    expect(html).toContain('for="name"');
  });

  it('required renders the canon required-marker class', () => {
    const html = renderToStaticMarkup(<Input id="phone" label="Phone" required onChange={() => {}} value="" />);
    expect(html).toContain('kvw-label-required');
  });

  it('errorText renders aria-invalid + role="alert", never both error and helper', () => {
    const html = renderToStaticMarkup(
      <Input id="pin" label="PIN" helperText="6 digits" errorText="Invalid PIN" onChange={() => {}} value="" />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('kvw-error-text');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('kvw-helper');
  });

  it('Golden Law 3: money affix derives INR symbol via Intl, never a hardcoded literal', () => {
    const html = renderToStaticMarkup(
      <Input id="amt" label="Amount" money={{ currencyCode: 'INR' }} onChange={() => {}} value="" />,
    );
    expect(html).toContain('kvw-input-affix');
    expect(html).toContain('kvw-input-money');
    expect(html).toContain('₹');
  });

  it('Golden Law 3: the SAME affix mechanism renders AED code-form for a different currency', () => {
    const html = renderToStaticMarkup(
      <Input
        id="amt-aed"
        label="Amount"
        money={{ currencyCode: 'AED', display: 'code', locale: 'ar-AE' }}
        onChange={() => {}}
        value=""
      />,
    );
    expect(html).toContain('AED');
    expect(html).not.toContain('₹');
  });
});
