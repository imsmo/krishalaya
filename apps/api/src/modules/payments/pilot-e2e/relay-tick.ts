// modules/payments/pilot-e2e/relay-tick.ts
// ONE-SHOT outbox relay drain for the local Krishi-Verse pilot E2E script (scripts/pilot-e2e/).
//
// WHY THIS FILE EXISTS (S0 classification memo finding): apps/api/src/core/outbox/relay.poller.ts
// exports runRelay(), but NOTHING in this repo calls it at runtime today. apps/worker's
// outbox-gauge job only MEASURES the pending backlog — see apps/worker/src/jobs/outbox-gauge.job.ts
// and apps/worker/WORKER-RUNTIME.md ("⛔ Deferred: domain-handler jobs"), which says outright that
// running each event's HANDLER (OutboxHandlerRegistry) "requires the api domain" and is undecided
// (P0-9-follow-on). Until S1 makes a permanent choice (api-internal timer / shared domain lib /
// bus+consumer) and wires it, cross-module transitions — payment_succeeded -> order confirmed,
// orders.order_completed -> escrow release + notification fanout — NEVER fire on their own, no
// matter how long you wait. This file is the "call it manually" stand-in so the pilot E2E script
// can prove the loop TODAY: scripts/pilot-e2e/flow.mjs shells out to
// scripts/pilot-e2e/relay-tick.mjs between steps, which in turn runs THIS file via ts-node.
//
// WHY IT LOOKS LIKE THIS: OutboxDispatcher + its handlers are plain constructor-injected classes,
// not booted through Nest's DI container in tests either — see the proven wiring in
// apps/api/src/modules/payments/__tests__/orders-payments-e2e.integration.spec.ts. This file copies
// that exact pattern (same relative import depth: src/modules/payments/pilot-e2e/ mirrors
// src/modules/payments/__tests__/) and adds the communication (notification) fan-out handlers so a
// "notification recorded" step in the E2E flow has something to observe.
//
// NOT a general-purpose relay runner: it registers only the handlers this pilot slice exercises
// (orders <-> payments settlement + the communication notification fan-out). Production wiring
// (S1) must register the FULL OutboxHandlerRegistry used by every module, exactly as each module's
// own `onModuleInit()` does today when the api boots.
import 'reflect-metadata';
import { Pool } from 'pg';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../../../core/outbox/outbox.dispatcher';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';

import { OrderRepository } from '../../orders/repositories/order.repository';
import { PaymentSucceededHandler } from '../../orders/events/handlers/payment-succeeded.handler';

import { OrderCompletedHandler } from '../events/handlers/order-completed.handler';
import { SettlementPricingService } from '../services/settlement-pricing.service';
import { CommissionRuleRepository } from '../repositories/commission-rule.repository';
import { TaxRuleRepository } from '../repositories/tax-rule.repository';
import { SettlementLineRepository } from '../repositories/settlement-line.repository';

import { NotificationService } from '../../communication/services/notification.service';
import { NotificationEventRepository } from '../../communication/repositories/notification-event.repository';
import { NotificationTemplateRepository } from '../../communication/repositories/notification-template.repository';
import { NotificationPreferenceRepository } from '../../communication/repositories/notification-preference.repository';
import { QuietHoursRepository } from '../../communication/repositories/quiet-hours.repository';
import { NotificationRepository } from '../../communication/repositories/notification.repository';
import { PushDeviceRepository } from '../../communication/repositories/push-device.repository';
import { NoopNotificationGateway } from '../../communication/gateway/noop.gateway';
import { NoopPushSender } from '../../communication/gateway/noop-push.sender';
import { DomainEventFanoutHandler } from '../../communication/events/handlers/domain-event-fanout.handler';
import { NOTIFICATION_EVENT_MAP } from '../../communication/events/notification-event-map';

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.error(`[relay-tick] ${msg}`);
}

