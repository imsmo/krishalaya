// packages/ui/src/__tests__/DiffViewer.test.tsx · DEV-18.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiffViewer } from '../components/DiffViewer';

describe('DiffViewer — inline mode (default)', () => {
  it('renders add/del/chg lines with the correct classes', () => {
    const html = renderToStaticMarkup(
      <DiffViewer
        label="Feature flag change"
        lines={[
          { key: '1', type: 'del', text: '- "commission_pct": 200   // 2.00%' },
          { key: '2', type: 'add', text: '+ "commission_pct": 150   // 1.50%' },
          { key: '3', type: 'chg', text: '~ template changed' },
        ]}
      />,
    );
    expect(html).toContain('kvw-diff');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Feature flag change"');
    expect(html).toContain('line del');
    expect(html).toContain('line add');
    expect(html).toContain('line chg');
    expect(html).not.toContain('kvw-diff-split');
  });

  it('renders word-level tok-add/tok-del marks when tokens are supplied', () => {
    const html = renderToStaticMarkup(
      <DiffViewer
        label="Template swap"
        lines={[
          {
            key: '1',
            type: 'chg',
            tokens: [
              { text: '~ "sms_template_id": ' },
              { text: 'KV-SMS-039', kind: 'del' },
              { text: ' → ' },
              { text: 'KV-SMS-042', kind: 'add' },
            ],
          },
        ]}
      />,
    );
    expect(html).toContain('tok-del');
    expect(html).toContain('tok-add');
    expect(html).toContain('KV-SMS-039');
    expect(html).toContain('KV-SMS-042');
  });
});

describe('DiffViewer — split mode', () => {
  it('renders two panes with before/after headings + removed/added/unchanged classes', () => {
    const html = renderToStaticMarkup(
      <DiffViewer
        mode="split"
        label="Plan version diff"
        beforeHeading="Before — v12"
        afterHeading="After — v13 (pending checker)"
        beforeLines={[
          { key: '1', type: 'unchanged', text: '{ "tenant_id": "TEN-0042",' },
          { key: '2', type: 'removed', text: '  "commission_pct": 200,' },
        ]}
        afterLines={[
          { key: '1', type: 'unchanged', text: '{ "tenant_id": "TEN-0042",' },
          { key: '2', type: 'added', text: '  "commission_pct": 150,' },
        ]}
      />,
    );
    expect(html).toContain('kvw-diff-split');
    expect(html).toContain('Before — v12');
    expect(html).toContain('After — v13 (pending checker)');
    expect(html).toContain('line removed');
    expect(html).toContain('line added');
    expect(html).toContain('line unchanged');
    expect(html).toContain('pane before');
    expect(html).toContain('pane after');
  });
});
