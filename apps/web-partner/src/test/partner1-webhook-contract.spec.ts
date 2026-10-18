// apps/web-partner/src/test/partner1-webhook-contract.spec.ts · PC-56 PARTNER-1a · founder D4 — the help article prints the delivery rail's OWN
// constants. The console cannot import the API's source, so features/partner1/webhook-contract.ts mirrors them; this spec reads the rail's two
// files from disk and turns red the day they differ. (Also the team acts' reason rule, mirrored from identity's verification-team.ts.)
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WEBHOOK_CONTRACT } from '../features/partner1/webhook-contract';
import { REASON_MAX, REASON_MIN } from '../features/partner1/settings';

const API = path.join(__dirname, '..', '..', '..', 'api', 'src', 'modules');
const read = (p: string) => fs.readFileSync(path.join(API, p), 'utf8');
const sig = read('tenant-webhooks/domain/webhook-signature.ts');
const rail = read('tenant-webhooks/domain/webhook-rail.state.ts');
const one = (src: string, re: RegExp) => { const m = re.exec(src); if (!m) throw new Error(`not found: ${re}`); return m[1]; };

describe('PC-56 PARTNER-1a · the webhook contract = the rail\'s constants', () => {
  it('the header names, the tolerance and the algorithm', () => {
    expect(WEBHOOK_CONTRACT.signatureHeader).toBe(one(sig, /export const SIGNATURE_HEADER = '([^']+)'/));
    expect(WEBHOOK_CONTRACT.legacySignatureHeader).toBe(one(sig, /export const LEGACY_SIGNATURE_HEADER = '([^']+)'/));
    expect(WEBHOOK_CONTRACT.toleranceSec).toBe(Number(one(sig, /export const DEFAULT_TOLERANCE_SEC = (\d+)/)));
    expect(sig).toContain("createHmac('sha256', secret).update(`${timestampSec}.${body}`)");
    expect(sig).toContain('[`t=${timestampSec}`, ...list.map((s) => `v1=${computeSignature(s, body, timestampSec)}`)]');
    expect(WEBHOOK_CONTRACT.algorithm).toBe('HMAC-SHA256');
  });
  it('the retry ladder, the attempts, the rotation overlap and the send timeout', () => {
    expect([...WEBHOOK_CONTRACT.retryLadderSeconds]).toEqual(one(rail, /RETRY_LADDER_SECONDS = \[([^\]]+)\]/).split(',').map((x) => Number(x.trim())));
    expect([...WEBHOOK_CONTRACT.retryLadderLabels]).toEqual(one(rail, /RETRY_LADDER_LABELS = \[([^\]]+)\]/).split(',').map((x) => x.trim().replace(/'/g, '')));
    expect(WEBHOOK_CONTRACT.maxAttempts).toBe(1 + WEBHOOK_CONTRACT.retryLadderSeconds.length);
    expect(rail).toContain('export const MAX_ATTEMPTS = 1 + RETRY_LADDER_SECONDS.length;');
    expect(WEBHOOK_CONTRACT.rotationOverlapHours).toBe(Number(one(rail, /ROTATION_OVERLAP_HOURS = (\d+)/)));
    expect(WEBHOOK_CONTRACT.sendTimeoutSec * 1000).toBe(Number(one(rail, /SEND_TIMEOUT_MS = ([\d_]+)/).replace(/_/g, '')));
  });
  it('the team acts\' reason rule mirrors identity\'s REASON_MIN / REASON_MAX', () => {
    const vt = read('identity/domain/verification-team.ts');
    expect(REASON_MIN).toBe(Number(one(vt, /export const REASON_MIN = (\d+)/)));
    expect(REASON_MAX).toBe(Number(one(vt, /export const REASON_MAX = (\d+)/)));
  });
});
