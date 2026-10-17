// apps/web-storefront/src/features/store6/acts.ts · PC-56 STORE-6a · D1 (founder Q1, HOTFIX-8 decision) — MONEY NEVER QUEUES, AND SAYS WHY.
// PURE. Every exported Server Action of the storefront (`app/**/actions.ts`) is classified here, once, by file and name:
//   • money      — moves money or makes a binding commitment (the 16 acts the founder named): offline, its button holds "— needs signal" AND
//                  prints the reason in words beside it; it is never saved for later;
//   • countdown  — has a clock attached (a sign-in or signup code, a short-lived download link): never saved for later either — a code sent
//                  later may already have expired;
//   • content    — the person's own content and preferences (cart lines, addresses, messages, reviews, notifications, watch): held "— needs
//                  signal" offline like every POST (OnlineGuard's rule), nothing saved on the phone in 6a (drafts are STORE-6b's: the person's
//                  unsent words will stay on the phone and leave only when they press Send);
//   • device     — touches only this browser's own state (sign-out, "start again", "back to edit").
// test/store6-acts.spec.ts scans the actions directory with `fs` and fails on an export with no class (survey E7) or an entry that no longer
// exists; the W314 page (`/queued`, components/offline/QueuedActionsScreen.tsx) prints the money + countdown list FROM this registry, and its
// render test derives the expected list from here — never a copy.
//
// Nothing here is a business literal: the act names and reasons are catalogue keys (`store6.act.<id>`, `store6.reason.<reason>`).

export type ActClass = 'money' | 'countdown' | 'content' | 'device';

/** The reason a money / countdown act needs a live answer — the words are `store6.reason.<key>` in en / hi / gu. */
export type ReasonKey =
  | 'placeOrder' | 'paymentAttempt' | 'payFromWallet' | 'chooseDelivery' | 'choosePayment' | 'applyCoupon' | 'bid' | 'makeOffer'
  | 'respondOffer' | 'acceptPrice' | 'cancelRefund' | 'received' | 'raiseDispute' | 'requestDeletion'
  | 'signInCode' | 'signupCode' | 'exportLink';

export const REASON_KEYS: readonly ReasonKey[] = Object.freeze([
  'placeOrder', 'paymentAttempt', 'payFromWallet', 'chooseDelivery', 'choosePayment', 'applyCoupon', 'bid', 'makeOffer', 'respondOffer',
  'acceptPrice', 'cancelRefund', 'received', 'raiseDispute', 'requestDeletion', 'signInCode', 'signupCode', 'exportLink',
] as ReasonKey[]);

export interface ActEntry {
  /** the actions file, relative to `src/app` */
  file: string;
  /** the exported function's name */
  name: string;
  cls: ActClass;
  /** money / countdown only: the act's own name on the W314 list (`store6.act.<id>`) and the reason it needs signal */
  id?: string;
  reason?: ReasonKey;
}

const T = '[tenantSlug]';
const money = (file: string, name: string, id: string, reason: ReasonKey): ActEntry => ({ file, name, cls: 'money', id, reason });
const countdown = (file: string, name: string, id: string, reason: ReasonKey): ActEntry => ({ file, name, cls: 'countdown', id, reason });
const content = (file: string, name: string): ActEntry => ({ file, name, cls: 'content' });
const device = (file: string, name: string): ActEntry => ({ file, name, cls: 'device' });

