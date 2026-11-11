// apps/web-ops/src/test-render/rtl1g-ops.render.test.tsx · PC-56 RTL-1g — the two ops leftovers RTL-1e listed as owed.
//
// (a) CODES INSIDE SENTENCES on views that did not receive `lang`: the centre code (ops3.pos.centre — the counter's chrome and its centre
//     picker), the cooler's centre code (ops3.bmc.cooler — the cooler card, the cooler picker, the reading review), the machine registration
//     (ops4.machine.label via machineText — the CHC dashboard, machine page, hire cards, upkeep list/alerts and the form's <option>s), the logger
//     serials and the last-breach reference on the sensor pages (IotViews), the WDRA number on the warehouse dashboard (IntakeViews) and the
//     repository name (EnwrViews). Each is now isolated with the existing `ltrText` — under Arabic ONLY. Under en/hi/gu every view is proven
//     BYTE-IDENTICAL to the same render with `ltrText` swapped for the identity (the 93aa6915 text), and the comparison can see a difference
//     under Arabic.
// (b) THE SWITCHER'S "Coming soon": it was the English literal under every language; it is now `lang.comingSoon` from the catalogue. The real
//     Sidebar (real lib/i18n, only `next/headers` faked) prints each language's words; the en value is exactly "Coming soon", so the en sidebar
//     is byte-identical.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockReq: { cookies: Record<string, string> } = { cookies: {} };
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => ({
  cookies: () => ({ get: (n: string) => (n in mockReq.cookies ? { name: n, value: mockReq.cookies[n] } : undefined), has: (n: string) => n in mockReq.cookies }),
  headers: () => new Headers({}),
}));

import { PosCollectView, PosHomeView, PosQualityView, PosShiftView, PosSlipView } from '../components/ops3/CounterViews';
import { BmcView, ReadingReview } from '../components/ops3/BmcViews';
import { ChcBookingsView, ChcDashboardView, ChcEquipmentView, machineText } from '../components/ops4/ChcViews';
import { MaintForm, MaintenanceView } from '../components/ops4/UpkeepViews';
import { IotDashboardView, IotDeviceView, IotHealthView } from '../components/ops4/IotViews';
import { WhDashboardView } from '../components/ops2/IntakeViews';
import { EnwrReceiptView, EnwrRegistryView } from '../components/ops2/EnwrViews';
import { Sidebar } from '../components/Sidebar';
import { LANG_COOKIE } from '../lib/i18n';
import { readDashboard } from '../features/ops2/intake';
import * as spanModule from '../features/rtl/span';
import { tr } from './ops1a-fixtures';
import { CENTRE, CENTRE_2, ROLL, ROWS, TODAY, POUR, RECORDED as POURED, CARD } from './ops3a-fixtures';
import { T1, TILES, POINTS } from './ops3b-fixtures';
import { CATEGORIES, HIRES, M1, MACHINES, MAINT, RATES } from './ops4a-fixtures';
import { ALERTS, DRAFT, ENTRIES } from './ops4b-fixtures';
import { DETAIL, LAST_BREACH, LOGGERS, OVERVIEW, READ_AT, REGISTRY, S_COOLER, SILENCES, SILENCE_MINUTES } from './ops4c-fixtures';
import { fakeIo } from './ops2a-fixtures';
import { RECEIPTS_2B } from './ops2b-fixtures';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ar } from '../i18n/ar';

const CAT: Record<string, Record<string, string>> = { en, hi, gu, ar };
const LRI = '⁦'; const PDI = '⁩';
const iso = (s: string) => `${LRI}${s}${PDI}`;
const noop = async () => undefined;

