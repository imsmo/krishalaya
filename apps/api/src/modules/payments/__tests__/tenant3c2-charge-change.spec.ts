// PC-56 TENANT-3c-2 · the tenant's own fee table: what a proposal may say, when it may take effect, and the two
// integrity rules the table never had (no overlapping windows, no platform row writable by a tenant).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CHARGE_CODE_SURFACES, MAX_FLAT_MINOR, MAX_PERCENT_BPS, MIN_NOTE_CHARS, SUPPORTED_CALC_METHODS, diffSummary,
  effectiveFromGate, endDateFor, isSupportedCalcMethod, proposalGate, readerOf, surfaceOf, validateChargeConfig,
} from '../domain/charge-change';
import { computeCharge } from '../domain/charge.calculator';
import { isComputable } from '../read-models/charge-console.read-model';

describe('TENANT-3c-2 · the write path only offers methods the pricing engine implements', () => {
  it('per_km is a LEGAL COLUMN VALUE and the calculator throws on it — so it is not offered', () => {
    expect(SUPPORTED_CALC_METHODS).toEqual(['flat', 'percent', 'slab', 'per_unit']);
    expect(isSupportedCalcMethod('per_km')).toBe(false);
    // The reason, proved rather than asserted: the engine itself refuses it.
    expect(() => computeCharge('per_km', {}, { amountMinor: 100n })).toThrow();
    expect(validateChargeConfig('per_km', { fee_minor: 100 })).toEqual({
      ok: false, error: 'CHARGE_METHOD_UNSUPPORTED', detail: { method: 'per_km', supported: ['flat', 'percent', 'slab', 'per_unit'] },
    });
  });
  it('a row the engine would throw on is FLAGGED by probing it, not by checking its method name', () => {
    expect(isComputable('flat', { fee_minor: 1200 })).toBe(true);
    expect(isComputable('per_km' as any, { per_km_minor: 500 })).toBe(false);
  });
});

describe('TENANT-3c-2 · a config the engine cannot compute never reaches the table', () => {
  it('flat and per_unit need a fee, bounded against an extra zero', () => {
    expect(validateChargeConfig('flat', { fee_minor: 12000 })).toEqual({ ok: true, config: { fee_minor: 12000 } });
    expect(validateChargeConfig('flat', {}).ok).toBe(false);
    expect(validateChargeConfig('flat', { fee_minor: -5 }).ok).toBe(false);
    expect(validateChargeConfig('per_unit', { fee_minor: Number(MAX_FLAT_MINOR) + 1 }))
      .toEqual({ ok: false, error: 'CHARGE_CONFIG_FEE_TOO_LARGE', detail: { maxMinor: MAX_FLAT_MINOR.toString() } });
  });
  it('percent needs bps, refuses a rate that reads as a typo, and refuses a floor above the ceiling', () => {
    expect(validateChargeConfig('percent', { bps: 250 })).toEqual({ ok: true, config: { bps: 250 } });
    expect(validateChargeConfig('percent', { bps: MAX_PERCENT_BPS + 1 }).ok).toBe(false);
    expect(validateChargeConfig('percent', { bps: 250, min_minor: 5000, max_minor: 1000 }))
      .toEqual({ ok: false, error: 'CHARGE_CONFIG_MIN_ABOVE_MAX' });
    // The clamp order is min-then-max in the calculator, so a floor above the ceiling would silently not exist.
    expect(computeCharge('percent', { bps: 250, min_minor: 5000, max_minor: 1000 }, { amountMinor: 1_000_000n })).toBe(1000n);
    expect(validateChargeConfig('percent', { bps: 2.5 }).ok).toBe(false);
  });
  it('SLABS MUST ASCEND, and nothing may follow the open-ended band — both make a band unreachable', () => {
    const ok = validateChargeConfig('slab', { slabs: [{ upto_minor: 39900, fee_minor: 3900 }, { upto_minor: null, fee_minor: 0 }] });
    expect(ok.ok).toBe(true);
    expect(validateChargeConfig('slab', { slabs: [{ upto_minor: 50000, fee_minor: 100 }, { upto_minor: 10000, fee_minor: 50 }] }))
      .toEqual({ ok: false, error: 'CHARGE_CONFIG_SLABS_NOT_ASCENDING' });
    expect(validateChargeConfig('slab', { slabs: [{ upto_minor: null, fee_minor: 0 }, { upto_minor: 10000, fee_minor: 50 }] }))
      .toEqual({ ok: false, error: 'CHARGE_CONFIG_SLAB_AFTER_CATCHALL' });
    expect(validateChargeConfig('slab', { slabs: [] }).ok).toBe(false);
    // and the reason a descending list is refused: the calculator takes the FIRST band the base fits under
    expect(computeCharge('slab', { slabs: [{ upto_minor: 50000, fee_minor: 100 }, { upto_minor: 10000, fee_minor: 50 }] }, { amountMinor: 5_000n })).toBe(100n);
  });
  it('a non-object config is refused rather than coerced', () => {
    for (const bad of [null, undefined, 'flat', 42, []]) expect(validateChargeConfig('flat', bad).ok).toBe(false);
  });
});

