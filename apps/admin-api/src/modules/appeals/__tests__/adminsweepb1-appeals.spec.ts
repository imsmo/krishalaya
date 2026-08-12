// PC-56 ADMIN-SWEEP-b1 · appeals — the writers, the ≠-reviewer rule, and the four-write overturn as one transaction.
//
// Three layers, deliberately:
//   1. PURE DOMAIN — every sentence a reviewer can be refused with, asserted by CODE and BEHAVIOUR (never by
//      matching prose: messages are allowed to improve; conditions are not).
//   2. THE FORMULA'S TWO ENDS — healedScore/healedBand duplicate apps/api's recompute (the ADMIN-6 "third copy"
//      hazard, named in appeal-subjects.ts). Both ends are pinned to the WRITTEN preimage: this file reads the
//      apps/api source and fails if the thresholds drift apart.
//   3. THE TRANSACTION — a stubbed pool proves the overturn's four effects and the status flip share ONE client,
//      that refusals happen BEFORE any write, and that every effect reports an honest outcome.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  APPEAL_SLA_HOURS, DECISION_REASON_MIN, appealSla, assertDecidable, assertDecisionReason, claimableBy,
  takeNextEmpty, AppealRuleError, type AppealRow,
} from '../domain/appeal';
import {
  SUBJECT_KINDS, ACTION_SUBJECT, parseSubjectRef, OVERTURN_EFFECTS, overturnPlan,
  healedScore, healedBand, reviewerSourceOf, RISK_SCORE_BASE, RISK_WINDOW_DAYS,
} from '../domain/appeal-subjects';
import { APPEAL_SLA_HOURS as OVERVIEW_SLA_HOURS } from '../../trust-safety/domain/trust-overview';
import { AppealsRepository } from '../repositories/appeals.repository';
import { AppealDecisionService } from '../services/appeal-decision.service';
import { AppealsQueueService } from '../services/appeals-queue.service';
import { AppealNotDecidableError, InvalidAppealDecisionError } from '../domain/appeals.errors';

const HOUR = 3_600_000;
const NOW = new Date('2026-08-11T12:00:00.000Z');
const ahead = (h: number) => new Date(NOW.getTime() + h * HOUR).toISOString();

/** The thrown rule CODE — asserted instead of prose, because messages may improve and conditions may not. */
function codeOf(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return e instanceof AppealRuleError ? e.code : `<not a rule error: ${e}>`; }
}