async function main(): Promise<void> {
  const appDatabaseUrl = process.env.DATABASE_URL;
  const relayDatabaseUrl = process.env.DATABASE_ADMIN_URL || process.env.MIGRATION_DATABASE_URL || appDatabaseUrl;
  if (!relayDatabaseUrl) {
    throw new Error('Set DATABASE_ADMIN_URL (preferred: the kv_relay BYPASSRLS role) or DATABASE_URL.');
  }

  // Minimal, valid config — the pilot script passes real values through the environment; these are
  // safe non-production fallbacks so the tick still runs if a var is missing (never a blocker for a
  // local proof script). AppConfig.assertProductionSecurity() only enforces strength in production.
  const config = new AppConfig({
    NODE_ENV: process.env.NODE_ENV || 'development',
    DATABASE_URL: appDatabaseUrl || relayDatabaseUrl,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'pilot-e2e-relay-tick-secret-min-32-characters',
    AUTH_HASH_PEPPER: process.env.AUTH_HASH_PEPPER || 'pilot-e2e-relay-tick-pepper-min-32-characters',
    SHARD_COUNT: process.env.SHARD_COUNT || '1',
  });

  const pools = new PgPoolProvider(config);
  const shards = new ShardRouter(config);
  const uow = new PgUnitOfWork(pools, shards);
  const replica = new PgReadReplicaProvider(pools, shards);
  const outbox = new PgOutboxWriter();
  const metrics = new PromMetrics();
  const cache = new InMemoryCacheService();

  // --- orders <-> payments settlement (the two handlers the S0 memo names explicitly) ---
  const orderRepo = new OrderRepository(replica as any);
  const paymentSucceededHandler = new PaymentSucceededHandler(orderRepo, outbox);

  const ledgerRepo = new LedgerRepository();
  const wallet = new InProcessWalletClient(ledgerRepo);
  const flags = new FlagsService(pools, cache);
  const commissionRuleRepo = new CommissionRuleRepository(replica as any);
  const taxRuleRepo = new TaxRuleRepository(replica as any);
  const pricing = new SettlementPricingService(commissionRuleRepo, taxRuleRepo);
  const settlementLineRepo = new SettlementLineRepository();
  const orderCompletedHandler = new OrderCompletedHandler(wallet, flags, pricing, settlementLineRepo);

  // --- communication fan-out (so "notification recorded" has something to prove) ---
  const gateway = new NoopNotificationGateway(config);
  const pushSender = new NoopPushSender(false);
  const pushDeviceRepo = new PushDeviceRepository(replica as any);
  const eventsRepo = new NotificationEventRepository(replica as any);
  const templatesRepo = new NotificationTemplateRepository(replica as any);
  const prefsRepo = new NotificationPreferenceRepository(replica as any);
  const quietRepo = new QuietHoursRepository(replica as any);
  const notifRepo = new NotificationRepository(replica as any);
  const notificationService = new NotificationService(
    uow, outbox, metrics, gateway, pushSender, pushDeviceRepo, eventsRepo, templatesRepo, prefsRepo, quietRepo, notifRepo, flags,
  );

  const registry = new OutboxHandlerRegistry();
  registry.register(paymentSucceededHandler);
  registry.register(orderCompletedHandler);
  for (const entry of NOTIFICATION_EVENT_MAP) registry.register(new DomainEventFanoutHandler(entry, notificationService));

  const relayPool = new Pool({ connectionString: relayDatabaseUrl });
  const dispatcher = new OutboxDispatcher(relayPool, registry, metrics);

  log(`connected (relay pool = ${relayDatabaseUrl.replace(/:\/\/[^@]+@/, '://***@')}); registry has ${registry.size} event type(s)`);

  let total = 0;
  for (;;) {
    const n = await dispatcher.relayBatch(50);
    total += n;
    if (n === 0) break;
    log(`drained ${n} event(s), continuing...`);
  }
  log(`done — ${total} outbox event(s) processed this tick`);

  await relayPool.end();
  await pools.onModuleDestroy();

  // The ONE line of stdout a caller should parse — everything else above went to stderr.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, processed: total }));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[relay-tick] FAILED:', err?.stack || err);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: false, processed: 0, error: String(err?.message || err) }));
  process.exit(1);
});
