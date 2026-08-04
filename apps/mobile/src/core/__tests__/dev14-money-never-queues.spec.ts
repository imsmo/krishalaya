// apps/mobile/src/core/__tests__/dev14-money-never-queues.spec.ts · DEV-14 (Golden Law 6 audit) regression suite.
// Proves, from the ACTUAL repo source (not a paraphrase), that every money-moving mutation in the app is
// structurally INELIGIBLE for the offline queue — the enqueue path (`enqueueOp`/`registerOpHandler`, defined in
// core/api/offline-queue.ts + core/offline/sync-queue.ts) is reachable from exactly TWO call sites in the whole
// app, both content (never money): core/media/uploader.ts ('media.upload') and
// features/listings/listings.api.ts ('listing.create' — draft creation, not a payment). Every money data-layer
// file (wallet/payments/cart/orders/auctions/labour/tenant/bank/offers), plus listings.api.ts's OWN money
// functions (payListingBoost/startBoost/etc.), is grep-verified to NEVER call enqueueOp — this makes the
// KV-MF-02 bug class (a client misclassifying a validation failure as "offline" and silently queuing a money
// action) structurally impossible, not just correctly classified. If a future change adds enqueueOp to any of
// these files, or adds a THIRD registerOpHandler call site anywhere in the app, this test fails and must be
// re-justified explicitly by extending the allowlists below — it can never silently regress.
// See Development_Program/dev14_report.md for the full screen-by-screen census this file encodes.
//
// Why a source-text scan (fs), not a module import: core/offline/sync-queue.ts, core/offline/handlers.ts, and
// every features/*.api.ts transitively pull in AsyncStorage/expo/native modules that this repo's jest.config.js
// (testEnvironment: 'node', roots: src/core/__tests__, no RN mocks configured) cannot resolve — confirmed by
// grep: zero pre-existing spec in this directory imports any *.api.ts file, core/api/client.ts, or
// core/offline/sync-queue.ts directly. write-classify.spec.ts + offline-queue.spec.ts already exhaustively
// unit-test the classifier + queue PATHWAY itself (network→retry, 4xx/5xx→permanent-fail, content still drains
// after a poison op is dead-lettered); this file closes the other half of DEV-14's mandate — proving the money
// surfaces never hand anything to that pathway in the first place.
import * as fs from 'fs';
import * as path from 'path';
import { isConnectivityFailure } from '../api/write-classify';
import { SdkNetworkError } from '@krishalaya/sdk-js';

const SRC_ROOT = path.join(__dirname, '..', '..'); // apps/mobile/src

function read(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), 'utf8');
}

/** Every money-moving mutation surface's data-layer file, grep-populated per DEV-14's full census (see
 * Development_Program/dev14_report.md §CENSUS for the screen-by-screen mapping). Each must NEVER call
 * enqueueOp — a money mutation either succeeds against the live server now, or the promise rejects and the
 * screen surfaces the real reason; it never sits in a silent local queue pretending to have worked. */
const MONEY_DATA_LAYER_FILES = [
  'features/wallet/wallet.api.ts', // requestWithdrawal (payout) + autopay mandate register/confirm/execute/cancel
  'features/payments/payments.api.ts', // addMoney (wallet recharge) + payForOrder + payOrderFromWallet
  'features/cart/cart.api.ts', // placeOrder (checkout → cart-to-orders conversion)
  'features/orders/orders.api.ts', // lifecycle transitions (confirm/pack/deliver/complete/cancel/dispute)
  'features/auctions/auctions.api.ts', // placeBid (EMD hold) + createAuction
  'features/labour/hire.api.ts', // payWages (employer settles a completed booking's wage)
  'features/labour/labour.api.ts', // worker-side reads/clock-in/clock-out (no money mutation; completeness row)
  'features/tenant/tenant.api.ts', // resolveDispute (refund amount) + applyForPlan (tenant subscription)
  'features/kyc/bank.api.ts', // addBank/addFullBank (payout destination — gates future withdrawals)
  'features/offers/offers.api.ts', // makeOffer/counterOffer/acceptOffer (price commitment → converts to an order)
  // [QA-FIX 2026-07-28, DEV-24 QA]: features/insurance/insurance.api.ts (DEV-24, KV-BL-055) added payPmsbyPremium
  // (premium payment initiation) — a real, direct money mutation per the same "never queued" contract as every
  // file above. Was structurally already caught by the repo-wide reachability test below (it never calls
  // enqueueOp/registerOpHandler), but had not been added to THIS itemized census — closing that documentation
  // gap explicitly rather than relying only on the repo-wide net.
  'features/insurance/insurance.api.ts', // payPmsbyPremium (PMSBY premium payment initiation, DEV-24/KV-BL-055)
];

