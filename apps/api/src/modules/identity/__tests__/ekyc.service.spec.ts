// EkycService unit tests — start→verify happy path (sandbox), wrong-OTP, attempt-cap lock, and anti-IDOR.
// Uses the REAL SandboxEkycProvider + an in-memory session store; UoW just runs the callback with a fake tx.
import { EkycService } from '../services/ekyc.service';
import { SandboxEkycProvider, SANDBOX_EKYC_OTP } from '../gateway/sandbox-ekyc.provider';
import { EkycSession } from '../domain/ekyc-session.entity';
import {
  InvalidGovIdError, EkycSessionNotFoundError, EkycVerificationFailedError, EkycTooManyAttemptsError,
} from '../domain/identity.errors';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const OTHER = '33333333-3333-3333-3333-333333333333';
const VALID_AADHAAR = '999999990019';   // Verhoeff-valid

function build() {
  const store = new Map<string, EkycSession>();
  const sessions = {
    async findPending(_tx: any, _t: string, u: string, d: string) {
      for (const s of store.values()) { const p = s.toProps(); if (p.userId === u && p.docType === d && p.status === 'pending') return s; }
      return null;
    },
    async getOwnedForUpdate(_tx: any, t: string, id: string, u: string) {
      const s = store.get(id); if (!s) return null; const p = s.toProps();
      return p.tenantId === t && p.userId === u ? s : null;
    },
    async insert(_tx: any, s: EkycSession) { store.set(s.id, s); },
    async update(_tx: any, s: EkycSession) { store.set(s.id, s); },
    async listForUser() { return [...store.values()]; },
  };
  const vaultRefs: any[] = [];
  const users = {
    async getForUpdate() { return { id: USER }; },
    async setVaultRef(_tx: any, _id: string, v: any) { vaultRefs.push(v); },
  };
  const kycInserts: any[] = [];
  // [PC-56 TENANT-9a] the eKYC writes through the role projector: the person's documents + 0180's map decide which roles move.
  const kyc = {
    async resolveDocTypeId() { return '44444444-4444-4444-4444-444444444444'; },
    async insert(_tx: any, d: any) { kycInserts.push(d.toProps()); },
    async insertDecision() { return 'dec'; },
    async openSubmission() { return null; },
    async personDocFacts() { return kycInserts.map((d) => ({ docTypeCode: d.docTypeCode, status: d.status, roleCode: null, validUntil: d.validUntil, decidedAt: '2026-10-04T00:00:00.000000Z' })); },
    async roleMap() { return new Map([['aadhaar', ['worker']], ['pan', ['vyapari']]]); },
    async today() { return '2026-10-04'; },
  };
  const kycStatuses: string[] = [];
  const roleWrites: Array<[string, string]> = [];
  const utr = {
    async roleFacts() { return [{ roleCode: 'worker', kycStatus: 'none', isActive: true }, { roleCode: 'farmer', kycStatus: 'pending', isActive: true }]; },
    async setRoleKycStatus(_tx: any, _t: string, _u: string, role: string, s: string) { kycStatuses.push(s); roleWrites.push([role, s]); return 1; },
  };
  const audits: any[] = [];
  const audit = { async write(_tx: any, e: any) { audits.push(e); } };
  const outboxed: any[] = [];
  const outbox = { async write(_tx: any, e: any) { outboxed.push(e); } };
  const uow = { async run(_t: string, fn: (tx: any) => Promise<any>) { return fn({}); } };

  const svc = new EkycService(
    uow as any, outbox as any, new SandboxEkycProvider(), audit as any,
    sessions as any, users as any, kyc as any, utr as any,
  );
  return { svc, store, vaultRefs, kycInserts, kycStatuses, roleWrites, audits, outboxed };
}

describe('EkycService', () => {
  it('rejects a malformed id before ever calling the provider', async () => {
    const { svc } = build();
    await expect(svc.start(TENANT, USER, { docType: 'aadhaar', idNumber: '123' })).rejects.toBeInstanceOf(InvalidGovIdError);
  });

  it('start → verify(123456) sets the user vault ref + last-4, writes a verified KYC doc, never stores the raw id', async () => {
    const { svc, store, vaultRefs, kycInserts, kycStatuses, roleWrites } = build();
    const started = await svc.start(TENANT, USER, { docType: 'aadhaar', idNumber: VALID_AADHAAR, fullName: 'Test' });
    expect(started.maskedId).toBe('XXXXXXXX0019');
    expect(started.otpRequired).toBe(true);

    // the persisted session must NOT contain the raw id anywhere
    const persisted = JSON.stringify(store.get(started.id)!.toProps());
    expect(persisted).not.toContain(VALID_AADHAAR);
    expect(persisted).toContain('XXXXXXXX0019');

    const res = await svc.verify(TENANT, USER, { sessionId: started.id, otp: SANDBOX_EKYC_OTP });
    expect(res.status).toBe('verified');
    expect(vaultRefs[0].aadhaarVaultRef).toMatch(/^vault_/);
    expect(vaultRefs[0].aadhaarLast4).toBe('0019');
    expect(kycInserts[0].status).toBe('verified');
    expect(kycInserts[0].mediaId).toBeNull();
    expect(kycInserts[0].verifyMethod).toBe('ekyc:sandbox');
    expect(kycStatuses).toContain('verified');
    // F-1: the Aadhaar verified the WORKER (the role it evidences) and left the FARMER exactly as it was.
    expect(roleWrites).toEqual([['worker', 'verified']]);
    expect(kycInserts[0].reviewedBy).toBeNull();
    // no raw id leaked into the vault ref / KYC doc
    expect(JSON.stringify({ vaultRefs, kycInserts })).not.toContain(VALID_AADHAAR);
  });

  it('a wrong OTP fails (422) and does not verify', async () => {
    const { svc, vaultRefs } = build();
    const started = await svc.start(TENANT, USER, { docType: 'aadhaar', idNumber: VALID_AADHAAR });
    await expect(svc.verify(TENANT, USER, { sessionId: started.id, otp: '000000' })).rejects.toBeInstanceOf(EkycVerificationFailedError);
    expect(vaultRefs).toHaveLength(0);
  });

  it('locks the session after the attempt cap (429)', async () => {
    const { svc } = build();
    const started = await svc.start(TENANT, USER, { docType: 'aadhaar', idNumber: VALID_AADHAAR });
    await expect(svc.verify(TENANT, USER, { sessionId: started.id, otp: '000000' })).rejects.toBeInstanceOf(EkycVerificationFailedError);
    await expect(svc.verify(TENANT, USER, { sessionId: started.id, otp: '000000' })).rejects.toBeInstanceOf(EkycVerificationFailedError);
    // 3rd failure hits the cap → locked (429)
    await expect(svc.verify(TENANT, USER, { sessionId: started.id, otp: '000000' })).rejects.toBeInstanceOf(EkycTooManyAttemptsError);
    // subsequent attempts see a terminal session → 404 (no enumeration)
    await expect(svc.verify(TENANT, USER, { sessionId: started.id, otp: SANDBOX_EKYC_OTP })).rejects.toBeInstanceOf(EkycSessionNotFoundError);
  });

  it('anti-IDOR: another user cannot verify someone else\'s session (404)', async () => {
    const { svc } = build();
    const started = await svc.start(TENANT, USER, { docType: 'aadhaar', idNumber: VALID_AADHAAR });
    await expect(svc.verify(TENANT, OTHER, { sessionId: started.id, otp: SANDBOX_EKYC_OTP })).rejects.toBeInstanceOf(EkycSessionNotFoundError);
  });
});
