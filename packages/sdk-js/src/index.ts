// @krishalaya/sdk-js · public entry. The official typed client every web frontend + mobile + integrator uses.
export { KrishalayaClient, createClient } from './client';
export type { SdkConfig } from './config';
export { SdkError, SdkNetworkError, SdkTimeoutError } from './errors';
export type { HttpMethod, RequestOptions, Envelope } from './http';
export type { CreateListingInput } from './resources/listings';
export type { OrderRole } from './resources/orders';
export type { OfferBox } from './resources/offers';
export type { WorkerPrefsInput, CreateBookingInput } from './resources/labour';
export { nameById } from './resources/lookups';
export type { Page, ListingCard, ListingQuery, BoostTier, BoostWalletPayResult, ListingAnalytics, ViewsByDayPoint, ProductCard, TraceProvenance, AuthTokens, UserProfile,
  CategoryNode, AttributeDef, AttributeOption, LookupValue, RegionNode, TenantBranding,
  MediaKind, MediaUploadTicket, MediaConfirmResult, MediaDownloadLink,
  PaymentPurpose, PaymentIntent, PaymentSummary, InvoiceSummary, InvoiceDownload, PayoutSummary, BankAccount, KycStatus, KycDocument, KycDocType, KycReviewItem,
  NotificationItem, NotificationPreference, QuietHours,
  OrderListItem, OrderItemLine, OrderDetail, OrderBuyerSummary, Shipment, OrderTracking, OrderEventPoint, ShipmentEventPoint, TrackingShipment, ReviewSummary, PublicReview, ReviewItem,
  CartItem, Cart, CheckoutResult, CheckoutPreview, CheckoutPreviewSeller, DeliveryMethod, DeliveryMethodsResult, WalletPaymentResult, Address,
  WalletBalance, WalletLedgerEntry, WalletInsights, InsightBucket,
  SavedItem, SavedSearch, SavedEntityType, SellerPublicProfile, GalleryItem,
  ListingOffer, Conversation, ConversationContext, Message, MaskedCall,
  Auction, AuctionKind, BidHistoryItem, PlaceBidResult, MyBid, WatchedAuction,
  WorkerProfile, WorkerCard, LabourBooking, LabourAssignment, LabourAttendance, LabourLookups,
  AmbassadorProfile, Referral, AmbassadorEarning, CommissionPlan, AmbassadorVisit, AmbassadorTarget, LeaderboardEntry, AssistedOnboardingResult, SuggestedListingDraft,
  AmbassadorTargetMetric, EnrollAmbassadorInput, UpdateAmbassadorInput, SetTargetInput, AmbassadorPayoutResult,
  Course, CourseLesson, Enrollment, LessonProgress,
  Plan, Subscription, TenantAnalytics, TenantBroadcast, RoleAssignment, RoleDef, PermissionDef, AssignRoleInput, StaffOverrideInput, Dispute,
  CommissionRule, CreateCommissionRuleInput, DeliveryZone, CreateDeliveryZoneInput, UpdateDeliveryZoneInput, TenantSetting, TenantFeature,
  IntegrationProvider, TenantIntegration, WebhookEndpoint,
  GroupLot, GroupLotPledge, GroupLotDetail, GroupLotStatus, CreateGroupLotInput, GroupLotSettlement,
  AuditEntry,
  AiReviewItem, AiReviewStatus, AiReviewQueueKind, EnqueueReviewInput, ResolveReviewInput,
  SearchHit, SearchEntityType, SearchEngine,
  DairyMcc, DairyMembership, DairyRateCard, DairyCollection, MilkBill,
  // PC-56 TENANT-6a · the counter board
  DairyCounterBoard, DairyCounterCentre, DairyCycleWindow, DairyPayday, DairyAnalyzer, DairyBmcTemp,
  // PC-56 TENANT-6b-1 · the pour-level hold, its review record, and the premium slabs the engine finally reads
  DairyHoldState, DairyReviewStatus, DairyQualityReview, DairyBonusSlab,
  // PC-56 TENANT-6b-2 · W168's desk
  DairyQualityDesk, DairyQualityFlagRow, DairyPremiumBand, DairyRateCardsInForce, DairyRateCardSummary,
  // PC-56 TENANT-6c-6 · W169's cycles and the console that reaches them
  DairyBillCycle, DairyCycleConsole, DairyCycleBillRow, DairyCycleAct, DairyCycleActRefusal, DairyCycleActCaution,
  // PC-56 TENANT-6d-1 · W170's tank
  DairyBmcUnit, DairyBmcMonitor, DairyBmcTile, DairyBmcReading, DairyBmcPlaybookStep,
  // PC-56 TENANT-6d-2 · W171's board, its custody register and the preference mix.
  DairyShiftWindow, DairyCustodyState, DairyCentreCustody, DairyTankCondition, DairyCentreRow,
  DairyCentreReconciliation, DairyPreferenceRow, DairyCentresConsole, DairyCentreCustodyRow,
  AssignMccOperatorInput, SetMccShiftWindowInput,
  // PC-56 TENANT-6d-3 · W171's move and the route history behind it.
  DairyMembershipRoute, DairyMoveRefusal, DairyMoveCaution, DairyMoveVerdict, MoveMembershipInput,
  // PC-56 TENANT-6d-4 · the shared form chain's review step.
  DairyReview, DairyReviewField, DairyReviewRefusal, DairyMccReviewInput, DairyBmcReviewInput,
  DairyStabilityVerdict, DairyWorkedExample, DairyFlagProtocol,
  DairyCoverage, DairyFlagSummary, DairyAccrual, DairyShiftClock,
  DairyAnimalType, DairyPaymentCycle, DairyPricingModel, DairyShift, MilkBillStatus,
  CreateMccInput, EnrolMemberInput, CreateRateCardInput, RecordCollectionInput, GenerateBillInput,
  Mandi, MandiPrice, PricePrediction, PriceAlert, MandiPulse, MandiPulseChange, AlertActivity, WeatherAlert,
  ForecastDay, ForecastHour, NormalisedForecast, ForecastResult, WeatherPrefs,
  LearningResource, ResourceKind, CropCalendar, CropCalendarStage, AssistantReply, AssistantStatus,
  Scheme, SchemeAuthority, EligibilityResult, ApplicationStatus, SchemeApplication, SchemeApplicationDocument, DbtTransfer,
  SupportTicket, TicketSeverity, TicketStatus, SupportThread, LandParcel, PrivacyRequest,
  OnboardRoleResult, ListingInquiry, ListingTrustDocument,
  WalletStatementFile, AutopayMandate, MandateExecution, SavedInstruments, SavedMandateInstrument, SavedBankInstrument,
  BusinessType, BusinessKycStatus, EkycStartResult, EkycVerifyResult, ConsentRecord, DisputeMessage } from './types';
