// modules/dairy/__tests__/tenant6d7-notice-vars-service.spec.ts · PC-56 TENANT-6d-7 · the READING half.
//
// THIS FILE EXISTS BECAUSE THE MUTATION PASS SAID SO. Five mutants of `DairyNoticeVarsService` survived the first run —
// hardcode the labels instead of reading them, fill a missing label in with its own key, assume two decimal places for
// an unknown currency, fall back to INR when the tenant's country join misses, keep only the first language of each
// label — and every one of them survived for the same reason: the service had NO test of its own. The pure rules were
// covered twice over and the code that decides what those rules are given was covered nowhere.
//
// A survivor list is evidence only of the suites that ran, and a suite that does not exist is the strongest version of
// that lesson.
import { DairyNoticeVarsService } from '../services/dairy-notice-vars.service';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { pickLang, LangMap } from '../../../core/i18n/lang-map';

/** `ui_messages` rows as the database would hand them over: one row per (key, language). */
const UI_ROWS = [
  { key: 'dairy.shift.morning', language_code: 'en', text: 'morning' },
  { key: 'dairy.shift.morning', language_code: 'hi', text: 'subah' },
  { key: 'dairy.shift.morning', language_code: 'gu', text: 'સવાર' },
  { key: 'dairy.shift.evening', language_code: 'en', text: 'evening' },
  { key: 'dairy.shift.evening', language_code: 'hi', text: 'shaam' },
  { key: 'dairy.shift.evening', language_code: 'gu', text: 'સાંજ' },
  { key: 'dairy.quality.outcome.cleared', language_code: 'en', text: 'cleared' },
  { key: 'dairy.quality.outcome.cleared', language_code: 'gu', text: 'પાસ થયું' },
  { key: 'dairy.quality.outcome.rejected', language_code: 'en', text: 'not accepted' },
  { key: 'dairy.quality.outcome.rejected', language_code: 'gu', text: 'સ્વીકાર્યું નથી' },
  { key: 'dairy.dispute.outcome.upheld', language_code: 'en', text: 'your objection was accepted' },
  { key: 'dairy.dispute.outcome.upheld', language_code: 'gu', text: 'તમારો વાંધો સ્વીકાર્યો' },
  { key: 'dairy.dispute.outcome.rejected', language_code: 'en', text: 'your objection was not accepted' },
  { key: 'dairy.dispute.outcome.rejected', language_code: 'gu', text: 'તમારો વાંધો સ્વીકાર્યો નથી' },
];

/**
 * The words in the fake are DELIBERATELY NOT the words in the seed — `evening` is spelled `EVENING-FROM-THE-DATABASE`
 * below in one test — because a service that hardcodes its labels would pass against a fake that agrees with the
 * hardcoding. The value has to be one that could only have come from the read.
 */
const uiRepo = (rows = UI_ROWS) => new UiMessageRepository({
  forTenant: () => ({ query: async () => ({ rows, rowCount: rows.length }) }),
} as never);

const lookups = (values: Array<{ id: string; code: string; name: string; sortOrder: number; meta: Record<string, unknown> }> = []) => ({
  values: jest.fn(async (_t: string, lang: string) => values.map((v) => ({ ...v, name: `${v.name}-${lang}` }))),
});

const centres = (name: string | null = 'Vanthali') => ({
  getById: jest.fn(async () => (name === null ? null : { toProps: () => ({ id: 'm1', code: 'MCC-VNT', defaultName: name, isActive: true }) })),
});

const tx = (rows: unknown[]) => ({ query: jest.fn(async () => ({ rows, rowCount: rows.length })) });

const svc = (over: { ui?: UiMessageRepository; lookups?: unknown; centres?: unknown } = {}) =>
  new DairyNoticeVarsService((over.ui ?? uiRepo()) as never, (over.lookups ?? lookups()) as never, (over.centres ?? centres()) as never);

describe('PC-56 TENANT-6d-7 · the service READS the words rather than knowing them', () => {
  it('builds every label from the database rows, in all three languages', async () => {
    const rows = UI_ROWS.map((r) => (r.key === 'dairy.shift.evening' && r.language_code === 'gu'
      ? { ...r, text: 'SANJ-FROM-THE-DATABASE' } : r));
    const labels = await svc({ ui: uiRepo(rows) }).labels();
    // A hardcoded label would say 'સાંજ'; only a READ can say this.
    expect(pickLang(labels.shift.evening, 'gu')).toBe('SANJ-FROM-THE-DATABASE');
    expect(pickLang(labels.shift.evening, 'hi')).toBe('shaam');
    expect(pickLang(labels.shift.morning, 'gu')).toBe('સવાર');
    expect(pickLang(labels.qualityOutcome.rejected, 'gu')).toBe('સ્વીકાર્યું નથી');
    expect(pickLang(labels.disputeOutcome.upheld, 'gu')).toBe('તમારો વાંધો સ્વીકાર્યો');
  });

  it('keeps EVERY language of a label, not just the first row it reads', async () => {
    const labels = await svc().labels();
    for (const m of [labels.shift.evening, labels.shift.morning]) {
      expect(Object.keys(m).sort()).toEqual(['en', 'gu', 'hi']);
    }
  });

  it('REFUSES to word a notice when a label is missing, rather than printing its key', async () => {
    const without = UI_ROWS.filter((r) => r.key !== 'dairy.quality.outcome.cleared');
    // A key rendered into an SMS ("your milk was dairy.quality.outcome.cleared") is worse than a loud failure: the
    // failure gets fixed, the SMS gets sent to 87 families.
    await expect(svc({ ui: uiRepo(without) }).labels()).rejects.toThrow(/ui_messages has no 'dairy.quality.outcome.cleared'/);
  });

  it('reads the labels ONCE per process — they are platform data that changes on deploy', async () => {
    const rows = UI_ROWS;
    let calls = 0;
    const repo = new UiMessageRepository({
      forTenant: () => ({ query: async () => { calls += 1; return { rows, rowCount: rows.length }; } }),
    } as never);
    const s = svc({ ui: repo });
    await s.labels(); await s.labels(); await s.labels();
    expect(calls).toBe(1);
  });
});

