// apps/web-ops/src/test/ops4b-pages.spec.ts · PC-56 OPS-4b · THE RECORDS — SOURCE ASSERTIONS, the premises, and the pure helpers.
//   READLESS · the HONEST animal pages (W394–W396) and their view import no `opsClient`, no SDK, call no `/v1/*` — POSITIVE CONTROL FIRST: the
//              pattern fires on /chc/maintenance (W408), which reads;
//   NO LIVESTOCK WRITE · no web-ops source calls registerAnimal, retireAnimal, updateAnimal, recordHealthEvent or ANY `.livestock.` method; the
//              only ops4 server action is W408's, and it calls only `recordMaintenance`;
//   Q4-A    · the desk tag lookup is gone: no `features/equipment/ear-tag.ts`, no `normaliseEarTag`, no `pashuAadhaar`, no `tag.` key;
//   PREMISES (brief §D) · Q5-A: the owner's app registers an animal (a `registerAnimal` caller exists — positive). Q4-A's second sentence: the
//              owner's app shows only the LAST FOUR digits of a tag — so the sentence is NOT printed; when her app shows the whole tag this
//              assertion turns red and the lead decides the words;
//   E2      · the sidebar's Maintenance; the kiosk home draws the three animal pages; the chain states answered BEFORE any read;
//   E3      · no client money math in any 4b source; the cost moves its decimal point as TEXT;
//   the pure helpers.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ANIMALS, MAINT, asAlerts, asRecorded, checkDraft, decodeRecorded, draftQuery, encodeRecorded, keyParam, maintFailureReason, parseDay, parseFailure,
  parseFieldError, parseHours, parseLogType, rupeesToMinorText,
} from '../features/ops4/upkeep';
import { en } from '../i18n/en';

