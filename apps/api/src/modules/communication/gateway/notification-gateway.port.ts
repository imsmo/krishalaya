// modules/communication/gateway/notification-gateway.port.ts
// Channel-agnostic port to the EXTERNAL notification product (push / in-app / email / sms / whatsapp / ivr).
// Krishalaya owns the POLICY + CONTENT (event catalog, templates, preferences, quiet hours, delivery log,
// cost tracking); the actual SEND is delegated across this boundary. Adapters are resilience-wrapped and may
// DEGRADE (return a 'failed' outcome) rather than throw — a hung notifier must never cascade into a request
// path (Law 12). The 'inapp' channel needs no external send (the notifications row IS the inbox item), so the
// service never calls the gateway for it.
export const NOTIFICATION_GATEWAY = Symbol('NOTIFICATION_GATEWAY');

export type NotifyChannel = 'push' | 'sms' | 'whatsapp' | 'email' | 'inapp' | 'ivr';

export interface DispatchInput {
  /** Idempotency key the external product MUST dedup on (= the notification id). */
  idempotencyKey: string;
  tenantId: string | null;
  userId: string;                 // the recipient; the external product resolves device tokens / contact
  channel: NotifyChannel;
  eventCode: string;
  languageCode: string;
  subject: string | null;         // email subject / push title
  body: string;                   // already rendered (no {{vars}} remain)
  providerTemplateRef: string | null;  // DLT template id / WA approved template name, when the channel requires it
  payload: Record<string, unknown>;    // structured data (deep link, ids) for the client
}

export interface DispatchResult {
  /** 'accepted' = the notifier took it (async; the terminal delivered/read state arrives via webhook);
   *  'failed' = a DEFINITIVE rejection or a transport failure that exhausted resilience (degraded). */
  status: 'accepted' | 'failed';
  providerMsgRef?: string;
  costMinor?: number;             // per-message cost for the SMS cost-bomb monitor
  failureReason?: string;
}

export interface NotificationGateway {
  readonly providerCode: string;
  dispatch(input: DispatchInput): Promise<DispatchResult>;
}