describe('PC-56 TENANT-6d-7 · money is read, never assumed', () => {
  it('REFUSES a currency the platform holds no scale for', async () => {
    // Rule zero, as an error rather than an assumption: guessing two decimals is how a JPY or KWD cooperative gets a
    // bill wrong by a factor of a hundred.
    await expect(svc().moneyContext(tx([{ timezone: 'Asia/Kolkata', minor_units: null }]) as never, 't1', 'JPY'))
      .rejects.toThrow(/no minor_units for JPY/);
    await expect(svc().moneyContext(tx([]) as never, 't1', 'INR')).rejects.toThrow(/has no country/);
    await expect(svc().moneyContext(tx([{ timezone: 'Asia/Kolkata', minor_units: 0 }]) as never, 't1', 'JPY'))
      .resolves.toEqual({ timezone: 'Asia/Kolkata', minorUnits: 0 });   // ZERO is a scale, not a missing value
  });

  it('REFUSES to invent the tenant\'s currency', async () => {
    await expect(svc().tenantMoneyContext(tx([]) as never, 't1')).rejects.toThrow(/no currency and no timezone/);
    await expect(svc().tenantMoneyContext(tx([{ timezone: 'Asia/Kolkata', currency_code: 'BDT', minor_units: null }]) as never, 't1'))
      .rejects.toThrow(/no minor_units for BDT/);
    // The platform's other reader of this fact defaults to 'INR' when the join misses; this one does not, and the
    // difference is a cross-border deployment quietly wording somebody's money in the wrong currency.
    await expect(svc().tenantMoneyContext(tx([{ timezone: 'Asia/Dhaka', currency_code: 'BDT', minor_units: 2 }]) as never, 't1'))
      .resolves.toEqual({ timezone: 'Asia/Dhaka', currencyCode: 'BDT', minorUnits: 2 });
  });

  it('words a bill preview against the TENANT\'S currency and clock, both read', async () => {
    const vars = await svc().billPreviewed(
      tx([{ timezone: 'Asia/Dhaka', currency_code: 'BDT', minor_units: 2 }]) as never, 't1',
      { periodStart: '2026-07-01', periodEnd: '2026-07-15', totalLitresMilli: 204_526n, netMinor: 841_200n,
        deductionsMinor: 0n, windowEndsAt: new Date('2026-07-16T03:30:00.000Z') });
    expect(vars.net).toBe('BDT 8,412.00');
    expect(vars.window_ends).toBe('16/07 09:30');   // Dhaka, not Kolkata, not the process's timezone
  });
});

describe('PC-56 TENANT-6d-7 · the centre, and the deduction vocabulary', () => {
  it('names the centre by NAME, and names nothing rather than a UUID when it cannot be read', async () => {
    // The labels are read THROUGH THE CALLER'S TRANSACTION when one is given — a word added to `ui_messages` seconds
    // ago must not be invisible to the notice that depends on it — so the fake transaction answers those rows.
    const named = await svc().qualityOpened(tx(UI_ROWS) as never, 't1', { mccId: 'm1', shift: 'evening' });
    expect(named.mcc).toBe('Vanthali');
    expect(pickLang(named.shift, 'gu')).toBe('સાંજ');
    const unknown = await svc({ centres: centres(null) }).qualityOpened(tx(UI_ROWS) as never, 't1', { mccId: 'gone', shift: 'morning' });
    // A farmer reading *"your milk at 7f3c-…-91 is held"* learns less than one reading *"your milk is held"*, and the
    // id would leak an internal key into an SMS.
    expect(unknown.mcc).toBe('');
  });

  it('takes the deduction type\'s name from the LOOKUP VOCABULARY, in each language (Law 6)', async () => {
    const lk = lookups([{ id: 'l1', code: 'feed_credit', name: 'feed credit', sortOrder: 1, meta: {} }]);
    const vars = await svc({ lookups: lk }).deductionInstruction(
      tx([{ timezone: 'Asia/Kolkata', currency_code: 'INR', minor_units: 2 }]) as never, 't1',
      { typeCode: 'feed_credit', maxPerCycleMinor: 20_000n });
    expect(pickLang(vars.what as LangMap, 'gu')).toBe('feed credit-gu');
    expect(pickLang(vars.what as LangMap, 'hi')).toBe('feed credit-hi');
    expect(vars.how_much).toEqual({ en: 'INR 200.00' });
    // Asked once per language, and no more: `LookupsService` caches, and this must not turn a notice into a fan of reads.
    expect(lk.values).toHaveBeenCalledTimes(3);
  });

  it('falls back to the CODE for a deduction type the vocabulary does not have', async () => {
    const vars = await svc().deductionInstruction(tx([]) as never, 't1', { typeCode: 'mystery', maxPerCycleMinor: null });
    // Not a blank: a member told *"mystery"* can ask what it is; a member told nothing cannot.
    expect(vars.what).toEqual({ en: 'mystery' });
    expect(pickLang(vars.how_much as LangMap, 'gu')).toBe('પ્રતિ ચક્ર મર્યાદા નથી');
  });
});
