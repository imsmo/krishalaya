// core/i18n/ui-message.repository.ts · PC-56 TENANT-6d-7 · reads `ui_messages` (0001), the platform's keyed string
// catalogue, which had a table and a mobile-app comment calling it *"the eventual source of truth"* and NO reader on
// the server at all.
//
// WHY A CORE REPOSITORY AND NOT A MODULE'S. `ui_messages` has no tenant column: it is platform vocabulary, like
// `languages` and `countries`. A word like *"evening"* is needed by the dairy module today and by logistics the moment
// a shipment notice names a window; putting the reader in dairy would mean the second caller either imports another
// module's repository (which CLAUDE.md forbids) or writes the query again (which is how this programme's last four
// duplicate-rule findings started).
//
// **A MISSING KEY IS AN ERROR AT THE CALL SITE, NOT AN EMPTY STRING HERE.** `langMapFrom` refuses a label with no
// English row, because the defect TENANT-6d-7 exists to close is precisely a variable that rendered as nothing.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../database/read-replica.provider';
import { TxContext } from '../database/unit-of-work';
import { LangMap, langMapFrom } from './lang-map';

@Injectable()
export class UiMessageRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * Every language of every key under one prefix, in ONE query.
   *
   * Prefix rather than key-by-key on purpose: a caller that needs `dairy.shift.morning` almost always needs
   * `dairy.shift.evening` in the same breath, and a notice to a village must not ask the database once per word.
   * `LIKE prefix || '%'` with a literal prefix is index-friendly on the (key, language_code) primary key.
   */
  async mapsUnder(prefix: string, x?: TxContext): Promise<Map<string, LangMap>> {
    const sql = `SELECT key, language_code, text FROM ui_messages WHERE key LIKE $1 || '%' ORDER BY key`;
    const r = x ? await x.query<{ key: string; language_code: string; text: string }>(sql, [prefix])
                : await this.replica.forTenant('').query<{ key: string; language_code: string; text: string }>(sql, [prefix]);
    const byKey = new Map<string, Map<string, string>>();
    for (const row of r.rows) {
      const m = byKey.get(row.key) ?? new Map<string, string>();
      m.set(row.language_code, row.text);
      byKey.set(row.key, m);
    }
    const out = new Map<string, LangMap>();
    for (const [key, rows] of byKey) out.set(key, langMapFrom(rows, key));
    return out;
  }

  /** One key, every language. Throws when the platform holds no English text for it — see the header. */
  async map(key: string, x?: TxContext): Promise<LangMap> {
    const all = await this.mapsUnder(key, x);
    const m = all.get(key);
    if (!m) throw new Error(`i18n: ui_messages has no rows for '${key}'`);
    return m;
  }
}
