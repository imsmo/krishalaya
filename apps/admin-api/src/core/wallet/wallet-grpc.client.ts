// apps/admin-api/src/core/wallet/wallet-grpc.client.ts · the production binding of WalletAdminPort. Talks to the
// wallet-service (the ONLY money writer, Law 2/9) over gRPC using the mirrored wallet.proto. FAIL-CLOSED: if the
// endpoint isn't configured it refuses to move money (throws) rather than silently no-op. Every RPC carries a
// hard deadline (Law 12 — one slow dependency must never hang the god-mode plane) + an s2s bearer in metadata
// (never logged). The proto is loaded with longs:String so amount_minor crosses the wire as a string and stays a
// bigint here — money is NEVER a JS float. Lazy channel: created on first use, reused after.
import { Injectable } from '@nestjs/common';
import { credentials, loadPackageDefinition, Metadata, type Client, type ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { join } from 'node:path';
import { AdminConfig } from '../config/admin-config';
import { WalletAdminPort, PostAdjustmentInput, PostAdjustmentResult } from './wallet-admin.port';

interface ProtoLeg { owner_kind: string; owner_id: string; account_code: string; currency_code: string; amount_minor: string; }
interface PostReq { tenant_id: string; txn_type: string; idempotency_key: string; legs: ProtoLeg[]; reference_type: string; reference_id: string; initiated_by: string; description: string; }
interface PostRes { txn_id: string; already_applied: boolean; }
type WalletGrpcClient = Client & { PostTransaction(req: PostReq, meta: Metadata, opts: { deadline: number }, cb: (e: ServiceError | null, r?: PostRes) => void): void };

export class WalletUnavailableError extends Error {
  readonly code = 'WALLET_UNAVAILABLE';
  constructor(detail: string) { super(`wallet-service unavailable: ${detail}`); this.name = 'WalletUnavailableError'; }
}

@Injectable()
export class WalletGrpcAdminClient implements WalletAdminPort {
  private client: WalletGrpcClient | null = null;
  constructor(private readonly config: AdminConfig) {}

  private connect(): WalletGrpcClient {
    if (this.client) return this.client;
    const addr = this.config.wallet.addr;
    if (!addr) throw new WalletUnavailableError('WALLET_GRPC_ADDR is not configured (cannot move money)');
    const def = loadSync(join(__dirname, 'wallet.proto'), { longs: String, keepCase: true, defaults: true, oneofs: true });
    const pkg = loadPackageDefinition(def) as any;
    const Ctor = pkg.krishalaya.wallet.v1.Wallet;
    this.client = new Ctor(addr, credentials.createInsecure()) as WalletGrpcClient;   // TLS terminated by the mesh
    return this.client;
  }

  post(input: PostAdjustmentInput): Promise<PostAdjustmentResult> {
    const client = this.connect();
    const meta = new Metadata();
    if (this.config.wallet.token) meta.set('authorization', `Bearer ${this.config.wallet.token}`);   // s2s; never logged
    const req: PostReq = {
      tenant_id: input.tenantId, txn_type: input.txnType, idempotency_key: input.idempotencyKey,
      legs: input.legs.map((l) => ({ owner_kind: l.ownerKind, owner_id: l.ownerId ?? '', account_code: l.accountCode, currency_code: input.currencyCode, amount_minor: l.amountMinor.toString() })),
      reference_type: input.referenceType ?? '', reference_id: input.referenceId ?? '', initiated_by: input.initiatedBy ?? '', description: input.description ?? '',
    };
    const deadline = Date.now() + this.config.wallet.timeoutMs;
    return new Promise<PostAdjustmentResult>((resolve, reject) => {
      client.PostTransaction(req, meta, { deadline }, (err, res) => {
        if (err || !res) return reject(new WalletUnavailableError(err?.details || err?.message || 'no response'));
        resolve({ txnId: res.txn_id, alreadyApplied: res.already_applied });
      });
    });
  }
}
