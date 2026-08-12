// modules/listings/__tests__/listings.e2e-spec.ts
// Endpoint integration tests. Boots a Nest test app against an ephemeral Postgres
// (testcontainers) + fake search/cache, seeds one tenant + plan, and exercises the
// real HTTP contract end to end. Marked describe.skip until the CI test-DB harness
// is wired (tracked in docs/build/03_BUILD_STATE.md); the scenarios below are the
// acceptance criteria the harness must satisfy.
import request from 'supertest';

describe.skip('listings e2e (requires test-DB harness)', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let app: any; // INestApplication — assigned when the test-DB harness lands (bootstrapTestApp below)
  let http: any;
  const tenant = 'tenant-e2e';
  const auth = { Authorization: 'Bearer test-seller', 'x-tenant-id': tenant };

  beforeAll(async () => {
    // app = await bootstrapTestApp({ seeds: ['plans', 'roles', 'category'] });
    // http = app.getHttpServer();
  });
  afterAll(async () => { /* await app?.close(); */ });

  const createBody = {
    productId: '11111111-1111-1111-1111-111111111111',
    categoryId: '22222222-2222-2222-2222-222222222222',
    title: 'E2E Wheat', quantityTotal: 100, minOrderQty: 1, unitCode: 'quintal',
    priceMinor: '1440000', currencyCode: 'INR', organicClaim: 'none', saleType: 'direct', visibility: 'public',
  };

  it('POST /v1/listings requires an Idempotency-Key header', async () => {
    await request(http).post('/v1/listings').set(auth).send(createBody).expect(400);
  });

  it('POST /v1/listings is idempotent — same key returns the same id', async () => {
    const key = 'idem-abc';
    const a = await request(http).post('/v1/listings').set({ ...auth, 'Idempotency-Key': key }).send(createBody).expect(201);
    const b = await request(http).post('/v1/listings').set({ ...auth, 'Idempotency-Key': key }).send(createBody).expect(201);
    expect(a.body.data.id).toEqual(b.body.data.id);
  });

  it('POST beyond plan max_listings_month → 429 quota exceeded', async () => {
    // create up to the seeded plan limit, then expect the next to be rejected
    // expect(lastResponse.status).toBe(429);
  });

  it('POST /v1/listings/:id/publish writes listing.published to the outbox in the same txn', async () => {
    // create → publish → assert a row exists in outbox_events for this aggregate_id
  });

  it('PATCH /v1/listings/:id/price with a stale expectedVersion → 409 concurrency', async () => {
    // create → publish → change with wrong version → expect 409
  });

  it('GET /v1/listings is served from the read-model and never the write primary', async () => {
    // assert the search read-model path is hit (no write-pool query)
  });
});
