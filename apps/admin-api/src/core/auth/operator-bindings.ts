// apps/admin-api/src/core/auth/operator-bindings.ts · PC-56 ADMIN-AUTH-1 — WHO MAY BE AN OPERATOR, AND WITH WHICH ROLES.
//
// **CONFIG, NOT DATA.** `ADMIN_OPERATOR_BINDINGS` is a JSON array `[{ "email": "...", "roles": ["..."] }]` held in Secrets
// Manager and validated here at boot. Law 11 keeps the permission ceiling (owner-roles.ts) out of database rows: if a row
// could make somebody an operator or hand them a role, anything with a write grant on that row — a bug, a compromised
// service, a careless migration — would be a route into god mode. So changing who is an admin requires secret + deploy
// access, the same bar as changing what a role grants (a code review and a deploy). The database can still SUBTRACT
// (0118's deny-only restrictions and suspension apply on top of these roles); it can never add.
//
// Rules (fail-closed in production, loud in development):
//   • the value must be a JSON array of { email, roles[] } objects — malformed JSON is refused in every environment;
//   • emails are trimmed and lower-cased and must look like an address; a duplicate email is refused in every environment
//     (two bindings for one person would make "which roles does this login get" depend on array order);
//   • every role must exist in owner-roles.ts — unknown → boot refusal in production, a warning (and the role dropped,
//     since it would grant nothing anyway) in development;
//   • a binding with no (known) roles is refused in production — it would mint a token that can do nothing but log in;
//   • production refuses to boot with zero bindings (nobody could ever sign in).
import { ownerRoleCatalogue } from '../rbac/owner-roles';

export interface OperatorBinding { email: string; roles: string[] }

export interface BindingsParseResult {
  bindings: OperatorBinding[];
  /** Fatal in production (boot refusal); in development, `warnings` are printed and `errors` still throw. */
  errors: string[];
  warnings: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(e: string): string { return e.trim().toLowerCase(); }

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 0 ? '' : email.slice(at + 1).toLowerCase();
}

/** Parse + validate. Never throws: the caller (AdminConfig) decides what is fatal for its environment. */
export function parseOperatorBindings(raw: unknown, isProd: boolean): BindingsParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bindings: OperatorBinding[] = [];
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    if (isProd) errors.push('ADMIN_OPERATOR_BINDINGS is empty — production needs at least one operator binding (nobody could sign in)');
    return { bindings, errors, warnings };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { errors.push('ADMIN_OPERATOR_BINDINGS is not valid JSON (expected [{"email":"...","roles":["..."]}])'); return { bindings, errors, warnings }; }
  if (!Array.isArray(parsed)) {
    errors.push('ADMIN_OPERATOR_BINDINGS must be a JSON array of {"email","roles"} objects');
    return { bindings, errors, warnings };
  }
  const known = new Set(ownerRoleCatalogue().map((r) => r.role));
  const seen = new Set<string>();
  parsed.forEach((entry, i) => {
    const e = entry as { email?: unknown; roles?: unknown } | null;
    if (!e || typeof e !== 'object' || typeof e.email !== 'string' || !Array.isArray(e.roles)) {
      errors.push(`ADMIN_OPERATOR_BINDINGS[${i}] must be {"email": string, "roles": string[]}`);
      return;
    }
    const email = normaliseEmail(e.email);
    if (!EMAIL_RE.test(email)) { errors.push(`ADMIN_OPERATOR_BINDINGS[${i}] has an invalid email`); return; }
    if (seen.has(email)) { errors.push(`ADMIN_OPERATOR_BINDINGS has a duplicate binding for ${email}`); return; }
    seen.add(email);
    const roles: string[] = [];
    for (const r of e.roles) {
      const role = typeof r === 'string' ? r.trim() : '';
      if (!role) { errors.push(`ADMIN_OPERATOR_BINDINGS[${i}] has an empty/non-string role`); continue; }
      if (!known.has(role)) {
        const msg = `ADMIN_OPERATOR_BINDINGS[${i}] (${email}) names role "${role}", which does not exist in owner-roles.ts`;
        if (isProd) errors.push(msg); else warnings.push(`${msg} — dropped (it would grant nothing)`);
        continue;
      }
      if (!roles.includes(role)) roles.push(role);
    }
    if (roles.length === 0) {
      const msg = `ADMIN_OPERATOR_BINDINGS[${i}] (${email}) has no valid role`;
      if (isProd) errors.push(msg); else warnings.push(msg);
    }
    bindings.push({ email, roles });
  });
  if (isProd && bindings.length === 0 && errors.length === 0) errors.push('ADMIN_OPERATOR_BINDINGS has zero bindings');
  return { bindings, errors, warnings };
}

/** The binding for a verified email, or null. Exact match on the lower-cased address — no wildcard, no domain binding:
 *  "everybody at the company is an operator" is not a binding this realm can express, by design. */
export function bindingFor(bindings: readonly OperatorBinding[], email: string): OperatorBinding | null {
  const e = normaliseEmail(email);
  return bindings.find((b) => b.email === e) ?? null;
}
