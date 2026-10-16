// core/http/__tests__/query-boolean.spec.ts · PC-56 HOTFIX-6 · B6 — the ONE strict query-string boolean, and the two DTOs that now use it.
import { parseQueryBoolean, queryBoolean } from '../query-boolean';
import { QueryNotificationsSchema } from '../../../modules/communication/dto/query-notification.dto';
import { QueryConversationsSchema } from '../../../modules/communication/dto/query-conversation.dto';

describe('HOTFIX-6 · strict query booleans', () => {
  it('true / 1 → true; false / 0 → false; anything else → null (refused)', () => {
    expect(['true', '1', 'false', '0'].map(parseQueryBoolean)).toEqual([true, true, false, false]);
    for (const v of ['', 'yes', 'no', 'maybe', 'TRUE', ' true', 2, null, {}]) expect([v, parseQueryBoolean(v)]).toEqual([v, null]);
    expect([parseQueryBoolean(true), parseQueryBoolean(false)]).toEqual([true, false]);
  });
  it('the zod field: "false" is false (z.coerce.boolean read it as TRUE); an unknown spelling fails', () => {
    expect(queryBoolean().parse('false')).toBe(false);
    expect(queryBoolean().parse('1')).toBe(true);
    expect(queryBoolean().safeParse('maybe').success).toBe(false);
    expect(queryBoolean().optional().parse(undefined)).toBeUndefined();
  });
  it('notifications `unreadOnly` and conversations `archived` read strictly', () => {
    expect(QueryNotificationsSchema.parse({ unreadOnly: 'false' }).unreadOnly).toBe(false);
    expect(QueryNotificationsSchema.parse({ unreadOnly: 'true' }).unreadOnly).toBe(true);
    expect(QueryNotificationsSchema.parse({}).unreadOnly).toBeUndefined();
    expect(QueryNotificationsSchema.safeParse({ unreadOnly: 'maybe' }).success).toBe(false);
    expect(QueryConversationsSchema.parse({ archived: 'false' }).archived).toBe(false);
    expect(QueryConversationsSchema.parse({}).archived).toBe(false);
    expect(QueryConversationsSchema.parse({ archived: '1' }).archived).toBe(true);
    expect(QueryConversationsSchema.safeParse({ archived: 'yes' }).success).toBe(false);
  });
});
