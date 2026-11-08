// apps/web-tenant/src/test/hotfix12-rate-card.spec.ts · PC-56 HOTFIX-12 — NO RATE CHANGE WITHOUT A SECOND PERSON AND A RECORD (web-tenant).
//
// The API is the rule (founder Q1-A + Q1-sub, 2026-11-08; migration 0234). The legacy `/dairy/console` must show each card's state —
// awaiting a second person / approved by you / approved by a second person / existed before the rule — offer Approve only to a
// person who did not create the card, and print the refusals as sentences in en/hi/gu. It never names a person: the API sends
// only whether the signed-in viewer created or approved the card.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { rateCardStateKey, canApproveRateCard, dairyRefusalKey, type RateCardApprovalLike } from '../features/dairy/calc';
import { cardCheckerKey, cardSupersedeKey } from '../features/dairy/quality';

const CATS = { en, hi, gu } as Record<string, Record<string, string>>;
const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const card = (o: Partial<RateCardApprovalLike>): RateCardApprovalLike => ({ approvalState: 'awaiting_second_person', createdByYou: false, approvedByYou: false, ...o });
const KEYS = ['dairy.ok.ratecard', 'dairy.ok.ratecard.approved', 'dairy.rate.to', 'dairy.rate.state', 'dairy.rate.state.awaiting', 'dairy.rate.state.awaitingYours',
  'dairy.rate.state.approvedByYou', 'dairy.rate.state.approvedBySecond', 'dairy.rate.state.beforeRule', 'dairy.rate.approve', 'dairy.rate.ruleHelp',
  'dairy.error.RATE_CARD_BACKDATED', 'dairy.error.RATE_CARD_SECOND_PERSON_REQUIRED', 'dairy.error.RATE_CARD_ALREADY_APPROVED', 'dairy.error.RATE_CARD_OVERLAP',
  'dairy.quality.card.supersede', 'dairy.quality.card.checker'];

describe('HOTFIX-12 · each card\'s state', () => {
  it('awaiting / yours awaiting / approved by you / approved by a second person / before the rule', () => {
    expect(rateCardStateKey(card({}))).toBe('dairy.rate.state.awaiting');
    expect(rateCardStateKey(card({ createdByYou: true }))).toBe('dairy.rate.state.awaitingYours');
    expect(rateCardStateKey(card({ approvalState: 'approved', approvedByYou: true }))).toBe('dairy.rate.state.approvedByYou');
    expect(rateCardStateKey(card({ approvalState: 'approved', createdByYou: true }))).toBe('dairy.rate.state.approvedBySecond');
    expect(rateCardStateKey(card({ approvalState: 'approved_before_rule' }))).toBe('dairy.rate.state.beforeRule');
  });
  it('Approve is hidden from the creator, and from any card already approved', () => {
    expect(canApproveRateCard(card({}))).toBe(true);
    expect(canApproveRateCard(card({ createdByYou: true }))).toBe(false);
    expect(canApproveRateCard(card({ approvalState: 'approved' }))).toBe(false);
    expect(canApproveRateCard(card({ approvalState: 'approved_before_rule' }))).toBe(false);
  });
  it('the console renders the state column, the rule line and Approve behind canApproveRateCard; the action posts the approval', () => {
    const page = src('app/dairy/console/page.tsx');
    expect(page).toContain("cell: (c) => t.t(rateCardStateKey(c))");
    expect(page).toContain("cell: (c) => canApproveRateCard(c) ? (");
    expect(page).toContain('<form action={approveRateCardAction}>');
    expect(page).toContain("t.t('dairy.rate.ruleHelp')");
    expect(page).toContain("'ratecard.approved'");
    expect(page).not.toMatch(/createdBy[^Y]|approvedBy[^Y]/);   // no person id is ever read on this page
    const actions = src('app/dairy/actions.ts');
    expect(actions).toContain('tenantClient().dairy.approveRateCard(id, randomUUID())');
    expect(actions).toContain('redirect(`${PATH}?ok=ratecard.approved`)');
  });
});

describe('HOTFIX-12 · the words', () => {
  it('every new key exists in en, hi and gu (parity), none empty, and no refusal sentence is its raw code', () => {
    for (const k of KEYS) for (const l of ['en', 'hi', 'gu']) {
      expect([l, k, typeof CATS[l][k]]).toEqual([l, k, 'string']);
      expect(CATS[l][k].length).toBeGreaterThan(2);
    }
    for (const code of ['RATE_CARD_BACKDATED', 'RATE_CARD_SECOND_PERSON_REQUIRED', 'RATE_CARD_ALREADY_APPROVED', 'RATE_CARD_OVERLAP'])
      for (const l of ['en', 'hi', 'gu']) expect(CATS[l][dairyRefusalKey(code)!]).not.toContain(code);
  });
  it('the catalogues stay at parity (same key set in en, hi, gu)', () => {
    const ks = (o: Record<string, string>) => Object.keys(o).sort();
    expect(ks(hi)).toEqual(ks(en));
    expect(ks(gu)).toEqual(ks(en));
  });
  it('the English rule line is the founder\'s Q1-A in sentences, and says nothing about the future', () => {
    // Founder follow-up (2026-11-08): tomorrow at the earliest — pricing changes only at midnight.
    expect(en['dairy.rate.ruleHelp']).toBe('A new rate card can start tomorrow at the earliest and prices nothing until a second person approves it. The person who creates it cannot approve it.');
    expect(en['dairy.error.RATE_CARD_BACKDATED']).toBe('A rate card can start tomorrow at the earliest.');
    for (const l of ['en', 'hi', 'gu']) expect(CATS[l]['dairy.quality.card.checker']).not.toEqual(CATS[l]['dairy.rate.state.awaiting']);
    for (const k of KEYS) expect(en[k]).not.toMatch(/\bwill\b|\bsoon\b|\bcoming\b/i);
  });
  it('the quality desk now says the truth when the server says the rule holds (checkerRequired / supersedeRecorded true)', () => {
    const r = { byAnimal: [], ambiguousAnimalTypes: [], supersedeRecorded: true, checkerRequired: true };
    expect(cardCheckerKey(r)).toBe('dairy.quality.card.checker');
    expect(cardSupersedeKey(r)).toBe('dairy.quality.card.supersede');
    expect(cardCheckerKey({ ...r, checkerRequired: false })).toBe('dairy.quality.card.noChecker');
  });
});
