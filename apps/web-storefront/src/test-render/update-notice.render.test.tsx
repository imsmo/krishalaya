// apps/web-storefront/src/test-render/update-notice.render.test.tsx · PC-56 STORE-6a · D4 (W319 "updates itself politely") — "A NEW VERSION IS READY",
// NEVER OVER A FORM WITH CONTENT. The view renders the sentence, "Refresh now" (a plain button outside any form — the signal guard never holds it)
// and "or it applies the next time you open it"; whether it may show is `updateNoticeAllowed(formsDirty(document))` — a page whose form holds
// what the person typed shows nothing, a clean page shows it. Mutant M5 (`updateNoticeAllowed` ignoring a dirty form) turns this red.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UpdateNoticeView } from '../components/offline/UpdateNotice';
import { formsDirty, updateNoticeAllowed, type DirtyField } from '../features/store6/sw-rules';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { text } from './store1b-harness';

const labels = (cat: Record<string, string>) => ({ ready: cat['store6.update.ready'], refresh: cat['store6.update.refresh'], later: cat['store6.update.later'] });
const page = (fields: DirtyField[]) => ({ querySelectorAll: (sel: string) => (sel === 'form input, form textarea, form select' ? fields : []) as never });
const shown = (fields: DirtyField[]) => renderToStaticMarkup(<UpdateNoticeView show={updateNoticeAllowed(formsDirty(page(fields)))} labels={labels(en)} />);

describe('STORE-6a · D4 · the polite update notice', () => {
  it('a clean page (hidden keys, untouched fields): the notice shows — the sentence, "Refresh now", "or next time"', () => {
    const h = shown([{ type: 'hidden', value: 'idem-key', defaultValue: 'idem-key' }, { type: 'text', value: '', defaultValue: '' }, { type: 'checkbox', checked: false, defaultChecked: false }]);
    expect(h).toContain('data-kv-update="ready"');
    expect(text(h)).toContain(`${en['store6.update.ready']} ${en['store6.update.refresh']} ${en['store6.update.later']}`);
    expect(h).toContain('<button type="button" class="kv-btn--link" data-kv-update-refresh="">');
  });
  it.each([
    ['a typed message', [{ type: 'text', value: 'Is the wheat still available?', defaultValue: '' }]],
    ['a changed quantity', [{ type: 'number', value: '12', defaultValue: '10' }]],
    ['a ticked box', [{ type: 'checkbox', checked: true, defaultChecked: false }]],
    ['a review being written', [{ value: 'Fresh, well packed', defaultValue: '' }]],
  ] as Array<[string, DirtyField[]]>)('NEVER over a form with content: %s', (_n, fields) => {
    expect(shown(fields)).toBe('');
  });
  it('nothing waiting → nothing; Hindi words', () => {
    expect(renderToStaticMarkup(<UpdateNoticeView show={false} labels={labels(en)} />)).toBe('');
    expect(text(renderToStaticMarkup(<UpdateNoticeView show labels={labels(hi)} />))).toContain(hi['store6.update.ready']);
  });
});
