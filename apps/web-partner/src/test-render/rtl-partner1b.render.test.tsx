// apps/web-partner/src/test-render/rtl-partner1b.render.test.tsx · PC-56 PARTNER-1b — the RTL spot-check of the new layouts (the STORE-CLOSE /
// PARTNER-1a precedent): rendered inside dir="rtl" in en, hi and gu, the keys page, the revoke chain, webhooks, a delivery, readiness, the
// settlement page and the 1b chain pages carry no inline style, no bare directional arrow (none is drawn — so no DirArrow is needed) and no
// physical left/right class; the CSS this wave added uses logical properties only.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeysView } from '../components/partner1/KeysView';
import { RevokeConfirm, RevokeFailure, RevokeSuccess } from '../components/partner1/RevokeChain';
import { WebhooksView } from '../components/partner1/WebhooksView';
import { DeliveryDetail } from '../components/partner1/DeliveriesTable';
import { ReadinessView } from '../components/partner1/ReadinessView';
import { SettlementView } from '../components/partner1/SettlementView';
import { ChainNotice } from '../components/partner1/ChainNotice';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { tr } from './partner1a-fixtures';
import { DELIVERIES, DELIVERY, ENDPOINTS, EVENTS, KEYS, READY } from './partner1b-fixtures';

const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl">{node}</div>);
const MAIL = { kind: 'none' as const };

describe('PC-56 PARTNER-1b · RTL spot-check (en / hi / gu)', () => {
  const pages = ([['en', en], ['hi', hi], ['gu', gu]] as const).flatMap(([lang, cat]) => [
    rtl(<KeysView t={tr(cat)} lang={lang} state="ok" keys={KEYS} canRevoke mailbox={MAIL} />),
    rtl(<RevokeConfirm t={tr(cat)} keyRow={KEYS[0]} idempotencyKey="k" action="/x" />),
    rtl(<RevokeSuccess t={tr(cat)} lang={lang} keyRow={KEYS[1]} />),
    rtl(<RevokeFailure t={tr(cat)} id={KEYS[0].id} code="PARTNER_KEY_ALREADY_REVOKED" />),
    rtl(<WebhooksView t={tr(cat)} lang={lang} state="ok" endpoints={ENDPOINTS} events={EVENTS} deliveries={DELIVERIES} filter={{ state: 'delivered' }} mailbox={MAIL} />),
    rtl(<DeliveryDetail t={tr(cat)} lang={lang} d={DELIVERY} endpoints={ENDPOINTS} />),
    rtl(<ReadinessView t={tr(cat)} lang={lang} state="ok" r={READY} mailbox={MAIL} />),
    rtl(<SettlementView t={tr(cat)} kind="bank" />),
    rtl(<ChainNotice t={tr(cat)} chain="keys_form" state="review" />),
    rtl(<ChainNotice t={tr(cat)} chain="onboarding_act" state="confirm" />),
  ]);
  it('no inline style, no bare arrow, no physical-side class in any new layout, in any of the three languages', () => {
    expect(pages.length).toBe(30);
    for (const html of pages) {
      expect(html).not.toMatch(/style="/);
      expect(html).not.toMatch(/[→←⇒⇐➜➔]/);
      expect(html).not.toMatch(/class="[^"]*(left|right)[^"]*"/);
    }
  });
  it('the CSS this wave added uses logical properties only', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'globals.css'), 'utf8');
    const ours = css.slice(css.indexOf('PC-56 PARTNER-1b'));
    expect(ours.length).toBeGreaterThan(100);
    expect(ours).not.toMatch(/(margin|padding|border)-(left|right)|\b(left|right)\s*:|text-align:\s*(left|right)|float:\s*(left|right)/);
  });
});
