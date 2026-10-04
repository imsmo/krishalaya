// apps/api/src/__tests__/tenant-swd-domain.spec.ts · PC-56 TENANT-SW-d — the PURE rules of the wave (no DB): the profile step and the
// GSTIN state advisory, the setup-call slot, the AGM pack (FY, assembly from facts, refusals by name, the content hash, the PDF lines),
// the register-import line judge, and the refusal maps against 0200's trigger codes (every `[CODE]` the migration raises is named).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  advisoryNeedsConfirm, cleanDraftPayload, gstStateAdvisory, missingRequired, reasonedRows, savedUpToStep, PROFILE_STEP_FIELDS,
} from '../modules/tenancy/domain/onboarding';
import { istInstant, lastFourMask, slotProblem } from '../modules/tenancy/domain/setup-call';
import { SWD_TENANCY_CODES, namedSwdTenancyRefusal } from '../modules/tenancy/domain/swd.errors';
import { SWD_GOV_CODES, namedSwdGovRefusal } from '../modules/memberships/domain/swd-gov.errors';
import {
  PackFacts, assemble, bpAsPercent, canonical, contentSha256, documentIdFor, fiscalYear, pdfLines, shareBp, verifyUrlFor, wrap,
} from '../modules/memberships/domain/agm-pack';
import { judgeLines, maskPhone, missingColumns, parseMinor, tally } from '../modules/memberships/domain/register-import';
import { renderTextPdf } from '../core/media/pdf/pdf-writer';

const MIG = fs.readFileSync(path.join(__dirname, '../../../../db/migrations/0200_onboarding_governance_pack.sql'), 'utf8');

describe('SW-d · the profile step (W114)', () => {
  const gj = { districtName: 'Junagadh', stateName: 'Gujarat', stateGstCode: '24' };
  const names = (c: string) => ({ '24': 'Gujarat', '27': 'Maharashtra' } as Record<string, string>)[c] ?? null;
  it('the advisory is a CONFIRM naming both states, never a refusal; a match and no GSTIN are silent; what cannot be compared says so', () => {
    expect(gstStateAdvisory('27AAPFU0939F1ZV', gj, 'IN', names)).toEqual({ kind: 'confirm', gstCode: '27', gstStateName: 'Maharashtra', districtName: 'Junagadh', districtStateName: 'Gujarat', districtStateCode: '24' });
    expect(gstStateAdvisory('24AABCU9603R1Z5', gj, 'IN', names)).toEqual({ kind: 'silent' });
    expect(gstStateAdvisory(null, gj, 'IN', names)).toEqual({ kind: 'silent' });
    expect(gstStateAdvisory('  ', gj, 'IN', names)).toEqual({ kind: 'silent' });
    expect(gstStateAdvisory('27AAPFU0939F1ZV', null, 'IN', names)).toEqual({ kind: 'not_checkable', reason: 'no_district' });
    expect(gstStateAdvisory('27AAPFU0939F1ZV', { ...gj, stateGstCode: null }, 'IN', names)).toEqual({ kind: 'not_checkable', reason: 'state_code_unknown' });
    expect(gstStateAdvisory('27AAPFU0939F1ZV', gj, 'BD', names)).toEqual({ kind: 'not_checkable', reason: 'not_india' });
    expect(gstStateAdvisory('99AAPFU0939F1ZV', gj, 'IN', names)).toMatchObject({ kind: 'confirm', gstStateName: null });
    const confirm = gstStateAdvisory('27AAPFU0939F1ZV', gj, 'IN', names);
    expect(advisoryNeedsConfirm(confirm, false)).toBe(true);
    expect(advisoryNeedsConfirm(confirm, true)).toBe(false);
    expect(advisoryNeedsConfirm({ kind: 'not_checkable', reason: 'no_district' }, false)).toBe(false);
  });
  it('a draft keeps only the step\'s keys, as trimmed text (0200\'s CHECK admits exactly these); three fields are required', () => {
    expect(cleanDraftPayload({ legalName: ' Shakti ', pan: 'AABCU9603R', regionId: 'not-a-uuid', status: 'active', ownerPhone: '+919800000000', gstin: 7 } as never))
      .toEqual({ legalName: 'Shakti', pan: 'AABCU9603R' });
    expect(PROFILE_STEP_FIELDS).toEqual(['legalName', 'displayName', 'regionId', 'cinOrRegNo', 'pan', 'gstin', 'fssaiLicense']);
    for (const k of PROFILE_STEP_FIELDS) expect(MIG).toContain(`'${k}'`);
    expect(missingRequired({ legalName: 'x', displayName: '', regionId: null })).toEqual(['displayName', 'regionId']);
  });
  it('the reason rule applies to a RECORDED identifier being replaced or cleared — not to names typed one step earlier', () => {
    expect(reasonedRows([{ field: 'gstin', from: '24AAA', to: '27BBB' }, { field: 'legalName', from: 'A', to: 'B' }, { field: 'pan', from: null, to: 'X' }] as never))
      .toEqual([{ field: 'gstin', from: '24AAA', to: '27BBB' }]);
    expect(savedUpToStep('profile', false)).toBe(2); expect(savedUpToStep('profile', true)).toBe(3); expect(savedUpToStep('done', false)).toBe(4);
  });
});

