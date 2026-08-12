// apps/admin-api/src/core/rbac/owner-roles.ts · the platform OWNER-role permission catalog (Law 11).
// These are PLATFORM roles, defined HERE in the god-mode realm — never in the tenant DB's role_permissions
// (a tenant admin can NEVER be granted these). Least-privilege: each owner role lists exactly the platform
// permissions it holds; super_admin holds '*'. Permissions resolve from the token's roles claim against this
// static catalog — never trusted directly from the client.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const OwnerPermissions = {
  AiModelManage: 'ai.model.manage',     // register/promote/retire models + tune thresholds
  AiModelRead: 'ai.model.read',         // browse the registry + fairness reports
  // ADMIN-7 — W082: "Needs `ai.review` (AI Ops Officer); fraud cases additionally need risk scope."
  //
  // IT EXISTED ONLY IN THE TENANT REALM. `apps/api/.../ai-governance.policies.ts` checks `ai.review` for a tenant's own
  // reviewer working their own cases; the PLATFORM officer W082 is written for — `platform_ai_ops` — had no permission
  // and no surface at all. Not the same act and not reusable across realms: a tenant reviews their own farmers' cases,
  // a platform officer reviews everybody's, and one grant covering both would hand a tenant admin cross-tenant reach.
  //
  // SEPARATE FROM `ai.model.read`, THOUGH BOTH LOOK AT AI, because reading what models decided is an auditor's job and
  // deciding a case changes what happens to a farmer's listing today. The decision explorer (W084) is gated on the read
  // permission and the queue on this one, which is exactly the split the two screens' restricted states describe.
  AiReview: 'ai.review',                // work the human-in-the-loop queue: claim, accept, reject
  TenantManage: 'tenant.manage',        // approve/suspend/archive tenants + limit overrides (consequential)
  TenantRead: 'tenant.read',            // search tenants + read scorecards
  ReconManage: 'recon.manage',          // open/resolve mismatch investigations + FREEZE wallet accounts
  ReconRead: 'recon.read',              // wallet reconciliation dashboard + run/investigation reads
  ComplianceManage: 'compliance.manage',// work DSRs, approve exports, manage retention, run breach console
  ComplianceRead: 'compliance.read',    // audit-log explorer + DSR/export/breach/retention reads
  // ADMIN-5 — the canon names this permission by hand on W041 and W042 ("Needs compliance.dsr — DPO-designated staff
  // only; every action is audited"). Separate from ComplianceManage because working a RIGHTS REQUEST means reading one
  // identified person's data and deciding what happens to it, while ComplianceManage also covers retention config and
  // export approvals, which name nobody. Somebody who tunes a retention policy has no reason to open a named farmer's
  // erasure. W046/W047's `compliance.consent.read`/`.write` and W043's `compliance.breach` are the same argument and are
  // NOT added here — they belong with the planes that use them (ADMIN-5b/5c), because a permission with no route behind
  // it is a promise nothing keeps.
  ComplianceDsr: 'compliance.dsr',      // work a DPDP rights request end to end (DPO-designated staff)
  // ADMIN-5b — both named by the canon (W046's and W047's restricted states). Separate from ComplianceDsr and from
  // ComplianceManage because they govern a different thing again: the REGISTRY is a cross-tenant list of people and
  // their choices, and the PURPOSE registry is the legal text every one of those choices was given against. Somebody
  // who works rights requests has no reason to rewrite a consent notice; somebody who authors notices has no reason to
  // read a named farmer's consent history.
  ComplianceConsentRead: 'compliance.consent.read',    // cross-tenant consent register + purposes (PII masked)
  ComplianceConsentWrite: 'compliance.consent.write',  // author + publish consent notices (checker-gated on publish)
  // ADMIN-5c — W043's restricted state names it ("Needs compliance.breach (DPO + security)"). Separate again because a
  // breach register is a SECURITY object as much as a privacy one: the people who need it are the on-call and the DPO,
  // not whoever tunes retention policies. W043 also says declaring is never blocked — any staff member can raise one
  // via the incident line — so this permission gates the CONSOLE, not the ability to report.
  ComplianceBreach: 'compliance.breach',
  BillingManage: 'billing.manage',      // SaaS invoice transitions + dunning + MANUAL money adjustments (via wallet-service)
  BillingRead: 'billing.read',          // revenue dashboard + invoice/adjustment/dunning reads
  FlagsManage: 'flags.manage',          // create/enable/disable flags + percent rollout + targeting + KILL-SWITCH (Law 10)
  FlagsRead: 'flags.read',              // flag registry + change-history reads
  PlansManage: 'plans.manage',          // SaaS plan catalogue: create/version/publish/archive + features + limits + pricing
  PlansRead: 'plans.read',              // plan catalogue + feature/limit + change-history reads
  ImpersonationGrant: 'impersonation.grant', // start/end/revoke a READ-ONLY act-as session (highest sensitivity)
  ImpersonationRead: 'impersonation.read',   // impersonation grant + action history reads (audit)
  SupportOversightRead: 'support.oversight.read',     // cross-tenant ticket + SLA-breach + tenant-health reads
  SupportOversightManage: 'support.oversight.manage', // escalate a ticket (raise severity / status / reassign)
  // ADMIN-SWEEP-b2 — W050's restricted state names it: "Needs `support.hub` — L1+ agents; thread PII masks apply
  // per role." It had never existed (the ungrantable-permission guard now counts these; this one was caught at
  // design time rather than by the spec, which is the cheap place to catch it).
  //
  // SEPARATE FROM `support.oversight.read`, because the hub is a WORKBENCH and the oversight plane is a WINDOW: a
  // NOC viewer reads queues, SLA boards and tenant health all day without ever owning a farmer's conversation.
  // `support.hub` claims tickets ("Next in queue"), flips presence ("Take a break"), and opens the per-principal
  // thread — the deepest support read there is, one person's contacts across every tenant they touch — so holding
  // it is a decision somebody makes about a named agent, not a side effect of being allowed to watch the board.
  SupportHub: 'support.hub',
  // ADMIN-SWEEP-b3 — W058's restricted state: "Access limited to safety-team roles; even platform owner sees case
  // metadata only, not thread content." The second half is structural fact (no admin-api code reads `messages` at
  // all — thread text stays in the tenant realm behind `moderation.messages`-class decisions); the first half is
  // this grant. SEPARATE FROM `support.hub`, because a women_safety case register is not a workbench queue: who may
  // even SEE that a named person raised a protected-category alert is the narrowest support question there is.
  SafetyDesk: 'safety.desk',
  ReportsRead: 'reports.read',          // read-only exec dashboards (MRR/ARR/GMV/active-tenants/active-users)
  ProvidersManage: 'providers.manage',  // enable/disable an integration provider platform-wide (Law 12 degrade)
  ProvidersRead: 'providers.read',      // provider registry + credential-ref health reads (no secrets)
  AnnouncementsManage: 'announcements.manage', // author/schedule/publish/expire platform-wide announcements
  AnnouncementsRead: 'announcements.read',     // announcement list + change-history reads
  CatalogueManage: 'catalogue.manage',  // platform master taxonomy: lookup vocabularies + category tree (create/edit/move/activate)
  CatalogueRead: 'catalogue.read',      // taxonomy registry (types/values/categories) + change-history reads
  // PC-56 ADMIN-3b. DELIBERATELY NOT part of catalogue.*: curating the category tree does not entitle somebody to assert
  // that a Tamil sentence means what the English means. And this permission is necessary but NOT sufficient — the
  // `translation_reviewers` table (0103) decides which LANGUAGES, because a language list is data and an enum cannot
  // carry "…but only for Gujarati".
  TranslationsReview: 'translations.review',   // author + approve/reject translations, within one's granted languages
  TranslationsManage: 'translations.manage',   // grant/revoke a reviewer's languages; request machine-translation runs
  SchemesRegistryManage: 'schemes.registry.manage', // govt-scheme master: authorities + schemes (create/edit/version/activate)
  SchemesRegistryRead: 'schemes.registry.read',     // scheme/authority registry + change-history + window calendar reads
  // ADMIN-4b — TWO PERMISSIONS SEPARATE FROM THE REGISTRY ONES, AND THE SEPARATION IS THE WHOLE POINT.
  // The registry is GLOBAL data with no person in it: a catalogue editor may need `schemes.registry.*` all day. The
  // two below open cross-tenant reads over FARMERS, and W074's and W076's own restricted states name them by hand.
  // Folding either into `schemes.registry.read` would mean anybody who can fix a typo in a scheme's name can also
  // download every scheme applicant in the country — and in the audit ledger that export would be indistinguishable
  // from a taxonomy dump.
  SchemesApplicationsRead: 'schemes.applications.read', // cross-tenant scheme applications INCLUDING applicant PII
  SchemesDbtRead: 'schemes.dbt.read',                   // cross-tenant DBT/PFMS credit observations (never bank fields)
  CellsManage: 'cells.manage',  // shard/cell routing directory: register cells/shards, status lifecycle, tenant placement/move (Law 8/12)
  CellsRead: 'cells.read',      // cell/shard map + tenant-placement + residency + change-history reads (no DSN secrets)
  // ADMIN-8 — THE CANON NAMES A CHECKER ON THIS MAP FIVE TIMES AND THERE WAS NONE.
  //   W029 "ALL changes are maker-checker + reasoned" · W030 "requires checker (`cells.approve`)"
  //   W031 "Weight/status changes need `cells.write` + checker" · W036 "Raising capacity_tenants needs … checker"
  //   W038 "Set is_default for BD → open for placements (checker)"
  // Every one of those writes was one operator with `cells.manage`, applied immediately.
  //
  // SEPARATE FROM `cells.manage`, AND THE SEPARATION IS WHAT MAKES THE RULE ADMINISTRABLE. `ck_cell_map_proposals_maker_
  // ne_checker` and `assertSecondPerson` refuse self-approval even if one person holds both — so this split is not the
  // control itself. What it buys is an access review that can grant "may propose a topology change" without granting "may
  // authorise one", which is the difference between a two-person rule and a formality on a team of three.
  CellsApprove: 'cells.approve',  // apply or reject a proposed cell/shard/placement change — a second person, always
  // ADMIN-5d — THE TRUST & SAFETY NAMESPACE. These four are the first `moderation.*` / `risk.*` permissions on the
  // platform; before this wave they existed only as prose inside migration 0067's rationale comment, which named them
  // as the access model for three tables nothing could reach.
  //
  // WHY FOUR AND NOT ONE. Every split below is a different KIND of power, and the canon's own restricted states name
  // them separately (W093: "Needs `risk.read`; freezes/blocks need `risk.act` + checker for blocked band"; W095:
  // "Needs `risk.rules` + checker — weights change real access for real people").
  //   • ModerationRead is the widest and the least dangerous: boards, counts, insights. An analyst asking "is the
  //     marketplace getting safer" needs it and needs nothing else.
  //   • RiskRead opens ONE NAMED PERSON'S risk profile — their phone, their score, the events behind it. That is a
  //     cross-tenant read over a farmer, and folding it into ModerationRead would mean anybody who can look at a
  //     trend line can also pull up a named farmer's fraud file.
  //   • RiskAct changes what a real person may do — restrict a band, add a device block. Separate from reading it
  //     because the overwhelming majority of trust work is looking, and standing write access to an access ladder is
  //     the thing you least want held by default.
  //   • RiskRules is separate AGAIN, and is the narrowest of the four. A weight change does not affect one person; it
  //     re-bands the whole population at once. W095's dry-run panel exists because a −3 adjustment moved 312 users
  //     and put 41 into payout delay. Somebody who may restrict one suspected fraudster has not thereby been trusted
  //     to move three hundred people at midnight.
  // ADMIN-5e — THE AUDIT SPLIT THE CANON FILED AND THE CODE NEVER MADE.
  // W039's restricted state: "Needs `audit.read`; old/new values additionally need `audit.values.read` (PII in
  // diffs)." W040's: "Diffs masked — old/new values need `audit.values.read` — timeline stays visible, diffs show
  // ▪▪▪." Neither existed; the explorer has been running on `compliance.read`, so anybody who can read the DSR queue
  // can also read every privileged action ever taken on the platform.
  //
  // THE SECOND PERMISSION IS THE INTERESTING ONE, AND IT RESOLVES A TENSION AN EARLIER WAVE LOGGED AS UNRESOLVED.
  // The explorer deliberately never selects `old_value`/`new_value` because a diff can carry anything the changed
  // row carried — a phone number, an address, a bank reference. W040 needs exactly those to draw a change diff. The
  // ADMIN-5 verdict called that a genuine conflict needing a decision. **The canon had already decided it**: the
  // timeline is `audit.read` and the DIFF is its own permission, so the history of what happened stays widely
  // readable and the contents of what changed do not. An auditor reconstructing a lifecycle needs the first; only
  // an investigation needs the second.
  AuditRead: 'audit.read',                  // the append-only trail: who did what, when, to which entity
  AuditValuesRead: 'audit.values.read',     // …and the before/after VALUES, which can carry anything the row carried
  // W068's restricted state: "Drafting needs `ledger.investigate`; posting needs a DIFFERENT user with
  // `ledger.correct`." Separate from `recon.manage` because opening an investigation is a note and posting a
  // correction MOVES A FARMER'S MONEY BY HAND — the widest gap between two acts anywhere in this console.
  // ADMIN-6 — W064's and W065's restricted states both name `ledger.read` ("auditor role gets read-only + export
  // only"), and W059's names it for balances. It did not exist: the ledger explorer had no route and the recon reads
  // ran on `recon.read`.
  //
  // SEPARATE FROM `recon.read`, AND THE SPLIT IS THE POINT. Recon shows whether the books BALANCE — aggregates, run
  // outcomes, mismatch counts, and no individual transaction. `ledger.read` opens the transactions themselves: every
  // leg, every account, every counterparty, across every tenant. That is the most complete picture of who paid whom
  // that exists on this platform, and an operator who needs to know the ledger is healthy does not need it.
  LedgerRead: 'ledger.read',                // the transaction explorer, one txn's legs, the hash chain, balances
  LedgerInvestigate: 'ledger.investigate',  // draft a correction against an open case; never posts
  LedgerCorrect: 'ledger.correct',          // approve and post a correction — a second person, always
  // ADMIN-6b — THE MONEY DOOR. W066's restricted state: "Viewing needs `ledger.read`; execution approval needs
  // `payouts.approve` (checker)." W062's: "Statements need `billing.read`; running the cycle needs `ledger.settle`."
  //
  // THERE IS ALREADY A `payout.approve`, AND IT IS A DIFFERENT PERMISSION IN A DIFFERENT REALM. Seed 0004 grants it to
  // `tenant_admin`, and its only two uses in the whole codebase are `@Get('batches')` and `@Get('batches/:id')` in
  // apps/api — a permission called "Approve payouts" that has never guarded an approval, because no approve endpoint
  // existed anywhere. That one governs a tenant admin looking at their own members' payouts and is deliberately left
  // alone; this one is the platform checker on a cross-tenant batch. They are not the same act and merging them would
  // let a tenant admin approve the platform's disbursements.
  //
  // SEPARATE FROM `ledger.correct`, THOUGH BOTH MOVE MONEY, because they move it in opposite directions and the
  // failure modes do not resemble each other. A correction adjusts the record of money already inside the platform; an
  // approval sends money OUT to 214 bank accounts and cannot be undone by another entry. The person who reconciles the
  // books is not automatically the person who should authorise a disbursement, and on a platform this is the one place
  // where being wrong is irreversible.
  PayoutApprove: 'payouts.approve',         // approve OR return a payout batch — a second person, always
  SettlementRead: 'settlement.read',        // the settlement cycle, its statements, one statement's lines + PDF
  LedgerSettle: 'ledger.settle',            // run a settlement cycle on demand (generates statements; moves no money)
  ModerationRead: 'moderation.read',   // trust & safety boards, counts, insights — no named-person risk file
  // ADMIN-5f — the QUEUE permissions, both named by the canon and neither previously existing.
  // W090: "Release/remove need `moderation.listings`; removals of value ≥ ₹1,00,000 are maker-checker."
  // W092: "Message bodies need `moderation.messages` — thread text is sensitive by default."
  //
  // MESSAGES ARE SEPARATE FROM LISTINGS AND THAT IS THE INTERESTING SPLIT. A held listing is a public offer; a
  // reported message is a private conversation between two people, one of whom is usually the person complaining.
  // Reading the thread is often necessary to judge a harassment report and it is never routine, so it is its own
  // grant — an operator can work the queue, hold listings and decide reports all day without ever opening somebody's
  // messages, and the one who needs to open them has asked for that specifically.
  ModerationListings: 'moderation.listings',   // hold / release / remove a listing; decide a report
  ModerationMessages: 'moderation.messages',   // read the BODY of a reported message thread
  // ADMIN-SWEEP-b1 — W097's restricted state: "Deciding needs `moderation.appeals` AND ≠ original reviewer
  // (enforced)." **THE EIGHTH UNGRANTABLE PERMISSION**: it had existed only inside 0067/0110 rationale comments —
  // the exact shape TENANT-1b-3 found seven times in the tenant realm, this time on the grant behind the appeal
  // path every removal notice has promised farmers since 0112.
  //
  // SEPARATE FROM `moderation.listings`, AND THE SEPARATION IS THE ≠-REVIEWER RULE MADE ADMINISTRABLE. The people
  // most likely to decide appeals are the same desks that made the original calls, and `chk_appeals_reviewer_neq`
  // (0067) plus the claim path's own skip refuse the overlap PER APPEAL even when one person holds both — so this
  // split is not the control itself, same as cells.approve. What it buys is that an access review can grant "may
  // work the moderation queue" without granting "may sit in judgement on the queue's own decisions", and that a
  // future dedicated appeals desk is one grant line, not a code change to every moderation route.
  ModerationAppeals: 'moderation.appeals',     // claim ("Take next") and decide an appeal; never the original act
  RiskRead: 'risk.read',               // ONE user's risk profile: score, band, explainable factors, masked identity
  RiskAct: 'risk.act',                 // band changes + platform blocklist entries (both require a second operator)
  RiskRules: 'risk.rules',             // propose/approve risk-weight changes — population-wide, dry-run gated
  /* ---- PC-56 ADMIN-9 · THE REALM'S OWN OPERATORS. W104 names `staff.manage`; W105 names `rbac.manage`. NEITHER
     EXISTED IN ANY REALM, which is consistent: there was no staff registry to manage and no way to change a role
     except a deploy. ---- */
  StaffRead: 'staff.read',             // the operator roster, one operator, their sessions and step-up history
  // Suspend an operator, restrict a permission (deny only), request a reinstatement, revoke somebody's session.
  StaffManage: 'staff.manage',
  // **A SEPARATE GRANT FOR THE CHECKER, and the separation is the control**: reinstatement needs a second person, and a
  // second person holding the SAME permission as the first is a second pair of hands rather than a second pair of eyes.
  // Whoever can suspend cannot, by permission alone, readmit.
  StaffReinstate: 'staff.reinstate',
  // The role matrix is a READ of the compiled catalogue (owner-roles.ts is this file). There is no `rbac.manage`
  // counterpart and there must not be: granting a platform permission is a code review and a deploy, and a database
  // path that could do it would make this catalogue advisory (Law 5, Law 11).
  RbacRead: 'rbac.read',
  /* ---- PC-56 ADMIN-10 · reports, analytics and exports. THREE PERMISSIONS THE CANON NAMES BY HAND AND NONE OF WHICH
     EXISTED. Only `reports.read` did, so a single grant covered the exec dashboard, the cross-tenant analytics and
     every export — and W001's own restricted state describes a split that could not happen: "Your role (Ops · L2) can't
     view platform revenue. Ask a Platform Owner for the metrics.revenue.read permission." ---- */
  // **THE MOST SENSITIVE FIGURES ON THE PLATFORM'S FRONT PAGE.** MRR, ARR and GMV are the numbers a competitor would pay
  // for and an operator on the support desk has no reason to see. Separate from `reports.read` so the dashboard can serve
  // the degraded page the canon describes — everything except the money — rather than a 403 for the whole screen.
  MetricsRevenueRead: 'metrics.revenue.read',
  // The ad-hoc builder. Separate from `reports.read` because a fixed dashboard answers questions somebody has already
  // reviewed, and a builder answers whatever the operator asks — a different risk against the same tables.
  AnalyticsRead: 'analytics.read',
  // ADMIN-SWEEP-b4 — W109/W111: "PII aggregates unless farmer360 grant". 0120's header deferred this permission
  // ("a permission with no route behind it is a promise nothing keeps") to the wave that builds the route; this is
  // that wave. SEPARATE FROM `analytics.read`, and the split IS the lens: every other analytics surface answers
  // questions about POPULATIONS; this one opens ONE NAMED FARMER's whole life with the platform — the deepest
  // per-person view there is, so the narrowest grant (the same sentence W155's tenant twin uses for member.view360).
  AnalyticsFarmer360: 'analytics.farmer360',
  // **EXPORT IS ITS OWN GRANT, and it is the one that matters.** Reading a figure on screen and walking out with a file
  // are different acts: the file survives the session, the screenshot policy and the leaver process. W111 says so
  // itself — "Needs analytics.read; exports need analytics.export."
  AnalyticsExport: 'analytics.export',
  /* ---- PC-56 ADMIN-11 · the configuration control plane. W103 names both by hand ("Viewing needs `settings.read`;
     changes need `settings.manage` + checker") and NEITHER existed — `grep -rn "settings.manage" apps` returned
     nothing across every app. ---- */
  SettingsRead: 'settings.read',
  // Define, set, revert, retype and re-classify a platform setting. Money-path and security keys additionally need a
  // second administrator, which is a rule in the service rather than a second permission: the same person may hold
  // `settings.manage` and still be unable to approve their own change.
  SettingsManage: 'settings.manage',
  // **THE CHECKER ON A FLAG THAT WIDENS.** W004: "Every toggle requires a reason and is maker-checker gated for
  // module-level flags." The reason was enforced; the second person was enforced nowhere, and `flags.manage` alone could
  // switch a module off for every tenant on the platform. Separate grant, so the desk that flips is not the desk that
  // widens.
  FlagsApprove: 'flags.approve',
  /* ---- PC-56 ADMIN-11b · notification templates. W101 and W102 both name `templates.manage` by hand in their
     read-only states, and `grep -rn "templates.manage" apps` returned nothing across every app — so the registry's
     restricted state could not happen and one grant would have covered reading the OTP wording and rewriting it. ---- */
  /* ---- PC-56 ADMIN-11c · providers, API keys & webhooks. W106 names both grants by hand ("Needs platform.api.read;
     revoking needs platform.api.manage + reason") and `grep -rn "platform.api" apps packages` returned nothing — so one
     grant covered reading every tenant's integration list AND switching it off. ---- */
  /* ---- PC-56 ADMIN-SWEEP · price intelligence. Reading the pulse is `analytics.read` (W107 says so). **DECIDING on a
     quarantined price is its own grant**: releasing an observation is what lets a number reach a farmer's selling
     decision, and that is not the same authority as reading a chart. ---- */
  MarketPriceReview: 'market.price.review',
  PlatformApiRead: 'platform.api.read',
  PlatformApiManage: 'platform.api.manage',
  // **W007 GATES THE SECRET REFERENCES AND NOT THE HEALTH METRICS**, in those words: "Secret refs (AWS ARN) require
  // providers.secrets.read. Health metrics remain visible to all ops roles." A single provider grant would have made the
  // canon's own restricted state unreachable, which is the third time this programme has found a screen describing a
  // permission split the code could not express.
  ProvidersSecretsRead: 'providers.secrets.read',
  TemplatesRead: 'templates.read',
  // Author a version, submit it, register a sender id. **NOT approve** — see below.
  TemplatesManage: 'templates.manage',
  // **THE SECURITY SIGN-OFF W102 NAMES: "auth/dispute templates additionally need security sign-off."** Approving is
  // what moves the serving pointer, which is the only act on this plane a recipient can see. Separate grant, because the
  // desk that writes the words is not the desk that decides they may be sent.
  TemplatesApprove: 'templates.approve',
} as const;
export type OwnerPermission = (typeof OwnerPermissions)[keyof typeof OwnerPermissions];