const appeal = (over: Partial<AppealRow> = {}): AppealRow => ({
  id: 'ap1', subjectRef: 'listing:11111111-1111-7111-8111-111111111111', subjectAction: 'listing_removed',
  appellant: 'farmer-1', originalActionRef: 'order-1', originalReviewerId: 'op-original',
  assignedTo: 'op-decider', status: 'pending', slaDueAt: ahead(28),
  decisionReason: null, decidedAt: null, createdAt: ahead(-20), ...over,
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b1 · the SLA clock (W097: 48h, set on submit)', () => {
  it('one 48 everywhere — the queue and the trust overview cannot drift apart silently', () => {
    expect(APPEAL_SLA_HOURS).toBe(48);
    expect(OVERVIEW_SLA_HOURS).toBe(APPEAL_SLA_HOURS);
  });
  it('floors running clocks to whole hours, the way the canon prints them ("28h")', () => {
    expect(appealSla(ahead(28.9), NOW)).toEqual({ kind: 'running', hoursLeft: 28 });
    expect(appealSla(ahead(0.5), NOW)).toEqual({ kind: 'running', hoursLeft: 0 });
  });
  it('a breached clock reports HOW FAR over — late and very late are different facts', () => {
    expect(appealSla(ahead(-12), NOW)).toEqual({ kind: 'breached', overHours: 12 });
    expect(appealSla(ahead(-0.1), NOW).kind).toBe('breached');
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b1 · the ≠-reviewer rule (the 17th maker-checker site)', () => {
  it('the assignee may decide', () => {
    expect(() => assertDecidable(appeal(), 'op-decider')).not.toThrow();
  });
  it('REFUSES the original reviewer BY CODE, even when the appeal is assigned to them', () => {
    // The strongest disqualification wins: assigned-to-you does not launder made-by-you.
    const own = appeal({ originalReviewerId: 'op-decider', assignedTo: 'op-decider' });
    expect(codeOf(() => assertDecidable(own, 'op-decider'))).toBe('APPEAL_OWN_DECISION');
  });
  it('refuses an unassigned appeal (assignment is what records who is judging)', () => {
    expect(codeOf(() => assertDecidable(appeal({ assignedTo: null }), 'op-decider'))).toBe('APPEAL_UNASSIGNED');
  });
  it("refuses deciding over another reviewer's shoulder", () => {
    expect(codeOf(() => assertDecidable(appeal(), 'op-other'))).toBe('APPEAL_NOT_YOURS');
  });
  it('refuses re-deciding — a wrong decision gets a NEW appeal, not an edit', () => {
    expect(codeOf(() => assertDecidable(appeal({ status: 'upheld' }), 'op-decider'))).toBe('APPEAL_ALREADY_DECIDED');
  });
  it('claimableBy skips your own original decisions and anything already claimed', () => {
    const base = { status: 'pending', assignedTo: null as string | null, originalReviewerId: 'op-a' };
    expect(claimableBy(base, 'op-b')).toBe(true);
    expect(claimableBy(base, 'op-a')).toBe(false);                                     // yours → a colleague's
    expect(claimableBy({ ...base, assignedTo: 'op-c' }, 'op-b')).toBe(false);          // claimed
    expect(claimableBy({ ...base, originalReviewerId: null }, 'op-a')).toBe(true);     // system call → anyone
    expect(claimableBy({ ...base, status: 'upheld' }, 'op-b')).toBe(false);
  });
  it('the two empty "Take next" states are distinguished — done-for-the-day vs find-a-colleague', () => {
    expect(takeNextEmpty(0, 0)).toEqual({ kind: 'queue_clear' });
    expect(takeNextEmpty(3, 0)).toEqual({ kind: 'only_your_own', n: 3 });
    expect(takeNextEmpty(3, 2)).toEqual({ kind: 'queue_clear' });   // claimables exist; the loop just races — not an empty
  });
  it('the decision reason has the same floor the database CHECK holds (0132)', () => {
    expect(DECISION_REASON_MIN).toBe(20);
    expect(codeOf(() => assertDecisionReason('too short'))).toBe('APPEAL_REASON_TOO_SHORT');
    expect(assertDecisionReason('  the photos were genuine; removal reversed  ')).toBe('the photos were genuine; removal reversed');
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b1 · subject refs and the overturn plan', () => {
  it('parses <kind>:<id> and REFUSES a ref that disagrees with the action', () => {
    expect(parseSubjectRef('listing:abc', 'listing_removed')).toEqual({ kind: 'listing', id: 'abc' });
    expect(parseSubjectRef('review:abc', 'review_hidden')).toEqual({ kind: 'review', id: 'abc' });
    expect(parseSubjectRef('account:u1', 'account_restricted')).toEqual({ kind: 'account', id: 'u1' });
    expect(parseSubjectRef('listing:abc', 'account_restricted')).toBeNull();   // disagreement
    expect(parseSubjectRef('garbage', 'listing_removed')).toBeNull();
    expect(parseSubjectRef('listing:', 'listing_removed')).toBeNull();
    expect(parseSubjectRef(':abc', 'listing_removed')).toBeNull();
  });
  it('every appealable action maps to a subject kind, and the sets agree with 0132', () => {
    expect(Object.keys(ACTION_SUBJECT).sort()).toEqual(['account_restricted', 'listing_removed', 'review_hidden']);
    expect(new Set(Object.values(ACTION_SUBJECT))).toEqual(new Set(SUBJECT_KINDS));
  });
  it('the plan is ALL FOUR EFFECTS, always — what varies is each outcome, never the attempt', () => {
    for (const action of Object.keys(ACTION_SUBJECT)) {
      expect(overturnPlan(action)).toEqual([...OVERTURN_EFFECTS]);
    }
    expect(OVERTURN_EFFECTS).toEqual(['restore_subject', 'reverse_risk_event', 'notify_appellant', 'coach_reviewer']);
  });
  it('a system decision routes its lesson to the rule, a human one to the human', () => {
    expect(reviewerSourceOf(null)).toBe('system');
    expect(reviewerSourceOf('op-1')).toBe('human');
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b1 · the score-heal formula is pinned to BOTH written ends', () => {
  it('base 70 + weighted sum, clamped 0..100', () => {
    expect(RISK_SCORE_BASE).toBe(70);
    expect(healedScore(0)).toBe(70);
    expect(healedScore(-40)).toBe(30);
    expect(healedScore(40)).toBe(100);      // clamped
    expect(healedScore(-200)).toBe(0);      // clamped
  });
  it('band thresholds verbatim from bandFor()', () => {
    expect(healedBand(80)).toBe('trusted');
    expect(healedBand(79)).toBe('standard');
    expect(healedBand(60)).toBe('standard');
    expect(healedBand(59)).toBe('caution');
    expect(healedBand(40)).toBe('caution');
    expect(healedBand(39)).toBe('restricted');
    expect(healedBand(20)).toBe('restricted');
    expect(healedBand(19)).toBe('blocked');
  });
  it('the OTHER end of the formula (apps/api) still says the same thing — drift fails here, not in production', () => {
    // Comments stripped before scanning: prose about a threshold must not satisfy a check on the threshold.
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', '..', 'api', 'src', 'modules', 'identity', 'domain', 'risk-score.entity.ts'),
      'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const line of ["score >= 80) return 'trusted'", "score >= 60) return 'standard'",
      "score >= 40) return 'caution'", "score >= 20) return 'restricted'"]) {
      expect(src).toContain(line);
    }
    const job = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', '..', 'api', 'src', 'modules', 'identity', 'jobs', 'risk-score-recompute.job.ts'),
      'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(job).toContain('const BASE = 70');
    expect(job).toContain(`interval '${RISK_WINDOW_DAYS} days'`);
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b1 · migration 0132 — the writers rest on these rules (comments stripped)', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0132_appeals_writers.sql'), 'utf8')
    .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

  it('kv_app may submit and read — and NOTHING else (no UPDATE, no DELETE for the tenant realm)', () => {
    expect(sql).toMatch(/GRANT SELECT, INSERT ON appeals TO kv_app/);
    expect(sql).not.toMatch(/GRANT[^;\n]*UPDATE[^;\n]*ON appeals[^;\n]*kv_app/);
    expect(sql).not.toMatch(/GRANT[^;\n]*DELETE[^;\n]*ON appeals/);
  });
  it('one open appeal per (subject, appellant) — resubmission is a dedupe, not a flood', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX uq_appeals_open_per_subject\s+ON appeals \(subject_ref, appellant\)\s+WHERE status = 'pending' AND deleted_at IS NULL/);
  });
  it('a decided appeal must carry decider, time and >=20-char reasoning (the database copy of the domain floor)', () => {
    expect(sql).toMatch(/chk_appeals_decided_shape/);
    expect(sql).toMatch(/length\(btrim\(COALESCE\(decision_reason, ''\)\)\) >= 20/);
    expect(sql).toMatch(/assigned_to IS NOT NULL/);
  });
  it('notices gained the appeal origin and the exactly-one-origin rule survived the widening', () => {
    expect(sql).toMatch(/ADD COLUMN appeal_id uuid REFERENCES appeals\(id\)/);
    expect(sql).toMatch(/num_nonnulls\(order_id, report_id, appeal_id\) = 1/);
  });
  it('the lessons register exists, one per appeal, human-or-system paired correctly', () => {
    expect(sql).toMatch(/CREATE TABLE moderation_review_lessons/);
    expect(sql).toMatch(/appeal_id\s+uuid NOT NULL UNIQUE REFERENCES appeals\(id\)/);
    expect(sql).toMatch(/\(reviewer_source = 'human'\) = \(reviewer_id IS NOT NULL\)/);
    expect(sql).toMatch(/REVOKE ALL ON moderation_review_lessons FROM kv_app, kv_relay/);
  });
});

/* ================================================================================================ */
/* THE TRANSACTION. A stub client that records every call; the repo is the real one pointed at the stub pool, so
 * the SQL itself is exercised (bindings included) without a database. */

class StubClient {
  calls: Array<{ sql: string; params: unknown[] }> = [];
  results = new Map<string, any[]>();
  when(fragment: string, rows: any[]) { this.results.set(fragment, rows); }
  async query(sql: string, params?: unknown[]) {
    this.calls.push({ sql, params: params ?? [] });
    for (const [frag, rows] of this.results) {
      if (sql.includes(frag)) return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 1 };
  }
}

function harness() {
  const client = new StubClient();
  const pool = {
    withTx: async <T,>(fn: (c: any) => Promise<T>): Promise<T> => fn(client),
    query: (sql: string, params?: unknown[]) => client.query(sql, params),
  };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  // The real repository against the stub pool/client, so the SQL itself is exercised.
  const repo = new AppealsRepository(pool as any);
  const decisions = new AppealDecisionService(pool as any, audit as any, repo);
  const queue = new AppealsQueueService(pool as any, audit as any, repo);
  return { client, pool, audit, repo, decisions, queue };
}

const actor = { userId: 'op-decider', roles: ['platform_moderation_desk'], ip: null, requestId: 'r1' } as any;
const ROW = {
  id: 'ap1', subjectRef: 'listing:11111111-1111-7111-8111-111111111111', subjectAction: 'listing_removed',
  appellant: 'farmer-1', originalActionRef: 'order-1', originalReviewerId: 'op-original',
  assignedTo: 'op-decider', status: 'pending', slaDueAt: ahead(28),
  decisionReason: null, decidedAt: null, createdAt: ahead(-20),
};

describe('ADMIN-SWEEP-b1 · the overturn is ONE transaction with four honest writes', () => {
  it('overturn: restore + reversal + heal + notice + lesson + status flip all on the SAME client', async () => {
    const { client, decisions, audit } = harness();
    client.when('FROM appeals a WHERE a.id = $1 AND a.deleted_at IS NULL FOR UPDATE', [{ ...ROW }]);
    client.when('SELECT code FROM languages', [{ code: 'en' }, { code: 'gu' }, { code: 'hi' }]);
    client.when('SELECT status FROM listings WHERE id = $1 FOR UPDATE', [{ status: 'archived' }]);
    client.when('FROM risk_events e', [{ id: 'ev1', tenantId: 't1', eventCode: 'fake_listing', weight: -40 }]);
    client.when('COALESCE(SUM(weight), 0)', [{ total: 0 }]);
    client.when('SELECT tenant_id FROM listings WHERE id = $1', [{ tenant_id: 't1' }]);

    const out = await decisions.decide(actor, 'ap1', {
      outcome: 'overturned', reason: 'The photos were genuine; we are sorry — decision reversed.', languageCode: 'gu',
    });

    const sqls = client.calls.map((c) => c.sql);
    // every write of the contract happened, on this one client
    expect(sqls.some((s) => s.includes("UPDATE listings SET status = 'published'"))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO risk_events'))).toBe(true);
    expect(sqls.some((s) => s.includes('UPDATE risk_scores SET score'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO moderation_action_notices'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO moderation_review_lessons'))).toBe(true);
    expect(sqls.some((s) => s.includes("UPDATE appeals SET status = $2"))).toBe(true);
    expect(audit.write).toHaveBeenCalledTimes(1);

    // the reversal is the exact opposite weight, coded and traceable
    const reversal = client.calls.find((c) => c.sql.includes('INSERT INTO risk_events'))!;
    expect(reversal.params).toContain(40);
    expect(reversal.sql).toContain("'appeal'");
    // the healed score: base 70 + post-reversal sum (stubbed 0) = 70 → standard
    const heal = client.calls.find((c) => c.sql.includes('UPDATE risk_scores SET score'))!;
    expect(heal.params).toContain(70);
    expect(heal.params).toContain('standard');
    // the notice is the decider's words in the language they wrote
    const notice = client.calls.find((c) => c.sql.includes('INSERT INTO moderation_action_notices'))!;
    expect(notice.params).toContain('gu');
    expect(notice.params).toContain(`appealnotice:ap1:subject_owner`);
    // and the response reports all four effects, honestly
    expect(out.effects.map((e: any) => e.effect)).toEqual(
      ['restore_subject', 'reverse_risk_event', 'coach_reviewer', 'notify_appellant']);
    expect(out.effects.every((e: any) => e.state === 'done')).toBe(true);
  });

  it('a gone subject and an unscored action are REPORTED, never printed as restored/healed', async () => {
    const { client, decisions } = harness();
    client.when('FROM appeals a WHERE a.id = $1 AND a.deleted_at IS NULL FOR UPDATE', [{ ...ROW }]);
    client.when('SELECT code FROM languages', [{ code: 'en' }]);
    client.when('SELECT status FROM listings WHERE id = $1 FOR UPDATE', []);      // listing gone
    client.when('FROM risk_events e', []);                                        // nothing scored
    client.when('SELECT tenant_id FROM listings WHERE id = $1', []);              // no tenant either

    const out = await decisions.decide(actor, 'ap1', {
      outcome: 'overturned', reason: 'Removal was wrong; recording the reversal for the record.', languageCode: 'en',
    });
    const by = Object.fromEntries(out.effects.map((e: any) => [e.effect, e]));
    expect(by.restore_subject.state).toBe('subject_gone');
    expect(by.reverse_risk_event.state).toBe('nothing_to_do');
    expect(by.notify_appellant.state).toBe('nothing_to_do');   // tenant-scoped spine had no route — said, not hidden
    expect(by.coach_reviewer.state).toBe('done');              // the lesson survives even when nothing else could run
    // and NO restore/heal writes happened
    const sqls = client.calls.map((c) => c.sql);
    expect(sqls.some((s) => s.includes("UPDATE listings SET status = 'published'"))).toBe(false);
    expect(sqls.some((s) => s.includes('INSERT INTO risk_events'))).toBe(false);
  });

  it('UPHOLD queues the reasoning to the appellant too — even upheld ones — and runs no overturn write', async () => {
    const { client, decisions } = harness();
    client.when('FROM appeals a WHERE a.id = $1 AND a.deleted_at IS NULL FOR UPDATE', [{ ...ROW }]);
    client.when('SELECT code FROM languages', [{ code: 'hi' }]);
    client.when('SELECT tenant_id FROM listings WHERE id = $1', [{ tenant_id: 't1' }]);
    const out = await decisions.decide(actor, 'ap1', {
      outcome: 'upheld', reason: 'The certificate was expired at listing time; the removal stands.', languageCode: 'hi',
    });
    const sqls = client.calls.map((c) => c.sql);
    expect(sqls.some((s) => s.includes('INSERT INTO moderation_action_notices'))).toBe(true);
    expect(sqls.some((s) => s.includes('UPDATE listings'))).toBe(false);
    expect(sqls.some((s) => s.includes('INSERT INTO risk_events'))).toBe(false);
    expect(sqls.some((s) => s.includes('moderation_review_lessons'))).toBe(false);
    expect(out.effects.map((e: any) => e.effect)).toEqual(['notify_appellant']);
  });

  it('the original reviewer is refused BEFORE any write — 409 with the rule in it', async () => {
    const { client, decisions } = harness();
    client.when('FROM appeals a WHERE a.id = $1 AND a.deleted_at IS NULL FOR UPDATE',
      [{ ...ROW, originalReviewerId: 'op-decider' }]);
    await expect(decisions.decide(actor, 'ap1', {
      outcome: 'overturned', reason: 'trying to acquit my own removal, twenty chars.', languageCode: 'en',
    })).rejects.toBeInstanceOf(AppealNotDecidableError);
    const sqls = client.calls.map((c) => c.sql);
    expect(sqls.some((s) => s.startsWith('UPDATE') || s.startsWith('INSERT'))).toBe(false);
  });

  it('a thin reason is refused as 422 with nothing written', async () => {
    const { client, decisions } = harness();
    client.when('FROM appeals a WHERE a.id = $1 AND a.deleted_at IS NULL FOR UPDATE', [{ ...ROW }]);
    await expect(decisions.decide(actor, 'ap1', { outcome: 'upheld', reason: 'no.', languageCode: 'en' }))
      .rejects.toBeInstanceOf(InvalidAppealDecisionError);
    expect(client.calls.some((c) => c.sql.startsWith('UPDATE') || c.sql.startsWith('INSERT'))).toBe(false);
  });
});

describe('ADMIN-SWEEP-b1 · "Take next" claims the persisted answer, not the display join', () => {
  it('resolves + persists origin inside the lock, then refuses to hand you your own call', async () => {
    const { client, queue } = harness();
    client.when('FOR UPDATE SKIP LOCKED', [{ id: 'ap1' }]);
    // the row is origin-less until claim resolves it — and resolution names the CALLER
    client.when('FROM appeals a WHERE a.id = $1 AND a.deleted_at IS NULL FOR UPDATE',
      [{ ...ROW, assignedTo: null, originalReviewerId: null, originalActionRef: null }]);
    client.when('LEFT JOIN LATERAL', [{ reviewerId: 'op-decider', actionRef: 'order-1' }]);
    client.when('count(*)::int AS total', [{ total: 1, notOwn: 0 }]);

    const out = await queue.takeNext(actor);
    expect(out.claimed).toBe(false);
    expect((out as any).empty).toEqual({ kind: 'only_your_own', n: 1 });
    // but the resolution WAS persisted for whoever comes next
    expect(client.calls.some((c) => c.sql.includes('UPDATE appeals SET original_reviewer_id'))).toBe(true);
    // and no claim was written
    expect(client.calls.some((c) => c.sql.includes('SET assigned_to'))).toBe(false);
  });

  it('claims the oldest deadline a stranger to the case may judge, and audits the claim', async () => {
    const { client, queue, audit } = harness();
    client.when('FOR UPDATE SKIP LOCKED', [{ id: 'ap1' }]);
    client.when('FROM appeals a WHERE a.id = $1 AND a.deleted_at IS NULL FOR UPDATE',
      [{ ...ROW, assignedTo: null }]);
    const out = await queue.takeNext(actor);
    expect(out.claimed).toBe(true);
    expect((out as any).appeal.assignedTo).toBe('op-decider');
    expect(client.calls.some((c) => c.sql.includes('SET assigned_to = $2') && c.sql.includes("original_reviewer_id <> $2"))).toBe(true);
    expect(audit.write).toHaveBeenCalledTimes(1);
  });
});
