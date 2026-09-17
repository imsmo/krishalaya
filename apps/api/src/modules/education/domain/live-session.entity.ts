// modules/education/domain/live-session.entity.ts · PC-56 TENANT-7c · THE LIVE CLASS, as the row holds it after 0172.
//
// A SCHEDULED CLASS, declared honestly: a title, its course, its host, the instant it starts (resolved in the
// cooperative's timezone by the database), a duration, a capacity, the join link the host pasted, and — afterwards — the
// attendance the host recorded, the recording attached through core/media, and the lesson the recording was published
// as. Lifecycle scheduled → live → ended · scheduled → ended (held elsewhere) · scheduled → cancelled, in
// live-session.state.ts (Law 5). The provider ref and playback URL survive from PC-26b for the one edge (`start`) a
// configured stream provider would take; this platform has none.
import { DomainEvent, CreatorEventType, LiveStatus } from './creator.events';
import { assertTransition } from './live-session.state';
import { InvalidLiveSessionError } from './creator.errors';

export interface LiveSessionProps {
  id: string; tenantId: string; hostUserId: string; channelId: string | null; courseId: string | null; title: string; topicId: string | null;
  scheduledAt: Date; durationMins: number; capacity: number | null; joinUrl: string | null; clashAccepted: boolean; remind: boolean;
  status: LiveStatus; providerStreamRef: string | null; playbackUrl: string | null;
  recordingMediaId: string | null; recordingAttachedAt: Date | null; recordingLessonId: string | null;
  startedAt: Date | null; endedAt: Date | null; cancelledAt: Date | null;
  attendanceCount: number | null; attendanceRecordedAt: Date | null; attendanceRecordedBy: string | null;
  createdAt?: Date;
}
export type LiveClassContent = Pick<LiveSessionProps, 'title' | 'scheduledAt' | 'durationMins' | 'capacity' | 'joinUrl' | 'clashAccepted' | 'remind'>;

export class LiveSession {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: LiveSessionProps) {}

  static schedule(input: { id: string; tenantId: string; hostUserId: string; courseId: string | null; channelId?: string | null; topicId?: string | null } & LiveClassContent): LiveSession {
    if (!input.title) throw new InvalidLiveSessionError('title required');
    const s = new LiveSession({
      id: input.id, tenantId: input.tenantId, hostUserId: input.hostUserId, channelId: input.channelId ?? null, courseId: input.courseId, title: input.title, topicId: input.topicId ?? null,
      scheduledAt: input.scheduledAt, durationMins: input.durationMins, capacity: input.capacity, joinUrl: input.joinUrl, clashAccepted: input.clashAccepted, remind: input.remind,
      status: 'scheduled', providerStreamRef: null, playbackUrl: null, recordingMediaId: null, recordingAttachedAt: null, recordingLessonId: null,
      startedAt: null, endedAt: null, cancelledAt: null, attendanceCount: null, attendanceRecordedAt: null, attendanceRecordedBy: null,
    });
    s.events.push({ type: CreatorEventType.LiveScheduled, payload: { sessionId: s.props.id, hostUserId: s.props.hostUserId, scheduledAt: s.props.scheduledAt.toISOString() } });
    return s;
  }
  static rehydrate(p: LiveSessionProps): LiveSession { return new LiveSession(p); }
  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get hostUserId() { return this.props.hostUserId; }
  get courseId() { return this.props.courseId; }
  get status() { return this.props.status; }
  toProps(): Readonly<LiveSessionProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** The form chain's edit — only while the class is still `scheduled` (the review refuses otherwise). */
  reschedule(c: LiveClassContent): void {
    if (this.props.status !== 'scheduled') throw new InvalidLiveSessionError(`cannot edit a ${this.props.status} class`);
    if (!c.title) throw new InvalidLiveSessionError('title required');
    this.props.title = c.title; this.props.scheduledAt = c.scheduledAt; this.props.durationMins = c.durationMins; this.props.capacity = c.capacity;
    this.props.joinUrl = c.joinUrl; this.props.clashAccepted = c.clashAccepted; this.props.remind = c.remind;
  }
  start(providerStreamRef: string, playbackUrl: string | null, now = new Date()): void {
    assertTransition(this.props.status, 'live');
    this.props.status = 'live'; this.props.providerStreamRef = providerStreamRef; this.props.playbackUrl = playbackUrl; this.props.startedAt = now;
    this.events.push({ type: CreatorEventType.LiveStarted, payload: { sessionId: this.props.id, hostUserId: this.props.hostUserId } });
  }
  /** From `live` (the stream ended) or from `scheduled` (held elsewhere and over). */
  end(now = new Date()): void {
    assertTransition(this.props.status, 'ended');
    this.props.status = 'ended'; this.props.endedAt = now;
    this.events.push({ type: CreatorEventType.LiveEnded, payload: { sessionId: this.props.id } });
  }
  cancel(now = new Date()): void {
    assertTransition(this.props.status, 'cancelled');
    this.props.status = 'cancelled'; this.props.cancelledAt = now;
    this.events.push({ type: CreatorEventType.LiveCancelled, payload: { sessionId: this.props.id } });
  }
  /** W415's "Attendees 342 of 500" — as a fact the host writes down after the class. */
  recordAttendance(count: number, by: string, now = new Date()): void {
    if (this.props.status !== 'ended') throw new InvalidLiveSessionError('attendance is recorded on an ended class');
    if (!Number.isInteger(count) || count < 0) throw new InvalidLiveSessionError('attendance must be a whole number');
    this.props.attendanceCount = count; this.props.attendanceRecordedAt = now; this.props.attendanceRecordedBy = by;
  }
  attachRecording(mediaId: string, now = new Date()): void {
    if (this.props.status !== 'ended') throw new InvalidLiveSessionError('a recording is attached to an ended class');
    if (this.props.recordingLessonId !== null) throw new InvalidLiveSessionError('the recording is already a lesson');
    this.props.recordingMediaId = mediaId; this.props.recordingAttachedAt = now;
  }
  publishedAsLesson(lessonId: string): void {
    if (this.props.recordingMediaId === null) throw new InvalidLiveSessionError('no recording to publish');
    if (this.props.recordingLessonId !== null) throw new InvalidLiveSessionError('already published');
    this.props.recordingLessonId = lessonId;
  }
  toJSON() {
    const v = this.props;
    return {
      id: v.id, hostUserId: v.hostUserId, channelId: v.channelId, courseId: v.courseId, title: v.title, topicId: v.topicId,
      scheduledAt: v.scheduledAt, durationMins: v.durationMins, capacity: v.capacity, joinUrl: v.joinUrl, clashAccepted: v.clashAccepted, remind: v.remind,
      status: v.status, playbackUrl: v.playbackUrl, recordingMediaId: v.recordingMediaId, recordingAttachedAt: v.recordingAttachedAt, recordingLessonId: v.recordingLessonId,
      startedAt: v.startedAt, endedAt: v.endedAt, cancelledAt: v.cancelledAt,
      attendanceCount: v.attendanceCount, attendanceRecordedAt: v.attendanceRecordedAt, attendanceRecordedBy: v.attendanceRecordedBy, createdAt: v.createdAt,
    };
  }
}
