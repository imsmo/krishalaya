// apps/web-ops/src/test-render/animals-transfer.render.test.tsx · PC-56 OPS-4b · W396 — HONEST in the OPS-1c kiosk chrome: the component takes no data (it
// reads nothing), ZERO inputs, the founder's words exact in en and their own text in hi / gu (×3), the kiosk statement, the links the canon never
// drew, every refused canon line BY NAME; no animal, tag, owner or person is shown.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnimalHonestView } from '../components/ops4/AnimalViews';
import { OPS4_REFUSALS } from '../features/ops4/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { CONTROLS, text, tr, visible } from './ops1a-fixtures';
import { FALSE_4A, MATH_4A, affirmed } from './ops4a-fixtures';
import { FALSE_4B } from './ops4b-fixtures';

const r = (cat: Record<string, string>) => renderToStaticMarkup(<AnimalHonestView t={tr(cat)} surface="animal_transfer" />);

describe('PC-56 OPS-4b · animals-transfer (W396)', () => {
  const h = r(en);
  it('reads nothing (the component takes only the translator and its surface) and has ZERO controls', () => {
    expect(AnimalHonestView.length).toBe(1);
    expect(CONTROLS.test(h)).toBe(false);
  });
  it('the founder\'s words, exact (en) and in hi / gu (×3)', () => {
    expect(text(h)).toContain('Ownership transfer is not available on this platform yet. Nothing here changes who owns an animal.');
    for (const cat of [hi, gu]) { expect(cat['ops4.q5.transfer']).not.toBe(en['ops4.q5.transfer']); expect(text(r(cat))).toContain(cat['ops4.q5.transfer']); }
  });
  it('Q4\'s second sentence is NOT printed (premise false at merge: the owner\'s app shows only the last four digits of a tag)', () => {
    expect(/sees her animals and their tags/i.test(text(h))).toBe(false);
  });
  it('the kiosk chrome (her own sign-in) and the edges: the other animal pages and the kiosk home', () => {
    expect(text(h)).toContain(en['ops1.kiosk.statement']);
    expect(h).toContain('href="/kiosk/home"');
    expect((h.match(/data-kv-edge="(eartag|animal_register|animal_transfer)"/g) ?? []).length).toBe(2);
    expect(h).not.toContain('data-kv-edge="animal_transfer"');
  });
  it('no animal, tag, owner or person is shown; no canon false word affirmed; no arithmetic', () => {
    expect(/\d{4}/.test(visible(h).replace(/W\d{3,4}/g, ''))).toBe(false);
    expect(FALSE_4B.test(affirmed(visible(h)))).toBe(false); expect(FALSE_4A.test(affirmed(visible(h)))).toBe(false); expect(MATH_4A.test(visible(h))).toBe(false);
  });
  it('every refusal of the page BY NAME (the kiosk chrome\'s among them)', () => {
    const ids = OPS4_REFUSALS.filter((x) => x.surfaces.includes('animal_transfer')).map((x) => x.id);
    expect(ids).toContain('kiosk_ambassador');
    for (const id of ids) expect([id, h.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
  });
});

describe('PC-56 OPS-4b · W396 — the fact the code proves', () => {
  it('a sold animal keeps its tag number, and it cannot be registered again (pashu_aadhaar is unique over every row — 0009)', () => {
    const h = renderToStaticMarkup(<AnimalHonestView t={tr(en)} surface="animal_transfer" />);
    expect(text(h)).toContain('An animal marked as sold keeps its tag number, and that number cannot be registered again.');
    for (const id of ['transfer_order', 'inaph_handshake', 'insurance_follows', 'transfer_states']) expect(h).toContain(`data-kv-refusal="${id}"`);
  });
});
