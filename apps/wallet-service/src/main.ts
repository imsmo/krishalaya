// apps/wallet-service/src/main.ts · the money service process. Boots fail-closed (WalletConfig), wires the
// ledger core (wallet.module), loads wallet.proto, and serves the Wallet gRPC service. The ledger engine is the
// ONLY writer of money (Law 2); this process owns it. Graceful shutdown drains the gRPC server then the pool.
// Imports @grpc/* (declared deps, installed in CI/runtime).
import 'dotenv/config'; // load apps/wallet-service/.env BEFORE WalletConfig reads it (local dev; no-ops in prod where env is injected)
import * as path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { buildWalletService } from './wallet.module';
import { makeWalletHandlers } from './grpc/wallet.grpc-controller';

async function bootstrap() {
  const svc = buildWalletService();
  const def = protoLoader.loadSync(path.join(__dirname, 'grpc', 'wallet.proto'), {
    keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(def) as any;
  const walletService = proto.krishalaya.wallet.v1.Wallet.service;

  const server = new grpc.Server({ 'grpc.max_concurrent_streams': 1000 });
  server.addService(walletService, makeWalletHandlers(svc.engine, svc.pool));

  const addr = `${svc.config.env.GRPC_HOST}:${svc.config.env.GRPC_PORT}`;
  await new Promise<void>((resolve, reject) =>
    server.bindAsync(addr, grpc.ServerCredentials.createInsecure(), (err) => (err ? reject(err) : resolve())));
  // eslint-disable-next-line no-console
  console.log(`[wallet-service] ledger gRPC listening on ${addr} (${svc.config.env.NODE_ENV})`);

  const shutdown = () => server.tryShutdown(() => { void svc.pool.end(); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
void bootstrap();
