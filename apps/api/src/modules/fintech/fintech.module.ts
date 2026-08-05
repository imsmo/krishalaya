// modules/fintech/fintech.module.ts
// Agri-Fintech (PRD M19): the lending spine. Farmers browse partner loan products, APPLY, the lender
// (FPO/banker) reviews → approves (opening an anti-predatory cooling-off window, PRD §59.4) → DISBURSES,
// which credits the borrower's wallet (tenant 'main' → borrower userMain, txnType 'loan_disbursement') and
// opens a servicing loan; the borrower REPAYS (borrower userMain → tenant 'main', txnType 'loan_repayment')
// until the outstanding reaches zero and the loan CLOSES. All money moves are zero-sum + idempotent through
// the wallet boundary (Law 2). Gated by the `fintech` feature flag (default OFF).
//
// LENDER MODEL: the FPO/tenant is the on-platform lender of record (proven, wallet-native). Bank/NBFC
// partner-rail disbursement (real RBI money) is the deferred, RBI/partner-gated path; financial_partners +
// loan_products are GLOBAL reference data authored on the admin/platform surface (Law 11), read-only here.
//
// SCOPE (this build): partner + loan-product browse, loan applications (apply→review→approve→disburse),
// loans (servicing), repayments + the disbursement & repayment money paths.
// DEFERRED (schema in 0011 / admin surface): credit scoring + consent (bureau), insurance (products/
// policies/claims), BNPL input financing, finance groups (SHG/JLG internal book), NWR-pledge collateral,
// origination-fee revenue leg, EMI schedule generation, parametric triggers, partner-rail disbursement, jobs.
import { Module } from '@nestjs/common';
import { PartnersController } from './controllers/v1/partners.controller';
import { LoanApplicationsController } from './controllers/v1/loan-applications.controller';
import { LoansController } from './controllers/v1/loans.controller';
import { ServicingController } from './controllers/v1/servicing.controller';
import { ServicingService } from './services/servicing.service';
import { ServicingRepository } from './repositories/servicing.repository';
import { FinancialPartnerService } from './services/financial-partner.service';
import { LoanApplicationService } from './services/loan-application.service';
import { LoanService } from './services/loan.service';
import { FinancialPartnerRepository } from './repositories/financial-partner.repository';
import { LoanProductRepository } from './repositories/loan-product.repository';
import { LoanApplicationRepository } from './repositories/loan-application.repository';
import { LoanRepository } from './repositories/loan.repository';
import { LoanRepaymentRepository } from './repositories/loan-repayment.repository';

@Module({
  controllers: [PartnersController, LoanApplicationsController, LoansController, ServicingController],
  providers: [FinancialPartnerService, LoanApplicationService, LoanService, FinancialPartnerRepository, LoanProductRepository, LoanApplicationRepository, LoanRepository, LoanRepaymentRepository, ServicingService, ServicingRepository],
  exports: [FinancialPartnerService, LoanApplicationService, LoanService],
})
export class FintechModule {}
