// modules/market-intel/domain/market-intel.events.ts · integration events (via outbox) + vocab.
export const MarketEventType = {
  PriceIngested:       'market.price_ingested',
  PredictionGenerated: 'market.prediction_generated',
  PriceAlertTriggered: 'market.price_alert_triggered',   // → notification fanout
  PriceAlertCreated:   'market.price_alert_created',
} as const;
export type MarketEventType = (typeof MarketEventType)[keyof typeof MarketEventType];
export type DomainEvent = { type: string; payload: Record<string, unknown> };

// PC-56 TENANT-12 (F-4): `tenant_manual` — a price typed on a tenant desk. It is a TENANT OBSERVATION (mandi_prices.tenant_id set,
// read by that tenant only), FORCED by the API: the caller can never label a typed price 'agmarknet' or 'enam'.
export const PRICE_SOURCES = ['agmarknet', 'enam', 'platform_txn', 'ambassador_manual', 'tenant_manual'] as const;
/** The only source the tenant API writes. */
export const TENANT_PRICE_SOURCE = 'tenant_manual' as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];
export const ALERT_DIRECTIONS = ['above', 'below'] as const;
export type AlertDirection = (typeof ALERT_DIRECTIONS)[number];
