// modules/education/__tests__/tenant-isolation.spec.ts · tenant-scoping SQL contract (CI gate).
// courses/instructors/enrollments bind tenant_id (+ allow NULL platform rows for courses/instructors); lists are
// keyset (never OFFSET); mutations lock FOR UPDATE. course_lessons + lesson_progress are gated via the
// tenant-scoped course/enrollment JOIN (no tenant_id of their own).
import { CourseRepository } from '../repositories/course.repository';
import { InstructorRepository } from '../repositories/instructor.repository';
import { EnrollmentRepository } from '../repositories/enrollment.repository';
import { CourseLessonRepository } from '../repositories/course-lesson.repository';
import { Course } from '../domain/course.entity';
import { Enrollment } from '../domain/enrollment.entity';

function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; }
const course = () => Course.create({ id: 'c1', tenantId: 'tenantA', instructorId: 'i1', defaultTitle: 'X', topicId: null, audienceRoleIds: [], level: 'basic', priceMinor: 0n, currencyCode: 'INR', certEnabled: false, coverMediaId: null });
const enrollment = () => Enrollment.enroll({ id: 'e1', tenantId: 'tenantA', courseId: 'c1', learnerUserId: 'u1', paymentId: null });

describe('courses isolation', () => {
  it('getForUpdate binds tenant_id + FOR UPDATE', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new CourseRepository(fakeReplica().provider).getForUpdate(tx as any, 'tenantA', 'c1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/c\.id=\$1 AND c\.tenant_id=\$2/); expect(sql).toMatch(/FOR UPDATE/); expect(params).toEqual(['c1', 'tenantA']);
  });
  it('browse list scopes to tenant OR platform, published only, keyset (no OFFSET)', async () => {
    const { provider, exec } = fakeReplica();
    await new CourseRepository(provider).listFor('tenantA', { box: 'browse', limit: 50 });
    const [sql] = exec.query.mock.calls[0];
    // PC-56 TENANT-7a: the platform library is its PUBLISHED rows — a KVK draft is not a tenant's to read.
    expect(sql).toMatch(/\(c\.tenant_id=\$1 OR \(c\.tenant_id IS NULL AND c\.status='published'\)\)/); expect(sql).toMatch(/c\.status='published'/);
    expect(sql).toMatch(/ORDER BY c\.created_at DESC, c\.id DESC/); expect(sql).not.toMatch(/OFFSET/i);
  });
  it('insert binds tenant_id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await new CourseRepository(fakeReplica().provider).insert(tx as any, course(), 'tenantA', 'u1');
    expect(tx.query.mock.calls[0][0]).toMatch(/INSERT INTO courses/); expect(tx.query.mock.calls[0][1]).toContain('tenantA');
  });
});

describe('instructors isolation', () => {
  it('findByUser binds user_id + tenant_id', async () => {
    const { provider, exec } = fakeReplica();
    await new InstructorRepository(provider).findByUser('tenantA', 'u1');
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/user_id=\$1 AND tenant_id=\$2/); expect(params).toEqual(['u1', 'tenantA']);
  });
});

describe('enrollments isolation', () => {
  it('getForUpdate binds tenant_id + FOR UPDATE; list keyset (no OFFSET)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new EnrollmentRepository(fakeReplica().provider).getForUpdate(tx as any, 'tenantA', 'e1');
    expect(tx.query.mock.calls[0][0]).toMatch(/id=\$1 AND tenant_id=\$2/); expect(tx.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    const { provider, exec } = fakeReplica();
    await new EnrollmentRepository(provider).listForLearner('tenantA', 'u1', { limit: 50 });
    expect(exec.query.mock.calls[0][0]).toMatch(/tenant_id=\$1 AND learner_user_id=\$2/); expect(exec.query.mock.calls[0][0]).not.toMatch(/OFFSET/i);
  });
  it('insert binds tenant_id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await new EnrollmentRepository(fakeReplica().provider).insert(tx as any, enrollment());
    expect(tx.query.mock.calls[0][0]).toMatch(/INSERT INTO enrollments/); expect(tx.query.mock.calls[0][1]).toContain('tenantA');
  });
});

