// core/i18n/locales/en.ts · source-of-truth English strings (keys, never literals — Law 7).
const en = {
  'sms.otp': 'Krishalaya code: {code} (valid {minutes} min). Do not share.',
  'error.BAD_REQUEST': 'Bad request',
  'error.VALIDATION_FAILED': 'Some details are not valid. Please check and try again.',
  'error.UNAUTHORIZED': 'Please sign in to continue.',
  'error.FORBIDDEN': 'You do not have permission to do this.',
  'error.NOT_FOUND': 'Not found.',
  'error.CONFLICT': 'This conflicts with the current state. Please refresh and retry.',
  'error.TOO_MANY_REQUESTS': 'Too many attempts. Please wait a little and try again.',
  'error.QUOTA_EXCEEDED': 'Your plan limit has been reached.',
  'error.INTERNAL': 'Something went wrong. Please try again.',
  'error.OTP_INVALID': 'Invalid or expired code.',
  'error.REFRESH_INVALID': 'Your session has expired. Please sign in again.',
  'error.LISTING_NOT_FOUND': 'Listing not found.',
  // DEV-27 (Q23, G0-4 founder ruling 2026-07-22): billing-document header badge — TS-002 §a "Documents"
  // row + DOC-000 §a/§b. Rendered alongside the tenant's own brand name, never in place of it.
  'doc.poweredByKrishalaya': 'Powered by Krishalaya',
};
export default en;
export type MessageKey = keyof typeof en;
