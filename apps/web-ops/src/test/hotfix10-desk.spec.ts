// apps/web-ops/src/test/hotfix10-desk.spec.ts · PC-56 HOTFIX-10 — the console half of "the desk learns nothing it should not".
// No render harness exists in web-ops yet (B21 is OPS-1a's first commit), so the page facts are pinned as SOURCE assertions over the
// exact files, beside the pure mapping:
//   H10-1 · the kiosk prints "already has an account" ONLY for the API's 409 USER_PHONE_ALREADY_REGISTERED and "Account created" only for the 201;
//   H10-2 · the AePS "device certified" box is NOT pre-ticked;
//   H10-4 · the middleware writes the SAME cookie the console reads — one constant, one definition.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { kioskCreateOutcome, PHONE_ALREADY_REGISTERED } from '../features/kiosk/form';
import { LANG_COOKIE } from '../lib/lang-cookie';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
/** Code only: block and line comments removed (so a comment naming the old cookie is not a "use" of it). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('HOTFIX-10 · H10-1 · the kiosk outcome', () => {
  it('201 (resolved) → created; 409 USER_PHONE_ALREADY_REGISTERED → exists; anything else → the generic failure', () => {
    expect(PHONE_ALREADY_REGISTERED).toBe('USER_PHONE_ALREADY_REGISTERED');
    expect(kioskCreateOutcome({ ok: true })).toBe('created');
    expect(kioskCreateOutcome({ ok: false, status: 409, code: 'USER_PHONE_ALREADY_REGISTERED' })).toBe('exists');
    expect(kioskCreateOutcome({ ok: false, status: 409, code: 'CONFLICT' })).toBe('create');          // a key in flight is not "exists"
    expect(kioskCreateOutcome({ ok: false, status: 422, code: 'INVALID_PHONE' })).toBe('create');
    expect(kioskCreateOutcome({ ok: false, status: 500 })).toBe('create');
    expect(kioskCreateOutcome({ ok: false })).toBe('create');
  });

  // NAMED UPDATE (PC-56 OPS-1c): the create act MOVED from app/kiosk/actions.ts (deleted; `/kiosk` now answers a 307 to /kiosk/home) to the W381
  // page's own action, app/kiosk/session-start/actions.ts, and its outcome is the kiosk chain (`?act=success` / `?act=failure&reason=…`). The
  // same pins, on the new home — unweakened: "exists" only through kioskCreateOutcome's 409 USER_PHONE_ALREADY_REGISTERED rule (now via
  // kioskFailureReason, which delegates to it), and success only after the call resolved.
  it('the server action routes every failure through kioskFailureReason (→ kioskCreateOutcome) and reports success only after the call resolved', () => {
    const src = code(read('app/kiosk/session-start/actions.ts'));
    expect(src).toMatch(/failure\(e instanceof SdkError \? kioskFailureReason\(e\.status, e\.code\) : 'create'\)/);
    expect(code(read('features/ops1/kiosk.ts'))).toMatch(/kioskCreateOutcome\(\{ ok: false, status, code: code \?\? undefined \}\) === 'exists'\) return 'exists'/);
    expect(src).not.toMatch(/status === 409 \? 'exists'/);                                               // the old any-409 mapping is gone
    expect(src.indexOf('await opsClient().users.create(')).toBeLessThan(src.indexOf('?act=success'));
    expect(src).not.toMatch(/kiosk\?ok=created/);
  });

  // NAMED UPDATE (PC-56 OPS-1c): the sentence moved from `kiosk.error.exists` (deleted with the OW-1 keys) to `ops1.kiosk.reason.exists`,
  // printed on the W3331 failure state. Same words, same pins.
  it('the 409 sentence ×3 says only that the number has an account and that she signs in herself — no "step", no person', () => {
    expect(en['ops1.kiosk.reason.exists']).toBe('This number already has an account. She signs in herself, on her own phone.');
    for (const cat of [en, hi, gu]) {
      expect(cat['ops1.kiosk.reason.exists']).toBeTruthy();
      expect(cat['ops1.kiosk.reason.exists']).not.toMatch(/\{|\d/);                                             // no placeholder, no digit
    }
    expect(hi['ops1.kiosk.reason.exists']).not.toBe(en['ops1.kiosk.reason.exists']);
    expect(gu['ops1.kiosk.reason.exists']).not.toBe(en['ops1.kiosk.reason.exists']);
    expect(en['kiosk.error.exists']).toBeUndefined();
  });
});

describe('HOTFIX-10 · H10-2 · the device-certified box is unticked by default', () => {
  // NAMED UPDATE (PC-56 OPS-1b): the record form MOVED from app/money/page.tsx (deleted; /money now answers a 307) to the W391 view
  // components/ops1/AepsViews.tsx, and its keys from `aeps.*` to `ops1.aeps.record.*`. The same pins, on the new home — unweakened.
  it('the W391 record view: the deviceCertified checkbox carries no defaultChecked / checked', () => {
    const src = code(read('components/ops1/AepsViews.tsx'));
    const tags = [...src.matchAll(/<input[^>]*name="deviceCertified"[^>]*\/>/g)].map((m) => m[0]);
    expect(tags).toHaveLength(1);
    expect(tags[0]).not.toMatch(/defaultChecked|\bchecked\b/);
    expect(tags[0]).toMatch(/type="checkbox"/);
  });
  it('the hint ×3 no longer tells the operator to UNcheck a pre-ticked box', () => {
    expect(en['ops1.aeps.record.deviceHint']).toMatch(/^Tick this only if/);
    expect(en['ops1.aeps.record.deviceHint']).toMatch(/cannot check a device/);
    expect(en['ops1.aeps.record.deviceHint']).not.toMatch(/Uncheck only/);
    for (const cat of [hi, gu]) { expect(cat['ops1.aeps.record.deviceHint']).toBeTruthy(); expect(cat['ops1.aeps.record.deviceHint']).not.toBe(en['ops1.aeps.record.deviceHint']); }
  });
});

describe('HOTFIX-10 · H10-4 · one language cookie', () => {
  it('the one definition is kvo_lang', () => expect(LANG_COOKIE).toBe('kvo_lang'));
  it('the middleware imports it (no copy of its own) and writes it', () => {
    const src = code(read('middleware.ts'));
    expect(src).toMatch(/import \{ LANG_COOKIE \} from '\.\/lib\/lang-cookie';/);
    expect(src).not.toMatch(/const LANG_COOKIE/);
    expect(src).toMatch(/res\.cookies\.set\(LANG_COOKIE,/);
  });
  it('lib/i18n re-exports the same constant (the reader the app uses)', () => {
    const src = code(read('lib/i18n.ts'));
    expect(src).toMatch(/import \{ LANG_COOKIE \} from '\.\/lang-cookie';/);
    expect(src).not.toMatch(/const LANG_COOKIE/);
    expect(src).toMatch(/cookies\(\)\.get\(LANG_COOKIE\)/);
  });
  it('no code file outside lib/lang-cookie.ts spells a language-cookie name', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
    const hits = walk(SRC)
      .filter((p) => !p.endsWith(join('lib', 'lang-cookie.ts')) && !p.includes(`${join('src', 'test')}`))
      .filter((p) => /kv[a-z]_lang/.test(code(readFileSync(p, 'utf8'))))
      .map((p) => p.slice(SRC.length + 1));
    expect(hits).toEqual([]);
  });
});
