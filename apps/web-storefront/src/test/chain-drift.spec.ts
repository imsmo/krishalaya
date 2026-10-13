// apps/web-storefront/src/test/chain-drift.spec.ts · PC-56 STORE-1a · C3 (founder D2) — the PORTED chain modules stay byte-identical to
// web-tenant's (HOTFIX-2 precedent: "byte-identical shared files with a drift test"). Each storefront copy may differ from its source in
// exactly ONE line — its first `// apps/…` provenance comment — and nothing else; `maskForDisplay` (one function of web-tenant's
// signup/steps.ts) must match that function's text exactly. A fix made on one side only turns this red.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SF = join(__dirname, '..');
const WT = join(__dirname, '..', '..', '..', 'web-tenant', 'src');
const PORTED = ['features/forms/chain.ts', 'features/mutate/chain.ts', 'features/mutate/verify.ts', 'features/offline/signal.ts', 'components/OnlineGuard.tsx', 'components/DirArrow.tsx'];

/** The file with its first `// apps/` provenance line removed (the only line allowed to differ). */
function body(path: string): { rest: string; provenance: string } {
  const lines = readFileSync(path, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith('// apps/'));
  expect(i).toBeGreaterThanOrEqual(0);
  const provenance = lines[i];
  lines.splice(i, 1);
  return { rest: lines.join('\n'), provenance };
}
function fnText(src: string, name: string): string {
  const start = src.indexOf(`export function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 2);
}

describe('STORE-1a · ported chain modules are byte-identical to web-tenant', () => {
  it.each(PORTED)('%s', (f) => {
    const sf = body(join(SF, f));
    const wt = body(join(WT, f));
    expect(sf.provenance).toContain(`apps/web-storefront/src/${f}`);
    expect(sf.provenance).toContain(`apps/web-tenant/src/${f}`);
    expect(sf.rest).toBe(wt.rest);
  });

  it('maskForDisplay is the same function as web-tenant signup/steps.ts', () => {
    const sf = readFileSync(join(SF, 'features/chain/mask.ts'), 'utf8');
    const wt = readFileSync(join(WT, 'features/signup/steps.ts'), 'utf8');
    expect(fnText(sf, 'maskForDisplay')).toBe(fnText(wt, 'maskForDisplay'));
  });

  it('the ported mask prints the canon shape (W322 "+91 98••• ••742")', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { maskForDisplay } = require('../features/chain/mask') as { maskForDisplay: (s: string) => string };
    expect(maskForDisplay('+919812345742')).toBe('+91 98••• ••742');
    expect(maskForDisplay('12')).toBe('••••');
  });
});
