// modules/schemes/schemes.module.ts
// Government Schemes & DBT (PRD M17): the scheme-application engine. Farmers browse the scheme catalogue
// (200+ schemes as DATA, with machine-readable eligibility rules), run an explainable eligibility check,
// and APPLY; a government officer verifies → approves/rejects → records the observed PFMS/DBT credit. Every
// status change is appended to a partitioned audit trail. Gated by the `schemes` feature flag (default OFF).
//
// MONEY: the only in-platform wallet move is the optional scheme PROCESSING FEE on submit (applicant
// userMain → tenant 'main', txnType 'service_fee', zero-sum + idempotent — Law 2). The DBT benefit itself is
// credited to the beneficiary's bank by the government PFMS (external); dbt_transfers merely RECORDS it.
//
// SCOPE (this build): scheme + authority browse, eligibility checker, applications (apply→submit→verify→
// clarify→approve/reject→disburse→close, +appeal) with audit trail + processing-fee collection, observed
// DBT-credit recording.
// DEFERRED (schema in 0011 / admin & platform surface): authoring schemes + authorities (admin, Law 11),
// PFMS sync + rule-refresh + stuck-escalation + window-open jobs, AI eligibility confidence, the full
// rule DSL, ambassador-assisted attribution beyond the assisted_by field.
import { DbtBounceService } from './services/dbt-bounce.service';
import { DbtBounceRepository } from './repositories/dbt-bounce.repository';
import { PFMS_PROVIDER, pfmsProviderFromEnv } from './providers/pfms.provider';
import { Module } from '@nestjs/common';
import { SchemesController } from './controllers/v1/schemes.controller';
import { EligibilityController } from './controllers/v1/eligibility.controller';
import { ApplicationsController } from './controllers/v1/applications.controller';
import { SchemeService } from './services/scheme.service';
import { SchemeApplicationService } from './services/scheme-application.service';
import { DbtTransferService } from './services/dbt-transfer.service';
import { SchemeDocumentService } from './services/scheme-document.service';
import { SchemeRepository } from './repositories/scheme.repository';
import { SchemeAuthorityRepository } from './repositories/scheme-authority.repository';
import { SchemeApplicationRepository } from './repositories/scheme-application.repository';
import { DbtTransferRepository } from './repositories/dbt-transfer.repository';
import { FieldVerificationRepository } from './repositories/field-verification.repository';
import { FieldVerificationService } from './services/field-verification.service';
import { GovExportService } from './services/gov-export.service';
import { SchemeDocumentRepository } from './repositories/scheme-document.repository';

@Module({
  controllers: [SchemesController, EligibilityController, ApplicationsController],
  providers: [SchemeService, SchemeApplicationService, DbtTransferService, SchemeDocumentService, SchemeRepository, SchemeAuthorityRepository, SchemeApplicationRepository, DbtTransferRepository, SchemeDocumentRepository, FieldVerificationRepository, FieldVerificationService, GovExportService, DbtBounceService, DbtBounceRepository,
    { provide: PFMS_PROVIDER, useFactory: () => pfmsProviderFromEnv(process.env) }],
  exports: [SchemeService, SchemeApplicationService, DbtTransferService],
})
export class SchemesModule {}
