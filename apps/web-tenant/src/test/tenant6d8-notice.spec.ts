// apps/web-tenant/src/test/tenant6d8-notice.spec.ts · PC-56 TENANT-6d-8 · what the screens may say about the notice.
//
// The API's own spec covers what happens; this covers what a dairy desk READS about it, and the difference between the
// two is where a screen starts overstating. Three rules:
//
//   • the confirm step says WHO tells the families — the platform, or this cooperative — because a cooperative that
//     believes the platform phoned 87 people will not phone them, and the families end up at a locked centre;
//   • the register's badge is the notice's own state, with no `sent` anywhere in it;
//   • the delivery sentence is chosen by the GAP between queued and reached, because that gap is the number that sends
//     somebody walking round three houses.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  diversionDeliveryKey, diversionNoticePromiseKey, diversionNoticeStateKey, diversionNoticeTone,
} from '../features/dairy/diversion';

const DICTS = { en, hi, gu } as const;
const hasKey = (k: string) => (Object.keys(en) as string[]).includes(k);
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('PC-56 TENANT-6d-8 · the notice, as a dairy desk reads it', () => {
  it('names WHO tells the families, on the confirm step', () => {
    expect(diversionNoticePromiseKey(true)).toBe('dairy.diversion.notice.willBeTold');
    expect(diversionNoticePromiseKey(false)).toBe('dairy.diversion.notice.tellThemYourself');
    // The two sentences must not be interchangeable: one is a promise the platform keeps, the other is an instruction
    // to the person reading it.
    expect(en['dairy.diversion.notice.willBeTold']).not.toBe(en['dairy.diversion.notice.tellThemYourself']);
    expect(en['dairy.diversion.notice.tellThemYourself']).toMatch(/NOT/);
    expect(en['dairy.diversion.notice.willBeTold']).toMatch(/own language/);
  });

  it('has a key for every notice state, in all three languages, and none of them says `sent`', () => {
    for (const state of ['not_enabled', 'not_signed', 'nobody_to_tell', 'queued', 'retracted'] as const) {
      const key = diversionNoticeStateKey(state);
      expect(key).toBe(`dairy.diversion.notice.${state}`);
      expect(hasKey(key)).toBe(true);
      for (const [lang, dict] of Object.entries(DICTS)) {
        const text = (dict as Record<string, string>)[key];
        expect(typeof text === 'string' && text.length > 10 ? 'present' : `${lang}:${key} MISSING`).toBe('present');
      }
    }
    // `queued` is the strongest state and its copy says the members were TOLD — which is true of the handover, and the
    // report is what says whether the phone rang. The word "sent" is not used, in any language, on purpose.
    expect(Object.keys(en).filter((k) => k.startsWith('dairy.diversion.notice.'))).not.toContain('dairy.diversion.notice.sent');
  });

  it('tones a queued notice as done and a switched-off one as a warning', () => {
    expect(diversionNoticeTone('queued')).toBe('ok');
    expect(diversionNoticeTone('not_enabled')).toBe('warn');     // somebody has to do this by hand
    expect(diversionNoticeTone('retracted')).toBe('warn');       // two messages went out; a reader should notice
    expect(diversionNoticeTone('not_signed')).toBe('muted');
    expect(diversionNoticeTone('nobody_to_tell')).toBe('muted');
  });

  it('chooses the delivery sentence BY THE GAP between queued and reached', () => {
    // The whole reason to show a report at all: 84 of 87 is the number that sends somebody walking round three houses.
    expect(diversionDeliveryKey({ queuedFor: 87, people: 87 })).toBe('dairy.diversion.notice.allReached');
    expect(diversionDeliveryKey({ queuedFor: 87, people: 84 })).toBe('dairy.diversion.notice.someReached');
    expect(diversionDeliveryKey({ queuedFor: 87, people: 0 })).toBe('dairy.diversion.notice.noneReached');
    expect(diversionDeliveryKey({ queuedFor: 0, people: 0 })).toBe('dairy.diversion.notice.nobodyToTell');
    // Nothing announced ⇒ no sentence at all, rather than a zero that reads like a failure.
    expect(diversionDeliveryKey(null)).toBeNull();
    expect(diversionDeliveryKey({ queuedFor: null, people: 0 })).toBeNull();
    // More reached than queued cannot happen, and if it ever does the honest answer is the strongest one, not a crash.
    expect(diversionDeliveryKey({ queuedFor: 3, people: 4 })).toBe('dairy.diversion.notice.allReached');
    for (const k of ['allReached', 'someReached', 'noneReached', 'nobodyToTell']) {
      expect(hasKey(`dairy.diversion.notice.${k}`)).toBe(true);
    }
    // And the three outcomes read DIFFERENTLY — a report whose sentences were interchangeable would be decoration.
    const texts = ['allReached', 'someReached', 'noneReached'].map((k) => en[`dairy.diversion.notice.${k}`]);
    expect(new Set(texts).size).toBe(3);
    expect(en['dairy.diversion.notice.noneReached']).toMatch(/NOBODY/);
  });

  it('says it on the CONFIRM step and on the request\'s success step', () => {
    const page = src('app/dairy/bmc/divert/page.tsx');
    expect(page).toContain('diversionNoticePromiseKey(preview.noticeEnabled)');
    // A request announces nothing, and the success screen of a request must not imply otherwise.
    expect(page).toContain('dairy.diversion.notice.not_signed');
    // The retired gap key is gone from the whole app — 6d-6 printed "not built" here and the notice exists now.
    expect(page).not.toContain('noticeNotSent');
    expect(Object.keys(en)).not.toContain('dairy.diversion.noticeNotSent');
  });

  it('keeps the three catalogues in step — Law 7, and the parity gate\'s own rule', () => {
    const mine = Object.keys(en).filter((k) => k.startsWith('dairy.diversion.notice.'));
    expect(mine.length).toBeGreaterThanOrEqual(13);
    for (const k of mine) {
      expect(Object.keys(hi)).toContain(k);
      expect(Object.keys(gu)).toContain(k);
      // Gujarati is the launch language of the cooperative this screen was drawn for: a key that fell back to English
      // here would be the same defect TENANT-6d-7 spent a wave removing, one layer up.
      expect((gu as Record<string, string>)[k]).not.toBe((en as Record<string, string>)[k]);
    }
  });
});
