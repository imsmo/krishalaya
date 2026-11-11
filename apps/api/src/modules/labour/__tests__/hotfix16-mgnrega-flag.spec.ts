// modules/labour/__tests__/hotfix16-mgnrega-flag.spec.ts · PC-56 HOTFIX-16 · MGNREGA BEHIND ITS SWITCH (unit, no database).
// GOV-5 Q4-A (lead-applied 2026-11-11): every route of MgnregaController is behind `labour` AND `mgnrega`. The guard sits on the CLASS
// (survey_gov5 E4 — a route added later is covered), and no handler carries a guard list or flag list of its own that could be read as
// replacing it. The seed row `mgnrega` exists exactly once and is OFF (Law 10). The live proof is
// src/__tests__/hotfix16-mgnrega-switch.integration.spec.ts.
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { FEATURE_FLAG_KEY, FeatureFlagGuard } from '../../../core/feature-flags/flags.guard';
import { MgnregaController } from '../controllers/v1/mgnrega.controller';

const SEED_0009 = join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'seeds', 'core', '0009_feature_flags.sql');
const handlers = () => Object.getOwnPropertyNames(MgnregaController.prototype)
  .filter((k) => k !== 'constructor')
  .map((k) => ({ name: k, fn: (MgnregaController.prototype as unknown as Record<string, unknown>)[k] }))
  .filter((h) => typeof h.fn === 'function' && Reflect.getMetadata(PATH_METADATA, h.fn as object) !== undefined);

describe('PC-56 HOTFIX-16 · MgnregaController is behind labour AND mgnrega', () => {
  it('the class carries FeatureFlagGuard and the flag list is exactly [labour, mgnrega]', () => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, MgnregaController) ?? []) as unknown[];
    expect(guards).toContain(FeatureFlagGuard);
    expect(Reflect.getMetadata(FEATURE_FLAG_KEY, MgnregaController)).toEqual(['labour', 'mgnrega']);
  });

  it('every route handler is covered by the class guard: no handler declares its own guards or flags, and there are 13 routes', () => {
    const hs = handlers();
    expect(hs.length).toBe(13);
    for (const h of hs) {
      expect([h.name, Reflect.getMetadata(GUARDS_METADATA, h.fn as object)]).toEqual([h.name, undefined]);
      expect([h.name, Reflect.getMetadata(FEATURE_FLAG_KEY, h.fn as object)]).toEqual([h.name, undefined]);
      expect(typeof Reflect.getMetadata(METHOD_METADATA, h.fn as object)).toBe('number');
    }
  });

  it('seed core/0009 holds the mgnrega row exactly once, OFF, rollout 100, no rules', () => {
    const sql = readFileSync(SEED_0009, 'utf8');
    const rows = sql.match(/^\s*\('mgnrega',.*$/gm) ?? [];
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatch(/, false, 100, '\{\}'\),?\s*$/);
    // `labour` stays OFF too
    expect(sql).toMatch(/^\s*\('labour','[^\n]*', false, 100, '\{\}'\),\s*$/m);
  });
});
