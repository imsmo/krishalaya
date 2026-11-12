// apps/mobile/src/core/__tests__/bundle1a-size-and-fonts.spec.ts · PC-56 BUNDLE-1a (brief_bundle1a.md §A–§C), "core" project
// (node, no export, no network):
//  A · the bundle-size gate counts the Hermes bytecode AS SHIPPED — the export runs with --source-maps (release builds compile
//      hermesc with ["-O","-output-source-map"]), a .map is never summed, the limit stays 6,000 KB, the export runs from the
//      app dir (resolved from the script's own location, not the caller's cwd), and the CI step says so;
//  B · only the 6 font faces the app uses ship — each `require`d by file in the root layout, no @expo-google-fonts package
//      index import anywhere — and every fontFamily the app or ui-native uses resolves to one of the loaded names.
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { font } from '../../../../../packages/ui-native/src/theme';

const APP = path.resolve(__dirname, '../../..'); // apps/mobile
const REPO = path.resolve(APP, '../..');
const UI_NATIVE_SRC = path.join(REPO, 'packages/ui-native/src');
// eslint-disable-next-line no-restricted-syntax, @typescript-eslint/no-var-requires -- the gate's pure half is CommonJS (.cjs), shared with the .mjs gate
const lib = require(path.join(APP, 'scripts/bundle-size-lib.cjs')) as {
  APP_DIR: string; DEFAULT_BUDGET_KB: number;
  exportArgs: (out: string) => string[]; isCounted: (name: string) => boolean;
  sumCounted: (files: { name: string; size: number }[]) => number; budgetKb: (env?: string) => number;
  verdict: (bytes: number, budget: number) => { kb: number; empty: boolean; over: boolean; overBy: number };
};

/** Source with comments removed — the static pins judge code, not the prose that explains it. A block comment opens only
 *  after a line start, space or punctuation, so prose like "@expo-google-fonts/" + "*" can't swallow the code after it. */
