// @krishalaya/sdk-js · typed errors. The SDK surfaces the API's stable error `code` (not a raw HTTP number)
// so callers branch on a contract, plus the requestId for support. SECURITY: an SdkError NEVER carries the
// request's Authorization header / token / body — only the safe code/status/requestId/message.
export class SdkError extends Error {
  constructor(
    public readonly code: string,           // stable API code, e.g. 'WALLET_INSUFFICIENT_BALANCE'
    public readonly status: number,         // HTTP status
    message: string,
    public readonly requestId?: string,
    public readonly details?: Record<string, unknown>,
  ) { super(message); this.name = 'SdkError'; }
  get isAuth() { return this.status === 401; }
  get isForbidden() { return this.status === 403; }
  get isNotFound() { return this.status === 404; }
  get isConflict() { return this.status === 409; }
  get isValidation() { return this.status === 422 || this.code === 'VALIDATION_ERROR'; }
  get isRateLimited() { return this.status === 429; }
}
/** The request never reached the API (DNS/connection/abort) — distinct from an API error response. */
export class SdkNetworkError extends Error { constructor(message: string, public readonly cause?: unknown) { super(message); this.name = 'SdkNetworkError'; } }
/** The request exceeded the configured timeout. */
export class SdkTimeoutError extends SdkNetworkError { constructor(timeoutMs: number) { super(`request timed out after ${timeoutMs}ms`); this.name = 'SdkTimeoutError'; } }
