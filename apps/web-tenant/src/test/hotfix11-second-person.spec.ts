// apps/web-tenant/src/test/hotfix11-second-person.spec.ts · PC-56 HOTFIX-11 — A SECOND PERSON ON EVERY MILK BILL (web-tenant).
//
// The API is the rule (founder H11-1 … H11-5, 2026-11-06); this console keeps its buttons and must SAY the refusal, in the secretary's
// own language, rather than print `DAIRY_BILL_PAYER_IS_APPROVER` at her. And it no longer offers "approve" on a disputed bill (Q4-A).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { DAIRY_REFUSAL_CODES, dairyRefusalKey, nextBillActions } from '../features/dairy/calc';

const CATS = { en, hi, gu } as Record<string, Record<string, string>>;
const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('HOTFIX-11 · the refusals, as sentences', () => {
  it('every refusal code the API can now answer has a sentence in en, hi and gu — and none is the raw code', () => {
    expect([...DAIRY_REFUSAL_CODES]).toEqual([
      'DAIRY_BILL_APPROVER_IS_PREVIEWER', 'DAIRY_BILL_PAYER_IS_APPROVER', 'DAIRY_BILL_PREVIEWER_UNKNOWN', 'DAIRY_BILL_APPROVER_UNKNOWN',
      'DAIRY_BILL_SIGNER_UNKNOWN', 'DAIRY_BILL_DISPUTE_UNANSWERED', 'DAIRY_CYCLE_CHECKER_IS_PREVIEWER', 'DAIRY_CYCLE_NOT_PREVIEWED',
    ]);
    for (const code of DAIRY_REFUSAL_CODES) for (const l of ['en', 'hi', 'gu']) {
      const v = CATS[l][`dairy.error.${code}`];
      expect([l, code, typeof v]).toEqual([l, code, 'string']);
      expect(v.length).toBeGreaterThan(20);
      expect(v).not.toContain(code);
    }
    expect(['en', 'hi', 'gu'].map((l) => typeof CATS[l]['dairy.bill.secondPerson'])).toEqual(['string', 'string', 'string']);
  });
  it('the English sentences are the founder\'s, word for word', () => {
    expect(en['dairy.error.DAIRY_BILL_APPROVER_IS_PREVIEWER']).toBe('The person who showed this bill to the member cannot also approve it. A second person on your dairy desk approves it — your administrator can give a colleague the dairy key.');
    expect(en['dairy.error.DAIRY_BILL_PAYER_IS_APPROVER']).toBe('The person who approved this bill cannot also pay it. Another person on your dairy desk pays it.');
    expect(en['dairy.error.DAIRY_BILL_DISPUTE_UNANSWERED']).toBe('This bill has an open objection from the member. Answer it first — reject it and show her the bill again, or void and rebuild it.');
  });
  it('dairyRefusalKey picks the sentence for a known code and nothing for any other', () => {
    expect(dairyRefusalKey('DAIRY_BILL_PAYER_IS_APPROVER')).toBe('dairy.error.DAIRY_BILL_PAYER_IS_APPROVER');
    expect(dairyRefusalKey('BILL_NOT_PAYABLE')).toBeNull();
    expect(dairyRefusalKey('save')).toBeNull();
    expect(dairyRefusalKey(null)).toBeNull();
    expect(dairyRefusalKey('')).toBeNull();
  });
  it('/dairy/console prints the sentence for ?error=<code> (raw code only when there is no sentence), and carries the help line', () => {
    const page = src('app/dairy/console/page.tsx');
    expect(page).toContain('const refusalKey = dairyRefusalKey(errorKey);');
    expect(page).toContain("{refusalKey ? t.t(refusalKey) : `${t.t('dairy.error')}: ${errorKey}`}");
    expect(page).not.toContain("{t.t('dairy.error')}: {errorKey}");
    expect(page).toContain("t.t('dairy.bill.secondPerson')");
  });
  it('the console\'s actions return to the console (a refusal used to land on /dairy, which reads no ?error=)', () => {
    const actions = src('app/dairy/actions.ts');
    expect(actions).toContain("const PATH = '/dairy/console';");
    expect(actions).not.toMatch(/const PATH = '\/dairy';/);
  });
  it('/dairy/cycles translates its refusals the same way', () => {
    expect(src('app/dairy/cycles/page.tsx')).toContain('dairyRefusalKey(searchParams.error)');
  });
});

describe('HOTFIX-11 · Q4-A — no approve on a disputed bill', () => {
  it('a disputed bill offers no action; every other status is unchanged', () => {
    expect(nextBillActions('disputed')).toEqual([]);
    expect(nextBillActions('draft')).toEqual(['preview']);
    expect(nextBillActions('previewed')).toEqual(['approve']);
    expect(nextBillActions('approved')).toEqual(['pay']);
  });
});
