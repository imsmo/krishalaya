// modules/tenant-api-keys/domain/api-scopes.ts · PC-56 TENANT-13c (F-9, founder decision 2026-10-03: READ SCOPES + NARROW WRITES under
// `api.manage`; member-PII and money-write scopes need a checker). THE TENANT KEY SCOPE CATALOGUE.
//
// ONLY scopes that map to v1 routes that exist today. Each scope names the exact routes it unlocks (method + path + the controller
// method that carries `@ApiScopes(<scope>)`); a spec over the REAL router asserts that the set of routes carrying the decorator is
// exactly this list — no catalogue route without it, and no other route accepting key auth. The database holds the same catalogue
// (`api_scope_catalogue`, 0193) so the trigger can refuse an unknown scope; a live spec compares the two.
//
// What a scope does NOT do: it never widens what the key's creator may do. A key acts on behalf of the tenant_admin who created it,
// with that person's CURRENT permissions (the route's own @RequirePermissions still runs) — the scope only narrows which routes.
//
// REFUSED AS SCOPES (no route, or a money path): any payout, refund, settlement close, ledger or wallet write; member edits;
// webhook writes (a key does not manage the realm that manages keys). "Any write of money" would need a checker — there is none in
// this catalogue because no money write is offered to a key at all.

export type ScopeKind = 'read' | 'write';
export interface ScopeRoute { method: 'GET' | 'POST' | 'PATCH'; path: string; controller: string; handler: string }
export interface ApiScope { code: string; kind: ScopeKind; checker: boolean; description: string; routes: readonly ScopeRoute[] }

const r = (method: ScopeRoute['method'], path: string, controller: string, handler: string): ScopeRoute => ({ method, path, controller, handler });