describe('course_lessons gated via the course join', () => {
  it('listForCourse joins courses on tenant_id (no cross-tenant leak)', async () => {
    const { provider, exec } = fakeReplica();
    await new CourseLessonRepository(provider).listForCourse('tenantA', 'c1');
    const [sql] = exec.query.mock.calls[0];
    expect(sql).toMatch(/JOIN courses c ON c\.id=l\.course_id/); expect(sql).toMatch(/c\.tenant_id=\$2 OR c\.tenant_id IS NULL/);
  });
});

// ---- creator-content layer isolation (channels / resources / live sessions) ------------------------------
import { LearningChannelRepository } from '../repositories/learning-channel.repository';
import { LearningResourceRepository } from '../repositories/learning-resource.repository';
import { LiveSessionRepository } from '../repositories/live-session.repository';
import { LearningChannel } from '../domain/learning-channel.entity';
import { LiveSession } from '../domain/live-session.entity';

const channelRow = () => LearningChannel.register({ id: 'ch1', tenantId: 'tenantA', ownerUserId: 'u1', provider: 'youtube', title: 'T', handle: null, externalUrl: 'https://y/@x', topicId: null, description: null });

describe('learning_channels isolation', () => {
  it('getForUpdate binds tenant_id + FOR UPDATE; browse list is approved-only + keyset (no OFFSET)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new LearningChannelRepository(fakeReplica().provider).getForUpdate(tx as any, 'tenantA', 'ch1');
    expect(tx.query.mock.calls[0][0]).toMatch(/id=\$1 AND tenant_id=\$2/); expect(tx.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    const { provider, exec } = fakeReplica();
    await new LearningChannelRepository(provider).listFor('tenantA', { box: 'browse', limit: 50 });
    const [sql] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1/); expect(sql).toMatch(/status='approved'/); expect(sql).not.toMatch(/OFFSET/i);
  });
  it('insert binds tenant_id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await new LearningChannelRepository(fakeReplica().provider).insert(tx as any, channelRow());
    expect(tx.query.mock.calls[0][0]).toMatch(/INSERT INTO learning_channels/); expect(tx.query.mock.calls[0][1]).toContain('tenantA');
  });
});

describe('learning_resources isolation', () => {
  it('browse list is approved-only, tenant-bound, keyset (no OFFSET)', async () => {
    const { provider, exec } = fakeReplica();
    await new LearningResourceRepository(provider).listFor('tenantA', { box: 'browse', limit: 50 });
    const [sql] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1/); expect(sql).toMatch(/status='approved'/); expect(sql).not.toMatch(/OFFSET/i);
  });
});

describe('live_sessions isolation', () => {
  it('getForUpdate binds tenant_id + FOR UPDATE; list keyset (no OFFSET); registration uses ON CONFLICT', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const repo = new LiveSessionRepository(fakeReplica().provider);
    await repo.getForUpdate(tx as any, 'tenantA', 's1');
    expect(tx.query.mock.calls[0][0]).toMatch(/id=\$1 AND tenant_id=\$2/); expect(tx.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    const tx2 = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await repo.register(tx2 as any, 's1', 'u9');
    expect(tx2.query.mock.calls[0][0]).toMatch(/INSERT INTO live_session_registrations/); expect(tx2.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(session_id, user_id\) DO NOTHING/);
    const fr = fakeReplica();
    await new LiveSessionRepository(fr.provider).listFor('tenantA', { box: 'upcoming', limit: 50 });
    expect(fr.exec.query.mock.calls[0][0]).toMatch(/tenant_id=\$1/); expect(fr.exec.query.mock.calls[0][0]).not.toMatch(/OFFSET/i);
  });
  it('insert binds tenant_id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const s = LiveSession.schedule({ id: 's1', tenantId: 'tenantA', hostUserId: 'u1', channelId: 'ch1', title: 'Q', topicId: null, scheduledAt: new Date() });
    await new LiveSessionRepository(fakeReplica().provider).insert(tx as any, s);
    expect(tx.query.mock.calls[0][0]).toMatch(/INSERT INTO live_sessions/); expect(tx.query.mock.calls[0][1]).toContain('tenantA');
  });
});
