// core/database/database.module.ts
// Database plumbing: connection pools + shard router + the concrete UnitOfWork
// and ReadReplica bound to their abstract tokens. Imported by CoreModule. This
// is the only module that knows about `pg`.
import { Global, Module } from '@nestjs/common';
import { PgPoolProvider } from './pg-pool.provider';
import { ShardRouter } from '../sharding/shard-router';
import { UNIT_OF_WORK } from './unit-of-work';
import { READ_REPLICA } from './read-replica.provider';
import { PgUnitOfWork } from './unit-of-work.pg';
import { PgReadReplicaProvider } from './read-replica.pg';
import { PartnerRealmUnitOfWork } from './partner-realm-uow';   // PC-56 PARTNER-0
import { GovRealmUnitOfWork } from './gov-realm-uow';   // PC-56 GOV-0

@Global()
@Module({
  providers: [
    PgPoolProvider,
    ShardRouter,
    { provide: UNIT_OF_WORK, useClass: PgUnitOfWork },
    { provide: READ_REPLICA, useClass: PgReadReplicaProvider },
    PartnerRealmUnitOfWork,
    GovRealmUnitOfWork,
  ],
  exports: [PgPoolProvider, ShardRouter, UNIT_OF_WORK, READ_REPLICA, PartnerRealmUnitOfWork, GovRealmUnitOfWork],
})
export class DatabaseModule {}
