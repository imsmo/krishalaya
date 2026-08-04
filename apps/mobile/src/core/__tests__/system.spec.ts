// Unit tests for the PURE system/search logic (features/system/system). No React/native deps (SDK/ui types are
// type-only). Covers global-search merge + local filter (ReDoS-safe), semver compare + forced-update decision,
// the permission catalog key builders, and DPDP delete-confirmation. The server owns search authority, DPDP, and
// the minimum supported version — these helpers only drive the UI.
import {
  normalizeQuery, mergeSearchResults, compareVersions, isUpdateRequired,
  PERMISSIONS, permissionsByGroup, permissionTitleKey, permissionWhyKey, deleteConfirmationOk,
  orderedLanguageCodes, languageSubKey,
  classifyFallback, safeErrorRef,
  DELETE_REASONS, deleteReasonLabelKey, hasWithdrawableBalance, composeDeleteReason,
  CONSENT_TOGGLES, consentLabelKey, consentHintKey, consentGranted,
  EXPORT_FORMATS, exportFormatLabelKey,
  fromUnifiedSearch, searchKindIcon, searchTabs, filterHits, type SearchHit,
  messageCategory, messageTabs, filterConversationsByTab, archivedConversations,
  conversationPreview, unreadTotal,
  canSubmitFeedback, composeFeedback, FEEDBACK_FEATURES,
  languagesSummary,
} from '../../features/system/system';
import type { ListingCard, OrderListItem } from '@krishalaya/sdk-js';

const listing = (over: Partial<ListingCard>): ListingCard => ({
  id: 'l1', title: 'Tomato', priceMinor: '1000', currencyCode: 'INR', unitCode: 'kg', quantityAvailable: 5,
  organicClaim: false, saleType: 'fixed', regionId: null, sellerUserId: 'u1', boosted: false, ...over,
});
const order = (over: Partial<OrderListItem>): OrderListItem => ({ id: 'o1', orderNo: 'ORD-1', status: 'placed', totalMinor: '5000', counterparty: 'Ram', ...over });

describe('normalizeQuery', () => {
  it('trims, collapses, lowercases, caps', () => {
    expect(normalizeQuery('  Tom  ato ')).toBe('tom ato');
    expect(normalizeQuery(null)).toBe('');
    expect(normalizeQuery('x'.repeat(120)).length).toBe(80);
  });
});

describe('mergeSearchResults', () => {
  it('filters listings by title + orders by no/status/counterparty; listings first', () => {
    const hits = mergeSearchResults([listing({ id: 'a', title: 'Tomato' }), listing({ id: 'b', title: 'Wheat' })], [order({ id: 'o', orderNo: 'ORD-9', status: 'placed', counterparty: 'Tomato Traders' })], 'tomato');
    expect(hits.map((h) => `${h.kind}:${h.id}`)).toEqual(['listing:a', 'order:o']);
  });
  it('treats the query as a literal (no regex injection)', () => {
    expect(mergeSearchResults([listing({ title: 'a.b' })], [], '.*')).toEqual([]);
  });
  it('empty query returns everything (capped)', () => {
    const many = Array.from({ length: 60 }, (_, i) => listing({ id: `l${i}`, title: `t${i}` }));
    expect(mergeSearchResults(many, [], '').length).toBe(50);
  });
});

describe('compareVersions / isUpdateRequired', () => {
  it('compares numerically', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });
  it('forces update only when a min is set and current is below it', () => {
    expect(isUpdateRequired('1.0.0', undefined)).toBe(false);
    expect(isUpdateRequired('1.0.0', null)).toBe(false);
    expect(isUpdateRequired('1.0.0', '1.2.0')).toBe(true);
    expect(isUpdateRequired('1.3.0', '1.2.0')).toBe(false);
  });
});