// [DEV-01 FIX 2026-07-23: the 13 types above (InsightBucket, WalletStatementFile…DisputeMessage) were already defined in ./types.ts
// (and in BusinessKycStatus/EkycStartResult/EkycVerifyResult's case, already consumed internally by
// resources/payments.ts and resources/identity.ts) but were never re-exported from this public barrel, so every
// consumer importing them from '@krishalaya/sdk-js' (apps/mobile: kyc.api.ts, wallet.api.ts, wallet-home.ts,
// autopay.ts, system.api.ts, tenant.api.ts) failed `tsc` with TS2305 "has no exported member". Mechanical
// barrel-export fix per DEV_PIPELINE_PLAYBOOK.md category (a); no behavior/schema change. `Skill` (imported by
// apps/mobile/src/features/labour/skill-picker.ts) has NO definition anywhere in packages/sdk-js/src — that is a
// real gap, left unfixed and recorded in DEV-01_BASELINE.md as baseline-red for the mobile-completion phase (D2).]

export * from './resources/livestock';
export * from './resources/returns';
// PC-56 TENANT-3b: the dispute console reads + the refund maker-checker plane live in resources/admin.ts.
export type { DisputeKpis, DisputeQueueRow, DisputeMoneyState, RefundGateState, RefundApproval } from './resources/admin';
export { RefundApprovalsResource } from './resources/admin';
// PC-56 TENANT-3c-1: W151/W152 + the GSTR-1 export live on payments.invoices.
export type { TradeInvoiceRow, TradeInvoiceLine, TradeInvoiceDetail, InvoiceMonthKpis, Gstr1ExportResult, CreditNoteResult } from './resources/payments';
// PC-56 TENANT-3c-2: W150's charges & taxes.
export type { ChargeRow, TaxRuleRow, ChargeProposalRow, ChargeOverview, ChargeProposalResult } from './resources/payments';
export { ChargesResource } from './resources/payments';
// PC-56 TENANT-4a: W143/W144 — the ORGANISATION's wallet (the tenant's own three accounts), distinct from the
// caller's personal wallet on `client.wallet`.
export { OrgWalletResource } from './resources/payments';
// PC-56 TENANT-4b: W145/W146 — the organisation's payout queue and the batch approval gate.
export { PayoutConsoleResource } from './resources/payments';
// PC-56 TENANT-4c: W147/W148 — the settlement cycle and its statements.
export { SettlementsResource } from './resources/payments';
export type { SettlementCycle, SettlementCycleStatus, SettlementProgress, SettlementOverview, SettlementCycleSellerRow, SettlementStatementListRow, SettlementStatementsPage, OrgStatementResult } from './resources/payments';
export type { PayoutQueueRow, PayoutQueuePage, PayoutBatchRow, PayoutBatchReview, PayoutBatchPrepared, PayoutPreflight, PayoutPreflightLine, PayoutPreflightCheck, PayoutRetryPlan } from './resources/payments';
export type { OrgWalletOverview, OrgAccountRow, OrgBalanceVerdict, OrgMovementRow, OrgLedgerRow, OrgLedgerWindow, OrgHealthLine, OrgLedgerExport, OrgTenantAccountCode } from './resources/payments';