/** One view per site, given the page language. */
type Mount = (lang: string) => Promise<React.ReactElement> | React.ReactElement;
const SITES: Array<[string, Mount, string[]]> = [
  ['pos home: the centre code in the chrome', (l) => <PosHomeView t={tr(CAT[l])} lang={l} state="ok" centre={CENTRE} centres={[CENTRE]} today={TODAY} rows={ROWS} />, ['TC-01']],
  ['pos home: the centre picker (several centres)', (l) => <PosHomeView t={tr(CAT[l])} lang={l} state="ok" centre={null} centres={[CENTRE, CENTRE_2]} today={TODAY} rows={null} />, ['TC-01', 'TC-02']],
  ['pos collect: the centre code', (l) => <PosCollectView t={tr(CAT[l])} lang={l} state="ok" centre={CENTRE} centres={[CENTRE]} today={TODAY} roll={ROLL} code={null} nextCursor={null} error={null} />, ['TC-01']],
  ['pos collect: the centre picker', (l) => <PosCollectView t={tr(CAT[l])} lang={l} state="ok" centre={null} centres={[CENTRE, CENTRE_2]} today={TODAY} roll={null} code={null} nextCursor={null} error={null} />, ['TC-01', 'TC-02']],
  ['pos quality: the centre code', (l) => <PosQualityView t={tr(CAT[l])} lang={l} centre={CENTRE} pour={POUR} memberCode="TC-001" milkType="cow" idemKey="k" action={noop} back="/pos/collect" />, ['TC-01']],
  ['pos slip: the centre code', (l) => <PosSlipView t={tr(CAT[l])} lang={l} state="ok" pour={POURED} card={CARD} cardRead centre={CENTRE} />, ['TC-01']],
  ['pos shift: the centre code', (l) => <PosShiftView t={tr(CAT[l])} lang={l} state="ok" centre={CENTRE} centres={[CENTRE]} today={TODAY} rows={ROWS} cooler={null as never} tiles={[]} />, ['TC-01']],
  ['bmc: the cooler card and the cooler picker', (l) => <BmcView t={tr(CAT[l])} lang={l} state="ok" scope="custody" centres={[CENTRE]} tiles={TILES} cooler={T1} points={POINTS} />, ['TC-01', 'TC-02']],
  ['bmc review: the cooler', (l) => <ReadingReview t={tr(CAT[l])} lang={l} tile={T1} tempC="4.6" action={noop} />, ['TC-01']],
  ['chc dashboard: the machine registration', (l) => <ChcDashboardView t={tr(CAT[l])} lang={l} state="ok" machines={MACHINES} machinesMore={false} categories={CATEGORIES} hires={HIRES} hiresMore={false} />, ['TEST-REG-1']],
  ['chc machine page: the registration in the heading', (l) => <ChcEquipmentView t={tr(CAT[l])} lang={l} state="ok" asset={M1} categories={CATEGORIES} rates={RATES} maintenance={MAINT} />, ['TEST-REG-1']],
  ['chc bookings: the machine on each hire card', (l) => <ChcBookingsView t={tr(CAT[l])} lang={l} state="ok" hires={HIRES} nextCursor={null} status={undefined} machines={MACHINES} categories={CATEGORIES} />, ['TEST-REG-1']],
  ['upkeep: the machine list, the alerts and the form options', (l) => <MaintenanceView t={tr(CAT[l])} lang={l} state="ok" machines={MACHINES} machinesMore={false} categories={CATEGORIES} entries={ENTRIES} alerts={ALERTS} />, ['TEST-REG-1']],
  ['upkeep form (the error chain): the options', (l) => <MaintForm t={tr(CAT[l])} lang={l} machines={MACHINES} categories={CATEGORIES} values={DRAFT} />, ['TEST-REG-1']],
  ['iot dashboard: logger serials and the last-breach reference', (l) => <IotDashboardView t={tr(CAT[l])} lang={l} state="ok" readAt={READ_AT} overview={OVERVIEW} lastBreach={LAST_BREACH} loggers={LOGGERS} registry={REGISTRY} />, ['LOG-TEST-1', 'LOG-TEST-2', LAST_BREACH.subjectRef]],
  ['iot device: the logger serial', (l) => <IotDeviceView t={tr(CAT[l])} lang={l} state="ok" readAt={READ_AT} hours={48} type="bmc_unit" id={S_COOLER} detail={DETAIL} />, ['LOG-TEST-1']],
  ['iot health: the flagged logger serials', (l) => <IotHealthView t={tr(CAT[l])} lang={l} state="ok" silences={SILENCES} loggers={LOGGERS} silenceMinutes={SILENCE_MINUTES} />, [LOGGERS.find((x) => SILENCES.some((s) => s.deviceId === x.deviceId))!.serial]],
  ['warehouse dashboard: the WDRA number', async (l) => { const r = await readDashboard(fakeIo(), {}); return <WhDashboardView t={tr(CAT[l])} lang={l} state={r.state} groups={r.groups} />; }, ['TEST-WDRA-9']],
  ['eNWR registry: the repository in each row', (l) => <EnwrRegistryView t={tr(CAT[l])} lang={l} state="ok" receipts={RECEIPTS_2B} size={25} nextCursor={null} />, ['NERL', 'CCRL']],
  ['eNWR receipt: the repository', (l) => <EnwrReceiptView t={tr(CAT[l])} lang={l} state="ok" receipt={RECEIPTS_2B[0]} unitCode="qtl" />, ['NERL']],
];