describe('permission catalog', () => {
  it('has entries with stable key builders', () => {
    expect(PERMISSIONS.length).toBeGreaterThan(0);
    expect(permissionTitleKey('camera')).toBe('system.permissions.camera.title');
    expect(permissionWhyKey('location')).toBe('system.permissions.location.why');
  });
  it('groups required vs optional', () => {
    expect(permissionsByGroup('required').map((p) => p.key)).toEqual(['sms', 'camera', 'microphone']);
    expect(permissionsByGroup('optional').map((p) => p.key)).toEqual(['location', 'notifications']);
  });
});

describe('language display order', () => {
  it('orders supported codes gu → hi → en', () => {
    expect(orderedLanguageCodes(['hi', 'en', 'gu'])).toEqual(['gu', 'hi', 'en']);
    expect(languageSubKey('gu')).toBe('system.language.sub.gu');
  });
});

describe('messages inbox categories', () => {
  const c = (contextType: string) => ({ id: contextType, contextType });
  it('maps contextType to a design category', () => {
    expect(messageCategory('order')).toBe('buyers');
    expect(messageCategory('requirement')).toBe('buyers');
    expect(messageCategory('booking')).toBe('workers');
    expect(messageCategory('support_ticket')).toBe('support');
    expect(messageCategory('dispute')).toBe('support');
    expect(messageCategory('mystery')).toBe('other');
  });
  it('messageTabs = All + present categories with real counts', () => {
    const tabs = messageTabs([c('order'), c('order'), c('booking'), c('support_ticket')]);
    expect(tabs).toEqual([
      { key: 'all', count: 4 }, { key: 'buyers', count: 2 }, { key: 'workers', count: 1 }, { key: 'support', count: 1 },
    ]);
  });
  it('filterConversationsByTab filters; all → everything', () => {
    const list = [c('order'), c('booking')];
    expect(filterConversationsByTab(list, 'all')).toHaveLength(2);
    expect(filterConversationsByTab(list, 'workers').map((x) => x.id)).toEqual(['booking']);
  });
});

describe('message archive', () => {
  it('keeps only locked threads, newest first', () => {
    const list = [
      { id: 'a', isLocked: true, createdAt: '2026-03-01T00:00:00Z' },
      { id: 'b', isLocked: false, createdAt: '2026-05-01T00:00:00Z' },
      { id: 'c', isLocked: true, createdAt: '2026-05-01T00:00:00Z' },
    ];
    expect(archivedConversations(list).map((x) => x.id)).toEqual(['c', 'a']);
  });
  it('empty when nothing is locked', () => {
    expect(archivedConversations([{ id: 'x', isLocked: false }] as any)).toEqual([]);
  });
});

describe('conversation summary rendering (P0-1)', () => {
  it('previews text, else 📷/🎤 kind, else none', () => {
    expect(conversationPreview({ lastMessageBody: '  hi there ' })).toEqual({ kind: 'text', text: 'hi there' });
    expect(conversationPreview({ lastMessageBody: '', lastMessageHasVoice: true })).toEqual({ kind: 'voice', text: '' });
    expect(conversationPreview({ lastMessageHasAttachment: true })).toEqual({ kind: 'photo', text: '' });
    expect(conversationPreview({})).toEqual({ kind: 'none', text: '' });
  });
  it('unreadTotal sums, clamping junk to 0', () => {
    expect(unreadTotal([{ unreadCount: 3 }, { unreadCount: 2 }, {}])).toBe(5);
    expect(unreadTotal([{ unreadCount: -4 }, { unreadCount: NaN as unknown as number }])).toBe(0);
  });
});