const SRC = path.join(__dirname, '..');
const APPS = path.join(SRC, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) && !/^import type /.test(l)).join('\n');
const READS = /opsClient\s*\(|lib\/api-client|@krishalaya\/sdk-js|\bfetch\s*\(|\/v1\//m;
const HONEST = ['app/animals/eartag-scan/page.tsx', 'app/animals/register/page.tsx', 'app/animals/transfer/page.tsx', 'components/ops4/AnimalViews.tsx', 'components/ops4/AnimalLinks.tsx'];
const ALL_4B = [...HONEST, 'app/chc/maintenance/page.tsx', 'app/chc/maintenance/actions.ts', 'components/ops4/UpkeepViews.tsx', 'features/ops4/upkeep.ts'];
const walk = (dir: string): string[] => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.name === 'node_modules' || e.name === '.next' || e.name === 'dist' || e.name === '.expo' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const SRC_FILES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/[\\/](test|test-render)[\\/]/.test(f));

describe('PC-56 OPS-4b · the readless assertion (positive control first)', () => {
  it('CONTROL: the pattern fires on /chc/maintenance (W408), which reads and records', () => {
    expect(READS.test(code(read('app/chc/maintenance/page.tsx')))).toBe(true);
    expect(READS.test(code(read('app/chc/maintenance/actions.ts')))).toBe(true);
  });
  it('then finds nothing in the HONEST animal pages and their views (no opsClient, no SDK, no /v1/)', () => {
    for (const rel of HONEST) {
      expect([rel, READS.test(code(read(rel)))]).toEqual([rel, false]);
      expect([rel, /opsClient|SdkError|cookies\(/.test(code(read(rel)))]).toEqual([rel, false]);
    }
  });
});

describe('PC-56 OPS-4b · no livestock write; one server action, the maintenance entry', () => {
  it('no web-ops source calls registerAnimal, retireAnimal, updateAnimal, recordHealthEvent or any `.livestock.` method', () => {
    for (const f of SRC_FILES) {
      const src = code(fs.readFileSync(f, 'utf8'));
      expect([path.relative(SRC, f), /\b(registerAnimal|retireAnimal|updateAnimal|recordHealthEvent|completeVetBooking|bookVet)\s*\(|\.livestock\./.test(src)]).toEqual([path.relative(SRC, f), false]);
    }
  });
  it('the only ops4 server action is W408\'s, and it calls recordMaintenance and nothing that moves money', () => {
    const actions = SRC_FILES.filter((f) => /^\s*['"]use server['"]/m.test(fs.readFileSync(f, 'utf8')) && /[\\/]app[\\/](chc|animals)[\\/]/.test(f)).map((f) => path.relative(SRC, f));
    expect(actions).toEqual([path.join('app', 'chc', 'maintenance', 'actions.ts')]);
    const a = code(read('app/chc/maintenance/actions.ts'));
    expect(Array.from(a.matchAll(/\.equipment\.(\w+)\(/g)).map((m) => m[1])).toEqual(['recordMaintenance']);
    expect(/Rental|setRate|wallet|settle/i.test(a)).toBe(false);
  });
});

describe('PC-56 OPS-4b · Q4-A · the desk tag lookup is gone', () => {
  it('no ear-tag normaliser, no pashuAadhaar, no tag. key', () => {
    expect(fs.existsSync(path.join(SRC, 'features', 'equipment', 'ear-tag.ts'))).toBe(false);
    // the registry (features/ops4/refusals.ts) CITES the removed lookup's canon in its DELTA text — data about the removal, not a call
    for (const f of SRC_FILES.filter((x) => !x.endsWith(path.join('features', 'ops4', 'refusals.ts')))) expect([path.relative(SRC, f), /normaliseEarTag|pashuAadhaar/.test(code(fs.readFileSync(f, 'utf8')))]).toEqual([path.relative(SRC, f), false]);
    expect(Object.keys(en).filter((k) => k.startsWith('tag.'))).toEqual([]);
  });
});

describe('PC-56 OPS-4b · the premises (brief §D)', () => {
  const MOB = path.join(APPS, 'mobile', 'src');
  it('Q5-A: the owner\'s app registers an animal — POSITIVE: the screen calls registerAnimal, which posts to livestock/animals', () => {
    expect(fs.readFileSync(path.join(MOB, 'app', '(pashupalak)', 'animals', 'add.tsx'), 'utf8')).toMatch(/await registerAnimal\(/);
    expect(fs.readFileSync(path.join(MOB, 'features', 'livestock', 'livestock.api.ts'), 'utf8')).toMatch(/livestock\.registerAnimal\(/);
  });
  it('Q4-A second sentence — PREMISE FALSE at merge: the owner\'s app lists her animals (box=mine) and shows only the LAST FOUR digits of a tag', () => {
    const list = fs.readFileSync(path.join(MOB, 'app', '(pashupalak)', 'animals', 'index.tsx'), 'utf8');
    const one = fs.readFileSync(path.join(MOB, 'app', '(pashupalak)', 'animals', '[id].tsx'), 'utf8');
    expect(fs.readFileSync(path.join(MOB, 'features', 'livestock', 'livestock.api.ts'), 'utf8')).toMatch(/livestock\.animals\(\{ box: 'mine'/);
    expect(list).toMatch(/pashuAadhaar\.slice\(-4\)/); expect(one).toMatch(/pashuAadhaar\.slice\(-4\)/);
    // so the sentence is NOT in any value (a red here means her app changed: the lead re-decides the words)
    for (const v of Object.values(en)) expect(/sees her animals and their tags/i.test(v)).toBe(false);
  });
});

describe('PC-56 OPS-4b · E2 · the sidebar, the edges, the chain order', () => {
  it('the sidebar links /chc/maintenance (labelled Maintenance) — never an animal page (they are kiosk pages)', () => {
    const nav = read('components/Sidebar.tsx');
    expect(nav).toMatch(/href: '\/chc\/maintenance', labelKey: 'nav\.chcMaintenance', sub: true/);
    expect(/href: '\/animals\//.test(nav)).toBe(false);
    expect(en['nav.chcMaintenance']).toBe('Maintenance');
  });
  it('the kiosk home draws all three animal pages; each animal page the other two and the kiosk home', () => {
    expect(read('components/ops1/KioskViews.tsx')).toMatch(/<AnimalLinks t=\{t\} \/>/);
    expect(read('components/ops4/AnimalLinks.tsx')).toContain("const HREF: Record<AnimalSurface, string> = { eartag: ANIMALS.eartag, animal_register: ANIMALS.register, animal_transfer: ANIMALS.transfer };");
    expect(ANIMALS).toEqual({ eartag: '/animals/eartag-scan', register: '/animals/register', transfer: '/animals/transfer' });
  });
  it('the chain states are answered BEFORE any read on W408; W394\'s DECOR chain before anything', () => {
    const m = code(read('app/chc/maintenance/page.tsx'));
    expect(m.indexOf("chain4State('chc_act'")).toBeGreaterThan(-1); expect(m.indexOf("chain4State('chc_act'")).toBeLessThan(m.indexOf('opsClient()'));
    expect(m.indexOf("form === 'failure'")).toBeLessThan(m.indexOf('opsClient()')); expect(m.indexOf("form === 'success'")).toBeLessThan(m.indexOf('opsClient()'));
    expect(code(read('app/animals/eartag-scan/page.tsx'))).toMatch(/chain4State\('eartag_act'/);
  });
  it('the form\'s Back is /chc/maintenance in every state (the canon\'s W405 is a defect, not copied)', () => {
    expect(MAINT).toBe('/chc/maintenance');
    const p = code(read('app/chc/maintenance/page.tsx'));
    expect((p.match(/chain="chc_form" state="\w+" page=\{MAINT\}/g) ?? []).length).toBe(4);
    expect(/chain="chc_form"[^>]*page=\{CHC\.dashboard\}|\/chc\/dashboard/.test(p)).toBe(false);
  });
});

describe('PC-56 OPS-4b · E3 · no client money math', () => {
  it('no sum, product, difference, percentage, Number(, parseFloat, Math., reduce( in any 4b source', () => {
    for (const rel of ALL_4B) {
      const src = code(read(rel));
      expect([rel, /Math\.|Number\(|parseFloat|parseInt|toFixed|\.reduce\(|BigInt\(/.test(src)]).toEqual([rel, false]);
      expect([rel, /['"`][^'"`\n]*%[^'"`\n]*['"`]/.test(src)]).toEqual([rel, false]);
      expect([rel, /(Minor|cost|engineHours|count)\s*[-+*/]\s*[\w(]|[\w)]\s*[-+*/]\s*\w*(Minor)\b/.test(src)]).toEqual([rel, false]);
    }
  });
  it('money goes through the formatter from a minor string only; the note is never read into the view', () => {
    const v = code(read('components/ops4/UpkeepViews.tsx'));
    expect(Array.from(v.matchAll(/formatMoneyMinor\(([^,]+),/g)).map((m) => m[1])).toEqual(['minor']);
    expect(/\.notes\b/.test(v)).toBe(false);
    expect(/ownerUserId|renterUserId|createdBy/.test(v)).toBe(false);
  });
});

describe('PC-56 OPS-4b · the pure helpers', () => {
  const A = '0192d2c4-e0e0-7000-8000-0000000000a1';
  it('rupees to a minor string by moving the point, as text', () => {
    expect([rupeesToMinorText('1250'), rupeesToMinorText('1250.5'), rupeesToMinorText('1250.50'), rupeesToMinorText('0.05'), rupeesToMinorText(' 7 ')]).toEqual(['125000', '125050', '125050', '5', '700']);
    expect([rupeesToMinorText('1,250'), rupeesToMinorText('-1'), rupeesToMinorText('1.234'), rupeesToMinorText('1e3'), rupeesToMinorText('')]).toEqual([null, null, null, null, null]);
  });
  it('a real day; a known type; engine hours to one decimal', () => {
    expect([parseDay('2024-02-29'), parseDay('2026-02-29'), parseDay('2026-02-31'), parseDay('10/11/2026')]).toEqual(['2024-02-29', null, null, null]);
    expect([parseLogType('repair'), parseLogType('completion'), parseHours('12.5'), parseHours('12.55')]).toEqual(['repair', null, '12.5', null]);
  });
  it('the draft is checked field by field against HER machines; the first failing field is named', () => {
    const d = { asset: A, logType: 'service', performedOn: '2026-11-09', cost: '731.5', hours: '' };
    expect(checkDraft(d, [A])).toEqual({ body: { assetId: A, logType: 'service', performedOn: '2026-11-09', costMinor: '73150', engineHoursAt: null }, error: null });
    expect(checkDraft(d, []).error).toBe('machine');
    expect(checkDraft({ ...d, logType: 'x' }, [A]).error).toBe('type');
    expect(checkDraft({ ...d, performedOn: '2026-13-01' }, [A]).error).toBe('day');
    expect(checkDraft({ ...d, cost: 'abc' }, [A]).error).toBe('cost');
    expect(checkDraft({ ...d, hours: '1.25' }, [A]).error).toBe('hours');
    expect(draftQuery(d)).toBe(`asset=${A}&logType=service&performedOn=2026-11-09&cost=731.5`);
  });
  it('the API\'s answers by name: the two refusals, 422 → the form, 404, 400, anything else', () => {
    expect([maintFailureReason(403, 'MAINTENANCE_NOT_YOUR_MACHINE'), maintFailureReason(400, 'MAINTENANCE_DATE_IN_FUTURE'), maintFailureReason(422, 'VALIDATION_FAILED'),
      maintFailureReason(404, 'ASSET_NOT_FOUND'), maintFailureReason(400, 'BAD_REQUEST'), maintFailureReason(500, undefined)]).toEqual(['not_your_machine', 'date_in_future', null, 'not_found', 'key', 'record']);
    expect([parseFailure('date_in_future'), parseFailure('x'), parseFieldError('cost'), parseFieldError('change'), parseFieldError(undefined)]).toEqual(['date_in_future', 'record', 'cost', 'change', 'api']);
    for (const r of ['not_your_machine', 'date_in_future', 'not_found', 'key', 'record']) expect([r, typeof en[`ops4.upkeep.failure.${r}`]]).toEqual([r, 'string']);
    for (const r of ['machine', 'type', 'day', 'cost', 'hours', 'api', 'change']) expect([r, typeof en[`ops4.upkeep.fieldError.${r}`]]).toEqual([r, 'string']);
  });
  it('the server\'s answer round-trips the kept cookie; tampering gives null; the alerts keep the two server words only; a key is a uuid', () => {
    const e = { id: 'x1', assetId: A, logType: 'repair' as const, costMinor: '10', engineHoursAt: null, performedOn: '2026-11-09' };
    expect(decodeRecorded(encodeRecorded(e))).toEqual(e);
    expect([decodeRecorded('!!'), decodeRecorded(undefined), asRecorded({ ...e, performedOn: 'x' })]).toEqual([null, null, null]);
    expect(asAlerts([{ assetId: A, alert: 'service_due' }, { assetId: A, alert: 'days_down' }, { alert: 'needs_attention' }])).toEqual([{ assetId: A, alert: 'service_due' }]);
    expect([keyParam('0192d2c4-0000-7000-8000-0000000000ff'), keyParam('k')]).toEqual(['0192d2c4-0000-7000-8000-0000000000ff', null]);
  });
});
