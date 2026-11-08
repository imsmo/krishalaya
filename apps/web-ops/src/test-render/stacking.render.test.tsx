// apps/web-ops/src/test-render/stacking.render.test.tsx · PC-56 OPS-2a · W374 /warehouse/stacking — HONEST, READS NOTHING. The two facts ×3 (no table
// or column holds a place, stack, bag count or pest-control log — pinned live in ops2a (4)); zero inputs; no figure; bay, stack, bag arithmetic,
// pest-control log, quarantine, the bay suggestion and the audit-count hold refused by name; linked FROM the dashboard (the edge the canon never drew).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StackingView } from '../components/ops2/IntakeViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { CONTROLS, text, tr, visible } from './ops1a-fixtures';
import { FALSE_2A } from './ops2a-fixtures';

const html = renderToStaticMarkup(<StackingView t={tr(en)} />);
describe('PC-56 OPS-2a · /warehouse/stacking is honest', () => {
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: the two facts verbatim, the statement first', (_l, cat) => {
    const h = text(renderToStaticMarkup(<StackingView t={tr(cat)} />));
    expect(h).toContain(cat['ops2.stacking.statement']); expect(h).toContain(cat['ops2.stacking.receipt']);
    expect(h.indexOf(cat['ops2.stacking.statement'])).toBeLessThan(h.indexOf(cat['ops2.stacking.receipt']));
  });
  it('the facts are the brief\'s, word for word; no promise about the future', () => {
    expect(en['ops2.stacking.statement']).toBe('Where goods sit in the warehouse is not recorded on this platform, and neither is pest control.');
    expect(en['ops2.stacking.receipt']).toBe('No receipt on this platform carries a location.');
    expect(/\b(until|will|soon|later|yet)\b/i.test(visible(html))).toBe(false);
  });
  it('zero inputs, no digit; none of the canon\'s claims outside the two negated facts and the DECOR label', () => {
    expect(CONTROLS.test(html)).toBe(false);
    expect(/\d/.test(visible(html))).toBe(false);
    const rest = visible(html).replace(en['ops2.stacking.statement'], '').replace(en['ops2.stacking.pestAct'], '');
    expect(FALSE_2A.test(rest)).toBe(false);
  });
  it('the refusals by name', () => {
    for (const id of ['bay_stack', 'bag_arithmetic', 'pest_log', 'ambient', 'quarantine', 'bay_suggestion', 'audit_hold', 'bay_retry', 'wh_plan_settings'])
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
  });
  it('the only links: the dashboard (REAL) and the two DECOR chains on this page', () => {
    expect(Array.from(html.matchAll(/href="([^"]+)"/g)).map((m) => m[1])).toEqual(['/warehouse/dashboard', '/warehouse/stacking?form=review', '/warehouse/stacking?act=confirm']);
  });
});