export * from './resources/fintech';
export * from './resources/partner-api';
export type { ProductBatch, CreateBatchInput } from './resources/catalogue'; // PC-50 W10-4
export type { EquipmentAsset, EquipmentRate, EquipmentRental } from './resources/equipment'; // PC-50 W10-6
export type { RiderPayoutStatement } from './resources/logistics'; // PC-55 A7
// Types defined in their resource modules but previously never re-exported from this barrel — the six web
// consoles import them via `from '@krishalaya/sdk-js'`, which failed to typecheck until now (surfaced by the
// first full `pnpm build` of web-ops/web-gov). Grouped by module, same style as the lines above.
export type { StorageBooking, AssayReport, NwrReceipt } from './resources/warehousing';
export type { Coupon, CouponRedemption, Promotion } from './resources/promotions';
export type { EduChannel, LiveSession } from './resources/education';
export type { MembershipTier, UserMembership, CoopBylaws, VoteIneligibleReason, VotingVerdict,
  ShareRegisterRow, ShareRegisterTiles, ShareRegisterView, MyVotingEligibility, ResolutionTally } from './resources/memberships';
export type { Requirement, RequirementResponse } from './resources/requirements';
// PC-56 TENANT-1b · the people roster + member detail. `REVEALABLE_MEMBER_FIELDS` is a VALUE export (the console
// renders the field picker from it, so the list cannot drift from the server's closed enum).
export { REVEALABLE_MEMBER_FIELDS, kycSeverity, isFullyVerified, rosterKycLabel, MIN_SUSPENSION_REASON } from './resources/members';
// PC-56 TENANT-1b-4 · the template generator is a VALUE export so the console cannot drift from the parser's column list.
export { MEMBER_IMPORT_COLUMNS, memberImportTemplateCsv } from './resources/bulk-imports';
export type { BulkImportJob, BulkImportStatus, BulkValidationReport, BulkValidationIssue } from './resources/bulk-imports';
// PC-56 TENANT-1c · the console home.
export type { TenantDashboard, DashboardTiles, DashboardAction, DashboardActionKind, TenantPlanHealth,
  GoLiveState, GoLiveStep, GoLiveStepKey,
  ComparePlan, PlanCompareView, PlanLimitBreach, PlanChangePreview, PlanChangeRecord,
  TenantSignupInput, TenantSignupResult } from './resources/tenancy';
