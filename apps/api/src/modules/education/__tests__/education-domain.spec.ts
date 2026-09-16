// modules/education/__tests__/education-domain.spec.ts · pure-domain invariants (no I/O).
// Pins: revenue split is exact bigint + zero-sum (instructor floor, platform remainder); course state machine;
// enrollment progress recompute stamps completion once; royalty bounds.
import { Course } from '../domain/course.entity';
import { Instructor } from '../domain/instructor.entity';
import { Enrollment } from '../domain/enrollment.entity';
import { InvalidRoyaltyError, InvalidCourseError } from '../domain/education.errors';
import { IllegalCourseTransitionError } from '../domain/course.state';

describe('Course.splitRevenue', () => {
  it('instructor gets floor(price*bps/10000), platform the remainder — zero-sum', () => {
    const { instructorMinor, platformMinor } = Course.splitRevenue(99999n, 8000);   // 80%
    expect(instructorMinor).toBe(79999n);   // floor(799992000/10000)=79999
    expect(platformMinor).toBe(20000n);
    expect(instructorMinor + platformMinor).toBe(99999n);
  });
  it('100% royalty → platform 0; 0% → instructor 0; always zero-sum', () => {
    expect(Course.splitRevenue(5000n, 10000)).toEqual({ instructorMinor: 5000n, platformMinor: 0n });
    expect(Course.splitRevenue(5000n, 0)).toEqual({ instructorMinor: 0n, platformMinor: 5000n });
  });
});

describe('Course lifecycle', () => {
  const mk = () => Course.create({ id: 'c1', tenantId: 't1', instructorId: 'i1', defaultTitle: 'Soil 101', topicId: null, audienceRoleIds: [], level: 'basic', priceMinor: 0n, currencyCode: 'INR', certEnabled: false, coverMediaId: null });
  it('draft→review→published→paused→published; archived blocks edits', () => {
    const T = new Date(); const c = mk(); c.submitForReview('maker', T); c.publish('checker', T); expect(c.status).toBe('published');
    c.pause(); expect(c.status).toBe('paused'); c.resume();
    c.archive(T); expect(() => c.update({ defaultTitle: 'x' })).toThrow(InvalidCourseError);
  });
  it('cannot publish straight from draft', () => { expect(() => mk().publish('checker', new Date())).toThrow(IllegalCourseTransitionError); });
  it('rejects negative price', () => { expect(() => Course.create({ id: 'c1', tenantId: 't1', instructorId: 'i1', defaultTitle: 'x', topicId: null, audienceRoleIds: [], level: 'basic', priceMinor: -1n, currencyCode: 'INR', certEnabled: false, coverMediaId: null })).toThrow(InvalidCourseError); });
});

describe('Instructor royalty bounds', () => {
  it('rejects royalty outside 0..10000', () => {
    expect(() => Instructor.create({ id: 'i1', userId: 'u1', tenantId: 't1', bio: null, royaltyBps: 10001 })).toThrow(InvalidRoyaltyError);
    expect(Instructor.create({ id: 'i1', userId: 'u1', tenantId: 't1', bio: null }).royaltyBps).toBe(8000);   // default 80%
  });
});

describe('Enrollment.recompute', () => {
  const mk = () => Enrollment.enroll({ id: 'e1', tenantId: 't1', courseId: 'c1', learnerUserId: 'u1', paymentId: null });
  it('updates pct and stamps completion exactly once at 100%', () => {
    const e = mk(); e.pullEvents();
    expect(e.recompute(1, 4)).toBe(false); expect(e.progressPct).toBe(25);
    expect(e.recompute(4, 4)).toBe(true); expect(e.isComplete).toBe(true);
    expect(e.pullEvents().map((x) => x.type)).toContain('education.course_completed');
    expect(e.recompute(4, 4)).toBe(false);   // already complete — no second event
    expect(e.pullEvents()).toHaveLength(0);
  });
  it('0 lessons → 0% (no divide-by-zero)', () => { const e = mk(); e.recompute(0, 0); expect(e.progressPct).toBe(0); });
});
