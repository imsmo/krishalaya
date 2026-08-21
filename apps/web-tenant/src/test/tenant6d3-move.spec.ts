// apps/web-tenant/src/test/tenant6d3-move.spec.ts · W171's move, as the screens describe it — TENANT-6d-3.
//
// Three screens changed when a membership became able to move, and every one of them changed in the same direction:
// from printing what is true TODAY to printing what was true THEN — or saying that it cannot.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isCalendarDay, isMemberCode, moveCautionKey, moveDisabledKey, moveEarliestKey, moveHeadingKey, movePickerGapKey,
  moveRefusalKey, showMoveForm,
} from '../features/dairy/centres';
import { codeIsCurrentKey, noCentreKey, pouredCentresText, spansCentresKey } from '../features/dairy/cycles';
import { flagCodeIsCurrentKey } from '../features/dairy/quality';
import type { DairyMoveCaution, DairyMoveRefusal } from '@krishalaya/sdk-js';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');
const hasKey = (k: string) => LOCALES.every((l) => dict(l).includes(`'${k}':`));

/* =========================================================================================================== */
describe('TENANT-6d-3 · where a bill\'s milk came from', () => {
  it('names ONE village plainly and TWO with the pours at each', () => {
    expect(pouredCentresText({ pouredCentres: [{ mccId: 'c1', code: 'MCC-AND-01', pours: 28 }] })).toBe('MCC-AND-01');
    // A fortnight in which the member moved. Printing only the first village is the register quietly deciding which
    // half of somebody's milk counts.
    expect(pouredCentresText({ pouredCentres: [
      { mccId: 'c1', code: 'MCC-AND-01', pours: 9 }, { mccId: 'c2', code: 'MCC-AND-02', pours: 5 },
    ] })).toBe('MCC-AND-01 (9) · MCC-AND-02 (5)');
  });

  it('has NO centre for a bill with no pours behind it, and never borrows one', () => {
    // A correction, or a manual bill. Borrowing the membership's current centre is exactly the defect this wave fixed.
    expect(pouredCentresText({ pouredCentres: [] })).toBeNull();
    expect(hasKey(noCentreKey())).toBe(true);
    expect(hasKey(spansCentresKey())).toBe(true);
    expect(hasKey(codeIsCurrentKey())).toBe(true);
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-3 · the card shown beside a dated record', () => {
  it('says so when the code is today\'s rather than the one that was carried', () => {
    expect(flagCodeIsCurrentKey({ memberCodeIsCurrent: true })).toBe('dairy.quality.flag.codeIsCurrent');
    // Resolved as of the pour: nothing to say.
    expect(flagCodeIsCurrentKey({ memberCodeIsCurrent: false })).toBeNull();
    expect(hasKey('dairy.quality.flag.codeIsCurrent')).toBe(true);
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-3 · the move, on the centres board', () => {
  it('draws the form ONLY when the cooperative has switched the move on', () => {
    expect(showMoveForm({ transferEnabled: true })).toBe(true);
    // A form drawn while the flag is off sends an operator into a 404 — worse than a sentence saying it is off.
    expect(showMoveForm({ transferEnabled: false })).toBe(false);
    expect(hasKey(moveHeadingKey())).toBe(true);
    expect(hasKey(moveDisabledKey())).toBe(true);
    expect(hasKey(movePickerGapKey())).toBe(true);
    expect(hasKey(moveEarliestKey())).toBe(true);
  });

  it('checks the two shapes a form can check, and leaves the rest to the API', () => {
    expect(isCalendarDay('2026-08-21')).toBe(true);
    expect(isCalendarDay('21-08-2026')).toBe(false);
    expect(isCalendarDay('2026-8-1')).toBe(false);
    expect(isCalendarDay('')).toBe(false);
    // A card must be something: this platform does not number a cooperative's cards, so it cannot fill a blank in.
    expect(isMemberCode('AND2-0104')).toBe(true);
    expect(isMemberCode('   ')).toBe(false);
    expect(isMemberCode('')).toBe(false);
    expect(isMemberCode('x'.repeat(41))).toBe(false);
  });

  it('has copy for EVERY refusal the API can return — a raw code on screen tells an operator nothing', () => {
    const refusals: DairyMoveRefusal[] = [
      'FLAG_OFF', 'NO_MANAGE', 'MEMBERSHIP_INACTIVE', 'SAME_CENTRE', 'CENTRE_INACTIVE',
      'CODE_TAKEN', 'CODE_HELD_AT_DESTINATION', 'BEFORE_LAST_POUR', 'BEFORE_ROUTE_START', 'NO_CURRENT_ROUTE',
    ];
    for (const r of refusals) expect(hasKey(moveRefusalKey(r))).toBe(true);
  });

  it('has copy for every caution, including the one that says a debt follows the person', () => {
    const cautions: DairyMoveCaution[] = ['SPLITS_OPEN_CYCLE', 'UNBILLED_POURS_AT_OLD_CENTRE', 'DEBT_FOLLOWS_MEMBER'];
    for (const c of cautions) expect(hasKey(moveCautionKey(c))).toBe(true);
  });

  it('has copy for the form\'s own fields and its outcome', () => {
    for (const k of ['membershipId', 'toCentre', 'choose', 'newCode', 'effectiveFrom', 'submit', 'datesNote', 'movedCount']) {
      expect(hasKey(`dairy.centres.move.${k}`)).toBe(true);
    }
    expect(hasKey('dairy.centres.ok.moved')).toBe(true);
  });
});
