// apps/web-storefront/src/features/legal/tokens.ts · PC-56 LEGAL-1 — THE COMPANY'S FACTS INSIDE A POLICY. PURE (no React, no IO).
//
// A policy body may name the platform's published facts (migration 0223 — `storefront.platformFacts()`) as tokens, e.g.
// `{{platform.grievance.email}}`. Exactly the eleven PlatformFacts fields are tokens (POLICY_TOKENS); each is read through `factLine`
// (features/sweep/facts.ts), so a SET fact prints its value and an EMPTY one — or a facts read that failed — prints the localized
// "not published yet" (the page never fails, and never prints a placeholder value).
// SAFETY: substitution runs on the parsed tree's TEXT nodes (markdown.ts has already run), so a fact value is only ever text — a value holding
// `[a](javascript:x)` or `**` is printed as those characters, never read as markdown. An unknown token (`{{anything.else}}`) stays literal text.
// Whitespace inside the braces is allowed (`{{ platform.grievance.email }}`). A mailbox fact is marked `mail` so the renderer may link it with
// the existing `mailtoHref` (a render decision, never injected markdown).
import type { PlatformFacts } from '@krishalaya/sdk-js';
import { factLine, type FactLine } from '../sweep/facts';
import type { Block, Inline } from './markdown';

type Pick = (f: PlatformFacts) => string | number | null | undefined;
/** Token name → the PlatformFacts field it prints, and whether it is a mailbox. */
export const POLICY_TOKENS: Readonly<Record<string, { read: Pick; mail: boolean }>> = Object.freeze({
  'platform.legal.entity_name': { read: (f) => f.legal.entityName, mail: false },
  'platform.legal.registered_office': { read: (f) => f.legal.registeredOffice, mail: false },
  'platform.grievance.officer_name': { read: (f) => f.grievance.officerName, mail: false },
  'platform.grievance.address': { read: (f) => f.grievance.address, mail: false },
  'platform.grievance.email': { read: (f) => f.grievance.email, mail: true },
  'platform.grievance.ack_hours': { read: (f) => f.grievance.ackHours, mail: false },
  'platform.grievance.resolve_days': { read: (f) => f.grievance.resolveDays, mail: false },
  'platform.contact.security_email': { read: (f) => f.contact.securityEmail, mail: true },
  'platform.contact.partners_email': { read: (f) => f.contact.partnersEmail, mail: true },
  'platform.contact.press_email': { read: (f) => f.contact.pressEmail, mail: true },
  'platform.contact.general_email': { read: (f) => f.contact.generalEmail, mail: true },
});

/** A text node after substitution: plain text, or one fact. */
export type TokenInline = { t: 'text'; v: string } | { t: 'fact'; name: string; line: FactLine; mail: boolean };
export type FactInline =
  | TokenInline
  | { t: 'strong'; c: FactInline[] }
  | { t: 'em'; c: FactInline[] }
  | { t: 'link'; href: string; external: boolean; c: FactInline[] };
export type FactBlock =
  | { t: 'heading'; level: 2 | 3 | 4; id: string; c: FactInline[] }
  | { t: 'paragraph'; c: FactInline[] }
  | { t: 'list'; ordered: boolean; start: number; items: FactInline[][] }
  | { t: 'rule' };

const TOKEN = /\{\{[ \t]*([A-Za-z0-9_.]{1,80})[ \t]*\}\}/g;

/** One text → text / fact pieces. `facts` null = the facts read failed (every known token reads "not published yet"). */
export function substituteText(v: string, facts: PlatformFacts | null): TokenInline[] {
  const out: TokenInline[] = [];
  let last = 0;
  let buf = '';
  for (const m of v.matchAll(TOKEN)) {
    const def = Object.prototype.hasOwnProperty.call(POLICY_TOKENS, m[1]) ? POLICY_TOKENS[m[1]] : undefined;
    if (!def) continue;   // unknown: left in the text, literally
    buf += v.slice(last, m.index);
    if (buf) { out.push({ t: 'text', v: buf }); buf = ''; }
    out.push({ t: 'fact', name: m[1], line: facts ? factLine(def.read(facts)) : { kind: 'unpublished' }, mail: def.mail });
    last = (m.index ?? 0) + m[0].length;
  }
  buf += v.slice(last);
  if (buf) out.push({ t: 'text', v: buf });
  return out;
}

function inlines(nodes: Inline[], facts: PlatformFacts | null): FactInline[] {
  return nodes.flatMap((n): FactInline[] => {
    if (n.t === 'text') return substituteText(n.v, facts);
    if (n.t === 'link') return [{ t: 'link', href: n.href, external: n.external, c: inlines(n.c, facts) }];
    return [{ t: n.t, c: inlines(n.c, facts) }];
  });
}

/** The parsed policy with every known token replaced by its fact. */
export function substituteTokens(blocks: Block[], facts: PlatformFacts | null): FactBlock[] {
  return blocks.map((b): FactBlock => {
    if (b.t === 'heading') return { ...b, c: inlines(b.c, facts) };
    if (b.t === 'paragraph') return { t: 'paragraph', c: inlines(b.c, facts) };
    if (b.t === 'list') return { ...b, items: b.items.map((it) => inlines(it, facts)) };
    return b;
  });
}