describe('TENANT-3c-2 · a price may not change today, and may not start before the rule it replaces', () => {
  it('tomorrow is the earliest', () => {
    expect(effectiveFromGate('2026-08-13', '2026-08-12', null)).toEqual({ ok: true });
    expect(effectiveFromGate('2026-08-12', '2026-08-12', null)).toEqual({ ok: false, error: 'CHARGE_EFFECTIVE_NOT_FUTURE' });
    expect(effectiveFromGate('2026-08-01', '2026-08-12', null)).toEqual({ ok: false, error: 'CHARGE_EFFECTIVE_NOT_FUTURE' });
    expect(effectiveFromGate('13-08-2026', '2026-08-12', null)).toEqual({ ok: false, error: 'CHARGE_EFFECTIVE_INVALID' });
  });
  it('and it must start after the row it supersedes began', () => {
    expect(effectiveFromGate('2026-08-13', '2026-08-12', '2026-08-20')).toEqual({ ok: false, error: 'CHARGE_EFFECTIVE_BEFORE_CURRENT' });
    expect(effectiveFromGate('2026-09-01', '2026-08-12', '2026-08-20')).toEqual({ ok: true });
  });
  it('the superseded row is end-dated the day BEFORE — the windows touch and never overlap', () => {
    expect(endDateFor('2026-09-01')).toBe('2026-08-31');
    expect(endDateFor('2026-03-01')).toBe('2026-02-28');   // and it does not invent a 30th of February
    expect(endDateFor('2026-01-01')).toBe('2025-12-31');
  });
});

describe('TENANT-3c-2 · the maker-checker gate, in the same vocabulary as the refund plane', () => {
  const p = (over: Partial<{ id: string; status: any; decidedBy: string | null; proposedBy: string }> = {}) =>
    ({ id: 'p1', status: 'approved', decidedBy: 'u-checker', proposedBy: 'u-maker', ...over });
  it('only an APPROVED proposal signed by somebody else is ready', () => {
    expect(proposalGate(p())).toEqual({ kind: 'ready', proposalId: 'p1' });
    expect(proposalGate(p({ status: 'pending', decidedBy: null }))).toEqual({ kind: 'awaiting_checker', proposalId: 'p1' });
    expect(proposalGate(p({ status: 'rejected' }))).toEqual({ kind: 'rejected_by_checker', proposalId: 'p1' });
    expect(proposalGate(p({ status: 'applied' }))).toEqual({ kind: 'already_applied', proposalId: 'p1' });
    expect(proposalGate(null)).toEqual({ kind: 'none' });
  });
  it('a checker who equals the maker does NOT open the gate (belt over 0141’s CHECK)', () => {
    expect(proposalGate(p({ decidedBy: 'u-maker' })).kind).toBe('awaiting_checker');
  });
  it('the note floor is the same 20 characters as every other note in this programme', () => {
    expect(MIN_NOTE_CHARS).toBe(20);
  });
});

describe('TENANT-3c-2 · registries, so a screen cannot claim a reader that does not exist', () => {
  it('a charge code maps to the surface that prices with it, or to nothing', () => {
    expect(surfaceOf('delivery_fee')).toBe('checkout');
    expect(surfaceOf('emd')).toBe('auctions');
    expect(surfaceOf('boost_local')).toBe('listings');
    expect(surfaceOf('invented_fee')).toBe('not_read_by_any_code');
    // the two codes checkout actually resolves are both registered
    expect(CHARGE_CODE_SURFACES.buyer_platform_fee).toBe('checkout');
  });
  it('a tax code maps to the code path that reads it — and 194Q is NOT one of them', () => {
    expect(readerOf('gst')).toBe('invoice_goods_line');
    expect(readerOf('gst_service')).toBe('invoice_fee_line');
    expect(readerOf('tds_194o')).toBe('settlement');
    // W150 lists "TDS 194Q (buyer purchases > ₹50L/yr)". It is the BUYER's own deduction, this platform deducts
    // 194-O instead (TENANT-3a's correction to W134), and nothing here computes it.
    expect(readerOf('tds_194q')).toBe('not_read_by_any_code');
  });
  it('the diff names every field that changed, and only those', () => {
    const d = diffSummary({ calcMethod: 'percent', config: { bps: 250 } }, { calcMethod: 'percent', config: { bps: 300, min_minor: 1000 } });
    expect(d).toEqual([{ field: 'bps', from: '250', to: '300' }, { field: 'min_minor', from: null, to: '1000' }]);
    expect(diffSummary(null, { calcMethod: 'flat', config: { fee_minor: 100 } })[0]).toEqual({ field: 'calcMethod', from: null, to: 'flat' });
    expect(diffSummary({ calcMethod: 'flat', config: { fee_minor: 100 } }, { calcMethod: 'flat', config: { fee_minor: 100 } })).toEqual([]);
  });
});

