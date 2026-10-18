// apps/web-partner/src/test-render/rtl-partner1a.render.test.tsx · PC-56 PARTNER-1a — the RTL spot-check of the new layouts (the STORE-CLOSE
// precedent): rendered inside dir="rtl", the dashboard, settings, help, the chain pages and the invite steps carry no inline style, no bare
// directional arrow and no physical left/right class; the CSS this wave added uses logical properties only.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardView } from '../components/partner1/DashboardView';
import { SettingsView } from '../components/partner1/SettingsView';
import { HelpView } from '../components/partner1/HelpView';
import { ChainNotice } from '../components/partner1/ChainNotice';
import { InviteChainView } from '../components/partner1/InviteChain';
import { en } from '../i18n/en';
import { FIGURES, ME, TEAM, tr } from './partner1a-fixtures';

const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl">{node}</div>);

describe('PC-56 PARTNER-1a · RTL spot-check', () => {
  const pages = [
    rtl(<DashboardView t={tr(en)} lang="en" state="ok" d={FIGURES} orgName="Fixture" />),
    rtl(<SettingsView t={tr(en)} lang="en" me={ME} sla={FIGURES.sla} team={{ kind: 'ok', team: TEAM }} invite={null} />),
    rtl(<HelpView t={tr(en)} mailbox={{ kind: 'none' }} />),
    rtl(<ChainNotice t={tr(en)} chain="dashboard_retry" state="confirm" />),
    ...(['edit', 'confirm', 'failure'] as const).map((s) => rtl(<InviteChainView labels={en} lang="en" step={s} idempotencyKey="k" phone="+919812345678" roleCode="partner_viewer" result={null} code={null} />)),
  ];
  it('no inline style, no bare arrow, no physical-side class in any new layout', () => {
    for (const html of pages) {
      expect(html).not.toMatch(/style="/);
      expect(html).not.toMatch(/[→←]/);
      expect(html).not.toMatch(/class="[^"]*(left|right)[^"]*"/);
    }
  });
  it('the CSS this wave added uses logical properties only', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'globals.css'), 'utf8');
    const ours = css.slice(css.indexOf('PC-56 PARTNER-1a'));
    expect(ours.length).toBeGreaterThan(100);
    expect(ours).not.toMatch(/(margin|padding|border)-(left|right)|\b(left|right)\s*:|text-align:\s*(left|right)|float:\s*(left|right)/);
  });
});
