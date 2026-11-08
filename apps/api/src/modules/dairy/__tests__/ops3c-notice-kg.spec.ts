// modules/dairy/__tests__/ops3c-notice-kg.spec.ts · PC-56 OPS-3c — founder Q8-A ("per kg of milk, on every console") reaches the MEMBER NOTICES
// (lead decision 2026-11-09). Seed `db/seeds/core/0007` is read as TEXT: every dairy template row names the bill's quantity in kilograms
// ("kg" / "કિગ્રા"), never "L" / "litre" / "લિટર" / "लीटर"; the variable keeps its name `{{litres}}` (it carries Σ weighed kg). A POSITIVE CONTROL
// first proves the litre pattern fires on the words these rows used to say.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SEED = readFileSync(join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'seeds', 'core', '0007_notification_events_templates.sql'), 'utf8');
/** A litre word, read with the variable's NAME (`{{litres}}`) removed first — the name is kept on purpose and is not copy. */
const LITRE = { test: (s: string) => /\{\{litres\}\}\s*(L\b|लीटर|લિટર)/.test(s) || /litre|liter|लीटर|लिटर|લિટર|લીટર/i.test(s.replace(/\{\{litres\}\}/g, '')) };
const rows = SEED.split('\n').filter((l) => /^\s*\('dairy\.[a-z_]+','(sms|push|inapp)','(en|hi|gu)'/.test(l));

describe('PC-56 OPS-3c · Q8-A · the dairy member notices say kilograms', () => {
  it('POSITIVE CONTROL: the pattern fires on the old words', () => {
    for (const old of ['{{period}}: {{litres}} L, net {{net}}.', '{{litres}} લિટર, ચોખ્ખા {{net}}', 'Every figure is money per litre']) expect([old, LITRE.test(old)]).toEqual([old, true]);
  });
  it('no dairy template row in seed 0007 says litre; the nine bill-preview rows say kg in their own language and keep {{litres}}', () => {
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) expect([r.slice(0, 60), LITRE.test(r)]).toEqual([r.slice(0, 60), false]);
    const preview = rows.filter((r) => r.includes("('dairy.bill_previewed',"));
    expect(preview.length).toBe(9);
    for (const r of preview) {
      expect([r.slice(0, 50), r.includes('{{litres}}')]).toEqual([r.slice(0, 50), true]);
      const gu = r.includes("','gu',");
      expect([r.slice(0, 50), gu ? r.includes('{{litres}} કિગ્રા') : r.includes('{{litres}} kg')]).toEqual([r.slice(0, 50), true]);
    }
  });
});
