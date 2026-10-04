// PC-56 TENANT-SW-d · the admin realm's setup-call queue (W2619–W2625's platform side).
import { Module } from '@nestjs/common';
import { SetupCallsOpsController } from './setup-calls-ops.controller';
import { SetupCallsOpsService } from './setup-calls-ops.service';

@Module({ controllers: [SetupCallsOpsController], providers: [SetupCallsOpsService] })
export class SetupCallsOpsModule {}
