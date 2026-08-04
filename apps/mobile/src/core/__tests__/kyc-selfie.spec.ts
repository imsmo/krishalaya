// Unit tests for the PURE selfie doc-type resolver (features/kyc/selfie, screen 173). No React/native deps.
import { selfieDocType } from '../../features/kyc/selfie';
import type { KycDocType } from '@krishalaya/sdk-js';

const t = (id: string, code: string, name = code): KycDocType => ({ id, code, name });

describe('selfieDocType', () => {
  it('matches a selfie/liveness/photo/face code (case-insensitive), first match wins', () => {
    expect(selfieDocType([t('1', 'aadhaar'), t('2', 'SELFIE'), t('3', 'pan')])?.id).toBe('2');
    expect(selfieDocType([t('a', 'live_photo')])?.id).toBe('a');
    expect(selfieDocType([t('a', 'face_match')])?.id).toBe('a');
    expect(selfieDocType([t('a', 'profile_photo')])?.id).toBe('a');
  });
  it('returns null when no selfie-like type exists (screen degrades, never files under a wrong type)', () => {
    expect(selfieDocType([t('1', 'aadhaar'), t('2', 'pan'), t('3', 'bank_passbook')])).toBeNull();
    expect(selfieDocType([])).toBeNull();
    expect(selfieDocType(null)).toBeNull();
    expect(selfieDocType(undefined)).toBeNull();
  });
  it('ignores malformed rows without a string code', () => {
    expect(selfieDocType([{ id: '1' } as unknown as KycDocType, t('2', 'selfie')])?.id).toBe('2');
  });
});
