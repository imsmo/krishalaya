// modules/identity/domain/consent.entity.ts · DPDP consent record (APPEND-ONLY history).
// Changing a consent is a NEW row, never an update — the full history is the audit trail.
export interface ConsentProps {
  id: string; userId: string; purposeCode: string; version: string; granted: boolean;
  channel: string; assistedBy: string | null;
  /** The version ROW whose words this person agreed to (migration 0108). NULL only when no published version exists for
   *  the purpose — before 0108 `version` was a label pointing at a mutable column, so the words of any superseded
   *  version were overwritten and are gone. NEVER read NULL as "the current version". */
  consentPurposeVersionId: string | null;
}
export class Consent {
  constructor(readonly props: ConsentProps) {}
  static record(input: ConsentProps): Consent { return new Consent(input); }
}
