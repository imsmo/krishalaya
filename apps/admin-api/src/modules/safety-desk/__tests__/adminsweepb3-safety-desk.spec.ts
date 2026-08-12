// PC-56 ADMIN-SWEEP-b3 · the emergency & safety desk — the paging truth, the register of human acts, and the
// metadata-only rule enforced by absence. Conditions and codes, never prose; the stub-pool harness exercises the
// repository's real SQL.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  EMERGENCY_CATEGORIES, PROTOCOLS, isEmergencyCategory, assertStep, assertStepDetail, stepStatus,
  requesterView, caseAge, STEP_DETAIL_MIN, SafetyRuleError,
} from '../domain/safety-desk';
import { SafetyDeskRepository } from '../repositories/safety-desk.repository';
import { SafetyDeskService } from '../services/safety-desk.service';
import { SafetyCaseConflictError, InvalidSafetyStepError } from '../domain/safety-desk.errors';

const NOW = new Date('2026-08-12T09:00:00.000Z');
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function codeOf(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return e instanceof SafetyRuleError ? e.code : `<not a rule error: ${e}>`; }
}

/* ================================================================================================ */
describe('ADMIN-SWEEP-b3 · the protocols and the paging truth', () => {
  it('exactly the three protected categories, and every category has a protocol', () => {
    expect([...EMERGENCY_CATEGORIES]).toEqual(['women_safety', 'emergency_vet', 'safety']);
    for (const c of EMERGENCY_CATEGORIES) expect(PROTOCOLS[c].length).toBeGreaterThan(0);
    expect(isEmergencyCategory('payment')).toBe(false);
    expect(isEmergencyCategory(null)).toBe(false);
  });
  it("page_vet is the ONLY would_page step, and it is emergency_vet's — the one automatic act the canon draws is the one the platform cannot perform", () => {
    const wouldPage = EMERGENCY_CATEGORIES.flatMap((c) => PROTOCOLS[c].filter((s) => s.kind === 'would_page').map((s) => `${c}:${s.code}`));
    expect(wouldPage).toEqual(['emergency_vet:page_vet']);
  });
  it('a would_page step ALWAYS lands as provider_pending with the COMPOSED truth — the author cannot edit it into a delivery claim', () => {
    expect(stepStatus('would_page')).toBe('provider_pending');
    const detail = assertStepDetail('would_page', 'I paged the vet and they confirmed');   // author text is DISCARDED
    expect(detail).toContain('nothing was sent');
    expect(detail).not.toContain('confirmed');
  });
  it('a human step demands the who/what at the same floor as 0134’s CHECK', () => {
    expect(STEP_DETAIL_MIN).toBe(20);
    expect(codeOf(() => assertStepDetail('human', 'called'))).toBe('SAFETY_DETAIL_TOO_SHORT');
    expect(assertStepDetail('human', '  Dr Mehta reached on her published number at 09:12, en route  '))
      .toBe('Dr Mehta reached on her published number at 09:12, en route');
    expect(stepStatus('human')).toBe('recorded');
  });
  it('an unknown step or a non-emergency category refuses BY CODE with the vocabulary in the sentence', () => {
    expect(codeOf(() => assertStep('payment', 'anything'))).toBe('SAFETY_NOT_EMERGENCY_CASE');
    expect(codeOf(() => assertStep('women_safety', 'page_vet'))).toBe('SAFETY_UNKNOWN_STEP');   // steps do not cross categories
    expect(assertStep('emergency_vet', 'page_vet')).toEqual({ code: 'page_vet', kind: 'would_page' });
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b3 · identity and age', () => {
  it('the requester leaves masked — a women_safety requester is the most protected person on this console', () => {
    const v = requesterView({ userId: 'u1', fullName: 'Meera Ben Joshi', phone: '+919812345678', languageCode: 'gu', gender: 'female' });
    expect(v.name).not.toContain('Joshi');
    expect(v.phone).not.toBe('+919812345678');
    expect(v.gender).toBe('female');   // a routing fact for "female agent preferred", not decoration
  });
  it('age prints in minutes, hours, days', () => {
    expect(caseAge(ago(4), NOW)).toBe('4m');
    expect(caseAge(ago(125), NOW)).toBe('2h');
    expect(caseAge(ago(3000), NOW)).toBe('2d');
  });
});

/* ================================================================================================ */
/* Transaction layer: real repository over the stub pool. */
class StubClient {
  calls: Array<{ sql: string; params: unknown[] }> = [];
  results = new Map<string, any[]>();
  when(fragment: string, rows: any[]) { this.results.set(fragment, rows); }
  async query(sql: string, params?: unknown[]) {
    this.calls.push({ sql, params: params ?? [] });
    for (const [frag, rows] of this.results) if (sql.includes(frag)) return { rows, rowCount: rows.length };
    return { rows: [], rowCount: 1 };
  }
}
function harness() {
  const client = new StubClient();
  const pool = {
    withTx: async <T,>(fn: (c: any) => Promise<T>): Promise<T> => fn(client),
    query: (sql: string, params?: unknown[]) => client.query(sql, params),
  };
  const audit = { write: jest.fn(), log: jest.fn() };
  const repo = new SafetyDeskRepository(pool as any);
  const svc = new SafetyDeskService(pool as any, audit as any, repo);
  return { client, audit, svc };
}
const actor = { userId: 'op-1', roles: ['platform_safety_desk'], ip: null, requestId: 'r1' } as any;
const CASE = {
  id: 'tk1', tenantId: 't1', ticketNo: 'TKT-1', categoryCode: 'emergency_vet', channel: 'ivr',
  severity: 'P1', status: 'open', subject: 's', createdAt: ago(4), requesterUserId: 'u1', tenantDistrict: 'Junagadh',
};

describe('ADMIN-SWEEP-b3 · join and the step register, end to end', () => {
  it('recording a step REFUSES a non-responder by code — the register is of people in the room', async () => {
    const { client, svc } = harness();
    client.when('FROM support_tickets t', [CASE]);
    client.when('FROM safety_case_responders', []);
    await expect(svc.recordStep(actor, 'tk1', { stepCode: 'vet_contacted', detail: 'Dr Mehta reached at 09:12, en route to the farm' }))
      .rejects.toBeInstanceOf(SafetyCaseConflictError);
    expect(client.calls.some((c) => c.sql.includes('INSERT INTO safety_case_steps'))).toBe(false);
  });

  it('a responder records a human step; the write is audited on the same client', async () => {
    const { client, audit, svc } = harness();
    client.when('FROM support_tickets t', [CASE]);
    client.when('FROM safety_case_responders', [{ adminId: 'op-1', joinedAt: 'x' }]);
    const out = await svc.recordStep(actor, 'tk1', { stepCode: 'vet_contacted', detail: 'Dr Mehta reached at 09:12, en route to the farm', vetProfileId: '22222222-2222-7222-8222-222222222222' });
    expect(out).toEqual({ ok: true, stepCode: 'vet_contacted', status: 'recorded' });
    const ins = client.calls.find((c) => c.sql.includes('INSERT INTO safety_case_steps'))!;
    expect(ins.params).toContain('recorded');
    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write.mock.calls[0][1]).toMatchObject({ action: 'safety.step_recorded' });
  });

  it('page_vet lands as provider_pending whatever the author typed, and a thin human detail is 422 with nothing written', async () => {
    const { client, svc } = harness();
    client.when('FROM support_tickets t', [CASE]);
    client.when('FROM safety_case_responders', [{ adminId: 'op-1', joinedAt: 'x' }]);
    const out = await svc.recordStep(actor, 'tk1', { stepCode: 'page_vet', detail: 'paged them, delivered fine' });
    expect(out.status).toBe('provider_pending');
    const ins = client.calls.find((c) => c.sql.includes('INSERT INTO safety_case_steps'))!;
    expect(String(ins.params[4])).toContain('nothing was sent');

    const h2 = harness();
    h2.client.when('FROM support_tickets t', [CASE]);
    await expect(h2.svc.recordStep(actor, 'tk1', { stepCode: 'vet_contacted', detail: 'ok' }))
      .rejects.toBeInstanceOf(InvalidSafetyStepError);
    expect(h2.client.calls.some((c) => c.sql.includes('INSERT INTO'))).toBe(false);
  });

  it('join is idempotent and audited only when it actually joined', async () => {
    const { client, audit, svc } = harness();
    client.when('FROM support_tickets t', [CASE]);
    expect(await svc.join(actor, 'tk1')).toMatchObject({ joined: true, already: false });
    expect(audit.write).toHaveBeenCalledTimes(1);
    client.when('ON CONFLICT (ticket_id, admin_id) DO NOTHING', []);   // second click: rowCount 0
    expect(await svc.join(actor, 'tk1')).toMatchObject({ joined: false, already: true });
    expect(audit.write).toHaveBeenCalledTimes(1);   // still once
  });

  it('the vet panel read is audited, vets are ordered by REGION MATCH (never distance), and the requester leaves masked', async () => {
    const { client, audit, svc } = harness();
    client.when('FROM support_tickets t WHERE t.id = $1', []);   // (guard: getCase uses CASE_FROM; see next stub)
    client.when('JOIN lookup_values lv', [CASE]);
    client.when('FROM users WHERE id = $1', [{ userId: 'u1', fullName: 'Meera Ben Joshi', phone: '+919812345678', languageCode: 'gu', gender: 'female' }]);
    client.when('FROM vet_profiles vp', [{ id: 'v1', fullName: 'Dr Mehta', phone: '+919111111111', languageCode: 'gu', registrationNo: 'VCI-1', serviceRadiusKm: 25, ratingAvg: '4.5', region: 'Junagadh', sameRegion: true }]);
    const out = await svc.getCase('tk1', 'op-1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'safety.vets_read' }));
    expect(out.requester!.phone).not.toBe('+919812345678');
    const vetSql = client.calls.find((c) => c.sql.includes('FROM vet_profiles'))!.sql;
    expect(vetSql).toContain('is_emergency_available');
    expect(vetSql).toContain('ORDER BY (vp.base_region_id IS NOT DISTINCT FROM $1) DESC');
    expect(vetSql.toLowerCase()).not.toContain('distance');
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b3 · the two absences that ARE the design (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('NOTHING in admin-api reads a message body — W058\'s "even platform owner" clause, enforced by absence', () => {
    const root = path.join(__dirname, '..', '..', '..');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!['node_modules', 'dist', '__tests__'].includes(e.name)) walk(p); continue; }
        if (!e.name.endsWith('.ts') || e.name.endsWith('.spec.ts')) continue;
        const text = strip(fs.readFileSync(p, 'utf8'));
        if (/(FROM|JOIN)\s+messages\b/i.test(text)) offenders.push(path.relative(root, p));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
  it('0134 adds NO paging/alerting tables, reuses 0098\'s enum, and keeps steps append-only', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0134_emergency_desk.sql'), 'utf8')
      .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    expect(sql).not.toMatch(/CREATE TABLE[^;]*(page|alert)/i);
    expect(sql).toMatch(/support_escalation_status NOT NULL/);
    expect(sql).toMatch(/CHECK \(status IN \('recorded', 'provider_pending'\)\)/);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON safety_case_steps TO kv_admin/);
    expect(sql).not.toMatch(/GRANT[^;\n]*UPDATE[^;\n]*safety_case_steps/);
    // the category vocabulary lands as a MIGRATION (the 0128 class, on data), idempotent via NOT EXISTS
    expect(sql).toMatch(/INSERT INTO lookup_values[\s\S]*WHERE NOT EXISTS/);
    expect(sql).toMatch(/'women_safety'/);
  });
});
