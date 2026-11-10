// apps/web-ops/src/test-render/animals-register.render.test.tsx · PC-56 OPS-4b · W395 — HONEST in the OPS-1c kiosk chrome: the component takes no data (it
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

const r = (cat: Record<string, string>) => renderToStaticMarkup(<AnimalHonestView t={tr(cat)} surface="animal_register" />);

describe('PC-56 OPS-4b · animals-register (W395)', () => {
  const h = r(en);
  it('reads nothing (the component takes only the translator and its surface) and has ZERO controls', () => {
    expect(AnimalHonestView.length).toBe(1);
    expect(CONTROLS.test(h)).toBe(false);
  });
  it('the founder\'s words, exact (en) and in hi / gu (×3)', () => {
    expect(text(h)).toContain('An animal is registered by its owner in her own app. This desk does not register animals.');
    for (const cat of [hi, gu]) { expect(cat['ops4.q5.register']).not.toBe(en['ops4.q5.register']); expect(text(r(cat))).toContain(cat['ops4.q5.register']); }
  });
  it('Q4\'s second sentence is NOT printed (premise false at merge: the owner\'s app shows only the last four digits of a tag)', () => {
    expect(/sees her animals and their tags/i.test(text(h))).toBe(false);
  });
  it('the kiosk chrome (her own sign-in) and the edges: the other animal pages and the kiosk home', () => {
    expect(text(h)).toContain(en['ops1.kiosk.statement']);
    expect(h).toContain('href="/kiosk/home"');
    expect((h.match(/data-kv-edge="(eartag|animal_register|animal_transfer)"/g) ?? []).length).toBe(2);
    expect(h).not.toContain('data-kv-edge="animal_register"');
  });
  it('no animal, tag, owner or person is shown; no canon false word affirmed; no arithmetic', () => {
    expect(/\d{4}/.test(visible(h).replace(/W\d{3,4}/g, ''))).toBe(false);
    expect(FALSE_4B.test(affirmed(visible(h)))).toBe(false); expect(FALSE_4A.test(affirmed(visible(h)))).toBe(false); expect(MATH_4A.test(visible(h))).toBe(false);
  });
  it('every refusal of the page BY NAME (the kiosk chrome\'s among them)', () => {
    const ids = OPS4_REFUSALS.filter((x) => x.surfaces.includes('animal_register')).map((x) => x.id);
    expect(ids).toContain('kiosk_ambassador');
    for (const id of ids) expect([id, h.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
  });
});
