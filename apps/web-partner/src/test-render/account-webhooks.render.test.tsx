// apps/web-partner/src/test-render/account-webhooks.render.test.tsx · PC-56 PARTNER-1b · founder D2 (canon W268, W3017–W3023) — webhooks, READ-ONLY:
// the partner's endpoints (no secret; the secret line says "held encrypted … rotated by partner operations on request"), the 0090 events (no
// application or consent event), the rail's contract from the CONSTANTS, the deliveries (newest first, the state filter, keyset "older",
// no payload), one delivery's attempts; the writes DECOR (Add endpoint, Activate, Rotate secret, Send test ping, Replay).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WebhooksView } from '../components/partner1/WebhooksView';
import { DeliveryDetail } from '../components/partner1/DeliveriesTable';
import { ChainNotice } from '../components/partner1/ChainNotice';
import { WEBHOOK_CONTRACT as W } from '../features/partner1/webhook-contract';
import { partner1RefusalKeys } from '../features/partner1/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { text, tr } from './partner1a-fixtures';
import { DELIVERIES, DELIVERY, ENDPOINTS, EVENTS, FALSE_1B } from './partner1b-fixtures';

const MAIL = { kind: 'none' as const };
const view = (extra: Partial<Parameters<typeof WebhooksView>[0]> = {}) => renderToStaticMarkup(
  <WebhooksView t={tr(en)} lang="en" state="ok" endpoints={ENDPOINTS} events={EVENTS} deliveries={DELIVERIES} filter={{}} mailbox={MAIL} {...extra} />);

describe('PC-56 PARTNER-1b · W268 webhooks (render)', () => {
  it('the endpoints (the URL as stored, events, active) — never a secret; the secret line is the true one', () => {
    const html = view(); const w = text(html);
    expect(w).toContain('https://hooks.fixture.test/kv'); expect(w).toContain('Not active');
    expect(w).toContain(en['partner1.hooks.secret']);
    expect(html).not.toMatch(/whsec|secret_enc|ciphertext|v2\./i);
    expect(w).not.toMatch(FALSE_1B);
  });
  it('the events are the allow-list given; never an application or consent event', () => {
    const w = text(view());
    for (const e of EVENTS) expect(w).toContain(e);
    expect(w).not.toMatch(/loan\.application\.submitted|consent\.granted/);
  });
  it('the contract block prints the rail\'s constants — no figure typed into a sentence', () => {
    const w = text(view());
    expect(w).toContain(W.retryLadderLabels.join(' · ')); expect(w).toContain(`${W.maxAttempts} attempts in all`);
    expect(w).toContain(`up to ${W.sendTimeoutSec} seconds`); expect(w).toContain(`${W.responseBodyCapBytes / 1024} KiB`);
    expect(w).toContain(`kept for ${W.retentionDays} days`); expect(w).toContain(W.signatureHeader); expect(w).toContain(W.algorithm);
    expect(w).toContain(`${W.rotationOverlapHours} hours on an FPO's own endpoints; a partner endpoint has no such overlap yet`);
    for (const k of partner1RefusalKeys('webhooks')) expect([k, w.includes(en[k])]).toEqual([k, true]);
  });
  it('the deliveries: newest first, the state words, the state filter, "older" by keyset, each row to its attempts; Replay is DECOR; no payload', () => {
    const html = view(); const w = text(html);
    expect(html.indexOf(DELIVERIES.items[0].id)).toBeLessThan(html.indexOf(DELIVERIES.items[1].id));
    expect(w).toContain('Delivered'); expect(w).toContain('Exhausted'); expect(w).toContain('503');
    expect(html).toContain(`href="/account/webhooks?delivery=${DELIVERIES.items[0].id}"`);
    expect(html).toContain('href="/account/webhooks?state=exhausted#deliveries"');
    expect(html).toContain(`href="/account/webhooks?cursor=${DELIVERIES.nextCursor}#deliveries"`);
    expect(html).toContain('data-kv-decor="replay"'); expect(html).toContain('href="/account/webhooks?act=confirm"');
    expect(html).not.toMatch(/payload|tenantId|tenant_id/);
    expect(text(view({ deliveries: { ...DELIVERIES, items: [], nextCursor: null } }))).toContain(en['partner1.hooks.deliveriesNone']);
    expect(text(view({ deliveries: null }))).toContain(en['partner1.hooks.deliveriesError']);
  });
  it('the writes are DECOR links (Add endpoint → the form chain; Activate / Rotate secret / Send test ping → the act chain)', () => {
    const html = view();
    expect(html).toContain('href="/account/webhooks?form=review"');
    expect((html.match(/href="\/account\/webhooks\?act=confirm"/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain('<form');
    for (const s of ['error', 'review', 'success', 'failure']) expect(text(renderToStaticMarkup(<ChainNotice t={tr(en)} chain="hooks_form" state={s} />))).toContain(en[`partner1.chain.hooksForm.${s}.body`]);
    for (const s of ['confirm', 'success', 'failure']) expect(text(renderToStaticMarkup(<ChainNotice t={tr(en)} chain="hooks_act" state={s} />))).toContain(en[`partner1.chain.hooksAct.${s}.body`]);
  });
  it('one delivery: its facts and every attempt (outcome, HTTP, time, error, signed at) — never the body; a missing one says so', () => {
    const html = renderToStaticMarkup(<DeliveryDetail t={tr(en)} lang="en" d={DELIVERY} endpoints={ENDPOINTS} />); const w = text(html);
    expect(html).toContain('data-kv-attempt="1"'); expect(html).toContain('data-kv-attempt="2"');
    expect(w).toContain('Failed'); expect(w).toContain('120 ms'); expect(w).toContain('http 503'); expect(w).toContain(en['partner1.hooks.detail.noBody']);
    expect(html).not.toMatch(/payload|signature=|v1=/);
    expect(text(renderToStaticMarkup(<DeliveryDetail t={tr(en)} lang="en" d={null} endpoints={ENDPOINTS} />))).toContain('older than 90 days');
  });
  it('switched off (never "unavailable"); not in your role; Gujarati renders', () => {
    const off = text(view({ state: 'off' })); expect(off).toContain('Nothing is broken'); expect(off).not.toMatch(/unavailable/i);
    expect(text(view({ state: 'forbidden' }))).toContain(en['partner1.hooks.forbidden']);
    expect(text(renderToStaticMarkup(<WebhooksView t={tr(gu)} lang="gu" state="ok" endpoints={ENDPOINTS} events={EVENTS} deliveries={DELIVERIES} filter={{}} mailbox={MAIL} />))).toContain(gu['partner1.hooks.title']);
  });
});
