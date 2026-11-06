// apps/web-ops/src/test-render/kiosk-start.render.test.tsx · PC-56 OPS-1c · W381 /kiosk/session-start — THE ONE FORM (create an account for a
// new number). Controls pinned exactly (2 inputs, 1 select, 1 form, 1 button); the language options ARE the registry's live set; the 409 is
// Q9-A's sentence and NOTHING about the person — even when the URL carries a name or a phone; no "session" or OTP claim (Q10-A).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LANGUAGES } from '@krishalaya/i18n';
import { KioskFailureView, KioskStartView } from '../components/ops1/KioskViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS1_REFUSALS } from '../features/ops1/refusals';
import { KIOSK_FAILURE_REASONS, kioskFailureReason, parseKioskReason } from '../features/ops1/kiosk';
import { text, tr, visible } from './ops1a-fixtures';
import { controls } from './ops1b-fixtures';
import { FALSE_1C, LANGS_1C } from './ops1c-fixtures';

const T = tr(en);
const page = renderToStaticMarkup(<KioskStartView t={T} mode="page" action="/kiosk/session-start" languages={LANGS_1C} />);
const FORM = { input: 2, select: 1, textarea: 0, form: 1, button: 1 };
const PERSON = { name: 'Zarinabanu Testwala', phone: '+919912345205', village: 'Testpur' };
const hostile = { act: 'failure', reason: 'exists', fullName: PERSON.name, phone: PERSON.phone, village: PERSON.village, name: PERSON.name };

describe('PC-56 OPS-1c · /kiosk/session-start creates an account for a new number', () => {
  it('the controls are pinned exactly: 2 inputs (phone, name), 1 select (language), 1 form, 1 button — and nothing else', () => {
    expect(controls(page)).toEqual(FORM);
    expect((page.match(/<(?:input|select)[^>]*name="([^"]+)"/g) ?? []).map((m) => m.replace(/.*name="([^"]+)".*/, '$1')).sort()).toEqual(['fullName', 'languageCode', 'phone']);
  });
  it('the language options are the registry\'s live codes, in registry order — no literal list', () => {
    const opts = Array.from(page.matchAll(/<option[^>]*value="([^"]+)"/g)).map((m) => m[1]);
    expect(opts).toEqual(LANGUAGES.map((l) => l.code));
    for (const l of LANGUAGES) expect(text(page)).toContain(l.nameNative);
  });
  it('the statement first; the lead says a known number shows nothing; no session, OTP or canon false word in the visible text', () => {
    expect(visible(page).indexOf(en['ops1.kiosk.statement'])).toBeGreaterThan(-1);
    expect(visible(page).indexOf(en['ops1.kiosk.statement'])).toBeLessThan(visible(page).indexOf(en['ops1.kiosk.start.phone']));
    expect(text(page)).toContain('nothing about that account is shown');
    expect(FALSE_1C.test(visible(page))).toBe(false);
    expect(page).toContain('href="/kiosk/home"');
  });
  it('the 409: Q9-A\'s sentence verbatim ×3 — and no name, phone or village, even when the URL carries them', () => {
    for (const cat of [en, hi, gu]) {
      const html = renderToStaticMarkup(<KioskFailureView t={tr(cat)} searchParams={hostile} />);
      expect(text(html)).toContain(cat['ops1.kiosk.reason.exists']);
      for (const leak of [PERSON.name, 'Zarinabanu', PERSON.phone, '12345205', PERSON.village]) expect([leak, html.includes(leak)]).toEqual([leak, false]);
      expect(controls(html).input + controls(html).form).toBe(0);
    }
    expect(en['ops1.kiosk.reason.exists']).toBe('This number already has an account. She signs in herself, on her own phone.');
  });
  it('every failure reason renders its own sentence ×3; a hostile reason falls back to "could not be created", never echoed', () => {
    for (const r of KIOSK_FAILURE_REASONS) for (const cat of [en, hi, gu]) expect([r, typeof cat[`ops1.kiosk.reason.${r}`] === 'string' && cat[`ops1.kiosk.reason.${r}`].length > 0]).toEqual([r, true]);
    const inj = renderToStaticMarkup(<KioskFailureView t={T} searchParams={{ act: 'failure', reason: '<b>Zarina</b>' }} />);
    expect(text(inj)).toContain(en['ops1.kiosk.reason.create']); expect(inj).not.toContain('Zarina');
    expect([parseKioskReason({ reason: 'exists' }), parseKioskReason({ reason: ['phone'] }), parseKioskReason({ reason: 'x' }), parseKioskReason(undefined)]).toEqual(['exists', 'phone', 'create', 'create']);
  });
  it('the server\'s answer → the named reason: only 409 USER_PHONE_ALREADY_REGISTERED is "exists"; 400 / 422 a rule; 403 forbidden; else create', () => {
    expect([kioskFailureReason(409, 'USER_PHONE_ALREADY_REGISTERED'), kioskFailureReason(409, 'CONFLICT'), kioskFailureReason(422, 'INVALID_PHONE'), kioskFailureReason(400, 'BAD_REQUEST'),
      kioskFailureReason(403, 'FORBIDDEN'), kioskFailureReason(500, 'X'), kioskFailureReason(undefined, null)]).toEqual(['exists', 'create', 'rule', 'rule', 'forbidden', 'create', 'create']);
  });
  it('every W381 refusal is listed by name', () => {
    for (const r of OPS1_REFUSALS.filter((x) => x.surfaces.includes('kiosk_start'))) expect([r.id, page.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
});
