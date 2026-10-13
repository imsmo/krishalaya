// apps/web-storefront/src/lib/server-env.ts · PC-56 STORE-1a · C2 — the storefront's SERVER-ONLY settings. Never NEXT_PUBLIC_*, never
// imported by a client component (`server-only` makes that a build error). lib/env.ts stays the public half.
import 'server-only';

const secret = process.env.STOREFRONT_CALLER_SECRET ?? '';

export const serverEnv = {
  /** Shared with the API (its STOREFRONT_CALLER_SECRET): signs the buyer's address on every API call. Shorter than 32 = treated as unset
   *  (the API refuses such a secret, so signing with it would only ever be ignored). Unset = no address forwarded. */
  callerSecret: secret.length >= 32 ? secret : '',
  /** '1' = one trusted edge proxy that OVERWRITES x-forwarded-for sits in front of the storefront (see lib/caller-sign.ts). */
  trustProxy: process.env.STOREFRONT_TRUST_PROXY === '1',
} as const;