// role code → permissions. '*' = god mode (everything). These are PLATFORM roles only — they can NEVER be
// granted to a tenant user (Law 11); the tenant DB's role_permissions has no row for any of these codes.
const OWNER_ROLE_GRANTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  super_admin:            ['*'],
  /* ---- PC-56 ADMIN-9 ---- */
  // The desk that runs the realm's own access: suspend, restrict, revoke a session, request a reinstatement. It
  // deliberately does NOT hold StaffReinstate — the desk that removes access is not the desk that restores it.
  platform_staff_ops:      [OwnerPermissions.StaffManage, OwnerPermissions.StaffRead, OwnerPermissions.RbacRead],
  // The checker. Holds reinstatement and the reads, and cannot suspend — so the two halves of the two-person rule sit
  // in two different roles rather than relying on two people who could each do both.
  platform_staff_checker:  [OwnerPermissions.StaffReinstate, OwnerPermissions.StaffRead, OwnerPermissions.RbacRead],
  // Read-only: the roster, the matrix, the step-up history. What an auditor asking "who could have done this" needs.
  platform_staff_auditor:  [OwnerPermissions.StaffRead, OwnerPermissions.RbacRead],
  /* ---- PC-56 ADMIN-10 ---- */
  // The exec/board reader: the dashboard, the money on it, the analytics, and the ability to take a file away.
  platform_analytics_ops:   [OwnerPermissions.ReportsRead, OwnerPermissions.MetricsRevenueRead,
    OwnerPermissions.AnalyticsRead, OwnerPermissions.AnalyticsExport],
  // ADMIN-SWEEP-b4. A DEDICATED role, not a line on platform_analytics_ops — the schemes_oversight reasoning again:
  // watching aggregates all day must not thereby open one named farmer's whole life. Whoever holds this holds it
  // because somebody decided they may see a person, and an access review can read that decision in one line.
  // AnalyticsExport is deliberately NOT here: exporting a person's profile needs BOTH grants (the service enforces
  // the conjunction), so the reviewer who may look is not automatically the one who may take the file away.
  platform_farmer360: [OwnerPermissions.AnalyticsFarmer360, OwnerPermissions.AnalyticsRead],
  // Reads everything and takes nothing out. The commonest shape of request on a reporting plane, and previously
  // impossible: `reports.read` carried the export with it.
  platform_analytics_viewer: [OwnerPermissions.ReportsRead, OwnerPermissions.MetricsRevenueRead,
    OwnerPermissions.AnalyticsRead],
  // **THE ROLE W001'S RESTRICTED STATE IS WRITTEN FOR.** Sees the dashboard and not the revenue — the operational
  // picture without the platform's own money. This is the role that made the permission split worth building.
  platform_ops_dashboard:   [OwnerPermissions.ReportsRead],
  /* ---- PC-56 ADMIN-11 ---- */
  // Reads the registry and changes nothing — an auditor asking "what is this platform configured to do".
  platform_config_viewer:  [OwnerPermissions.SettingsRead, OwnerPermissions.FlagsRead],
  // Proposes and applies configuration. Holds neither checker grant: the desk that changes settings and flips flags is
  // deliberately not the desk that approves a money-path setting or widens a module flag.
  platform_config_ops:     [OwnerPermissions.SettingsManage, OwnerPermissions.SettingsRead,
    OwnerPermissions.FlagsManage, OwnerPermissions.FlagsRead],
  // The checker. Approves a widened flag and reads everything; cannot propose, so the two halves of the rule live in
  // two roles rather than relying on two people who could each do both (the ADMIN-9 pattern).
  platform_config_checker: [OwnerPermissions.FlagsApprove, OwnerPermissions.SettingsRead, OwnerPermissions.FlagsRead],
  /* ---- PC-56 ADMIN-11b ---- */
  // The copy desk: writes and submits wording, and cannot approve its own. The sixteenth maker-checker site is only real
  // if the two halves can be held by two roles rather than by one person exercising restraint.
  platform_templates_ops:     [OwnerPermissions.TemplatesManage, OwnerPermissions.TemplatesRead],
  // The security sign-off on OTP and dispute wording. Approves and cannot author.
  platform_templates_checker: [OwnerPermissions.TemplatesApprove, OwnerPermissions.TemplatesRead],
  // Reads every template and every version, including tenant overrides — the "what did we send" question, which before
  // this wave had no answer at all.
  platform_templates_auditor: [OwnerPermissions.TemplatesRead],
  /* ---- PC-56 ADMIN-11c ---- */
  // The integrations desk: sees every key, endpoint and callback, and can revoke. Deliberately WITHOUT
  // `providers.secrets.read` — the desk that watches traffic is not the desk that reads credentials.
  platform_integrations_ops:     [OwnerPermissions.PlatformApiManage, OwnerPermissions.PlatformApiRead],
  /* ---- PC-56 ADMIN-SWEEP ---- */
  // The market desk: reads the pulse and clears the anomaly queue. Deliberately NOT holding `analytics.export` — the
  // desk that judges a price does not need to walk out with the price file.
  platform_market_ops:           [OwnerPermissions.MarketPriceReview, OwnerPermissions.AnalyticsRead],
  // Read-only oversight: the shape of request this plane will get most often, and previously impossible to grant.
  platform_integrations_viewer:  [OwnerPermissions.PlatformApiRead],
  // The role W007's restricted state is written for: reads the secret REFERENCES (never the secrets) as well as the
  // health metrics. Separate from the ops role so a credential reference is a deliberate grant.
  platform_integrations_secrets: [OwnerPermissions.PlatformApiRead, OwnerPermissions.ProvidersSecretsRead],
  platform_ai_ops:        [OwnerPermissions.AiModelManage, OwnerPermissions.AiModelRead, OwnerPermissions.AiReview],
  platform_ai_auditor:    [OwnerPermissions.AiModelRead],
  // ADMIN-7. The reviewer who works the queue and cannot change a model — the commonest shape of request on this plane
  // and previously impossible to grant, because the only AI roles were "manage everything" and "read the registry".
  platform_ai_reviewer:   [OwnerPermissions.AiReview, OwnerPermissions.AiModelRead],
  platform_tenant_ops:    [OwnerPermissions.TenantManage, OwnerPermissions.TenantRead],
  platform_tenant_viewer: [OwnerPermissions.TenantRead],
  platform_recon_ops:     [OwnerPermissions.ReconManage, OwnerPermissions.ReconRead],
  platform_recon_viewer:  [OwnerPermissions.ReconRead],
  platform_compliance_ops:    [OwnerPermissions.ComplianceManage, OwnerPermissions.ComplianceRead, OwnerPermissions.ComplianceDsr],
  // The DPO works rights requests and reads the registers — and deliberately does NOT get ComplianceManage, so they
  // cannot rewrite a retention policy to change the scope of an erasure they are about to sign off. That separation is
  // the whole reason this role exists rather than being folded into platform_compliance_ops.
  platform_dpo:               [OwnerPermissions.ComplianceDsr, OwnerPermissions.ComplianceRead, OwnerPermissions.ComplianceConsentRead, OwnerPermissions.ComplianceBreach],
  // Security on-call works the breach register and reads the posture page, and holds nothing else — they have no reason
  // to open a named farmer's rights request at 3am.
  platform_security_oncall:   [OwnerPermissions.ComplianceBreach, OwnerPermissions.ComplianceRead],
  // The notice AUTHOR reads the registry and writes notices, and deliberately holds no rights-request permission: the
  // person who writes the words has no business reading which named farmers accepted them.
  platform_consent_author:    [OwnerPermissions.ComplianceConsentRead, OwnerPermissions.ComplianceConsentWrite],
  platform_compliance_viewer: [OwnerPermissions.ComplianceRead],   // DPO / auditor read-only
  platform_billing_ops:       [OwnerPermissions.BillingManage, OwnerPermissions.BillingRead],
  platform_billing_viewer:    [OwnerPermissions.BillingRead],      // finance / revenue analyst read-only
  platform_flags_ops:         [OwnerPermissions.FlagsManage, OwnerPermissions.FlagsRead],
  platform_flags_viewer:      [OwnerPermissions.FlagsRead],        // SRE / release manager read-only
  platform_plans_ops:         [OwnerPermissions.PlansManage, OwnerPermissions.PlansRead],
  platform_plans_viewer:      [OwnerPermissions.PlansRead],        // pricing / product analyst read-only
  platform_support_impersonator: [OwnerPermissions.ImpersonationGrant, OwnerPermissions.ImpersonationRead],
  platform_impersonation_auditor: [OwnerPermissions.ImpersonationRead],   // read-only audit of act-as sessions
  platform_support_oversight: [OwnerPermissions.SupportOversightManage, OwnerPermissions.SupportOversightRead, OwnerPermissions.SupportHub],
  platform_support_oversight_viewer: [OwnerPermissions.SupportOversightRead],   // NOC / support-lead read-only
  platform_reports_viewer: [OwnerPermissions.ReportsRead],   // exec / finance / analyst — read-only dashboards
  platform_providers_ops: [OwnerPermissions.ProvidersManage, OwnerPermissions.ProvidersRead],
  platform_providers_viewer: [OwnerPermissions.ProvidersRead],   // integrations / SRE — read-only
  platform_announcements_ops: [OwnerPermissions.AnnouncementsManage, OwnerPermissions.AnnouncementsRead],
  platform_announcements_viewer: [OwnerPermissions.AnnouncementsRead],   // comms / marketing — read-only
  platform_catalogue_ops: [OwnerPermissions.CatalogueManage, OwnerPermissions.CatalogueRead],
  platform_catalogue_viewer: [OwnerPermissions.CatalogueRead],   // catalogue / data-governance analyst — read-only
  // A REVIEWER IS NOT A CATALOGUE EDITOR. They also need CatalogueRead to see the canonical text they are judging
  // against — reviewing a translation without its source is a spelling check, not a review.
  platform_translations_reviewer: [OwnerPermissions.TranslationsReview, OwnerPermissions.CatalogueRead],
  // The localisation LEAD decides who speaks for a language, and reviews too.
  platform_translations_lead: [OwnerPermissions.TranslationsManage, OwnerPermissions.TranslationsReview, OwnerPermissions.CatalogueRead],
  platform_schemes_ops: [OwnerPermissions.SchemesRegistryManage, OwnerPermissions.SchemesRegistryRead],
  platform_schemes_viewer: [OwnerPermissions.SchemesRegistryRead],   // govt-programs / policy analyst — read-only
  // ADMIN-SWEEP-b1 — THE NINTH AND TENTH UNGRANTABLE PERMISSIONS, found the day the reachability guard first ran.
  // ADMIN-4b split `schemes.applications.read` and `schemes.dbt.read` out of the registry grants precisely because
  // they open cross-tenant reads over FARMERS — and then granted them to nobody, so W074/W076's oversight routes
  // 403'd every operator below god mode. A DEDICATED role rather than a line on platform_schemes_ops, for ADMIN-4b's
  // own stated reason: the person who fixes a typo in a scheme's name must not thereby be able to download every
  // scheme applicant in the country. Whoever holds this role holds it because somebody decided they may see farmers.
  platform_schemes_oversight: [OwnerPermissions.SchemesApplicationsRead, OwnerPermissions.SchemesDbtRead, OwnerPermissions.SchemesRegistryRead],
  platform_cells_ops: [OwnerPermissions.CellsManage, OwnerPermissions.CellsRead],
  platform_cells_viewer: [OwnerPermissions.CellsRead],   // infra / SRE — read-only topology view
  // ADMIN-8. The checker who authorises topology changes and proposes none — deliberately NOT holding `cells.manage`, so
  // that an access review can see at a glance who may sign and who may ask.
  platform_cells_checker: [OwnerPermissions.CellsApprove, OwnerPermissions.CellsRead],
  // ADMIN-5d. The safety DESK works cases: they read the boards and they act on individual accounts. They do NOT hold
  // `risk.rules` — the person under pressure at 22:40 to stop a fraud ring is the last person who should be able to
  // re-weight the whole population to make one cluster go away.
  platform_trust_safety: [OwnerPermissions.ModerationRead, OwnerPermissions.RiskRead, OwnerPermissions.RiskAct],
  // The risk POLICY owner sets weights and reads the boards, and deliberately holds no `risk.act`: whoever writes the
  // rule does not also get to apply it by hand to a particular person. Same separation as platform_consent_author,
  // and for the same reason.
  platform_risk_policy: [OwnerPermissions.RiskRules, OwnerPermissions.ModerationRead, OwnerPermissions.RiskRead],
  platform_trust_safety_viewer: [OwnerPermissions.ModerationRead],   // T&S analyst — boards and trends, no person file
  // ADMIN-5f. The QUEUE desk works cases: it reads the boards, holds listings and decides reports. It does NOT hold
  // `moderation.messages` — reading a private thread is a decision somebody makes for a named reason, not a standing
  // capability of whoever is on shift.
  platform_moderation_desk: [OwnerPermissions.ModerationRead, OwnerPermissions.ModerationListings, OwnerPermissions.ModerationAppeals],
  // The SAFETY desk is the one that reads threads, because harassment cannot be judged without them.
  platform_safety_desk: [OwnerPermissions.ModerationRead, OwnerPermissions.ModerationListings, OwnerPermissions.ModerationMessages, OwnerPermissions.RiskRead, OwnerPermissions.ModerationAppeals, OwnerPermissions.SafetyDesk],
  // ADMIN-5e. The AUDITOR reads the trail and nothing else — the point of the role is that it can see every action
  // on the platform without being able to take one. `audit.values.read` is deliberately NOT here: reading a lifecycle
  // is the job, reading the values inside every change is a separate need with its own justification.
  platform_auditor: [OwnerPermissions.AuditRead],
  platform_audit_investigator: [OwnerPermissions.AuditRead, OwnerPermissions.AuditValuesRead],
  // Ledger corrections split across TWO roles that cannot be held usefully by one person, which is the entire
  // control: the investigator drafts and the controller posts. `ck_correction_maker_ne_checker` and the shared
  // two-person rule both refuse the overlap even if somebody is granted both.
  platform_ledger_investigator: [OwnerPermissions.LedgerInvestigate, OwnerPermissions.LedgerRead, OwnerPermissions.ReconRead, OwnerPermissions.AuditRead],
  platform_ledger_controller: [OwnerPermissions.LedgerCorrect, OwnerPermissions.LedgerRead, OwnerPermissions.ReconRead, OwnerPermissions.AuditRead, OwnerPermissions.AuditValuesRead],
  // ADMIN-6. W064: "auditor role gets read-only + export only." This role can see every transaction on the platform
  // and change nothing — which is what makes it safe to grant to somebody outside the money team.
  platform_ledger_auditor: [OwnerPermissions.LedgerRead, OwnerPermissions.ReconRead, OwnerPermissions.AuditRead],
  // ADMIN-6b. THE CHECKER ROLE DOES NOT INCLUDE THE MAKER'S GRANT, and that is not an oversight — a batch is opened by
  // the settlement/wage machinery or by an operator with `ledger.settle`, and approved here. Somebody holding both can
  // still be refused by `ck_payout_batches_maker_ne_checker` and by `assertSecondPerson`, so this separation is
  // convenience for an access review rather than the control itself. The control is in the database.
  platform_payout_checker: [OwnerPermissions.PayoutApprove, OwnerPermissions.LedgerRead, OwnerPermissions.SettlementRead],
  // Finance reads the settlement cycle and its statements and approves nothing — the commonest shape of request on this
  // plane, and previously impossible to grant because neither permission existed.
  platform_settlement_viewer: [OwnerPermissions.SettlementRead, OwnerPermissions.BillingRead],
  platform_settlement_ops: [OwnerPermissions.SettlementRead, OwnerPermissions.LedgerSettle, OwnerPermissions.BillingRead, OwnerPermissions.ReconRead],
});

