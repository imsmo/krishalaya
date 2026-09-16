import { buildLesson } from '../features/studio/manage';

describe('features/studio/manage (PC-26)', () => {
  // PC-56 TENANT-7a: the course state mirror and `buildCourse` left this file with the inline create form; the course
  // form and its acts are API-reviewed chains now (test/tenant7a-courses.spec.ts).

  it('buildLesson: video needs mediaId, article needs body — no hollow lessons', () => {
    expect(buildLesson({ moduleNo: '1', lessonNo: '1', title: 'Why drip', contentKind: 'video', mediaId: 'm1', body: '' }))
      .toEqual({ ok: true, value: { moduleNo: 1, lessonNo: 1, defaultTitle: 'Why drip', contentKind: 'video', mediaId: 'm1' } });
    expect(buildLesson({ moduleNo: '', lessonNo: '2', title: 'Read this', contentKind: 'article', mediaId: '', body: 'Long text' }))
      .toEqual({ ok: true, value: { moduleNo: 1, lessonNo: 2, defaultTitle: 'Read this', contentKind: 'article', body: 'Long text' } });
    expect(buildLesson({ moduleNo: '1', lessonNo: '1', title: 'x', contentKind: 'video', mediaId: '', body: '' })).toEqual({ ok: false, error: 'content' });
    expect(buildLesson({ moduleNo: '1', lessonNo: '0', title: 'x', contentKind: 'video', mediaId: 'm', body: '' })).toEqual({ ok: false, error: 'lessonno' });
    expect(buildLesson({ moduleNo: '1', lessonNo: '1', title: 'x', contentKind: 'webinar', mediaId: 'm', body: '' })).toEqual({ ok: false, error: 'kind' });
    // PC-26b: quiz lessons carry the parsed canonical quiz JSON; unparseable text -> quiz_* error, never hollow
    const q = buildLesson({ moduleNo: '1', lessonNo: '3', title: 'Check yourself', contentKind: 'quiz', mediaId: '', body: '', quizText: 'Q: 2+2?\n*A) 4\nB) 5' });
    expect(q.ok).toBe(true);
    if (q.ok) expect((q.value.quiz as { questions: unknown[] }).questions).toHaveLength(1);
    expect(buildLesson({ moduleNo: '1', lessonNo: '3', title: 'x', contentKind: 'quiz', mediaId: '', body: '', quizText: '' })).toEqual({ ok: false, error: 'quiz_empty' });
  });
});