describe('feedback CTA', () => {
  it('submit-gate requires a 1–5 rating', () => {
    expect(canSubmitFeedback(0)).toBe(false);
    expect(canSubmitFeedback(3)).toBe(true);
    expect(canSubmitFeedback(5)).toBe(true);
    expect(canSubmitFeedback(6)).toBe(false);
    expect(canSubmitFeedback(2.5)).toBe(false);
  });
  it('composes a bounded ticket subject', () => {
    expect(composeFeedback(4, ['voice', 'mandi'], '  weather off  ')).toBe('Rating 4/5 | Likes: voice, mandi | Improve: weather off');
    expect(composeFeedback(5, [], '')).toBe('Rating 5/5');
    expect(composeFeedback(9, [], '')).toBe('Rating 5/5'); // clamped
    expect(composeFeedback(3, [], 'x'.repeat(400)).length).toBe(250); // truncated
  });
  it('ships the fixed feature set', () => {
    expect(FEEDBACK_FEATURES).toContain('voice');
    expect(FEEDBACK_FEATURES.length).toBe(6);
  });
});

describe('about — languages summary', () => {
  it('derives count + uppercase codes from the registry', () => {
    expect(languagesSummary([{ code: 'hi' }, { code: 'en' }, { code: 'gu' }])).toBe('3 (HI, EN, GU)');
    expect(languagesSummary([{ code: 'en' }])).toBe('1 (EN)');
  });
});

describe('deleteConfirmationOk', () => {
  it('matches the expected word case-insensitively; rejects mismatch/blank', () => {
    expect(deleteConfirmationOk('delete', 'DELETE')).toBe(true);
    expect(deleteConfirmationOk('  DELETE ', 'DELETE')).toBe(true);
    expect(deleteConfirmationOk('nope', 'DELETE')).toBe(false);
    expect(deleteConfirmationOk('', 'DELETE')).toBe(false);
    expect(deleteConfirmationOk('delete', '')).toBe(false);
  });
});

describe('account-delete reasons + balance', () => {
  it('exposes the six reasons with stable label keys', () => {
    expect(DELETE_REASONS).toEqual(['notUsing', 'alternative', 'privacy', 'featurePhone', 'badExperience', 'other']);
    expect(deleteReasonLabelKey('privacy')).toBe('accountDelete.reason.privacy');
  });
  it('hasWithdrawableBalance is true only for a positive integer minor string', () => {
    expect(hasWithdrawableBalance('885000')).toBe(true);
    expect(hasWithdrawableBalance('0')).toBe(false);
    expect(hasWithdrawableBalance('-100')).toBe(false);
    expect(hasWithdrawableBalance('12.5')).toBe(false);
    expect(hasWithdrawableBalance(undefined)).toBe(false);
  });
  it('composeDeleteReason joins code + optional feedback', () => {
    expect(composeDeleteReason('privacy', '')).toBe('privacy');
    expect(composeDeleteReason('privacy', '  too much spam ')).toBe('privacy: too much spam');
    expect(composeDeleteReason('', 'just because')).toBe('just because');
  });
});

describe('privacy consent toggles', () => {
  it('lists six toggles across two groups with stable keys', () => {
    expect(CONSENT_TOGGLES).toHaveLength(6);
    expect(CONSENT_TOGGLES.filter((x) => x.group === 'profile')).toHaveLength(3);
    expect(CONSENT_TOGGLES.filter((x) => x.group === 'data')).toHaveLength(3);
    expect(consentLabelKey('marketing_comms')).toBe('privacySettings.toggle.marketing_comms');
    expect(consentHintKey('marketing_comms')).toBe('privacySettings.hint.marketing_comms');
  });
  it('consentGranted reads the server list; opt-in default false', () => {
    const list = [{ purposeCode: 'marketing_comms', granted: true }, { purposeCode: 'research_sharing', granted: false }];
    expect(consentGranted(list, 'marketing_comms')).toBe(true);
    expect(consentGranted(list, 'research_sharing')).toBe(false);
    expect(consentGranted(list, 'unknown')).toBe(false);
    expect(consentGranted(null, 'marketing_comms')).toBe(false);
  });
});

