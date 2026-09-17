// modules/education/__tests__/creator-domain.spec.ts · pure-domain invariants for the creator-content layer.
// Pins: channel URL validation + state machine (pending→approved↔suspended, rejected terminal); resource
// auto-approve vs pending + takedown; live-session lifecycle (scheduled→live→ended; can't cancel a live one).
import { LearningChannel } from '../domain/learning-channel.entity';
import { LearningResource } from '../domain/learning-resource.entity';
import { LiveSession } from '../domain/live-session.entity';
import { InvalidChannelError, InvalidResourceError } from '../domain/creator.errors';
import { IllegalChannelTransitionError } from '../domain/channel.state';
import { IllegalLiveTransitionError } from '../domain/live-session.state';

const chan = () => LearningChannel.register({ id: 'c1', tenantId: 't1', ownerUserId: 'u1', provider: 'youtube', title: 'KrishiTV', handle: '@krishi', externalUrl: 'https://youtube.com/@krishi', topicId: null, description: null });

describe('LearningChannel', () => {
  it('rejects a non-http(s) external_url', () => {
    expect(() => LearningChannel.register({ id: 'c1', tenantId: 't1', ownerUserId: 'u1', provider: 'website', title: 'x', handle: null, externalUrl: 'javascript:alert(1)', topicId: null, description: null })).toThrow(InvalidChannelError);
  });
  it('pending→approve→suspend→approve; rejected is terminal', () => {
    const c = chan(); expect(c.status).toBe('pending');
    c.approve('mod'); expect(c.status).toBe('approved');
    c.suspend('mod', 'spam'); expect(c.status).toBe('suspended');
    c.approve('mod'); expect(c.status).toBe('approved');
    c.reject('mod', 'final'); expect(() => c.approve('mod')).toThrow(IllegalChannelTransitionError);
  });
  it('cannot approve straight from suspended→... wait, approve is allowed; but pending cannot suspend', () => {
    expect(() => chan().suspend('mod', null)).toThrow(IllegalChannelTransitionError);
  });
});

describe('LearningResource', () => {
  const base = { id: 'r1', tenantId: 't1', channelId: 'c1', ownerUserId: 'u1', kind: 'video' as const, title: 'Drip 101', externalUrl: 'https://youtu.be/abc', mediaId: null, topicId: null, languageCode: 'en', body: null };
  it('autoApprove under own approved channel → approved + event; else pending', () => {
    const a = LearningResource.create({ ...base, autoApprove: true }); expect(a.status).toBe('approved');
    expect(a.pullEvents().map((e) => e.type)).toContain('education.resource_published');
    const p = LearningResource.create({ ...base, autoApprove: false }); expect(p.status).toBe('pending');
    expect(p.pullEvents()).toHaveLength(0);
  });
  it('requires an external_url or media', () => {
    expect(() => LearningResource.create({ ...base, externalUrl: null, mediaId: null, autoApprove: false })).toThrow(InvalidResourceError);
  });
  it('moderator takedown is idempotent', () => {
    const r = LearningResource.create({ ...base, autoApprove: true }); r.pullEvents();
    r.takedown('mod', 'copyright'); expect(r.status).toBe('rejected');
    expect(r.pullEvents()).toHaveLength(1); r.takedown('mod', null); expect(r.pullEvents()).toHaveLength(0);
  });
});

describe('LiveSession (PC-56 TENANT-7c shape)', () => {
  const mk = () => LiveSession.schedule({ id: 's1', tenantId: 't1', hostUserId: 'u1', courseId: 'c1', title: 'Soil Q&A', scheduledAt: new Date('2026-07-16T15:00:00Z'), durationMins: 90, capacity: 500, joinUrl: 'https://meet.example/x', clashAccepted: false, remind: true });
  it('scheduled→live→ended; cannot cancel a live session', () => {
    const s = mk(); s.start('stream-1', 'https://play/1'); expect(s.status).toBe('live');
    expect(() => s.cancel()).toThrow(IllegalLiveTransitionError);
    s.end(); expect(s.status).toBe('ended');
  });
  it('scheduled can be cancelled, and — held elsewhere — ended without ever being live (7c)', () => {
    const s = mk(); s.end(); expect(s.status).toBe('ended'); expect(s.toProps().endedAt).not.toBeNull(); expect(s.toProps().startedAt).toBeNull();
    const c = mk(); c.cancel(); expect(c.status).toBe('cancelled'); expect(c.toProps().cancelledAt).not.toBeNull();
    expect(() => c.end()).toThrow(IllegalLiveTransitionError);
  });
  it('attendance, the recording and the lesson follow the end, in that order, once', () => {
    const s = mk();
    expect(() => s.recordAttendance(10, 'u1')).toThrow(); expect(() => s.attachRecording('m1')).toThrow();
    s.end(); s.recordAttendance(342, 'u1'); expect(s.toProps()).toMatchObject({ attendanceCount: 342, attendanceRecordedBy: 'u1' });
    expect(() => s.recordAttendance(-1, 'u1')).toThrow(); expect(() => s.recordAttendance(1.5, 'u1')).toThrow();
    expect(() => s.publishedAsLesson('l1')).toThrow();
    s.attachRecording('m1'); s.publishedAsLesson('l1');
    expect(() => s.publishedAsLesson('l2')).toThrow(); expect(() => s.attachRecording('m2')).toThrow();
  });
  it('an edit is only while scheduled', () => {
    const s = mk(); s.reschedule({ title: 'Soil Q&A II', scheduledAt: new Date('2026-07-17T15:00:00Z'), durationMins: 60, capacity: null, joinUrl: null, clashAccepted: true, remind: false });
    expect(s.toProps()).toMatchObject({ title: 'Soil Q&A II', durationMins: 60, capacity: null, clashAccepted: true, remind: false });
    s.cancel(); expect(() => s.reschedule({ title: 'x', scheduledAt: new Date(), durationMins: 60, capacity: null, joinUrl: null, clashAccepted: false, remind: true })).toThrow();
  });
});
