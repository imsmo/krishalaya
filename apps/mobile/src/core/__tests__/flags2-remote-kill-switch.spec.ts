// src/core/__tests__/flags2-remote-kill-switch.spec.ts · PC-56 FLAGS-2.
// The app hydrates its flags from GET /v1/config/flags (every server `feature_flags` row). A mobile key with no server row
// can only change with a new app-store build — no kill-switch. This pins: every FlagKey the app declares has a server row
// in seed core/0009, and the five Phase-2 operator apps whose server modules are OFF are seeded OFF.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { flags } from '../flags/flags';

const REPO = resolve(__dirname, '../../../../..');
const FLAGS_TS = readFileSync(resolve(REPO, 'apps/mobile/src/core/flags/flags.ts'), 'utf8');
const SEED = readFileSync(resolve(REPO, 'db/seeds/core/0009_feature_flags.sql'), 'utf8');

/** The keys of DEFAULTS in flags.ts — the full FlagKey set (DEFAULTS is a Record<FlagKey, boolean>, so tsc keeps it complete). */
function mobileKeys(): string[] {
  const body = FLAGS_TS.slice(FLAGS_TS.indexOf('const DEFAULTS'));
  return [...body.slice(0, body.indexOf('};')).matchAll(/^\s*(\w+):\s*(?:true|false)/gm)].map((m) => m[1]);
}
/** Seeded rows: key → is_enabled. */
function seeded(): Map<string, boolean> {
  return new Map([...SEED.matchAll(/^\s*\('([a-z0-9_]+)',\s*'(?:[^']|'')*',\s*(true|false),/gm)].map((m) => [m[1], m[2] === 'true']));
}

describe('FLAGS-2 · every mobile flag is a remote kill-switch', () => {
  it('reads all 39 mobile keys', () => {
    expect(mobileKeys()).toHaveLength(39);
  });

  it('every mobile key has a server row in seed core/0009', () => {
    const rows = seeded();
    expect(mobileKeys().filter((k) => !rows.has(k))).toEqual([]);
  });

  it('the five Phase-2 operator apps are seeded OFF (their server modules are OFF)', () => {
    const rows = seeded();
    for (const k of ['mcc_operator', 'vet', 'store_owner', 'delivery_partner', 'equipment_owner', 'dairy', 'livestock']) {
      expect([k, rows.get(k)]).toEqual([k, false]);
    }
  });

  it('a server OFF overrides a build default ON (the hydrate path the rows rely on)', () => {
    expect(flags.isEnabled('farmer_app')).toBe(true);
    flags.hydrate({ farmer_app: false });
    expect(flags.isEnabled('farmer_app')).toBe(false);
    flags.hydrate({ farmer_app: true });
    expect(flags.isEnabled('farmer_app')).toBe(true);
  });
});