export const API_SCOPES: readonly ApiScope[] = Object.freeze([
  { code: 'orders.read', kind: 'read', checker: false,
    description: "Read your organisation's orders: the console list, one order, its items and its event history.",
    routes: [r('GET', '/v1/orders/console/list', 'OrdersController', 'consoleList'), r('GET', '/v1/orders/:id', 'OrdersController', 'get'),
      r('GET', '/v1/orders/:id/items', 'OrdersController', 'items'), r('GET', '/v1/orders/:id/events', 'OrdersController', 'events')] },
  { code: 'orders.status.write', kind: 'write', checker: false,
    description: 'Move an order through the status steps the console already exposes: confirm, packed, ready, delivered.',
    routes: [r('POST', '/v1/orders/:id/confirm', 'OrdersController', 'confirm'), r('POST', '/v1/orders/:id/packed', 'OrdersController', 'packed'),
      r('POST', '/v1/orders/:id/ready', 'OrdersController', 'ready'), r('POST', '/v1/orders/:id/delivered', 'OrdersController', 'delivered')] },
  { code: 'listings.read', kind: 'read', checker: false,
    description: "Read your organisation's marketplace listings and one listing's price history.",
    routes: [r('GET', '/v1/listings', 'ListingsController', 'search'), r('GET', '/v1/listings/:id', 'ListingsController', 'getOne'),
      r('GET', '/v1/listings/:id/price-history', 'ListingsController', 'priceHistory')] },
  { code: 'listings.write', kind: 'write', checker: false,
    description: "Create a listing (your own, or a member's on their recorded consent) and change a listing's price.",
    routes: [r('POST', '/v1/listings', 'ListingsController', 'create'), r('POST', '/v1/listings/on-behalf', 'ListingsController', 'createOnBehalf'),
      r('PATCH', '/v1/listings/:id/price', 'ListingsController', 'changePrice')] },
  { code: 'members.read', kind: 'read', checker: false,
    description: 'Read the member roster MASKED: short name and masked phone; no phone-number search.',
    routes: [r('GET', '/v1/members/roster', 'MemberRosterController', 'list'), r('GET', '/v1/members/roster/:userId', 'MemberRosterController', 'member')] },
  { code: 'members.read.pii', kind: 'read', checker: true,
    description: "Reveal one member's field (phone, address) — recorded and reasoned per reveal. A second administrator must confirm the key.",
    routes: [r('POST', '/v1/members/roster/:userId/reveal', 'MemberRosterController', 'reveal')] },
  { code: 'payments.summary.read', kind: 'read', checker: false,
    description: 'Read settlement cycles and the organisation statement summary — totals only, never an account number.',
    routes: [r('GET', '/v1/settlements', 'SettlementCyclesController', 'overview'), r('GET', '/v1/settlements/org-statement', 'SettlementCyclesController', 'orgStatementFor')] },
  { code: 'statements.read', kind: 'read', checker: false,
    description: 'Read generated settlement statements.',
    routes: [r('GET', '/v1/settlement-statements', 'SettlementStatementsController', 'list'), r('GET', '/v1/settlement-statements/:id', 'SettlementStatementsController', 'get'),
      r('GET', '/v1/settlements/statements', 'SettlementCyclesController', 'statements')] },
  { code: 'invoices.read', kind: 'read', checker: false,
    description: 'Read tax invoices: the list, one invoice, and the invoice of one order.',
    routes: [r('GET', '/v1/invoices', 'InvoicesController', 'list'), r('GET', '/v1/invoices/:id', 'InvoicesController', 'detail'),
      r('GET', '/v1/invoices/order/:orderId', 'InvoicesController', 'byOrder')] },
  { code: 'webhooks.read', kind: 'read', checker: false,
    description: 'Read your webhook endpoints and their delivery log (payloads masked).',
    routes: [r('GET', '/v1/webhooks', 'WebhooksController', 'list'), r('GET', '/v1/webhooks/deliveries', 'WebhooksController', 'deliveries'),
      r('GET', '/v1/webhooks/deliveries/:id', 'WebhooksController', 'delivery')] },
  { code: 'dairy.collections.read', kind: 'read', checker: false,
    description: 'Read milk collections recorded at your centres.',
    routes: [r('GET', '/v1/dairy/collections', 'CollectionsController', 'list')] },
  { code: 'labour.bookings.read', kind: 'read', checker: false,
    description: 'Read labour bookings and one booking.',
    routes: [r('GET', '/v1/labour/bookings', 'BookingsController', 'list'), r('GET', '/v1/labour/bookings/:id', 'BookingsController', 'get')] },
] as ApiScope[]);

export const SCOPE_CODES: readonly string[] = API_SCOPES.map((s) => s.code);
const BY_CODE = new Map(API_SCOPES.map((s) => [s.code, s]));

export function scopeOf(code: string): ApiScope | undefined { return BY_CODE.get(code); }
export function isKnownScope(code: string): boolean { return BY_CODE.has(code); }
/** True when any of these scopes needs a second administrator (member PII; any money write). */
export function needsChecker(scopes: readonly string[]): boolean { return scopes.some((s) => BY_CODE.get(s)?.checker === true); }
/** The scope's kind — a write demands an Idempotency-Key on every key-authenticated call. */
export function isWriteScope(code: string): boolean { return BY_CODE.get(code)?.kind === 'write'; }
/** Every route the given scopes unlock, in catalogue order — the review page prints exactly these. */
export function routesUnlocked(scopes: readonly string[]): ScopeRoute[] {
  return API_SCOPES.filter((s) => scopes.includes(s.code)).flatMap((s) => [...s.routes]);
}

/**
 * EXACT MATCH. A key holding `members.read` does not hold `members.read.pii`; `orders.read` does not hold `orders.status.write`.
 * There is no wildcard and no family form: a scope string is compared whole, so a scope added tomorrow is never inherited by
 * every key ever minted (the partner realm's rule, `partner-key.rules.hasScope`).
 */
export function hasScope(granted: readonly string[] | null | undefined, required: string): boolean {
  if (!granted || !required) return false;
  return granted.includes(required);
}

/** The member short name a `members.read` key sees (defined in core so the roster controller reads it without importing this module). */
export { shortName } from '../../../core/auth/api-key.port';
