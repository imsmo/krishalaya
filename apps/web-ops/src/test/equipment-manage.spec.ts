// apps/web-ops/src/test/equipment-manage.spec.ts · OW-3 → PC-56 OPS-4a.
//
// NAMED UPDATE (PC-56 OPS-4a, founder Q3-A applied from OPS-1 Q2-A "the ops console only READS" money): this spec pinned OW-3's owner money
// desk on `/equipment/[id]` — the quote / start / complete / settle gates and builders of `features/equipment/manage.ts`, and (HOTFIX-13) the
// settle refusal shown by name there. Q3-A REMOVES that desk from this console: "Quotes, starting, finishing and payment are done by the
// machine's owner in their own app, not on this console." The gates and builders are deleted with it, so the pins are REPLACED (never
// weakened) by the pins of the decision itself: the desk, its action and its helpers are gone; `/equipment` and `/equipment/:id` are REAL
// 307s; the HOTFIX-13 refusal now lives where the settle button lives — the owner's mobile app (`equip.detail.settleHoursNotConfirmed`,
// pinned ×3 in apps/mobile/src/core/__tests__/pc50-equipment.spec.ts) — and its words are on `/chc/bookings` as the founder's Q1 sentence.
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.join(__dirname, '..');
const exists = (rel: string) => fs.existsSync(path.join(SRC, rel));

describe('OW-3 → OPS-4a · the owner money desk is gone from this console (Q3-A)', () => {
  it('the OW-3 pages, their server action and the money gates/builders are deleted', () => {
    for (const rel of ['app/equipment/page.tsx', 'app/equipment/[id]/page.tsx', 'app/equipment/actions.ts', 'features/equipment/manage.ts'])
      expect([rel, exists(rel)]).toEqual([rel, false]);
  });
  it('/equipment and /equipment/:id answer REAL 307s to the hire pages', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(path.join(SRC, '..', 'next.config.js')) as { redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> };
    const r = (await cfg.redirects()).filter((x) => x.source.startsWith('/equipment'));
    expect(r).toEqual([{ source: '/equipment', destination: '/chc/dashboard', permanent: false }, { source: '/equipment/:id', destination: '/chc/bookings', permanent: false }]);
  });
  it('the HOTFIX-13 refusal is the owner app\'s now; the founder\'s Q1 sentence is on /chc/bookings ×3', async () => {
    const mobile = path.join(SRC, '..', '..', 'mobile', 'src');
    expect(fs.readFileSync(path.join(mobile, 'features', 'equipment', 'equipment.ts'), 'utf8')).toContain("'equip.detail.settleHoursNotConfirmed'");
    const [en, hi, gu] = await Promise.all(['en', 'hi', 'gu'].map(async (l) => (await import(`../i18n/${l}`)) as Record<string, Record<string, string>>));
    for (const m of [en.en, hi.hi, gu.gu]) expect(typeof m['ops4.q1.words']).toBe('string');
    expect(en.en['ops4.q1.words']).toBe("The owner records the hours worked. Nothing beyond the deposit leaves the renter's wallet until she confirms those hours in her own app.");
    expect(en.en['chc.error.hoursNotConfirmed']).toBeUndefined();
  });
});
