# @krishalaya/sdk-js

The official typed TypeScript client for the Krishalaya API. Every web frontend, the mobile app, and
third-party integrators talk to the platform through this one SDK — so the API contract, auth handling, money
semantics, and resilience live in a single audited place.

## Design

- **No secrets in the SDK.** The access token is supplied per-request by a `getToken` callback the host owns
  (SSR reads an httpOnly cookie; a browser reads memory; a server integration reads a vault). The SDK only
  attaches it as a Bearer header and **never logs or embeds it in an error**.
- **Resilient by default (Law 12).** Every call has a timeout (AbortController). Idempotent **GET**s retry on
  transient failures (network / timeout / 5xx / 429) with exponential backoff + jitter; **mutations are NEVER
  auto-retried** (Law 3 — a non-idempotent call must fail loudly, never silently double-fire). Mutations pass an
  `Idempotency-Key`.
- **Money is a string of bigint minor units** (Law 2). `priceMinor`/balances are typed `string` so a large value
  never loses precision in a browser. Format with `@krishalaya/i18n`'s `formatMoneyMinor`.
- **Typed errors.** A non-2xx becomes an `SdkError` carrying the API's stable `code`, `status`, and `requestId`
  (helpers: `isAuth/isForbidden/isNotFound/isConflict/isValidation/isRateLimited`). Transport failures are
  `SdkNetworkError` / `SdkTimeoutError`.
- **Envelope-aware.** Unwraps the API's `{ data, meta }` envelope; `meta.nextCursor` surfaces as `page.nextCursor`
  (keyset pagination — never OFFSET).

## Usage

```ts
import { createClient } from '@krishalaya/sdk-js';
const kv = createClient({ baseUrl: 'https://api.krishalaya.com', getToken: () => myToken, tenantSlug: 'acme' });
const page = await kv.listings.browse({ q: 'tomato', limit: 24 });   // anonymous, retried GET
const prov = await kv.traceability.scan('QR-TOKEN');                 // public farm-to-fork provenance
const me = await kv.auth.me();                                       // uses the bearer token
```

Resources: `listings` (browse/get), `catalogue` (browseProducts), `traceability` (scan — public), `auth`
(requestOtp/verifyOtp/refresh/me). The `request()` escape hatch covers endpoints without a dedicated method yet,
with the same envelope + resilience.

## Tests

`src/test/sdk.spec.ts` (injected fake fetch, no network): URL/version building, header attachment
(bearer/tenant/idempotency) + anonymous suppression, `{data,meta}` unwrap, typed-error mapping + **token never
leaked into the error**, idempotent-GET retry vs **no-retry on POST**, timeout, money stays a string. `npm test`.
