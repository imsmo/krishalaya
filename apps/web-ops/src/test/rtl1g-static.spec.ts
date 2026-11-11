import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ar } from '../i18n/ar';
// apps/web-ops/src/test/rtl1g-static.spec.ts · PC-56 RTL-1g — the static half of the two ops leftovers (the render half is
// test-render/rtl1g-ops.render.test.tsx): every page whose view now isolates a code passes the page language, and the switcher's
// "coming soon" words come from the catalogue (no English literal left in the component).
const SRC = join(__dirname, '..');
const read = (f: string) => readFileSync(join(SRC, f), 'utf8');
const code = (f: string) => read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('the pages hand their language to the views that isolate codes', () => {
  const PAGES: Array<[string, string[]]> = [
    ['app/pos/collect/page.tsx', ['<PosCollectView t={t} lang={lang}']],
    ['app/pos/quality/page.tsx', ['<PosQualityView t={t} lang={lang}']],
    ['app/bmc/page.tsx', ['<BmcView t={t} lang={lang} state={state} scope={scope} centres={centres} tiles={[]}', '<BmcView t={t} lang={lang} state={state} scope={scope} centres={centres} tiles={tiles}', '<ReadingReview t={t} lang={lang}']],
    ['app/iot/dashboard/page.tsx', ['<IotDashboardView t={t} lang={lang}']],
    ['app/iot/device/page.tsx', ['<IotDeviceView t={t} lang={lang} state="notFound"', '<IotDeviceView t={t} lang={lang} state={state}']],
    ['app/iot/device-health/page.tsx', ['<IotHealthView t={t} lang={lang}']],
    ['app/chc/maintenance/page.tsx', ['categories, lang);', '<MaintForm t={t} machines={machines} categories={categories} values={draft} lang={lang} />']],
  ];
  it.each(PAGES)('%s', (f, needles) => {
    const s = read(f);
    expect(s).toMatch(/const lang = getLang\(\);/);
    for (const n of needles) expect({ n, has: s.includes(n) }).toEqual({ n, has: true });
  });
  it('the views pass it down to every inner site (chrome, picker, card, machine text, form)', () => {
    expect(code('components/ops3/CounterViews.tsx').match(/<CounterChrome t=\{t\} centre=\{centre\} lang=\{lang\} \/>/g)).toHaveLength(5);
    expect(code('components/ops3/CounterViews.tsx').match(/<CentrePicker [^>]*lang=\{lang\} \/>/g)).toHaveLength(3);
    expect(code('components/ops3/BmcViews.tsx')).toContain('<CoolerCard t={t} tile={cooler} lang={lang} />');
    expect(code('components/ops4/UpkeepViews.tsx')).toContain('<MaintForm t={t} machines={machines} categories={categories} lang={lang} />');
    for (const f of ['components/ops4/ChcViews.tsx', 'components/ops4/UpkeepViews.tsx']) {
      const calls = code(f).split('\n').filter((l) => l.includes('machineText(t,'));
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.filter((l) => !l.includes('categories, lang)'))).toEqual([]);
    }
  });
});

describe('the switcher\'s "coming soon" words are the catalogue\'s', () => {
  it('no English literal left in LocaleSwitcher; Sidebar passes lang.comingSoon', () => {
    expect(code('components/LocaleSwitcher.tsx')).not.toMatch(/Coming soon/i);
    expect(code('components/LocaleSwitcher.tsx')).toContain('comingSoonLabel: string;');
    expect(read('components/Sidebar.tsx')).toContain("comingSoonLabel={t.t('lang.comingSoon')}");
  });
  it('lang.comingSoon in all four catalogues; en exactly "Coming soon"; hi/gu/ar their own words', () => {
    expect(en['lang.comingSoon']).toBe('Coming soon');
    for (const cat of [hi, gu, ar] as Array<Record<string, string>>) {
      expect(cat['lang.comingSoon']).toBeTruthy();
      expect(cat['lang.comingSoon']).not.toMatch(/[A-Za-z]/);
    }
  });
});
