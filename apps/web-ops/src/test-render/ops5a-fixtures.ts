// apps/web-ops/src/test-render/ops5a-fixtures.ts · PC-56 OPS-5a — the alert pages' server answers as the API shapes them (`alert-rules`, `alerts/feed`,
// `breaches/:id`), run through the page's own narrowing (`asRules`, `asFired`) exactly as the page does. HOSTILE on purpose (survey E15): the rules
// carry the people's ids, an author, a proposer and a proposal's free-text reason; the feed carries the people told, the acknowledging person and a
// typed label as the subject; the breach carries an action note, an outcome reason and a buyer's reason that each name a person — NONE may print.
// The ONE free text printed is a rule's own name, and the active rule's name is NAME-SHAPED on purpose ("Testperson Namesake …") so a render test
// pins that exception. Figures chosen so no canon figure appears (survey F-12): a duration of 754 s, a loss of 1,250.50 in its row's own currency.
import type { ColdBreach } from '@krishalaya/sdk-js';
import { asFired, asRules } from '../features/ops5/alerts';

export const R_BREACH = '0192d2c4-a1e7-7000-8000-000000000001';
export const R_SILENT = '0192d2c4-a1e7-7000-8000-000000000002';
export const CHANGE_1 = '0192d2c4-c4a9-7000-8000-000000000001';
export const BREACH_1 = '0192d2c4-b7ea-7000-8000-000000000001';
export const SUBJECT = '0192d2c4-c001-7000-8000-000000000c01';
export const P1 = '0192d2c4-9e09-7000-8000-000000000001';
export const P2 = '0192d2c4-9e09-7000-8000-000000000002';
export const P3 = '0192d2c4-9e09-7000-8000-000000000003';
export const PERSON = 'Testperson Namesake';
export const RULE_NAME = `${PERSON} cooler watch`;   // name-shaped: the one free text the page prints (a rule's identity)

export const RAW_RULES = [
  { id: R_BREACH, kind: 'cold_chain_breach', ruleName: RULE_NAME, threshold: { windowHours: 12, minBreaches: 3 }, recipientUserIds: [P1, P2, P3], channelHint: 'sms',
    cooldownMinutes: 45, isActive: true, lastEvaluatedAt: '2026-11-10T02:40:00.000Z', createdBy: P1, updatedBy: P2,
    lastChange: { action: 'change_confirmed', at: '2026-11-09T11:05:00.000Z', byYou: false }, openChange: null },
  { id: R_SILENT, kind: 'device_silent', ruleName: 'Logger quiet rule', threshold: { silentMinutes: 40 }, recipientUserIds: [P2], channelHint: null,
    cooldownMinutes: 120, isActive: false, lastEvaluatedAt: null, createdBy: P2, updatedBy: P2, lastChange: { action: 'updated', at: '2026-11-08T07:15:00.000Z', byYou: true },
    openChange: { id: CHANGE_1, ruleId: R_SILENT, state: 'proposed', proposedBy: P1, proposedByYou: false, proposedAt: '2026-11-10T01:30:00.000Z',
      reason: `${PERSON} said to quiet it`, before: {}, after: {}, changes: [{ field: 'cooldownMinutes', direction: 'quieter' }, { field: 'recipientsRemoved', direction: 'quieter' }] } },
];
export const RULES = asRules(RAW_RULES);
/** The same open proposal, proposed by the reader. */
export const RULES_MINE = asRules(RAW_RULES.map((r) => (r.openChange ? { ...r, openChange: { ...r.openChange, proposedBy: P3, proposedByYou: true } } : r)));