/** Flatten a token's roles to a permission set against the static owner catalog (unknown roles grant nothing). */
/* ------------------------------------------------------------------------------------------------ */
/* PC-56 ADMIN-9 · READING the catalogue, so W105's matrix shows the thing that actually enforces     */
/* ------------------------------------------------------------------------------------------------ */
//
// W105 says it plainly in its own error state: "Enforcement reads from the compiled policy, not this view." That is
// true, and it is the reason the role editor can be built HONESTLY as a read and cannot be built at all as a write:
// this object IS the compiled policy. A console that appeared to grant a permission would be editing a frozen constant
// in a running process — the change would survive until the next request and nothing would have been granted.
//
// So the catalogue is exposed for projection. Deliberately a COPY, not the object: a caller that could mutate the map
// it was handed would be a caller that can escalate, and `Object.freeze` on the outer record does not freeze the arrays.
export interface OwnerRoleGrant { role: string; permissions: readonly string[]; isGodMode: boolean }

export function ownerRoleCatalogue(): OwnerRoleGrant[] {
  return Object.entries(OWNER_ROLE_GRANTS)
    .map(([role, perms]) => ({ role, permissions: [...perms], isGodMode: perms.includes('*') }))
    .sort((a, b) => a.role.localeCompare(b.role));
}

