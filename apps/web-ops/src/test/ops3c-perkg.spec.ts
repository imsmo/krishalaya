// apps/web-ops/src/test/ops3c-perkg.spec.ts · PC-56 OPS-3c · founder Q8-A (2026-11-08): "Label everything as kilograms, 'per kg of milk', on every
// console, now. No pricing change." The relabel is COPY ONLY: every key below names a quantity the platform WEIGHS in kilograms (or a rate the
// engine applies per kg — `milk-rate-card.entity.ts` priceMinor / bonusMinor, `milk-bill.entity.ts` total_litres = Σ weight_kg, the read models'
// `litres` = milli-kg) and now says kg in en, hi and gu. The POSITIVE CONTROL first: keys that are GENUINELY litres (a cooler's or a centre's
// stated capacity, an animal's yield as the farmer states it) still say litre, so the litre pattern is proven to fire in every language.
// The catalogues of web-tenant (.ts) and mobile (.json) are read as TEXT (no cross-app import).
import * as fs from 'node:fs';
import * as path from 'node:path';

const APPS = path.join(__dirname, '..', '..', '..');
const LANGS = ['en', 'hi', 'gu'] as const;
type Lang = typeof LANGS[number];
function tsCatalog(app: string, lang: Lang): Record<string, string> {
  const src = fs.readFileSync(path.join(APPS, app, 'src', 'i18n', `${lang}.ts`), 'utf8');
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/^\s*'([^']+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"),\s*$/gm)) out[m[1]] = (m[2] ?? m[3]).replace(/\\(.)/g, '$1');
  return out;
}
const mobile = (lang: Lang): Record<string, string> => JSON.parse(fs.readFileSync(path.join(APPS, 'mobile', 'src', 'core', 'i18n', 'locales', `${lang}.json`), 'utf8'));
const CAT = {
  'web-ops': Object.fromEntries(LANGS.map((l) => [l, tsCatalog('web-ops', l)])) as Record<Lang, Record<string, string>>,
  'web-tenant': Object.fromEntries(LANGS.map((l) => [l, tsCatalog('web-tenant', l)])) as Record<Lang, Record<string, string>>,
  mobile: Object.fromEntries(LANGS.map((l) => [l, mobile(l)])) as Record<Lang, Record<string, string>>,
};
/** A litre word in each language: "litre", "L" as a unit, "L/…"; लीटर / लिटर / ली / ली.; લિટર / લીટર / લિ / લિ. */
const LITRE: Record<Lang, RegExp> = {
  en: /litre|liter|(^|[^A-Za-z·])L($|[^A-Za-z·'])/i,
  hi: /लीटर|लिटर|(^|[^ऀ-ॿ])ली($|[^ऀ-ॿ])/,
  gu: /લિટર|લીટર|(^|[^઀-૿])લિ($|[^઀-૿])/,
};
const KG: Record<Lang, RegExp> = { en: /\bkg\b|kilogram/i, hi: /किग्रा|किलोग्राम/, gu: /કિગ્રા|કિલોગ્રામ/ };

/** EVERY key the Q8-A relabel changed (the full list is in the OPS-3c report §6). */
export const RELABELLED: Record<keyof typeof CAT, string[]> = {
  'web-ops': ['dairy.litres', 'ops1.payout.colLitres'],
  'web-tenant': ['dairy.rate.base', 'dairy.bill.litres', 'dairy.counter.lead', 'dairy.quality.example.base', 'dairy.litres', 'dairy.tile.qualityBasis',
    'dairy.col.litres', 'dairy.totals.foots', 'dairy.cycles.col.perDay', 'dairy.cycles.col.litres', 'dairy.insights.state.unavailable',
    'dairy.insights.tile.ratePerLitre', 'dairy.insights.rate.noPours', 'dairy.insights.chart.caption', 'dairy.insights.moved.title', 'dairy.rate.perKgMilk'],
  mobile: ['dairyapp.bills.litres', 'dairyapp.rates.base', 'mcc.day.litres', 'dairyapp.billDetail.litres'],
};
/** GENUINELY litres — verified at source: `bmc_units.capacity_litres`, a cooler's stated `volumeLitres`, `mcc_centres.capacity_litres_shift`, an animal's yield. */
const GENUINE: Record<keyof typeof CAT, string[]> = {
  // NAMED UPDATE (PC-56 OPS-3a): W365 prints a cooler's STATED level (`DairyBmcTile.volumeLitres`) of its `capacityLitres` tank — genuine litres.
  // NAMED UPDATE (PC-56 OPS-3b): W366 prints the tank's volume (`capacityLitres`) and its STATED level (`volumeLitres`) — genuine litres.
  'web-ops': ['ops3.pos.shiftPage.levelValue', 'ops3.bmc.capacityValue', 'ops3.bmc.levelValue'],
  'web-tenant': ['dairy.unit.litres', 'form.bmc.field.capacityLitres', 'form.centre.field.capacityLitresShift', 'dairy.bmc.acts.volumeLitres', 'dairy.mcc.capacity'],
  mobile: ['mcc.centre.capacityLitres', 'pashu.add.yield'],
};

describe('PC-56 OPS-3c · Q8-A · the per-kg relabel (copy only)', () => {
  it('POSITIVE CONTROL: the litre pattern fires on every genuinely-litre key, in en, hi and gu', () => {
    for (const app of Object.keys(GENUINE) as Array<keyof typeof CAT>) for (const k of GENUINE[app]) for (const l of LANGS)
      expect([app, k, l, LITRE[l].test(CAT[app][l][k] ?? '')]).toEqual([app, k, l, true]);
  });
  it('no relabelled key still says litre in any language, and each says kilograms', () => {
    let n = 0;
    for (const app of Object.keys(RELABELLED) as Array<keyof typeof CAT>) for (const k of RELABELLED[app]) for (const l of LANGS) {
      const v = CAT[app][l][k];
      expect([app, k, l, typeof v === 'string' && v.length > 0]).toEqual([app, k, l, true]);
      expect([app, k, l, v, LITRE[l].test(v)]).toEqual([app, k, l, v, false]);
      expect([app, k, l, v, KG[l].test(v)]).toEqual([app, k, l, v, true]);
      n++;
    }
    expect(n).toBe(22 * 3);
  });
  it('no `ops3.` value in web-ops says litre in any language', () => {
    // NAMED UPDATE (PC-56 OPS-3a): every ops3. value but the GENUINE-litre keys above (which the positive control requires to say litre).
    for (const l of LANGS) for (const [k, v] of Object.entries(CAT['web-ops'][l])) if (k.startsWith('ops3.') && !GENUINE['web-ops'].includes(k)) expect([k, l, LITRE[l].test(v)]).toEqual([k, l, false]);
  });
  it('the components that print a GENUINE litre use the genuine-litre keys; the hard-coded "/L" on the slab line is gone', () => {
    const wt = (rel: string) => fs.readFileSync(path.join(APPS, 'web-tenant', 'src', rel), 'utf8');
    expect(wt('app/dairy/bmc/page.tsx')).toContain("{u.capacityLitres} {t.t('dairy.unit.litres')}");
    expect(wt('app/dairy/centres/page.tsx')).toContain("{c.capacityLitresShift} {t.t('dairy.unit.litres')}");
    expect(wt('app/dairy/quality/page.tsx')).not.toMatch(/\}\/L`/);
    expect(wt('app/dairy/quality/page.tsx')).toContain("${t.t('dairy.rate.perKgMilk')}");
    const centre = fs.readFileSync(path.join(APPS, 'mobile', 'src', 'app', '(mcc)', 'centre.tsx'), 'utf8');
    expect(centre).toContain("${mcc.capacityLitresShift} ${t('mcc.centre.capacityLitres')}");
    expect(centre).not.toContain("${mcc.capacityLitresShift} ${t('dairyapp.bills.litres')}");
  });
});
