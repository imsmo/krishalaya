// apps/admin-api/src/core/auth/dev-login.controller.ts · DEV-56 Part 3 — a dev-ONLY way into the god-mode realm.
//
// WHY THIS EXISTS. Production entry is `login/page.tsx`'s link to `${adminApiUrl}/auth/sso/start`, which is meant to
// redirect to the real admin IdP after a FIDO2/hardware-key ceremony (Law 11) — that route/IdP integration does not
// exist anywhere in this codebase yet (grep-verified: no controller anywhere registers `auth/sso/start`), so today
// there is NO way for the founder to reach the console on his own machine: no seeded operator, no bypass, nothing.
// The only workaround before this file was hand-minting a JWT with a one-off script and setting the `kva_session`
// cookie by hand — undocumented and not repeatable.
//
// WHAT THIS ADDS: one endpoint that mints the EXACT token shape `admin-jwt.strategy.ts`'s `verifyAdminToken()`
// requires (HS256; `iss`/`aud` pinned to THIS process's own issuer/audience; `sub`/`roles`/`amr`/`auth_time`/`sid`/
// `exp`) using this process's own `ADMIN_JWT_SECRET` — a token minted here verifies exactly the same way a real
// IdP-issued one would, so every downstream guard (`AdminAuthGuard`, `OwnerPermissionsGuard`, `HardwareKeyGuard`,
// `StepUpReauthGuard`) sees a real, indistinguishable principal, not a stub.
//
// `platform_operators` NEEDS NO PRE-SEEDED ROW: `accessVerdict()` (`operator-access.ts`) admits an operator the
// realm has never seen before on their first request BY DESIGN ("their token is valid, the realm has simply never
// seen them before... refusing first-sightings would mean nobody could ever sign in") and `AdminAuthGuard`'s
// `canActivate()` calls `registry.observe()` immediately afterwards — the existing, already-proven first-sighting
// provisioning path. This endpoint deliberately does not touch that table itself.
//
// `super_admin` IS A REAL ROW IN `owner-roles.ts`'s OWN CATALOGUE (`OWNER_ROLE_GRANTS.super_admin = ['*']`) — the
// platform-owner RBAC catalogue for THIS realm (Law 11: never the tenant DB's `roles` table, which happens to carry
// a same-named but administratively unrelated row) — so the minted token's `roles: ['super_admin']` claim resolves
// to real god-mode permissions, not an invented name.
//
// WHY THIS IS SAFE TO SHIP (Law 8 — impossible to enable in production, not merely "off by default" convention):
//   1. `ADMIN_DEV_LOGIN_ENABLED` defaults to `false` (`admin-config.ts`).
//   2. `AdminConfig.assertProductionSecurity()` THROWS AT BOOT (refuses to start the process) if this flag is ever
//      `true` while `NODE_ENV==='production'` — mirroring `apps/api`'s own `AUTH_EXPOSE_OTP` production guard
//      exactly (`apps/api/src/core/config/app-config.ts`: "AUTH_EXPOSE_OTP must be false in production").
//   3. This handler ALSO checks `NODE_ENV !== 'production'` itself, redundantly, belt-and-braces on the realm's
//      front door in case a future refactor ever weakens the boot-time assertion.
//   4. LOOPBACK-ONLY: refuses any request whose remote address is not 127.0.0.1/::1, so even a process that somehow
//      had this flag on could not be reached over a network — only from the machine running it. A founder on his
//      own laptop is the only real caller this was built for.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it does not touch `login/page.tsx`'s production IdP link (untouched — still
// points at the real `auth/sso/start` path so the production flow is never pretended to exist), and it does not
// simulate an IdP integration — this is a clearly-labelled bypass, not a stub of the real thing.
import { Controller, ForbiddenException, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, randomUUID } from 'node:crypto';
import { AdminConfig } from '../config/admin-config';

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The fixed dev identity this endpoint always mints — deliberately a recognisable, non-random sentinel (never a
 *  real farmer/operator UUID) so anyone reading `platform_operators` or the audit trail on a founder's machine can
 *  tell at a glance this row came from the dev bypass, not a real IdP-authenticated human.
 *  [QA-FIX 2026-07-30] The literal originally shipped here — '00000000-0000-0000-0000-00000000dev1' — is NOT a
 *  valid UUID: its trailing 'v' is not a hex digit (0-9a-f), so Postgres's `uuid` column type rejects it outright.
 *  This was never caught by a static read because minting only builds a JWT string; it broke the FIRST time this
 *  QA pass actually booted admin-api and called a real guarded endpoint (`AdminAuthGuard` passes `principal.userId`
 *  straight into `OperatorRegistryRepository.accessInputs()`'s parameterized `uuid` query) — every single route
 *  behind `AdminAuthGuard` 500'd with `22P02 invalid input syntax for type uuid`, live-reproduced, not theoretical.
 *  Replaced with the classic all-hex `deadbeef` placeholder — still instantly recognisable as a sentinel, and a
 *  valid UUID. See dev56_report.md/DEV_TRACKER.md for the reproduction. */
const DEV_ADMIN_USER_ID = 'deadbeef-0000-0000-0000-000000000001';
const DEV_SESSION_MAX_AGE_SEC = 8 * 3600; // 8-hour dev session: long enough for a working day, short enough to force a fresh mint the next day

export interface DevLoginResponse { token: string; maxAgeSec: number; userId: string; roles: string[] }

@Controller('auth')
export class DevLoginController {
  constructor(private readonly config: AdminConfig) {}

  @Get('dev-login')
  devLogin(@Req() req: Request): DevLoginResponse {
    // Redundant with assertProductionSecurity()'s boot-time refusal — belt-and-braces (see file header point 3).
    if (this.config.env.NODE_ENV === 'production') {
      throw new ForbiddenException('dev login is never available in production');
    }
    if (!this.config.env.ADMIN_DEV_LOGIN_ENABLED) {
      throw new ForbiddenException('dev login is disabled — set ADMIN_DEV_LOGIN_ENABLED=true locally to use it');
    }

    const ip = String(req.ip ?? req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (ip !== '127.0.0.1' && ip !== '::1') {
      throw new ForbiddenException('dev login only answers requests from the machine running this process (loopback only)');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    // Shape pinned EXACTLY to what admin-jwt.strategy.ts#verifyAdminToken reads: iss/aud checked against this same
    // process's config.jwt; roles resolved by resolveOwnerPermissions() (owner-roles.ts); amr/auth_time read by the
    // step-up guard; sid read by the session registry.
    const payload = b64url(Buffer.from(JSON.stringify({
      iss: this.config.jwt.issuer,
      aud: this.config.jwt.audience,
      sub: DEV_ADMIN_USER_ID,
      roles: ['super_admin'],   // real row in owner-roles.ts's OWN catalogue — see file header
      // Never 'hwk' — this identity never performed a hardware-key ceremony. A route gated on
      // ADMIN_REQUIRE_HARDWARE_KEY (off by default outside production) would still correctly refuse this
      // principal if that flag were ever turned on locally.
      amr: ['dev-bypass'],
      auth_time: nowSec,
      sid: randomUUID(),
      exp: nowSec + DEV_SESSION_MAX_AGE_SEC,
    })));
    const sig = b64url(createHmac('sha256', this.config.jwt.secret).update(`${header}.${payload}`).digest());
    return { token: `${header}.${payload}.${sig}`, maxAgeSec: DEV_SESSION_MAX_AGE_SEC, userId: DEV_ADMIN_USER_ID, roles: ['super_admin'] };
  }
}
