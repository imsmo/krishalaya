// apps/web-ops/src/test-render/enwr-issue.render.test.tsx · PC-56 OPS-2b · W375 /warehouse/enwr/issue — HONEST, READS NOTHING (founder Q3-A). The
// statement of fact ×3; zero inputs; no figure; "Send OTP to farmer", the issue act, the valuation and "repository confirmed" refused by name; the
// only links: the register (built) and the DECOR act chain on THIS page.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EnwrIssueView } from '../components/ops2/EnwrViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { CONTROLS, text, tr, visible } from './ops1a-fixtures';
import { FALSE_2B } from './ops2b-fixtures';

const html = renderToStaticMarkup(<EnwrIssueView t={tr(en)} />);
describe('PC-56 OPS-2b · /warehouse/enwr/issue is honest', () => {
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: the statement verbatim, first', (_l, cat) => {
    const h = renderToStaticMarkup(<EnwrIssueView t={tr(cat)} />);
    expect(text(h)).toContain(cat['ops2.enwrIssue.statement']);
    expect(text(h).indexOf(cat['ops2.enwrIssue.statement'])).toBeLessThan(text(h).indexOf(cat['ops2.enwrIssue.records']));
  });
  it('the statement is the brief\'s, word for word; no sentence about the future', () => {
    expect(en['ops2.enwrIssue.statement']).toBe('This platform does not issue an eNWR. No receipt is recorded here in a depositor\'s name.');
    expect(/\b(until|will|soon|yet|later|when .* connected)\b/i.test(visible(html))).toBe(false);
  });
  it('zero inputs, no digit, none of the canon\'s claims', () => {
    expect(CONTROLS.test(html)).toBe(false);
    expect(/\d/.test(visible(html))).toBe(false);
    expect(FALSE_2B.test(visible(html))).toBe(false);
  });
  it('the refusals by name: send a code, the issue act, the value, the holder, "repository confirmed", the repository link', () => {
    for (const id of ['send_otp', 'issue_act', 'receipt_value', 'holder_name', 'repository_confirmed', 'repository_link', 'prepared_steps', 'market_reference', 'value_stale', 'manager_restricted', 'grade_link'])
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
  });
  it('the only links: the register and the DECOR chain on this page', () => {
    expect(Array.from(html.matchAll(/href="([^"]+)"/g)).map((m) => m[1])).toEqual(['/warehouse/enwr/registry', '/warehouse/enwr/issue?act=confirm']);
  });
});