describe('search tabs + hit mapping', () => {
  const hit = (kind: SearchHit['kind'], id: string): SearchHit => ({ kind, id, title: id });
  it('fromUnifiedSearch maps known types, lifts ref money, drops unknown', () => {
    const out = fromUnifiedSearch([
      { type: 'listings', id: 'l1', title: 'Wheat', createdAt: '', score: 1, ref: { priceMinor: '288000', currencyCode: 'INR', unitCode: 'qtl', sellerName: 'Ramesh' } },
      { type: 'sellers', id: 's1', title: 'Krishna', createdAt: '', score: 1 },
      { type: 'weirdthing', id: 'x', title: 'X', createdAt: '', score: 1 },
    ] as never);
    expect(out.map((h) => h.kind)).toEqual(['listing', 'seller']);
    expect(out[0].priceMinor).toBe('288000');
    expect(out[0].note).toBe('Ramesh');
  });
  it('fromUnifiedSearch rejects a float price (Law 2)', () => {
    const out = fromUnifiedSearch([{ type: 'listings', id: 'l', title: 'W', createdAt: '', score: 1, ref: { priceMinor: '2880.50' } }] as never);
    expect(out[0].priceMinor).toBeUndefined();
  });
  it('searchTabs = All + present kinds in design order with real counts', () => {
    const tabs = searchTabs([hit('listing', 'a'), hit('listing', 'b'), hit('tip', 'c'), hit('seller', 'd')]);
    expect(tabs).toEqual([
      { key: 'all', count: 4 }, { key: 'listing', count: 2 }, { key: 'seller', count: 1 }, { key: 'tip', count: 1 },
    ]);
  });
  it('filterHits filters by tab; all → everything', () => {
    const hits = [hit('listing', 'a'), hit('tip', 'b')];
    expect(filterHits(hits, 'all')).toHaveLength(2);
    expect(filterHits(hits, 'tip').map((h) => h.id)).toEqual(['b']);
  });
  it('searchKindIcon covers each kind', () => {
    expect(searchKindIcon('listing')).toBe('🌾');
    expect(searchKindIcon('mandi')).toBe('📊');
    expect(searchKindIcon('tip')).toBe('💡');
    expect(searchKindIcon('seller')).toBe('👤');
  });
});

describe('export formats', () => {
  it('offers CSV+JSON and PDF with stable label keys', () => {
    expect(EXPORT_FORMATS).toEqual(['data', 'pdf']);
    expect(exportFormatLabelKey('data')).toBe('dataDownload.format.data');
    expect(exportFormatLabelKey('pdf')).toBe('dataDownload.format.pdf');
  });
});

describe('classifyFallback', () => {
  it('routes network/timeout errors to the offline fallback', () => {
    expect(classifyFallback({ name: 'SdkNetworkError' })).toBe('offline');
    expect(classifyFallback({ name: 'SdkTimeoutError' })).toBe('offline');
  });
  it('routes everything else (5xx, unknown, render crash) to the server fallback', () => {
    expect(classifyFallback({ name: 'SdkError', status: 500 })).toBe('server');
    expect(classifyFallback(new Error('boom'))).toBe('server');
    expect(classifyFallback(null)).toBe('server');
    expect(classifyFallback('weird')).toBe('server');
  });
});

describe('safeErrorRef', () => {
  it('returns the SDK requestId when present (bounded), null otherwise — never leaks other fields', () => {
    expect(safeErrorRef({ requestId: 'req-123' })).toBe('req-123');
    expect(safeErrorRef({ requestId: '  req-9  ' })).toBe('req-9');
    expect(safeErrorRef({ requestId: 'x'.repeat(200) })).toHaveLength(64);
    expect(safeErrorRef({ message: 'secret', code: 'X' })).toBeNull();
    expect(safeErrorRef({ requestId: '' })).toBeNull();
    expect(safeErrorRef(null)).toBeNull();
    expect(safeErrorRef(new Error('boom'))).toBeNull();
  });
});