describe('SW-d · the setup call (W2619)', () => {
  it('last four digits only; IST civil → instant; the slot rules', () => {
    expect(lastFourMask('+919876543210')).toBe('••••3210');
    expect(lastFourMask('12')).toBeNull();
    expect(istInstant('2026-10-12', '10:30')!.toISOString()).toBe('2026-10-12T05:00:00.000Z');
    expect(istInstant('2026-13-12', '10:30')).toBeNull();
    const now = new Date('2026-10-04T00:00:00Z');
    const at = (h: number, d = 1) => new Date(now.getTime() + d * 86_400_000 + h * 3_600_000);
    expect(slotProblem(at(1), at(2), now)).toBeNull();
    expect(slotProblem(new Date(now.getTime() - 1000), at(2), now)).toBe('not_future');
    expect(slotProblem(at(1, 31), at(2, 31), now)).toBe('too_far');
    expect(slotProblem(at(2), at(1), now)).toBe('not_after_start');
    expect(slotProblem(at(1), at(6), now)).toBe('too_long');
    expect(MIG).toMatch(/phone_masked ~ '\^••••\[0-9\]\{4\}\$'/);
  });
});

describe('SW-d · the AGM pack (W199) — facts, methods, refusals by name', () => {
  const fy = fiscalYear(4, 2025);
  const facts = (o: Partial<PackFacts> = {}): PackFacts => ({
    fy, zone: 'Asia/Kolkata', countryCurrency: 'INR', memberCount: 2,
    gmv: [{ currency: 'INR', orders: 2, goodsMinor: '500000', buyerTotalMinor: '520000' }],
    memberCredits: [{ currency: 'INR', creditsMinor: '450000', clawbacksMinor: '-10000', transactions: 3 }],
    platformFees: [{ currency: 'INR', netMinor: '25000', entries: 2 }], gstPayable: [{ currency: 'INR', netMinor: '4500', entries: 2 }],
    tenantCommission: [{ currency: 'INR', netMinor: '20500', entries: 2 }], statements: { statements: 1, members: 1 },
    register: { rowsAtFyEnd: 2, holders: 2, totalShares: 15, paidUpMinor: '150000', changedAfterFyEnd: 0 },
    resolutions: [{ id: 'r1', title: 'Dividend', closedAt: '2025-08-01T06:00:00.000Z', outcome: 'passed', type: 'dividend' }],
    annexure: null, quorum: { quorumBp: 3300, source: 'platform_default' }, ...o,
  });
  it('the FY is the declared basis: April → "FY 2025-26" 2025-04-01..2026-03-31; January → "FY 2025"', () => {
    expect(fy).toEqual({ label: 'FY 2025-26', start: '2025-04-01', endInclusive: '2026-03-31', endExclusive: '2026-04-01', startMonth: 4, startYear: 2025 });
    expect(fiscalYear(1, 2025)).toMatchObject({ label: 'FY 2025', start: '2025-01-01', endInclusive: '2025-12-31' });
    expect(fiscalYear(7, 2099)).toMatchObject({ label: 'FY 2099-00', endInclusive: '2100-06-30' });
    expect(() => fiscalYear(13, 2025)).toThrow();
  });
  it('every row carries a method; surplus and operating costs are REFUSED BY NAME with no figure; the share is paid ÷ GMV with both facts', () => {
    const rows = assemble(facts());
    const by = (i: string) => rows.find((r) => r.item === i)!;
    for (const r of rows) { expect(r.method.length).toBeGreaterThan(20); if (r.status === 'refused') expect(r.figures).toEqual({}); else expect(Object.keys(r.figures).length).toBeGreaterThan(0); }
    expect(by('surplus')).toMatchObject({ status: 'refused', refusalCode: 'NO_COST_LEDGER', figures: {} });
    expect(by('operating_costs')).toMatchObject({ status: 'refused', refusalCode: 'NO_COST_LEDGER', figures: {} });
    expect(by('notice_period')).toMatchObject({ status: 'refused', refusalCode: 'NO_NOTICE_SETTING' });
    expect(by('annexure')).toMatchObject({ status: 'refused', refusalCode: 'NOT_UPLOADED' });
    expect(by('paid_to_members').figures).toMatchObject({ netMinor: '440000', creditsMinor: '450000', clawbacksMinor: '-10000' });
    expect(by('paid_share').figures).toMatchObject({ bp: 8800, percent: '88.00%', paidMinor: '440000', gmvMinor: '500000', currency: 'INR' });
    expect(rows.map((r) => r.sortOrder)).toEqual(rows.map((_, i) => i));
    // no row anywhere carries a typed surplus figure
    expect(JSON.stringify(rows.filter((r) => r.item === 'surplus'))).not.toMatch(/Minor/);
  });
  it('no GMV / mixed currencies / a register changed after FY end → refused by name (never a guessed figure)', () => {
    expect(assemble(facts({ gmv: [] })).find((r) => r.item === 'paid_share')).toMatchObject({ status: 'refused', refusalCode: 'NO_GMV' });
    const mixed = assemble(facts({ gmv: [{ currency: 'INR', orders: 1, goodsMinor: '1', buyerTotalMinor: '1' }, { currency: 'USD', orders: 1, goodsMinor: '1', buyerTotalMinor: '1' }] }));
    expect(mixed.find((r) => r.item === 'paid_share')).toMatchObject({ status: 'refused', refusalCode: 'MIXED_CURRENCY' });
    expect(mixed.find((r) => r.item === 'gmv')!.figures).toHaveProperty('byCurrency');
    const changed = assemble(facts({ register: { rowsAtFyEnd: 2, holders: 2, totalShares: 15, paidUpMinor: '150000', changedAfterFyEnd: 1 } }));
    expect(changed.find((r) => r.item === 'snapshot')).toMatchObject({ status: 'refused', refusalCode: 'REGISTER_CHANGED_AFTER_FY_END', figures: {} });
    expect(assemble(facts({ quorum: { quorumBp: 5000, source: 'tenant_setting' } })).find((r) => r.item === 'quorum')!.figures).toMatchObject({ percent: '50.00%', source: 'tenant_setting' });
    expect(assemble(facts({ annexure: { mediaId: 'm', bytes: '10', sha256: 'ab', mime: 'application/pdf' } })).find((r) => r.item === 'annexure')!.figures)
      .toMatchObject({ label: 'uploaded by the cooperative — not produced by the platform' });
  });
  it('integer basis points only; the content hash is canonical (key order does not matter); the document id is the trigger\'s formula', () => {
    expect(shareBp('1', '3')).toBe(3333); expect(shareBp('10', '0')).toBeNull(); expect(bpAsPercent(5)).toBe('0.05%'); expect(bpAsPercent(10000)).toBe('100.00%');
    expect(canonical({ b: 1, a: [{ d: 2, c: 1 }] })).toBe('{"a":[{"c":1,"d":2}],"b":1}');
    const rows = assemble(facts()); const meta = { documentId: 'AGM-X-FY2025-26-1', fiscalYearLabel: 'FY 2025-26', addendumNo: 0 };
    expect(contentSha256(meta, rows)).toBe(contentSha256(meta, [...rows].reverse()));
    expect(contentSha256(meta, rows)).not.toBe(contentSha256({ ...meta, addendumNo: 1 }, rows));
    expect(documentIdFor('anand-fpo', 'FY 2025-26', 0)).toBe('AGM-ANAND-FPO-FY2025-26-1');
    expect(documentIdFor('anand-fpo', 'FY 2025-26', 2)).toBe('AGM-ANAND-FPO-FY2025-26-3');
    expect(MIG).toContain(`'AGM-' || upper(t.slug) || '-' || replace(p_fy_label, ' ', '') || '-' || (p_addendum + 1)::text`);
    expect(verifyUrlFor('https://c.example/', 'AGM-A-FY2025-26-1')).toBe('https://c.example/verify/agm/AGM-A-FY2025-26-1');
  });
  it('the PDF: English through the WinAnsi writer, every refusal + method printed, the QR and the Indic half refused by name, the content hash inside, the file hash NOT', () => {
    const rows = assemble(facts());
    const { title, lines } = pdfLines({ organisation: 'Anand FPO', legalName: 'Anand FPO Ltd', documentId: 'AGM-ANAND-FY2025-26-2', fy, zone: 'Asia/Kolkata', fyBasisSource: 'country_default',
      issuedAt: '2026-10-04T06:00:00.000Z', addendumNo: 1, parentDocumentId: 'AGM-ANAND-FY2025-26-1', reason: 'The auditor revised the annexure', verifyUrl: 'https://c/verify/agm/AGM-ANAND-FY2025-26-2',
      contentSha256: 'f'.repeat(64), secondLanguage: 'gu' }, rows);
    const text = lines.join('\n');
    expect(title).toBe('AGM pack - FY 2025-26 - AGM-ANAND-FY2025-26-2');
    expect(text).toContain('ADDENDUM 1 to AGM-ANAND-FY2025-26-1'); expect(text).toContain('REFUSED - FPO surplus [NO_COST_LEDGER]');
    expect(text).toContain('Verification QR: not printed'); expect(text).toContain('Gujarati: this PDF writer cannot draw Gujarati script');
    expect(text).toContain(`Content sha256 (of the figures and methods below):\n${'f'.repeat(64)}`);
    expect(text).toContain('Share of GMV paid to members: 88.00% (INR 4,400.00 of INR 5,000.00)');
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(110);
    const pdf = renderTextPdf(title, lines);
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(wrap('a '.repeat(100), 20).every((l) => l.length <= 20)).toBe(true);
  });
});

