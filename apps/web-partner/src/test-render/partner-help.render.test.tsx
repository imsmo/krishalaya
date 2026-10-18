// apps/web-partner/src/test-render/partner-help.render.test.tsx · PC-56 PARTNER-1a · founder D4 (canon W272) — help: the partners mailbox from the
// platform facts (a mailto) or "not published yet" — no literal mailbox (M1 kills here); no phone, no hours, no round-the-clock promise; the
// webhook-signature article printing the rail's constants; "Raise a ticket" → the DECOR chain; the refusals by name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelpView } from '../components/partner1/HelpView';
import { WEBHOOK_CONTRACT } from '../features/partner1/webhook-contract';
import { partner1RefusalKeys } from '../features/partner1/refusals';
import { en } from '../i18n/en';
import { text, tr } from './partner1a-fixtures';

const FACT = 'partners-desk@example.test';

describe('PC-56 PARTNER-1a · W272 help (render)', () => {
  it('the mailbox is the platform FACT, printed as a mailto — and only that one', () => {
    const html = renderToStaticMarkup(<HelpView t={tr(en)} mailbox={{ kind: 'published', address: FACT }} />);
    expect(html).toContain(`href="mailto:${FACT}"`);
    expect((html.match(/mailto:/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/support@|krishalaya\.(com|in)/i);
  });
  it('no published mailbox → "not published yet" and no mailto at all; a failed read says so', () => {
    const none = renderToStaticMarkup(<HelpView t={tr(en)} mailbox={{ kind: 'none' }} />);
    expect(text(none)).toContain(en['partner1.help.mailboxNone']); expect(none).not.toContain('mailto:');
    expect(text(renderToStaticMarkup(<HelpView t={tr(en)} mailbox={{ kind: 'error' }} />))).toContain(en['partner1.help.mailboxError']);
  });
  it('no phone, no hours, no round-the-clock promise, no ticket desk (refused by name)', () => {
    const w = text(renderToStaticMarkup(<HelpView t={tr(en)} mailbox={{ kind: 'none' }} />));
    expect(w).not.toMatch(/\+91|1800|24\s*[×x]\s*7|business hours|IST\)|P0|P1|TKT-/);
    for (const k of partner1RefusalKeys('help')) expect([k, w.includes(en[k])]).toEqual([k, true]);
  });
  it('the article prints the rail\'s constants: both headers, the format, HMAC-SHA256 over t.body, the tolerance, the ladder, the attempts', () => {
    const html = renderToStaticMarkup(<HelpView t={tr(en)} mailbox={{ kind: 'none' }} />); const w = text(html);
    expect(html).toContain('data-kv-article="webhook-signatures"');
    expect(w).toContain(`${WEBHOOK_CONTRACT.signatureHeader} header`); expect(w).toContain('X-KV-Signature');
    expect(w).toContain('t=…,v1=…'); expect(w).toContain('HMAC-SHA256'); expect(w).toContain('{t}.{raw body}');
    expect(w).toContain(`more than ${WEBHOOK_CONTRACT.toleranceSec} seconds`);
    expect(w).toContain('1m · 5m · 30m · 2h · 12h'); expect(w).toContain(`${WEBHOOK_CONTRACT.maxAttempts} attempts`);
  });
  it('"Raise a ticket" leads to the DECOR chain and says to write to the mailbox', () => {
    const html = renderToStaticMarkup(<HelpView t={tr(en)} mailbox={{ kind: 'none' }} />);
    expect(html).toContain('href="/help?ticket=review"'); expect(text(html)).toContain(en['partner1.help.ticketRefused']);
  });
});