async function render(mount: Mount, lang: string): Promise<string> { return renderToStaticMarkup(await mount(lang)); }
/** The view as built, and the same view with ltrText as the identity (the text it printed at 93aa6915). */
async function nowAndBefore(mount: Mount, lang: string): Promise<[string, string]> {
  const now = await render(mount, lang);
  const spy = jest.spyOn(spanModule, 'ltrText').mockImplementation((s) => s);
  try { return [now, await render(mount, lang)]; } finally { spy.mockRestore(); }
}

describe('(a) codes inside sentences, isolated under Arabic only (RTL-1g)', () => {
  it.each(SITES)('%s — ar: each code is one LRI…PDI run', async (_n, mount, codes) => {
    const html = await render(mount, 'ar');
    for (const c of codes) expect({ c, isolated: html.includes(iso(c)) }).toEqual({ c, isolated: true });
  });
  it.each(SITES)('%s — en / hi / gu: byte-identical to the 93aa6915 text, and no isolate mark at all', async (_n, mount, codes) => {
    for (const lang of ['en', 'hi', 'gu']) {
      const [now, before] = await nowAndBefore(mount, lang);
      expect({ lang, same: now === before }).toEqual({ lang, same: true });
      expect(now).not.toMatch(/[⁦-⁩]/);
      for (const c of codes) expect(now).toContain(c);
    }
    // and the comparison can see a difference: under ar the identity render is a different page
    const [arNow, arBefore] = await nowAndBefore(mount, 'ar');
    expect(arNow).not.toBe(arBefore);
  });
  it('a view rendered WITHOUT lang (every pre-RTL-1g caller) is the en text, never isolated', async () => {
    const html = renderToStaticMarkup(<PosCollectView t={tr(en)} state="ok" centre={CENTRE} centres={[CENTRE]} today={TODAY} roll={ROLL} code={null} nextCursor={null} error={null} />);
    expect(html).toBe(await render(SITES[2][1], 'en'));
    expect(html).not.toMatch(/[⁦-⁩]/);
  });
  it('machineText: the registration isolated under ar only; a machine with no registration is unchanged', () => {
    expect(machineText(tr(ar), M1, CATEGORIES, 'ar')).toContain(iso('TEST-REG-1'));
    expect(machineText(tr(en), M1, CATEGORIES)).toBe(machineText(tr(en), M1, CATEGORIES, 'en'));
    expect(machineText(tr(en), M1, CATEGORIES, 'en')).not.toMatch(/[⁦-⁩]/);
    expect(machineText(tr(ar), MACHINES[1], CATEGORIES, 'ar')).not.toMatch(/[⁦-⁩]/);
  });
});

describe('(b) the switcher\'s "Coming soon" is the catalogue\'s, in the page language (RTL-1g)', () => {
  const sidebar = (lang: string) => { mockReq.cookies = { [LANG_COOKIE]: lang }; return renderToStaticMarkup(<Sidebar />); };
  it('en value is exactly "Coming soon" — the en sidebar prints what it printed at 93aa6915', () => {
    expect(en['lang.comingSoon']).toBe('Coming soon');
    const html = sidebar('en');
    expect(html).toContain('class="kv-locale__soon-group" aria-label="Coming soon"');
    expect(html).toContain('title="Coming soon"');
  });
  it.each([['hi'], ['gu'], ['ar']])('%s: the group label and every chip title are that catalogue words, never the English literal', (lang) => {
    const html = sidebar(lang);
    const v = CAT[lang]['lang.comingSoon'];
    expect(v).not.toBe('Coming soon');
    expect(html).toContain(`class="kv-locale__soon-group" aria-label="${v}"`);
    expect(html).toContain(`title="${v}"`);
    expect(html).not.toContain('Coming soon');
  });
});