describe('SW-d · the register import (W2626) — every line judged, named by its line', () => {
  const header = ['phone', 'folio', 'shares', 'paid_up'];
  it('columns, money in the currency\'s scale (never a float), the masked phone', () => {
    expect(missingColumns(['Phone ', '﻿folio', 'SHARES'])).toEqual(['paid_up']);
    expect(parseMinor('1000', 2)).toBe('100000'); expect(parseMinor('500.5', 2)).toBe('50050'); expect(parseMinor('1,234.56', 2)).toBe('123456');
    expect(parseMinor('12.345', 2)).toBeNull(); expect(parseMinor('-1', 2)).toBeNull(); expect(parseMinor('1.5', 0)).toBeNull(); expect(parseMinor('15', 0)).toBe('15');
    expect(maskPhone('+91 98765 43210')).toBe('••••3210'); expect(maskPhone('abc')).toBe('');
  });
  it('per-country phones; shape, folio, shares, paid_up errors; within-file duplicates on phone and folio (first one stands)', () => {
    const recs = [
      ['9876543210', 'f-1', '10', '100'], ['abc', 'F-2', '1', '1'], ['9876500000', 'F 3', '1', '1'], ['9876500001', 'F-4', '0', '1'],
      ['9876500002', 'F-5', '1', 'x'], ['+919876543210', 'F-6', '1', '1'], ['9876500003', 'F-1', '1', '1'], ['9876500004'], [''],
    ];
    const lines = judgeLines(header, recs, { phonePrefix: '+91', minorUnits: 2 });
    expect(lines.map((l) => [l.lineNo, l.error])).toEqual([
      [2, null], [3, 'PHONE_INVALID'], [4, 'FOLIO_INVALID'], [5, 'SHARES_INVALID'], [6, 'PAID_UP_INVALID'], [7, 'DUPLICATE_IN_FILE'], [8, 'FOLIO_DUPLICATE_IN_FILE'], [9, 'ROW_SHAPE']]);
    expect(lines[0]).toMatchObject({ phoneE164: '+919876543210', phoneMasked: '••••3210', folio: 'F-1', shares: 10, paidUpMinor: '10000' });
    expect(judgeLines(header, [['7911123456', 'A', '1', '1']], { phonePrefix: '+44', minorUnits: 2 })[0]).toMatchObject({ phoneE164: '+447911123456', error: null });
    expect(tally(['valid', 'error', 'skipped_duplicate', 'valid'])).toEqual({ rowCount: 4, validCount: 2, errorCount: 1, duplicateCount: 1 });
  });
});