export const RAW_FEED = [
  { id: '0192d2c4-f1ed-7000-8000-000000000001', ruleId: R_BREACH, ruleName: RULE_NAME, kind: 'cold_chain_breach', severity: 'critical', subjectType: 'bmc_unit', subjectRef: `${PERSON} typed sensor`,
    detail: { breaches: 4 }, recipients: [P1, P2, P3], notified: true, firedAt: '2026-11-10T02:40:00.000Z', acknowledgedAt: '2026-11-10T02:52:00.000Z', acknowledgedBy: P2 },
  { id: '0192d2c4-f1ed-7000-8000-000000000002', ruleId: R_BREACH, ruleName: RULE_NAME, kind: 'cold_chain_breach', severity: 'warning', subjectType: 'bmc_unit', subjectRef: '0192D2C4',
    detail: { breaches: 3 }, recipients: [P1, P2, P3], notified: true, firedAt: '2026-11-09T20:10:00.000Z', acknowledgedAt: null, acknowledgedBy: null },
  { id: '0192d2c4-f1ed-7000-8000-000000000003', ruleId: null, ruleName: null, kind: 'cold_chain_breach', severity: 'critical', subjectType: 'bmc_unit', subjectRef: SUBJECT,
    detail: { breachId: BREACH_1, peakC: '9.80' }, recipients: [P1, P3], notified: true, firedAt: '2026-11-10T00:05:00.000Z', acknowledgedAt: null, acknowledgedBy: null },
  { id: '0192d2c4-f1ed-7000-8000-000000000004', ruleId: null, ruleName: null, kind: 'device_silent', severity: 'warning', subjectType: 'bmc_unit', subjectRef: 'LOG-TEST-1',
    detail: {}, recipients: [P2], notified: true, firedAt: '2026-11-09T23:00:00.000Z', acknowledgedAt: null, acknowledgedBy: null },
];
export const FIRED = asFired(RAW_FEED);

export const BREACH: ColdBreach = {
  id: BREACH_1, subjectType: 'bmc_unit', subjectId: SUBJECT, subjectRef: '0192D2C4', device: { id: '0192d2c4-1061-7000-8000-000000000001', serial: 'LOG-TEST-1' },
  band: { minC: '2.00', maxC: '6.00' }, direction: 'above', peakC: '9.80', readingsOut: 5,
  firstOutAt: '2026-11-09T23:58:00.000Z', openedAt: '2026-11-10T00:05:00.000Z', closedAt: '2026-11-10T00:10:34.000Z', durationSeconds: 754,
  alert: { state: 'alerted', recipients: 2, id: '0192d2c4-f1ed-7000-8000-000000000003' },
  acknowledgedAt: '2026-11-10T00:07:00.000Z', actionAt: '2026-11-10T00:20:00.000Z', actionNote: `${PERSON} moved the crates to the spare cooler`,
  outcome: 'loss_recorded', outcomeAt: '2026-11-10T01:00:00.000Z', outcomeReason: `${PERSON} confirmed spoilage of two cans`,
  loss: { minor: '125050', currency: 'INR' },
  buyer: { offerState: 'decided', offeredAt: '2026-11-10T00:21:00.000Z', decision: 'accept_with_test', decidedAt: '2026-11-10T00:40:00.000Z', reason: `${PERSON} wants a lab test`, disputeId: null },
  playbookRun: { kind: 'refused', code: 'PLAYBOOK_NOT_BUILT' } as unknown as ColdBreach['playbookRun'], acts: [],
};
/** An open breach nobody was told about, nothing recorded on it, no buyer. */
export const BREACH_OPEN: ColdBreach = {
  ...BREACH, closedAt: null, durationSeconds: null, alert: { state: 'no_recipient', recipients: 0, id: null }, acknowledgedAt: null, actionAt: null, actionNote: null,
  outcome: null, outcomeAt: null, outcomeReason: null, loss: null, buyer: { offerState: 'none', offeredAt: null, decision: null, decidedAt: null, reason: null, disputeId: null },
  acts: ['acknowledge', 'record_action'],
};
/** A loss in ANOTHER currency — the page prints the row's own, never a default. */
export const BREACH_USD: ColdBreach = { ...BREACH, loss: { minor: '125050', currency: 'USD' } };
/** Words that would make a false claim if printed affirmatively (survey §1B–§1F). */
export const FALSE_5A = /maker[- ]checker|versioned|escalat|ladder|rings? (the )?phone|vet desk|humidity|platform default|archived|on-call|zero-sum|audit[- ]trail|\bcause\b|\bdoor\b|\bbump\b|toleran|trail attached|incident (file )?closed/i;
