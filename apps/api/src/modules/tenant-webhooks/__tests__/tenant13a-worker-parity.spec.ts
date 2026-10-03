// modules/tenant-webhooks/__tests__/tenant13a-worker-parity.spec.ts · PC-56 TENANT-13a — "the registration guard shares the same function".
// The delivery worker is pg-native and self-contained (it imports nothing from apps/api), so the four files both sides must agree on —
// the target guard, the signature, the delivery contract + state machines, and the secret envelope — live in BOTH apps as byte-identical
// copies. This spec fails on any drift: a range added to one guard and not the other, a ladder step changed on one side, a signing
// detail that only the worker knows. Edit the API copy, copy it over, and this goes green.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API = join(__dirname, '..', '..', '..');                         // apps/api/src
const WORKER = join(API, '..', '..', 'worker', 'src', 'jobs', 'webhook');
const PAIRS: Array<[string, string]> = [
  [join(API, 'modules', 'tenant-webhooks', 'domain', 'webhook-ssrf.ts'), join(WORKER, 'webhook-ssrf.ts')],
  [join(API, 'modules', 'tenant-webhooks', 'domain', 'webhook-signature.ts'), join(WORKER, 'webhook-signature.ts')],
  [join(API, 'modules', 'tenant-webhooks', 'domain', 'webhook-rail.state.ts'), join(WORKER, 'webhook-rail.state.ts')],
  [join(API, 'core', 'secrets', 'secret-envelope.ts'), join(WORKER, 'secret-envelope.ts')],
];

describe('PC-56 TENANT-13a · the worker runs the SAME guard, signature, contract and envelope as the API', () => {
  it.each(PAIRS.map(([a, w]) => [a.slice(API.length + 1), a, w]))('%s is byte-identical in apps/worker', (_n, a, w) => {
    expect(readFileSync(w, 'utf8')).toBe(readFileSync(a, 'utf8'));
  });
  it('the worker job uses those copies (and nothing from apps/api)', () => {
    const job = readFileSync(join(WORKER, '..', 'webhook-delivery.job.ts'), 'utf8');
    for (const m of ['./webhook/webhook-ssrf', './webhook/secret-envelope', './webhook/webhook-signature', './webhook/webhook-rail.state']) expect(job).toContain(`from '${m}'`);
    expect(job).not.toMatch(/from '[^']*(apps\/api|\.\.\/\.\.\/\.\.\/api)/);
  });
});