describe('SW-d · every [CODE] 0200 raises is named (API sentence), and a named refusal maps to its status', () => {
  const raised = [...new Set([...MIG.matchAll(/\[([A-Z_]{3,})\]/g)].map((m) => m[1]))].sort();
  it('the migration raises codes, and each one has a sentence in one of the two maps', () => {
    expect(raised.length).toBeGreaterThan(30);
    const named = new Set([...Object.keys(SWD_TENANCY_CODES), ...Object.keys(SWD_GOV_CODES)]);
    expect(raised.filter((c) => !named.has(c))).toEqual([]);
  });
  it('the mappers turn a trigger message into a typed refusal and leave anything else alone; the unique indexes are named too', () => {
    const t = namedSwdTenancyRefusal(new Error('[SETUP_CALL_ADMIN_REALM] only the team')) as { code: string; httpStatus?: number; status?: number };
    expect(t.code).toBe('SETUP_CALL_ADMIN_REALM');
    expect((namedSwdTenancyRefusal(Object.assign(new Error('dup'), { code: '23505', constraint: 'uq_scr_one_open' })) as { code: string }).code).toBe('SETUP_CALL_ALREADY_OPEN');
    expect((namedSwdGovRefusal(new Error('[AGM_CHECKER_IS_MAKER] x')) as { code: string }).code).toBe('AGM_CHECKER_IS_MAKER');
    expect((namedSwdGovRefusal(Object.assign(new Error('dup'), { code: '23505', constraint: 'uq_agm_root_fy' })) as { code: string }).code).toBe('AGM_PACK_EXISTS');
    const other = new Error('boom'); expect(namedSwdGovRefusal(other)).toBe(other);
  });
});
