// core/webhooks/__tests__/admin11c-inbound-receipts.spec.ts · PC-56 ADMIN-11c.
//
// **THE SINKS VERIFIED CORRECTLY AND THREW THE BYTES AWAY.** `inbound_webhooks` existed from migration 0015 with no
// reader and no writer anywhere in the monorepo, while W106 promised "raw payloads stored pre-processing — replayable,
// audit-grade". A rejected signature left no trace at all, which is the one event that most needs one.
import { MAX_STORED_BYTES, preparePayload, statusFor } from '../inbound-webhook.recorder';

describe('ADMIN-11c · a payload is stored in a form a reviewer can use', () => {
  it('parses a normal provider callback', () => {
    const r = preparePayload('{"event":"payment.captured","payload":{"amount":1245000}}');
    expect(r.truncated).toBe(false);
    expect((r.payload as { event: string }).event).toBe('payment.captured');
    expect(r.rawBytes).toBe(57);
  });

  // **AN UNAUTHENTICATED SINK IS AN UNBOUNDED WRITE PATH.** Recording rejected payloads is exactly what this module is
  // for, and it is also how a stranger fills a partitioned table with 10 MB bodies.
  it('caps an oversized body and SAYS it was capped', () => {
    const r = preparePayload(JSON.stringify({ junk: 'x'.repeat(MAX_STORED_BYTES) }));
    expect(r.truncated).toBe(true);
    expect(r.rawBytes).toBeGreaterThan(MAX_STORED_BYTES);
    // A silently short row would be the worst of both: useless for a replay and misleading as evidence.
    expect((r.payload as { _truncated: boolean })._truncated).toBe(true);
    expect((r.payload as { _head: string })._head.length).toBeLessThanOrEqual(2_000);
  });

  it('stores an unparseable body as text rather than dropping it', () => {
    // A body that does not parse is exactly the body a reviewer wants to see: a probe, a misroute, a truncated POST.
    const r = preparePayload('<html>404</html>');
    expect(r.truncated).toBe(false);
    expect((r.payload as { _unparseable: boolean })._unparseable).toBe(true);
    expect((r.payload as { _raw: string })._raw).toBe('<html>404</html>');
  });

  it('counts BYTES rather than characters', () => {
    // A Gujarati or Devanagari payload is multi-byte, and a character count would under-report the storage a stranger
    // can consume — the number that matters for a cap is the byte count.
    expect(preparePayload('"ક"').rawBytes).toBe(5);
  });

  it('measures an empty body as zero rather than failing', () => {
    const r = preparePayload('');
    expect(r.rawBytes).toBe(0);
    expect((r.payload as { _unparseable: boolean })._unparseable).toBe(true);
  });
});

describe('ADMIN-11c · a refused callback is ignored, never failed', () => {
  // "Failed" says the platform tried and could not. What happened is that the platform DECLINED — a defence working,
  // not an incident. Filing it as a failure would put a working control in an outage report.
  it('maps a rejected signature to ignored and everything else to received', () => {
    expect(statusFor(false)).toBe('ignored');
    expect(statusFor(true)).toBe('received');
    // Undecided at insert time: the receipt is written BEFORE verification, which is the whole point — a receipt
    // written afterwards could only ever describe successes.
    expect(statusFor(null)).toBe('received');
    expect(statusFor(undefined)).toBe('received');
  });
});
