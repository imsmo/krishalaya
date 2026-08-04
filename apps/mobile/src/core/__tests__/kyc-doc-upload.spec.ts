// Unit tests for the PURE doc-type resolver (features/kyc/doc-upload, screen 174). No React/native deps.
import { resolveDocType } from '../../features/kyc/doc-upload';
import type { KycDocType } from '@krishalaya/sdk-js';

const t = (id: string, code: string, name = code): KycDocType => ({ id, code, name });
const list = [t('1', 'aadhaar', 'Aadhaar Card'), t('2', 'land_712', '7/12 Utara'), t('3', 'pan', 'PAN Card')];

describe('resolveDocType', () => {
  it('finds the doc-type by id (real name from catalogue)', () => {
    expect(resolveDocType(list, '2')?.name).toBe('7/12 Utara');
    expect(resolveDocType(list, '1')?.code).toBe('aadhaar');
  });
  it('returns null for an unknown id / missing id / empty list', () => {
    expect(resolveDocType(list, '999')).toBeNull();
    expect(resolveDocType(list, undefined)).toBeNull();
    expect(resolveDocType(list, null)).toBeNull();
    expect(resolveDocType([], '1')).toBeNull();
    expect(resolveDocType(null, '1')).toBeNull();
  });
});