describe('TENANT-3c-2 · the schema says what the wave claims (comments stripped)', () => {
  const root = path.join(__dirname, '..', '..', '..', '..', '..', '..');
  const sql = fs.readFileSync(path.join(root, 'db', 'migrations', '0141_charge_change_gate.sql'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('THE RLS HOLE IS CLOSED: writes are pinned to the caller’s own tenant', () => {
    // The sweep's FOR ALL policy used its USING clause as the write check, so `tenant_id IS NULL` satisfied INSERT —
    // and kv_app holds INSERT and UPDATE on this table. A tenant could have created a PLATFORM-WIDE fee.
    expect(sql).toContain('DROP POLICY IF EXISTS tenant_isolation_charge_definitions ON charge_definitions');
    expect(sql).toContain('CREATE POLICY charge_definitions_insert ON charge_definitions');
    expect(sql).toContain('WITH CHECK (tenant_id = current_tenant_id())');
    const insertPolicy = sql.slice(sql.indexOf('charge_definitions_insert'), sql.indexOf('charge_definitions_update'));
    expect(insertPolicy).not.toContain('tenant_id IS NULL');       // the write side no longer accepts a platform row
    const readPolicy = sql.slice(sql.indexOf('charge_definitions_read'), sql.indexOf('charge_definitions_insert'));
    expect(readPolicy).toContain('tenant_id IS NULL');             // reads still see the defaults (the resolver needs them)
  });
  it('THE HOLE WAS PROVEN, NOT ASSUMED, BEFORE IT WAS CLOSED', () => {
    // On a pre-0141 database, `SET ROLE kv_app` with a tenant context INSERTED a row with tenant_id = NULL and the
    // row came back as a platform default: "INSERT 0 1 · proof_platform_fee | t". After 0141 the same statement is
    // refused. The migration header records the mechanism; this pin records that it was demonstrated.
    // (The narrative lives in the migration header; this pin asserts the STATEMENTS, because the header is stripped.)
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON charge_definitions FROM kv_relay');
    expect(sql).toContain('REVOKE DELETE, TRUNCATE ON charge_definitions FROM kv_app');
  });
  it('two rows can no longer be in force for one code at one time', () => {
    expect(sql).toContain('ex_charge_def_no_overlap');
    expect(sql).toContain('EXCLUDE USING gist');
    expect(sql).toContain("daterange(effective_from, effective_to, '[]') WITH &&");
    // COALESCE folds the platform scope: without it two overlapping PLATFORM rows would both be allowed.
    expect(sql).toContain("COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =");
  });
  it('the proposal plane is maker-checker, append-only, one open per code', () => {
    expect(sql).toContain('ck_charge_prop_maker_ne_checker');
    expect(sql).toContain('decided_by IS NULL OR decided_by <> proposed_by');
    expect(sql).toContain('uq_charge_prop_open');
    expect(sql).toContain('REVOKE DELETE, TRUNCATE ON charge_change_proposals');
  });
  it('BOTH note floors name their column first — 0139’s NULL-CHECK lesson, applied at write time', () => {
    expect(sql).toContain('proposal_note IS NOT NULL AND char_length(btrim(proposal_note)) >= 20');
    expect(sql).toContain('decision_note IS NOT NULL AND char_length(btrim(decision_note)) >= 20');
  });
  it('an end proposal carries no rule and a change carries one — the shape cannot be half-filled', () => {
    expect(sql).toContain('ck_charge_prop_shape');
    expect(sql).toContain("(action = 'end' AND calc_method IS NULL AND config IS NULL AND supersedes_id IS NOT NULL)");
  });
  it('0141 does NOT make tax_rules tenant-writable and does NOT narrow the calc_method CHECK', () => {
    expect(sql).not.toMatch(/ALTER TABLE tax_rules ADD COLUMN IF NOT EXISTS tenant_id/);
    expect(sql).not.toMatch(/INSERT INTO tax_rules/);
    expect(sql).not.toMatch(/calc_method IN \('flat'/);            // per_km stays a legal value; the gate is in code
  });
  it('the service end-dates rather than editing, and derives the action from the data', () => {
    const svc = read('services', 'charge-change.service.ts');
    expect(svc).toContain('endDateDefinition');
    expect(svc).toContain('insertDefinition');
    expect(svc).toContain('CHARGE_CHECKER_IS_MAKER');
    expect(svc).toContain('const action: ChargeAction = input.action === \'end\'');
    const repo = read('repositories', 'charge-change.repository.ts');
    // The ONLY UPDATE on a pricing row touches the end date — never an amount, a method or a config.
    expect(repo).toMatch(/UPDATE charge_definitions SET effective_to=/);
    expect(repo).not.toMatch(/UPDATE charge_definitions SET (config|calc_method|label)/);
  });
});
