// apps/web-storefront/src/features/sweep/facts.ts · PC-56 STORE-SWEEP-a · C1 (founder D3 / D7) — THE FACTS ARE DATA. PURE.
//
// The Trust, Contact, About and Press pages print the platform's published facts (`storefront.platformFacts()`, migration 0223): each one WHEN
// SET, and an honest "not published yet" line per fact when it is empty — never a placeholder value, never a domain literal, never the canon's
// "48 hours / 30 days / Indian intermediary rules" figures. The API already answers null for an empty value; `factLine` re-checks (a blank
// string, a non-string, a figure that is not a whole number ≥ 1 are all "unpublished") so a page can never print an empty mailbox.
// A FAILED read is not "unpublished": the page says the details could not be loaded (ERROR ≠ EMPTY — features/home/load-result.ts).
import type { PlatformFacts } from '@krishalaya/sdk-js';

export type FactLine = { kind: 'set'; value: string } | { kind: 'unpublished' };

/** One fact as the page prints it. */
export function factLine(v: string | number | null | undefined): FactLine {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 ? { kind: 'set', value: String(v) } : { kind: 'unpublished' };
  if (typeof v !== 'string') return { kind: 'unpublished' };
  const s = v.trim();
  return s.length > 0 ? { kind: 'set', value: s } : { kind: 'unpublished' };
}

/** A mailbox fact is a `mailto:` link only when it looks like one address (no spaces, one @); otherwise it is printed as text. */
export function mailtoHref(line: FactLine): string | null {
  return line.kind === 'set' && /^[^\s@<>"']+@[^\s@<>"']+$/.test(line.value) ? `mailto:${line.value}` : null;
}

export type GrievanceFact = 'officer' | 'address' | 'email' | 'ack' | 'resolve';
/** The grievance block, in order: the officer, the postal address, the mailbox, the acknowledgement and resolution figures (only those set
 *  print a figure; the rest say "not published yet"). */
export function grievanceLines(f: PlatformFacts): Array<{ id: GrievanceFact; line: FactLine }> {
  return [
    { id: 'officer', line: factLine(f.grievance.officerName) },
    { id: 'address', line: factLine(f.grievance.address) },
    { id: 'email', line: factLine(f.grievance.email) },
    { id: 'ack', line: factLine(f.grievance.ackHours) },
    { id: 'resolve', line: factLine(f.grievance.resolveDays) },
  ];
}

export type Mailbox = 'general' | 'press' | 'partners' | 'security' | 'grievance';
/** The five mailboxes the platform's Contact page lists (D7: they come ONLY from this read — no `@` in code, catalogues or tests). */
export function mailboxLines(f: PlatformFacts): Array<{ id: Mailbox; line: FactLine }> {
  return [
    { id: 'general', line: factLine(f.contact.generalEmail) },
    { id: 'press', line: factLine(f.contact.pressEmail) },
    { id: 'partners', line: factLine(f.contact.partnersEmail) },
    { id: 'security', line: factLine(f.contact.securityEmail) },
    { id: 'grievance', line: factLine(f.grievance.email) },
  ];
}

export type LegalFact = 'entity' | 'office';
export function legalLines(f: PlatformFacts): Array<{ id: LegalFact; line: FactLine }> {
  return [
    { id: 'entity', line: factLine(f.legal.entityName) },
    { id: 'office', line: factLine(f.legal.registeredOffice) },
  ];
}
