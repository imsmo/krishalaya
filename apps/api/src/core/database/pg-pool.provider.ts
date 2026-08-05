// core/database/pg-pool.provider.ts
// Owns the pg connection pools — one WRITER and one READ-REPLICA pool per shard.
// Pools are created lazily and reused. A connection pooler (RDS Proxy/pgBouncer)
// sits in front in production; this keeps in-process pools modest. Closed on
// shutdown so pods drain cleanly (no leaked sockets, no hung deploys).
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig } from '../config/app-config';
import { urlForShard } from '../sharding/shard-directory';

type Role = 'writer' | 'replica';

@Injectable()
export class PgPoolProvider implements OnModuleDestroy {
  private readonly log = new Logger(PgPoolProvider.name);
  private readonly pools = new Map<string, Pool>();
  constructor(private readonly config: AppConfig) {}

  private key(shardId: number, role: Role) { return `${shardId}:${role}`; }

  private make(shardId: number, role: Role): Pool {
    const { writerUrl, replicaUrl, poolMax } = this.config.db;
    // PC-52: shard N connects to ITS OWN cluster when DATABASE_URL[_REPLICA]_SHARD_N is set;
    // unset ⇒ the default URLs (shard 0 / single-shard behaviour byte-identical to before).
    const url = urlForShard(process.env, shardId, role, role === 'replica' ? replicaUrl : writerUrl);
    const pool = new Pool({ connectionString: url, max: poolMax, application_name: `kv-api-s${shardId}-${role}` });
    pool.on('error', (e) => this.log.error(`pg pool error (shard ${shardId} ${role}): ${e.message}`));
    return pool;
  }

  writer(shardId: number): Pool { return this.get(shardId, 'writer'); }
  replica(shardId: number): Pool { return this.get(shardId, 'replica'); }

  private get(shardId: number, role: Role): Pool {
    const k = this.key(shardId, role);
    let p = this.pools.get(k);
    if (!p) { p = this.make(shardId, role); this.pools.set(k, p); }
    return p;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.pools.values()].map((p) => p.end().catch(() => undefined)));
    this.pools.clear();
  }
}