export const STOREFRONT_ACTS: readonly ActEntry[] = Object.freeze([
  // ── money: the 16 acts the founder named (survey Q1) ──
  money(`${T}/checkout/actions.ts`, 'placeOrderAction', 'placeOrder', 'placeOrder'),
  money(`${T}/checkout/pay/actions.ts`, 'createOrderAttemptAction', 'pay', 'paymentAttempt'),
  money(`${T}/checkout/pay/actions.ts`, 'payFromWalletAction', 'payFromWallet', 'payFromWallet'),
  money(`${T}/checkout/actions.ts`, 'chooseDeliveryAction', 'chooseDelivery', 'chooseDelivery'),
  money(`${T}/checkout/actions.ts`, 'choosePaymentAction', 'choosePayment', 'choosePayment'),
  money(`${T}/checkout/actions.ts`, 'applyCouponAction', 'applyCoupon', 'applyCoupon'),
  money(`${T}/auctions/[id]/actions.ts`, 'placeBidAction', 'bid', 'bid'),
  money(`${T}/listings/[id]/actions.ts`, 'makeOfferAction', 'makeOffer', 'makeOffer'),
  money(`${T}/offers/[id]/actions.ts`, 'acceptOfferAction', 'acceptOffer', 'respondOffer'),
  money(`${T}/offers/[id]/actions.ts`, 'counterOfferAction', 'counterOffer', 'respondOffer'),
  money(`${T}/offers/[id]/actions.ts`, 'declineOfferAction', 'declineOffer', 'respondOffer'),
  money(`${T}/cart/actions.ts`, 'acceptPriceAction', 'acceptPrice', 'acceptPrice'),
  money(`${T}/orders/[id]/cancel/actions.ts`, 'cancelOrderAction', 'cancelRefund', 'cancelRefund'),
  money(`${T}/orders/[id]/actions.ts`, 'completeOrderAction', 'received', 'received'),
  money(`${T}/orders/[id]/actions.ts`, 'raiseDisputeAction', 'raiseDispute', 'raiseDispute'),
  money('(platform)/account/actions.ts', 'requestDeletionAction', 'requestDeletion', 'requestDeletion'),
  // ── countdown: the sign-in and signup codes, the short-lived download links ──
  countdown('(platform)/login/actions.ts', 'requestCodeAction', 'signInSend', 'signInCode'),
  countdown('(platform)/login/actions.ts', 'resendCodeAction', 'signInResend', 'signInCode'),
  countdown('(platform)/login/actions.ts', 'verifyCodeAction', 'signInVerify', 'signInCode'),
  countdown('(platform)/login/actions.ts', 'verifyTwoFactorAction', 'signInTwoFactor', 'signInCode'),
  countdown('(platform)/for-organisations/actions.ts', 'startSignupAction', 'signupSend', 'signupCode'),
  countdown('(platform)/for-organisations/actions.ts', 'resendCodeAction', 'signupResend', 'signupCode'),
  countdown('(platform)/for-organisations/actions.ts', 'confirmCodeAction', 'signupConfirm', 'signupCode'),
  countdown('(platform)/for-organisations/actions.ts', 'submitSignupAction', 'signupCreate', 'signupCode'),
  countdown('(platform)/account/actions.ts', 'requestExportAction', 'dataExport', 'exportLink'),
  countdown('(platform)/account/actions.ts', 'mintDownloadAction', 'dataDownload', 'exportLink'),
  countdown('(platform)/trace/actions.ts', 'requestTraceExportAction', 'traceExport', 'exportLink'),
  countdown('(platform)/trace/actions.ts', 'mintTraceDownloadAction', 'traceDownload', 'exportLink'),
  // ── content: the person's own content and preferences (held offline like every POST; drafts are 6b's) ──
  content('(platform)/account/actions.ts', 'updateProfileAction'),
  content('(platform)/account/addresses/actions.ts', 'reviewAddressAction'),
  content('(platform)/account/addresses/actions.ts', 'submitAddressAction'),
  content('(platform)/account/addresses/actions.ts', 'removeAddressAction'),
  content('(platform)/account/addresses/actions.ts', 'makeDefaultAddressAction'),
  content('(platform)/account/preferences/actions.ts', 'reviewPreferencesAction'),
  content('(platform)/account/preferences/actions.ts', 'submitPreferencesAction'),
  content(`${T}/auctions/[id]/actions.ts`, 'toggleWatchAction'),
  content(`${T}/cart/actions.ts`, 'updateCartLineAction'),
  content(`${T}/cart/actions.ts`, 'removeCartLineAction'),
  content(`${T}/checkout/actions.ts`, 'addAddressAction'),
  // a READ, not an act: the pay page's status poll — it writes nothing, so it can never queue anything (classified so the scan is total)
  content(`${T}/checkout/pay/actions.ts`, 'pollOrderPayment'),
  content(`${T}/listings/[id]/actions.ts`, 'addToCartAction'),
  content(`${T}/messages/[id]/actions.ts`, 'postMessageAction'),
  content(`${T}/messages/[id]/report/[messageId]/actions.ts`, 'reportMessageAction'),
  content(`${T}/messages/actions.ts`, 'openOrganisationThreadAction'),
  content(`${T}/notifications/actions.ts`, 'markReadAction'),
  content(`${T}/notifications/actions.ts`, 'markAllReadAction'),
  content(`${T}/orders/[id]/review/actions.ts`, 'previewReviewAction'),
  content(`${T}/orders/[id]/review/actions.ts`, 'submitReviewAction'),
  content(`${T}/orders/[id]/review/actions.ts`, 'editReviewAction'),
  content(`${T}/orders/[id]/review/actions.ts`, 'saveReviewEditAction'),
  // ── device: this browser's own state only ──
  device('(platform)/login/actions.ts', 'logoutAction'),
  device('(platform)/login/actions.ts', 'resetLoginAction'),
  device('(platform)/for-organisations/actions.ts', 'editFormAction'),
  device('(platform)/for-organisations/actions.ts', 'restartSignupAction'),
]);

/** The acts of one class, in registry order. */
export function actsOf(cls: ActClass): ActEntry[] { return STOREFRONT_ACTS.filter((a) => a.cls === cls); }

/** What never waits for signal (W314 "never queue money, OTPs, or anything with a countdown"): the money acts, then the countdown acts. */
export function neverQueued(): ActEntry[] { return [...actsOf('money'), ...actsOf('countdown')]; }

/** The class of one export (`file` relative to src/app), or null when it is not classified — the spec fails on null. */
export function classOf(file: string, name: string): ActClass | null {
  return STOREFRONT_ACTS.find((a) => a.file === file && a.name === name)?.cls ?? null;
}

/** The two attributes a money / countdown form (or a standalone money button) carries, so the signal words can print its reason. */
export function actAttrs(reason: ReasonKey, cls: 'money' | 'countdown' = 'money'): { 'data-kv-act-class': string; 'data-kv-needs-signal-reason': ReasonKey } {
  return { 'data-kv-act-class': cls, 'data-kv-needs-signal-reason': reason };
}
