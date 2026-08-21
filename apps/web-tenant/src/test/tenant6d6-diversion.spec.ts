// apps/web-tenant/src/test/tenant6d6-diversion.spec.ts · W170's playbook step 2, on screen — TENANT-6d-6.
//
// The playbook's second step stops being a suggestion: *"If ≥ 7.5°C by 16:00 → divert evening shift to Bhesan (route
// notice to 87 pourers, Gujarati voice)"*. What is asserted here is what the screens must NOT overstate:
//
//   • **a request is not a diversion.** One person cannot move a village's milk, so the success state says a dairy lead
//     still has to sign it — not that the milk has moved;
//   • **a diversion is not a transfer.** Nobody's membership, card or history changes, and the confirm step says so,
//     because a screen that blurred the two would be describing TENANT-6d-3's act;
//   • **the members are NOT told by this act.** Printed on the confirm step AND the success step: a cooperative that
//     believes the platform phoned 87 families will not phone them itself, and those families arrive at a locked centre;
//   • **the counter board explains itself.** A live diversion makes two of TENANT-6a's numbers disagree on purpose, and
//     without a badge an honest diverted evening reads exactly like a broken counter.
//
// And the wave's other discipline: this act rides TENANT-6d-5's SHARED mutate chain rather than a second copy of it.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DIVERSIONS_HREF, DIVERT_HREF, divertHref, diversionNoteKey, diversionNoticeGapKey, diversionRowText,
  diversionShiftKey, diversionStateKey, diversionStateTone, unionPickupGapKey,
} from '../features/dairy/diversion';
import { mutateRefusalKey, mutateStep, reasonState } from '../features/mutate/chain';
import type { DairyDiversionRow } from '@krishalaya/sdk-js';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');
const hasKey = (k: string) => LOCALES.every((l) => dict(l).includes(`'${k}':`));
const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/** The refusal codes, read from the API's own domain — derived, not retyped (TENANT-6d-4's ruling). */
function apiRefusals(): string[] {
  const file = fs.readFileSync(path.join(__dirname, '../../../api/src/modules/dairy/domain/dairy-diversion.ts'), 'utf8');
  const block = file.slice(file.indexOf('export const DIVERSION_REFUSALS = ['));
  const list = block.slice(block.indexOf('['), block.indexOf('] as const'));
  return [...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
}

/* =========================================================================================================== */
describe('TENANT-6d-6 · a request is not a diversion', () => {
  it('has three states and one sentence each', () => {
    expect(diversionStateKey({ state: 'requested' })).toBe('dairy.diversion.state.requested');
    expect(diversionStateKey({ state: 'live' })).toBe('dairy.diversion.state.live');
    expect(diversionStateKey({ state: 'cancelled' })).toBe('dairy.diversion.state.cancelled');
    for (const s of ['requested', 'live', 'cancelled']) expect(hasKey(`dairy.diversion.state.${s}`)).toBe(true);
  });

  it('tones the middle state as the only one that moves milk', () => {
    // `requested` is AMBER, not green: somebody still has to sign it, and a green badge on an unsigned request is how a
    // cooperative sends 87 families to a village nobody authorised.
    expect(diversionStateTone({ state: 'requested' })).toBe('warn');
    expect(diversionStateTone({ state: 'live' })).toBe('ok');
    expect(diversionStateTone({ state: 'cancelled' })).toBe('muted');
  });

  it('says on the SUCCESS screen that a second signature is still needed', () => {
    const page = src('app/dairy/bmc/divert/page.tsx');
    const success = page.slice(page.indexOf("step === 'success'"), page.indexOf("step === 'failure'"));
    // Not "diverted" — "requested", and waiting.
    expect(success).toContain('mutate.diversion.requested');
    expect(success).toContain('mutate.diversion.needsSecondSignature');
    expect(hasKey('mutate.diversion.requested')).toBe(true);
    expect(hasKey('mutate.diversion.needsSecondSignature')).toBe(true);
    for (const l of LOCALES) {
      const line = dict(l).split('\n').find((x) => x.includes("'mutate.diversion.needsSecondSignature':")) ?? '';
      expect({ l, long: line.length > 70 }).toEqual({ l, long: true });
    }
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-6 · the promises the screens refuse to make', () => {
  it('says the members are NOT told, on the confirm step AND the success step', () => {
    // The most dangerous missing feature in this wave: a cooperative that thinks the platform phoned 87 families will
    // not phone them, and those families carry their milk to a locked door.
    expect(diversionNoticeGapKey()).toBe('dairy.diversion.noticeNotSent');
    expect(hasKey(diversionNoticeGapKey())).toBe(true);
    const page = src('app/dairy/bmc/divert/page.tsx');
    expect(page.split('diversionNoticeGapKey()').length - 1).toBeGreaterThanOrEqual(2);
    // And the copy names the canon's own promise, so a reader knows what is missing rather than that something is.
    expect(dict('en')).toMatch(/voice notice in Gujarati/);
  });

  it('says a diversion is NOT a transfer', () => {
    expect(hasKey('mutate.diversion.notATransfer')).toBe(true);
    expect(src('app/dairy/bmc/divert/page.tsx')).toContain('mutate.diversion.notATransfer');
    // TENANT-6d-3's act is the other one, and the copy distinguishes them in every language.
    for (const l of LOCALES) {
      const line = dict(l).split('\n').find((x) => x.includes("'mutate.diversion.notATransfer':")) ?? '';
      expect({ l, long: line.length > 60 }).toEqual({ l, long: true });
    }
  });

  it('prints the SIZE of the decision', () => {
    // W170 says "87 pourers" and means it: the number is the decision.
    expect(hasKey('mutate.diversion.affected')).toBe(true);
    const page = src('app/dairy/bmc/divert/page.tsx');
    expect(page).toContain('preview.affectedMembers');
    expect(page).toContain('mutate.diversion.affected');
  });

  it('has a sentence for every refusal the API can return', () => {
    const codes = apiRefusals();
    expect(codes.length).toBeGreaterThanOrEqual(16);
    for (const c of codes) expect({ c, has: hasKey(mutateRefusalKey('diversion', c)) }).toEqual({ c, has: true });
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-6 · the playbook step, and the one still not built', () => {
  it('offers the act from the playbook step itself, carrying the focus tank\'s centre', () => {
    expect(divertHref('mcc-1')).toBe(`${DIVERT_HREF}?step=confirm&fromMccId=mcc-1&shift=evening`);
    // The canon's own shift: *"divert EVENING shift to Bhesan"*. A morning default would be a different sentence.
    expect(divertHref('mcc-1', 'morning')).toContain('shift=morning');
    const monitor = src('app/dairy/bmc/page.tsx');
    expect(monitor).toContain("p.step === 'divert_next_shift' && p.built");
    expect(monitor).toContain('divertHref(focusTile.mccId)');
    expect(hasKey('dairy.bmc.playbook.divertAct')).toBe(true);
  });

  it('says why the step is only a suggestion when the act is switched off', () => {
    const monitor = src('app/dairy/bmc/page.tsx');
    expect(monitor).toContain('!view.diversionEnabled');
    expect(hasKey('dairy.bmc.playbook.divertNotEnabled')).toBe(true);
  });

  it('names step 3 as NOT BUILT, on the step', () => {
    // TENANT-6d-1 marked the whole playbook unbuilt. Now that step 2 is an act, a silent step 3 would read as a third
    // actionable item — so it says what is missing: no union, no pickup, no batch test.
    expect(unionPickupGapKey()).toBe('dairy.bmc.playbook.unionPickupUnbuilt');
    expect(hasKey(unionPickupGapKey())).toBe(true);
    expect(src('app/dairy/bmc/page.tsx')).toContain('unionPickupGapKey()');
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-6 · the counter board explains itself', () => {
  it('badges both sides of a live diversion, and stays quiet on an ordinary evening', () => {
    expect(diversionNoteKey({ divertedIn: 3, divertedOut: 0 })).toBe('dairy.counter.diversion.in');
    expect(diversionNoteKey({ divertedIn: 0, divertedOut: 87 })).toBe('dairy.counter.diversion.out');
    expect(diversionNoteKey({ divertedIn: 3, divertedOut: 87 })).toBe('dairy.counter.diversion.both');
    expect(diversionNoteKey({ divertedIn: 0, divertedOut: 0 })).toBeNull();
    for (const k of ['in', 'out', 'both']) expect(hasKey(`dairy.counter.diversion.${k}`)).toBe(true);
  });

  it('prints the badge next to the POURERS column, where the disagreement shows', () => {
    // The roll and the pours are the two numbers a diversion makes disagree, so the explanation belongs beside them.
    const board = src('app/dairy/page.tsx');
    const col = board.slice(board.indexOf("t.t('dairy.col.pourers')"), board.indexOf("t.t('dairy.col.quality')"));
    expect(col).toContain('diversionNoteKey(c)');
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-6 · one chain, two acts', () => {
  it('rides TENANT-6d-5\'s mutate chain instead of copying it', () => {
    const page = src('app/dairy/bmc/divert/page.tsx');
    expect(page).toContain("from '../../../../features/mutate/chain'");
    // No second implementation of the step machinery or the URL carrying.
    expect(page).not.toContain('new URLSearchParams');
    expect(mutateStep('confirm')).toBe('confirm');
    expect(reasonState('power cut')).toBe('ok');
  });

  it('asks the API only on the confirm step, with both centres present', () => {
    const page = src('app/dairy/bmc/divert/page.tsx');
    const guard = page.indexOf("if (step === 'confirm' && from.length > 0 && to.length > 0)");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(page.indexOf('previewDiversion'));
  });

  it('re-implements no rule in the action, and keeps the values on a failure', () => {
    const action = src('app/dairy/bmc/divert/actions.ts');
    expect(/new RegExp|\.test\(/.test(action)).toBe(false);
    expect(action).toContain("carryValues('failure', values)");
    expect(action).toContain('error=${encodeURIComponent(code)}');
    expect(action).toContain('revalidatePath(BOARD)');
    // The reason is dropped from the SUCCESS url — it is in the audit row now (TENANT-6d-5's ruling).
    const success = action.slice(action.indexOf('step=success'));
    expect(success).not.toContain('reason=');
  });

  it('links its success screen to the record\'s own audit trail', () => {
    const page = src('app/dairy/bmc/divert/page.tsx');
    expect(page).toContain("canLinkAudit('dairy_shift_diversion', createdId)");
    expect(page).toContain("auditHref('dairy_shift_diversion'");
  });

  it('uses the counter board\'s OWN shift words, not a second copy', () => {
    // The parity gate's duplicate check caught exactly this when the wave first added its own `morning`.
    expect(diversionShiftKey('evening')).toBe('dairy.shift.evening');
    for (const l of LOCALES) {
      const count = dict(l).split("'dairy.shift.evening':").length - 1;
      expect({ l, count }).toEqual({ l, count: 1 });
    }
  });

  it('names a register href and a row by its two villages', () => {
    expect(DIVERSIONS_HREF).toBe('/dairy/diversions');
    expect(diversionRowText({ fromCode: 'MCC-VNT', toCode: 'MCC-BHE' } as DairyDiversionRow)).toBe('MCC-VNT → MCC-BHE');
  });
});
