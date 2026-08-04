// Unit tests for core/api/write-classify.ts — the KV-MF-02 fix. Only a TRUE connectivity failure
// (SdkNetworkError/SdkTimeoutError) may be queued/retried; every real server response (any HTTP status) or
// unexpected exception must be surfaced/dead-lettered instead.
import { SdkError, SdkNetworkError, SdkTimeoutError } from '@krishalaya/sdk-js';
import { isConnectivityFailure, classifyReplayFailure } from '../api/write-classify';

describe('isConnectivityFailure', () => {
  it('is true for a genuine network error (request never reached the API)', () => {
    expect(isConnectivityFailure(new SdkNetworkError('fetch failed'))).toBe(true);
  });
  it('is true for a timeout (SdkTimeoutError extends SdkNetworkError)', () => {
    expect(isConnectivityFailure(new SdkTimeoutError(8000))).toBe(true);
  });
  it('is false for a 422 validation error — a real server response, must surface, never queue', () => {
    expect(isConnectivityFailure(new SdkError('VALIDATION_FAILED', 422, 'Request validation failed'))).toBe(false);
  });
  it('is false for a 5xx — a real (if unhappy) server response is not "offline"', () => {
    expect(isConnectivityFailure(new SdkError('INTERNAL', 500, 'An unexpected error occurred'))).toBe(false);
  });
  it('is false for 408/429 — these are real responses too, not connectivity failures', () => {
    expect(isConnectivityFailure(new SdkError('TIMEOUT', 408, 'timed out'))).toBe(false);
    expect(isConnectivityFailure(new SdkError('RATE_LIMITED', 429, 'slow down'))).toBe(false);
  });
  it('is false for an unrelated/unexpected exception (e.g. a post-success side-effect bug) — must not misreport as offline', () => {
    expect(isConnectivityFailure(new TypeError('cache.invalidate is not a function'))).toBe(false);
    expect(isConnectivityFailure('a thrown string')).toBe(false);
    expect(isConnectivityFailure(undefined)).toBe(false);
  });
});

describe('classifyReplayFailure (offline-queue ReplayResult mapping)', () => {
  it('network/timeout → retry (keep it queued, connectivity may return)', () => {
    expect(classifyReplayFailure(new SdkNetworkError('offline'))).toBe('retry');
    expect(classifyReplayFailure(new SdkTimeoutError(8000))).toBe('retry');
  });
  it('a 422 → permanent-fail (poison op: identical payload will 422 forever — dead-letter on the FIRST retry)', () => {
    expect(classifyReplayFailure(new SdkError('VALIDATION_FAILED', 422, 'bad payload'))).toBe('permanent-fail');
  });
  it('a 5xx → permanent-fail too (a real server bug does not "resolve itself" just by retrying the same op)', () => {
    expect(classifyReplayFailure(new SdkError('INTERNAL', 500, 'boom'))).toBe('permanent-fail');
  });
  it('an unexpected non-SdkError exception → permanent-fail (never spin forever on a mystery error)', () => {
    expect(classifyReplayFailure(new Error('unexpected'))).toBe('permanent-fail');
  });
});