describe('DEV-14 · Golden Law 6 — money data-layer files never call enqueueOp', () => {
  it.each(MONEY_DATA_LAYER_FILES)('%s contains zero enqueueOp call sites', (relPath) => {
    const src = read(relPath);
    expect(src).not.toMatch(/enqueueOp\s*\(/);
  });

  it.each(MONEY_DATA_LAYER_FILES)('%s never imports the offline write-queue module', (relPath) => {
    const src = read(relPath);
    expect(src).not.toMatch(/from ['"].*\/(offline\/sync-queue|api\/offline-queue)['"]/);
  });
});

describe("DEV-14 · listings.api.ts — mixed file, function-scoped check (content queues, money never does)", () => {
  const src = read('features/listings/listings.api.ts');

  it("has EXACTLY one enqueueOp call site total (createListing's content path)", () => {
    const matches = src.match(/enqueueOp\s*\(/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('the one enqueueOp call site is inside createListing (a draft, not a payment), not a money function', () => {
    const idx = src.indexOf('enqueueOp(');
    expect(idx).toBeGreaterThan(-1);
    const before = src.slice(0, idx);
    const fnStart = before.lastIndexOf('export async function');
    expect(fnStart).toBeGreaterThan(-1);
    const fnHeader = src.slice(fnStart, src.indexOf('(', fnStart));
    expect(fnHeader).toContain('createListing');
  });

  const MONEY_OR_LIFECYCLE_FUNCTIONS = [
    'payListingBoost', 'startBoost', 'loadBoostTiers', 'extendListing', 'repostListing', 'archiveListing', 'addListingPhoto',
  ];
  for (const fnName of MONEY_OR_LIFECYCLE_FUNCTIONS) {
    it(`money/lifecycle function ${fnName} contains no enqueueOp`, () => {
      const start = src.indexOf(`function ${fnName}(`);
      expect(start).toBeGreaterThan(-1); // the function must actually exist — fails loudly if renamed/removed
      const nextExport = src.indexOf('\nexport ', start + 1);
      const body = nextExport === -1 ? src.slice(start) : src.slice(start, nextExport);
      expect(body).not.toMatch(/enqueueOp\s*\(/);
    });
  }
});

describe('DEV-14 · repo-wide reachability — the offline queue has EXACTLY 2 registered op types, both content', () => {
  // Every file under src (excluding this test directory) that calls registerOpHandler( or enqueueOp( directly.
  // A new money handler wired in anywhere — the actual KV-MF-02 regression shape — fails this test immediately.
  const ALLOWLIST = new Set(['core/media/uploader.ts', 'features/listings/listings.api.ts']);
  const DEFINING_FILE = 'core/offline/sync-queue.ts'; // where enqueueOp/registerOpHandler are DEFINED, not called

  function walk(dir: string, out: string[]): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const allFiles = walk(SRC_ROOT, []);
  const callers = new Set<string>();
  for (const f of allFiles) {
    const rel = path.relative(SRC_ROOT, f).split(path.sep).join('/');
    if (rel === DEFINING_FILE) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (/registerOpHandler\s*\(/.test(src) || /enqueueOp\s*\(/.test(src)) callers.add(rel);
  }

  it('the exact set of files that touch the offline queue is the known-safe content allowlist', () => {
    expect(Array.from(callers).sort()).toEqual(Array.from(ALLOWLIST).sort());
  });

  it('the allowlist itself contains no money-shaped filename (guards the guard)', () => {
    const moneyish = /wallet|payout|withdraw|payment|wage|checkout|boost|auction|dispute|bank(?!ers)/i;
    for (const f of ALLOWLIST) expect(moneyish.test(f)).toBe(false);
  });
});

describe('DEV-14 · [QA-FIX 2026-07-24] queue module export surface — no alias can evade the allowlist scan', () => {
  // The reachability test above (previous describe block) greps every file for the LITERAL call-site text
  // `enqueueOp(` / `registerOpHandler(`. That is airtight against a NEW CALLER, but blind to a NEW ALIAS: if
  // core/offline/sync-queue.ts ever grew e.g. `export const stash = enqueueOp;`, a money file could call
  // `stash({...})` and neither regex would fire — the allowlist test would stay green while a money mutation
  // silently gained a queue path. Closing that gap: pin the module's exact VALUE-export surface (function/const
  // names), so adding any new export — alias or not — fails this test until explicitly re-justified here.
  const src = read('core/offline/sync-queue.ts');
  const KNOWN_VALUE_EXPORTS = ['registerOpHandler', 'enqueueOp', 'onDroppedOp', 'flushQueue', 'pendingCount', 'deadOps'];

  it('core/offline/sync-queue.ts exports exactly the known set of functions (no new alias/entry point)', () => {
    const names = new Set<string>();
    for (const m of src.matchAll(/export\s+function\s+([A-Za-z0-9_]+)\s*\(/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*=/g)) names.add(m[1]);
    expect(Array.from(names).sort()).toEqual(Array.from(KNOWN_VALUE_EXPORTS).sort());
  });

  it('the queue instance itself (`const queue = new OfflineQueue(...)`) is never exported directly', () => {
    // If `queue` (the shared OfflineQueue instance) were ever exported, a caller could reach `queue.enqueue(...)`
    // directly — bypassing the `enqueueOp(` wrapper text entirely and evading every grep above.
    expect(src).not.toMatch(/export\s+(const|let|var)\s+queue\b/);
    expect(src).not.toMatch(/export\s*\{\s*queue\s*[,}]/);
  });
});

describe('DEV-14 · control group — content actions still queue normally (no over-fix)', () => {
  // Sanity-checks the pathway itself is untouched: MF-02's own fix (write-classify.ts) still classifies a real
  // network failure as retry-able (queue-eligible) — proving DEV-14 did not blanket-disable queueing for
  // everything. Full behavioral coverage of the pathway lives in write-classify.spec.ts + offline-queue.spec.ts;
  // this is a one-line tripwire so a DEV-14-era diff can't accidentally break the content path.
  it('a genuine connectivity failure is still classified as queue-eligible (content path unaffected)', () => {
    expect(isConnectivityFailure(new SdkNetworkError('offline'))).toBe(true);
  });
});
