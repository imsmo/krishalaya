// PC-56 ADMIN-SWEEP-b2 · the communication hub — the identity decision, channel honesty, and the presence-gated claim.
//
// Conditions and codes, never message prose. The stubbed pool exercises the repository's real SQL (the appeals
// pattern), so the claim's WHERE and the masking boundary are tested as written, without a database.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TICKET_CHANNELS, CARRIED_CHANNELS, channelStanding, presenceOf, assertMayClaim, presenceTransition,
  principalView, worstSeverity, hubSla, HubRuleError,
} from '../domain/comm-hub';
import { CommHubRepository } from '../repositories/comm-hub.repository';
import { CommHubService } from '../services/comm-hub.service';
import { HubNotClaimableError } from '../domain/comm-hub.errors';

const NOW = new Date('2026-08-12T09:00:00.000Z');
const inMin = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

function codeOf(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return e instanceof HubRuleError ? e.code : `<not a rule error: ${e}>`; }
}

/* ================================================================================================ */
describe('ADMIN-SWEEP-b2 · channel honesty (declared vs carried)', () => {
  it('exactly one channel is carried end-to-end — in-app chat; every other label is declared metadata', () => {
    // The whatsapp-bot and ivr-ussd gateways are intentional exit(1) stubs and the SMS wiring is OTP-only; a chip
    // that printed "whatsapp" like "app" would claim an inbox the platform cannot receive.
    expect([...CARRIED_CHANNELS]).toEqual(['app']);
    expect(channelStanding('app')).toBe('carried');
    for (const ch of TICKET_CHANNELS.filter((c) => c !== 'app')) expect(channelStanding(ch)).toBe('declared');
    expect(channelStanding('carrier_pigeon')).toBe('declared');   // unknown labels are never promoted
  });
  it('the channel vocabulary matches 0012 verbatim', () => {
    expect([...TICKET_CHANNELS]).toEqual(['app', 'whatsapp', 'ivr', 'phone', 'email', 'ambassador']);
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b2 · identity leaves the domain masked (the 0133 decision)', () => {
  it('principalView masks name and phone and keeps only what the agent must have', () => {
    const v = principalView({ userId: 'u1', fullName: 'Bhavna Mehta', phone: '+919876543210', languageCode: 'gu' });
    expect(v.userId).toBe('u1');
    expect(v.languageCode).toBe('gu');
    expect(v.name).not.toContain('Mehta');
    expect(v.phone).not.toBe('+919876543210');
    expect(v.phone).toMatch(/\d{2,4}$/);   // masked shape keeps a verifiable tail, not the number
  });
  it('the hub takes no phone input: no dto field and no repository parameter mentions phone', () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const dto = strip(fs.readFileSync(path.join(__dirname, '..', 'dto', 'comm-hub.dto.ts'), 'utf8'));
    expect(dto.toLowerCase()).not.toContain('phone');
    // and the repository never FILTERS on a phone — the column may be selected (it leaves masked) but a
    // `phone =`/`LIKE`/`IN` predicate would be the cross-tenant sweep the decision refuses
    const repo = strip(fs.readFileSync(path.join(__dirname, '..', 'repositories', 'comm-hub.repository.ts'), 'utf8'));
    expect(repo).not.toMatch(/phone\s*(=|LIKE|ILIKE|IN\b)/i);
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b2 · presence and the claim gate', () => {
  it('absence of a row means available — the table holds exceptions, not the roster', () => {
    expect(presenceOf(null)).toBe('available');
    expect(presenceOf(undefined)).toBe('available');
    expect(presenceOf({ status: 'break' })).toBe('break');
    expect(presenceOf({ status: 'gibberish' })).toBe('available');   // an unknown state must not lock someone out
  });
  it('a break REFUSES the claim by code', () => {
    expect(codeOf(() => assertMayClaim('break'))).toBe('HUB_ON_BREAK');
    expect(codeOf(() => assertMayClaim('available'))).toBeNull();
  });
  it('flipping to the state you are in is a noop, not an audit entry', () => {
    expect(presenceTransition('break', 'break')).toBe('noop');
    expect(presenceTransition('available', 'break')).toBe('change');
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b2 · queue arithmetic', () => {
  it('severity worst-of is lexical min (P0 < P1 < P2 < P3, by design)', () => {
    expect(worstSeverity(['P2', 'P0', 'P3'])).toBe('P0');
    expect(worstSeverity([])).toBeNull();
  });
  it('an unset clock says UNSET — never comfortably on-time', () => {
    expect(hubSla(null, NOW)).toEqual({ kind: 'unset' });
    expect(hubSla(inMin(90), NOW)).toEqual({ kind: 'due', inMinutes: 90 });
    expect(hubSla(inMin(-10), NOW)).toEqual({ kind: 'breached', overMinutes: 10 });
  });
});

/* ================================================================================================ */
/* THE TRANSACTION LAYER — real repository over a stubbed pool (the appeals harness pattern). */

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
  const repo = new CommHubRepository(pool as any);
  const svc = new CommHubService(pool as any, audit as any, repo);
  return { client, audit, svc };
}
const actor = { userId: 'op-1', roles: ['platform_support_oversight'], ip: null, requestId: 'r1' } as any;

describe('ADMIN-SWEEP-b2 · "Next in queue" and presence, end to end', () => {
  it('claims the worst deadline nobody owns IN EITHER REALM, atomically, and audits it', async () => {
    const { client, audit, svc } = harness();
    client.when('UPDATE support_tickets SET claimed_by_admin_id', [{ id: 'tk1', requesterUserId: 'u1' }]);
    const out = await svc.takeNext(actor);
    expect(out).toEqual({ claimed: true, ticketId: 'tk1', requesterUserId: 'u1' });
    const claim = client.calls.find((c) => c.sql.includes('SET claimed_by_admin_id'))!;
    // both realms' ownership excluded, SKIP LOCKED for concurrent agents, worst-deadline-first — the conditions ARE the queue
    expect(claim.sql).toContain('claimed_by_admin_id IS NULL AND assignee_user_id IS NULL');
    expect(claim.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claim.sql).toContain('ORDER BY sla_first_response_due ASC NULLS LAST');
    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write.mock.calls[0][1]).toMatchObject({ action: 'support.hub_claimed', entityId: 'tk1' });
  });

  it('refuses the claim while on break — 409, nothing written', async () => {
    const { client, svc } = harness();
    client.when('FROM support_hub_presence', [{ status: 'break', since: 'x' }]);
    await expect(svc.takeNext(actor)).rejects.toBeInstanceOf(HubNotClaimableError);
    expect(client.calls.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
  });

  it('an empty queue is an ANSWER, not an error', async () => {
    const { client, svc } = harness();
    client.when('UPDATE support_tickets SET claimed_by_admin_id', []);
    const out = await svc.takeNext(actor);
    expect(out).toEqual({ claimed: false });
  });

  it('presence flips are audited once and same-state flips are noops with no audit', async () => {
    const { client, audit, svc } = harness();
    expect(await svc.setPresence(actor, 'break')).toEqual({ status: 'break', changed: true });
    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write.mock.calls[0][1]).toMatchObject({ action: 'support.hub_break' });
    client.when('FROM support_hub_presence', [{ status: 'break', since: 'x' }]);
    expect(await svc.setPresence(actor, 'break')).toEqual({ status: 'break', changed: false });
    expect(audit.write).toHaveBeenCalledTimes(1);   // still once
  });

  it('opening a principal thread writes the read-audit row (the risk-profile doctrine)', async () => {
    const { client, audit, svc } = harness();
    client.when('FROM users WHERE id = $1', [{ userId: 'u1', fullName: 'Bhavna Mehta', phone: '+919876543210', languageCode: 'gu' }]);
    client.when('FROM support_tickets t', [
      { id: 'tk1', tenantId: 't1', ticketNo: 'T-1', channel: 'whatsapp', severity: 'P1', status: 'open', subject: 's', slaFirstResponseDue: inMin(30), createdAt: 'x', assigneeUserId: null, claimedByAdminId: 'op-1' },
    ]);
    const out = await svc.principal('u1', 'op-1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'support.hub_principal_read', entityId: 'u1' }));
    expect(out.phone).not.toBe('+919876543210');           // masked at the boundary
    expect(out.tickets[0].standing).toBe('declared');      // whatsapp is a label, not a verified inbox
    expect(out.tickets[0].mine).toBe(true);
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b2 · migration 0133 — the schema half of the decisions (comments stripped)', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0133_comm_hub.sql'), 'utf8')
    .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

  it('the platform claim is its own column pair with the both-or-neither CHECK — not assignee_user_id', () => {
    expect(sql).toMatch(/ADD COLUMN claimed_by_admin_id uuid/);
    expect(sql).toMatch(/\(claimed_by_admin_id IS NULL\) = \(claimed_at IS NULL\)/);
    expect(sql).not.toMatch(/claimed_by_admin_id uuid[^,\n]*REFERENCES/);   // operators are not users rows (0110)
  });
  it('the pull queue and my-load are indexed, partial on the live backlog', () => {
    expect(sql).toMatch(/idx_tickets_hub_queue[\s\S]*WHERE status NOT IN \('resolved', 'closed'\) AND claimed_by_admin_id IS NULL/);
    expect(sql).toMatch(/idx_tickets_hub_claimed/);
  });
  it('presence exists, constrained to the two real states, closed to the tenant realm', () => {
    expect(sql).toMatch(/CREATE TABLE support_hub_presence/);
    expect(sql).toMatch(/CHECK \(status IN \('available', 'break'\)\)/);
    expect(sql).toMatch(/REVOKE ALL ON support_hub_presence FROM kv_app, kv_relay/);
  });
  it('adds NO whatsapp/sms/ivr message tables — a schema for messages nothing can receive is the 0067 shape again', () => {
    expect(sql).not.toMatch(/CREATE TABLE[^;]*(whatsapp|sms|ivr)/i);
  });
});