const code = (s: string) => s.replace(/(^|[\s;{(,])\/\*[\s\S]*?\*\//g, '$1').replace(/(^|\s)\/\/.*$/gm, '$1');
const readCode = (abs: string) => code(fs.readFileSync(abs, 'utf8'));
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const SOURCES = [...walk(path.join(APP, 'src')), ...walk(UI_NATIVE_SRC)];

describe('A · the gate counts what ships', () => {
  it('exports android Hermes WITH --source-maps (so hermesc moves the debug tables out of the .hbc, as release builds do)', () => {
    expect(lib.exportArgs('/tmp/x')).toEqual(['expo', 'export', '--platform', 'android', '--source-maps', '--output-dir', '/tmp/x']);
  });

  it('sums the .hbc/.js/.bundle only — never a .map, never an asset', () => {
    for (const n of ['entry-abc.hbc', 'entry-abc.js', 'index.android.bundle']) expect(lib.isCounted(n)).toBe(true);
    for (const n of ['entry-abc.hbc.map', 'entry-abc.js.map', 'index.android.bundle.map', 'x.map', 'Hind_400Regular.ttf', 'metadata.json', 'debug.html'])
      expect(lib.isCounted(n)).toBe(false);
    expect(lib.sumCounted([
      { name: 'entry-abc.hbc', size: 4_512_012 },
      { name: 'entry-abc.hbc.map', size: 9_000_000 },
      { name: '2269b53714460c46f78dca3c00a47307', size: 150_000 },
      { name: 'metadata.json', size: 1_160 },
    ])).toBe(4_512_012);
  });

  it('the limit stays 6,000 KB (1 KB = 1,024 B); the env override still works', () => {
    expect(lib.DEFAULT_BUDGET_KB).toBe(6000);
    expect(lib.budgetKb(undefined)).toBe(6000);
    expect(lib.budgetKb('')).toBe(6000);
    expect(lib.budgetKb('7000')).toBe(7000);
    expect(lib.verdict(6000 * 1024, 6000)).toEqual({ kb: 6000, empty: false, over: false, overBy: 0 });
    expect(lib.verdict(6000 * 1024 + 600, 6000)).toEqual({ kb: 6001, empty: false, over: true, overBy: 1 });
    expect(lib.verdict(4_512_012, 6000)).toEqual({ kb: 4406, empty: false, over: false, overBy: 0 });
    expect(lib.verdict(0, 6000).empty).toBe(true);
  });

  it('runs the export from the app dir, resolved from the script itself (not the caller\'s cwd)', () => {
    expect(lib.APP_DIR).toBe(APP);
    // …and from anywhere else too: CI runs the gate from the repo root, so load the lib in a node whose cwd IS the repo root.
    const fromRoot = execFileSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(path.join(APP, 'scripts/bundle-size-lib.cjs'))}).APP_DIR)`],
      { cwd: REPO, encoding: 'utf8' });
    expect(fromRoot).toBe(APP);
    expect(JSON.parse(fs.readFileSync(path.join(lib.APP_DIR, 'package.json'), 'utf8')).name).toBe('@krishalaya/mobile');
    const gate = readCode(path.join(APP, 'scripts/check-bundle-size.mjs'));
    expect(gate).toMatch(/require\('\.\/bundle-size-lib\.cjs'\)/);
    expect(gate).toMatch(/execFileSync\('npx', exportArgs\(out\), \{ cwd: APP_DIR,/);
    expect(gate).toMatch(/verdict\(sumCounted\(files\), BUDGET_KB\)/);
    expect(gate).toMatch(/budgetKb\(process\.env\.MOBILE_BUNDLE_BUDGET_KB\)/);
    expect(gate).not.toMatch(/process\.cwd\(\)/);
    expect(gate).not.toMatch(/expo export/); // the argv comes from the pinned exportArgs, not a second hand-written command
  });

  it('a failure sets the exit code instead of process.exit(), so the temp export is still removed', () => {
    const gate = readCode(path.join(APP, 'scripts/check-bundle-size.mjs'));
    expect(gate).not.toMatch(/process\.exit\(/);
    expect((gate.match(/process\.exitCode = 1;/g) ?? []).length).toBe(2);
    expect(gate).toMatch(/\} finally \{\s*try \{ rmSync\(out, \{ recursive: true, force: true \}\); \}/);
  });

  it('the CI step is labelled for what it measures and runs the gate', () => {
    const ci = fs.readFileSync(path.join(REPO, '.github/workflows/mobile-ci.yml'), 'utf8');
    expect(ci).toMatch(/- name: Hermes bytecode as shipped ≤ 6,000 KB\n\s+run: node apps\/mobile\/scripts\/check-bundle-size\.mjs/);
    expect(ci).not.toMatch(/30 MB/);
  });
});

describe('B · only the fonts the app uses ship', () => {
  const layout = readCode(path.join(APP, 'src/app/_layout.tsx'));
  const faces = [...layout.matchAll(/^\s*(\w+): require\('(@expo-google-fonts\/[^']+)'\),?$/gm)].map((m) => ({ name: m[1], file: m[2] }));
  const LOADED = new Set(faces.map((f) => f.name));

  it('the root layout loads exactly the 6 faces, each required by its .ttf file, via expo-font\'s useFonts', () => {
    expect(faces).toEqual([
      { name: 'Fraunces', file: '@expo-google-fonts/fraunces/Fraunces_700Bold.ttf' },
      { name: 'PlusJakartaSans', file: '@expo-google-fonts/plus-jakarta-sans/PlusJakartaSans_400Regular.ttf' },
      { name: 'PlusJakartaSans_Semibold', file: '@expo-google-fonts/plus-jakarta-sans/PlusJakartaSans_600SemiBold.ttf' },
      { name: 'PlusJakartaSans_Bold', file: '@expo-google-fonts/plus-jakarta-sans/PlusJakartaSans_700Bold.ttf' },
      { name: 'Hind', file: '@expo-google-fonts/hind/Hind_400Regular.ttf' },
      { name: 'Hind_Semibold', file: '@expo-google-fonts/hind/Hind_600SemiBold.ttf' },
    ]);
    for (const f of faces) expect(fs.existsSync(require.resolve(f.file, { paths: [APP] }))).toBe(true);
    expect(layout).toMatch(/import \{ useFonts \} from 'expo-font';/);
    expect(layout).toMatch(/useFonts\(FONT_FACES\)/);
    expect((layout.match(/require\('@expo-google-fonts\//g) ?? []).length).toBe(6);
  });

  it('no @expo-google-fonts package index is imported anywhere (it registers — and ships — every weight)', () => {
    const offenders: string[] = [];
    for (const f of SOURCES) {
      for (const m of readCode(f).matchAll(/['"](@expo-google-fonts\/[^'"]*)['"]/g)) {
        if (!/^@expo-google-fonts\/[\w-]+\/\w+\.ttf$/.test(m[1])) offenders.push(`${path.relative(REPO, f)}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every ui-native font token names a loaded face', () => {
    expect(font.display).toBe('Fraunces');
    expect(font.body).toBe('PlusJakartaSans');
    expect(font.vernacular).toBe('Hind');
    for (const [k, v] of Object.entries(font)) if (typeof v === 'string') expect([k, LOADED.has(v)]).toEqual([k, true]);
    expect('mono' in font).toBe(false); // `font.mono ?? font.body` therefore resolves to body (a loaded face)
  });

  it('every fontFamily used in apps/mobile/src and packages/ui-native/src resolves to a loaded face', () => {
    const tokens = font as unknown as Record<string, unknown>;
    const resolve = (expr: string): string | undefined => {
      const lit = /^['"]([^'"]+)['"]$/.exec(expr);
      if (lit) return lit[1];
      const alt = expr.split('??').map((s) => s.trim());
      for (const a of alt) {
        const tok = /^font\.(\w+)$/.exec(a);
        if (!tok) return `<unrecognised: ${expr}>`;
        const v = tokens[tok[1]];
        if (typeof v === 'string') return v;
      }
      return `<undefined: ${expr}>`;
    };
    const bad: string[] = [];
    let seen = 0;
    for (const f of SOURCES) {
      for (const m of readCode(f).matchAll(/fontFamily\s*:\s*([^,}\n]+)/g)) {
        seen++;
        const name = resolve(m[1].trim());
        if (!name || !LOADED.has(name)) bad.push(`${path.relative(REPO, f)}: fontFamily ${m[1].trim()} → ${name}`);
      }
    }
    expect(bad).toEqual([]);
    expect(seen).toBeGreaterThan(1000); // the scan really ran over the app (≈1,900 uses today)
  });

  it('the web CSS font stacks in @krishalaya/tokens never reach React Native', () => {
    const leaks = SOURCES.filter((f) => /import\s*\{[^}]*\bfontFamily\b[^}]*\}\s*from\s*'@krishalaya\/tokens'/.test(readCode(f)));
    expect(leaks.map((f) => path.relative(REPO, f))).toEqual([]);
  });
});
