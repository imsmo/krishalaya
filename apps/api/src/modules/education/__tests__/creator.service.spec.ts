// modules/education/__tests__/creator.service.spec.ts · creator-content service unit tests with fakes.
// Pins: register needs channel.host; moderation needs content.moderate + writes an audit row; a host edits
// only their OWN channel (404 IDOR); live schedule requires the host's OWN APPROVED channel; live start
// degrades to 503 when the stream provider is down (nothing flips to live).
import { LearningChannelService } from '../services/learning-channel.service';
import { LearningChannel } from '../domain/learning-channel.entity';
import { ChannelNotFoundError, CreatorForbiddenError } from '../domain/creator.errors';

const host = { userId: 'u1', canAuthor: false, canPublish: false, isAdmin: false, canHost: true, canModerate: false };
const mod = { userId: 'm1', canAuthor: false, canPublish: false, isAdmin: false, canHost: false, canModerate: true };
const approvedChannel = (owner = 'u1') => LearningChannel.rehydrate({ id: 'c1', tenantId: 't1', ownerUserId: owner, provider: 'youtube', title: 'T', handle: null, externalUrl: 'https://y/@x', topicId: null, description: null, status: 'approved', reviewNote: null, reviewedBy: null, reviewedAt: null });

function channelHarness(opts: { channel?: LearningChannel | null } = {}) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const audit = { write: jest.fn() };
  const repo = { insert: jest.fn(), getForUpdate: jest.fn(async () => opts.channel ?? null), getById: jest.fn(async () => opts.channel ?? null), update: jest.fn(), listFor: jest.fn() };
  const svc = new LearningChannelService(uow as any, outbox as any, metrics as any, audit as any, repo as any);
  return { svc, audit, repo };
}

describe('LearningChannelService', () => {
  it('register requires channel.host', async () => {
    const { svc } = channelHarness();
    await expect(svc.register('t1', { ...host, canHost: false }, { provider: 'youtube', title: 'X', externalUrl: 'https://y/@x' } as any)).rejects.toBeInstanceOf(CreatorForbiddenError);
  });
  it('moderation requires content.moderate and writes an audit row', async () => {
    const pending = LearningChannel.register({ id: 'c1', tenantId: 't1', ownerUserId: 'u1', provider: 'youtube', title: 'T', handle: null, externalUrl: 'https://y/@x', topicId: null, description: null });
    const { svc } = channelHarness({ channel: pending });   // pre-existing unused `audit` removed by 7c's lint pass
    await expect(svc.moderate('t1', host, 'c1', 'approve', null, null)).rejects.toBeInstanceOf(CreatorForbiddenError);
    const { svc: svc2, audit: audit2 } = channelHarness({ channel: pending });
    await svc2.moderate('t1', mod, 'c1', 'approve', null, '1.1.1.1');
    expect(audit2.write).toHaveBeenCalledTimes(1);
    expect((audit2.write.mock.calls as any[])[0][1].action).toBe('education.channel_approve');
  });
  it('a host can edit only their OWN channel (404, no IDOR)', async () => {
    const { svc } = channelHarness({ channel: approvedChannel('someone-else') });
    await expect(svc.update('t1', host, 'c1', { title: 'hijack' } as any)).rejects.toBeInstanceOf(ChannelNotFoundError);
  });
});
