// apps/web-admin/src/test/adminsweepb1-appeals.spec.ts · W097 + W1953–W1955 console logic (PC-56 ADMIN-SWEEP-b1).
//
// The console REFLECTS the server's rules and grants nothing (Law 6): every gate here has a stricter twin in
// admin-api, and these tests pin the reflection — the sentence an operator sees must correspond to the refusal the
// server would issue, and a tick the platform has not verified must never be drawn.
import {
  DECISION_REASON_MIN, APPEAL_SLA_HOURS, APPEAL_STATUSES,
  slaLabel, slaTone, decideBlockedKey, neOriginalMark, buildDecide, statusTab, effectTone, OVERTURN_EFFECT_KEYS,
} from '../features/moderation/appeals';
import { en } from '../i18n/en';

describe('ADMIN-SWEEP-b1 · SLA display', () => {
  it('prints hours-left while running and hours-OVER once breached — late and very late differ', () => {
    expect(slaLabel({ kind: 'running', hoursLeft: 28 })).toEqual({ key: 'left', hours: 28 });
    expect(slaLabel({ kind: 'breached', overHours: 12 })).toEqual({ key: 'over', hours: 12 });
    expect(slaLabel(null)).toEqual({ key: 'none', hours: 0 });
  });
  it('escalates the tone as the clock runs down', () => {
    expect(slaTone({ kind: 'running', hoursLeft: 28 })).toBe('success');
    expect(slaTone({ kind: 'running', hoursLeft: 7 })).toBe('warning');
    expect(slaTone({ kind: 'breached', overHours: 1 })).toBe('danger');
  });
  it('the constant is the canon 48 — one number with the server, not a copy that drifts', () => {
    expect(APPEAL_SLA_HOURS).toBe(48);
  });
});

describe('ADMIN-SWEEP-b1 · the decide gate mirrors the server sentences', () => {
  const base = { status: 'pending', assignedTo: 'op-a', originalReviewerId: 'op-b', viewer: 'op-a' };
  it('the assignee may decide', () => {
    expect(decideBlockedKey(base)).toBeNull();
  });
  it('your own original call is the STRONGEST refusal — it wins even when the appeal is assigned to you', () => {
    expect(decideBlockedKey({ ...base, originalReviewerId: 'op-a' })).toBe('ownOriginalCall');
    expect(decideBlockedKey({ ...base, originalReviewerId: 'op-a', assignedTo: null })).toBe('ownOriginalCall');
  });
  it('unassigned → claim first; assigned elsewhere → not yours', () => {
    expect(decideBlockedKey({ ...base, assignedTo: null })).toBe('unassigned');
    expect(decideBlockedKey({ ...base, viewer: 'op-c' })).toBe('assignedElsewhere');
  });
  it('a decided appeal offers nothing', () => {
    expect(decideBlockedKey({ ...base, status: 'overturned' })).toBe('decided');
  });
  it('every blocked key has its sentence in the catalogue', () => {
    for (const k of ['decided', 'ownOriginalCall', 'unassigned', 'assignedElsewhere']) {
      expect((en as Record<string, string>)[`ap.decideBlocked.${k}`]).toBeTruthy();
    }
  });
});

describe('ADMIN-SWEEP-b1 · the ≠-original mark is never invented', () => {
  it('draws the tick only when both sides are known and differ', () => {
    expect(neOriginalMark('op-a', 'op-b')).toBe('ok');
  });
  it('an unresolved origin prints as UNVERIFIED, not as a tick — a check the platform has not made', () => {
    expect(neOriginalMark('op-a', null)).toBe('unknown');
  });
  it('draws nothing for an unassigned row, and nothing for an impossible equality', () => {
    expect(neOriginalMark(null, 'op-b')).toBeNull();
    expect(neOriginalMark('op-a', 'op-a')).toBeNull();   // the DB CHECK forbids it; the console must not style it
  });
});

describe('ADMIN-SWEEP-b1 · buildDecide (client twin of the server gate)', () => {
  it('refuses a thin reason with the same floor as the domain and 0132', () => {
    expect(DECISION_REASON_MIN).toBe(20);
    expect(buildDecide({ outcome: 'upheld', reason: 'no', languageCode: 'gu' })).toEqual({ ok: false, error: 'reason' });
  });
  it('refuses a missing outcome or language', () => {
    expect(buildDecide({ outcome: '', reason: 'a'.repeat(30), languageCode: 'gu' })).toEqual({ ok: false, error: 'outcome' });
    expect(buildDecide({ outcome: 'overturned', reason: 'a'.repeat(30), languageCode: ' ' })).toEqual({ ok: false, error: 'language' });
  });
  it('trims and passes a well-formed decision through', () => {
    expect(buildDecide({ outcome: 'overturned', reason: `  ${'a'.repeat(30)}  `, languageCode: ' gu ' }))
      .toEqual({ ok: true, value: { outcome: 'overturned', reason: 'a'.repeat(30), languageCode: 'gu' } });
  });
});

describe('ADMIN-SWEEP-b1 · tabs, effects and catalogue coverage', () => {
  it('statusTab admits only the three real statuses and defaults to pending', () => {
    expect(APPEAL_STATUSES).toEqual(['pending', 'upheld', 'overturned']);
    expect(statusTab(undefined)).toBe('pending');
    expect(statusTab('overturned')).toBe('overturned');
    expect(statusTab('deleted')).toBe('pending');
  });
  it('all four overturn effects have honest catalogue copy, and the panel names the in-app-only truth', () => {
    for (const k of OVERTURN_EFFECT_KEYS) {
      expect((en as Record<string, string>)[`ap.effect.${k}`]).toBeTruthy();
    }
    // the notify line must not promise a channel that does not exist (the ADMIN-2b pager lesson)
    expect((en as Record<string, string>)['ap.effect.notifyAppellant']).toContain('no SMS or voice provider');
    // and the doctrine line carries the half-contract warning that split this wave
    expect((en as Record<string, string>)['ap.effectsDoctrine']).toContain('ONE transaction');
  });
  it('effectTone distinguishes done / nothing-to-do / subject-gone', () => {
    expect(effectTone('done')).toBe('success');
    expect(effectTone('nothing_to_do')).toBe('neutral');
    expect(effectTone('subject_gone')).toBe('warning');
  });
  it('the trust overview no longer names appeals as not built', () => {
    expect((en as Record<string, string>)['ts.notBuilt']).not.toContain('are not built');
    expect((en as Record<string, string>)['ts.nav.appeals']).toBeTruthy();
  });
});