/** Every permission code the platform realm knows. The matrix's row set, and the allow-list a restriction is checked
 *  against — a restriction naming a code that does not exist would deny nothing while looking like a control. */
export function ownerPermissionCodes(): string[] {
  return [...new Set(Object.values(OwnerPermissions) as string[])].sort();
}

export function resolveOwnerPermissions(roles: string[]): Set<string> {
  const perms = new Set<string>();
  for (const r of roles) for (const p of OWNER_ROLE_GRANTS[r] ?? []) perms.add(p);
  return perms;
}
export function hasOwnerPermission(perms: Set<string>, needed: string): boolean { return perms.has('*') || perms.has(needed); }

export const REQUIRE_OWNER_PERMISSION = 'require_owner_permission';
export const RequireOwnerPermission = (perm: OwnerPermission) => SetMetadata(REQUIRE_OWNER_PERMISSION, perm);

/** Guard that THROWS (never logs) when the principal lacks the required owner permission (Law 6 / §4). */
@Injectable()
export class OwnerPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const needed = this.reflector.getAllAndOverride<string>(REQUIRE_OWNER_PERMISSION, [ctx.getHandler(), ctx.getClass()]);
    if (!needed) return true;
    const req = ctx.switchToHttp().getRequest();
    const perms: Set<string> = req.admin?.permissions ?? new Set();
    if (!hasOwnerPermission(perms, needed)) throw new ForbiddenException(`missing owner permission: ${needed}`);
    return true;
  }
}