export type { RosterMember, RosterRole, RosterCensus, RosterQuery, MemberDetail, MemberRoleDetail, MemberGlance,
  MemberPreferences, MemberActivityItem, RevealableMemberField, KycLabel, SuspensionRecord, SuspensionResult,
  Farmer360, Farmer360Income, Farmer360Season, Farmer360Scheme, Farmer360CreditEvidence, LandByUnit } from './resources/members';
// PC-56 TENANT-2a · staff console + listing QC (W123/W126/W127)
export { LISTING_IMPORT_COLUMNS, listingImportTemplateCsv } from './resources/bulk-imports';   // TENANT-2c
export type { OrderWorkingView, OrderViewCounts, ConsoleOrderRow, OrderTimelineEvent, OrderMoneyBasis, OrderMoneyBox } from './types';   // TENANT-3a
export type { ConsoleListingRow, ConsoleCounts, QcQueueItem, QcKpis, QcRejectReason, QcQueuePayload, QcReviewPayload, PriceHistoryEntry, FairPriceGuide } from './types';
// PC-56 TENANT-4d-1: W118's meters and W115's plan cards.
export type { PlanUsageView, PlanMeter, PlanMeterState, PlanMeterVerdict, PlanProjection, ChoosablePlanRow } from './resources/tenancy';
// PC-56 TENANT-4d-2 — W120's billing console.
export { SaasBillingResource, SAAS_INVOICE_TABS } from './resources/tenancy';
// PC-56 TENANT-4d-3 — W2424-W2427's tax-identity chain.
export { TenantProfileResource, TAX_FIELD_CODES } from './resources/tenancy';
export type { TaxIdentityForm, TaxIdentityField, TaxFieldCode, TaxFieldError, TaxFieldErrorReason, ChecksumVerdict, TenantProfilePatch, ProfilePreview, ProfileDiffRow } from './resources/tenancy';
export type { BillingConsoleView, SaasInvoiceRow, SaasInvoiceDetail, SaasPayQuote, SaasInvoiceTab, BillingMechanismVerdict } from './resources/tenancy';
// PC-56 TENANT-5a · the shipment trail — the first tenant-side read of `shipment_events`, a table with two
// writers and no reader in its own module since 0007.
export type { ShipmentTrail, ShipmentTrailPoint, ShipmentProgress, ShipmentEventFilter, ShipmentEventRow, ShipmentEventPage } from './types';
// PC-56 TENANT-5b · W229's fleet register and W231's route board.
export type {
  RcCell, VehicleToday, FleetVehicleRow, FleetSplit, FleetMechanisms, FleetRegisterPage, FleetVehicle,
  LogisticsPartnerRow, RouteStatusDto, RouteParcels, RouteEconomics, RouteApproval, RouteBoardRow, RouteCounts,
  RouteBoardPage, RouteCorridor, DeliveryRouteDto,
} from './types';
// PC-56 TENANT-5c · the freight desk.
export type {
  FreightSourceKind, FreightReconStatus, FreightLineVerdict, FreightDisputeReason, FreightExpected,
  FreightPayment, FreightInvoiceRow, FreightCycleCount, FreightDeskPage, FreightLine, FreightInvoiceDetail,
  FreightReconDetail,
  // PC-56 TENANT-5d · the logistics desk
  LogisticsOverview, LogisticsInsights, LogisticsAttention, LogisticsMechanism, LogisticsRate, LogisticsTransit,
  LogisticsOnTime, LogisticsTransitLoss, LogisticsCostPerUnit, LogisticsFailureBreakdown, LogisticsHistory,
  LogisticsLane,
} from './types';
