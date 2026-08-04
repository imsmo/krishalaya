// Unit tests for sdkErrorMessage (KV-MF-03/04): the "Chat with support" + "Raise a complaint" alerts must show the
// real server-reported reason (e.g. an SdkError's message off a 404 when a feature flag is off) instead of a
// frozen generic string, per the KV-MF-02 convention.
import { SdkError, SdkNetworkError } from '@krishalaya/sdk-js';
import { sdkErrorMessage } from '../errors/sdk-error-message';

describe('sdkErrorMessage', () => {
  it('surfaces an SdkError message (e.g. a 404 from a feature flag being off server-side)', () => {
    const e = new SdkError('NOT_FOUND', 404, 'Not found', 'req-123');
    expect(sdkErrorMessage(e)).toBe('Not found');
  });
  it('surfaces a network error message too (any Error subclass)', () => {
    expect(sdkErrorMessage(new SdkNetworkError('request timed out'))).toBe('request timed out');
  });
  it('falls back to undefined for a non-Error throw or an empty message', () => {
    expect(sdkErrorMessage('plain string')).toBeUndefined();
    expect(sdkErrorMessage(undefined)).toBeUndefined();
    expect(sdkErrorMessage(new Error(''))).toBeUndefined();
  });
});
