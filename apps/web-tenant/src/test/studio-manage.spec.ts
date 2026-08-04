import { canSubmit, canPublish, canPause, canResume, canArchive, canEdit, buildCourse, buildLesson } from '../features/studio/manage';

describe('features/studio/manage (PC-26)', () => {
  it('mirrors the course state machine', () => {
    expect(canSubmit('draft')).toBe(true); expect(canSubmit('review')).toBe(false);
    expect(canPublish('review')).toBe(true); expect(canPublish('draft')).toBe(false);
    expect(canPause('published')).toBe(true); expect(canResume('paused')).toBe(true);
    expect(canArchive('published')).toBe(true); expect(canArchive('archived')).toBe(false);
    expect(canEdit('draft')).toBe(true); expect(canEdit('published')).toBe(false);
  });

  it('buildCourse: title/level/price rules; blank price = free; float-free minor', () => {
    expect(buildCourse({ title: ' Drip 101 ', level: 'basic', priceMajor: '99.50', certEnabled: true }))
      .toEqual({ ok: true, value: { defaultTitle: 'Drip 101', level: 'basic', priceMinor: '9950', certEnabled: true } });
    expect(buildCourse({ title: '', level: 'basic', priceMajor: '', certEnabled: false })).toEqual({ ok: false, error: 'title' });
    expect(buildCourse({ title: 'x', level: 'pro', priceMajor: '', certEnabled: false })).toEqual({ ok: false, error: 'level' });
    expect(buildCourse({ title: 'x', level: 'basic', priceMajor: 'abc', certEnabled: false })).toEqual({ ok: false, error: 'price' });
    expect(buildCourse({ title: 'x', level: 'basic', priceMajor: '', certEnabled: false }))
      .toEqual({ ok: true, value: { defaultTitle: 'x', level: 'basic', priceMinor: '0', certEnabled: false } });
  });

  it('buildLesson: video needs mediaId, article needs body — no hollow lessons', () => {
    expect(buildLesson({ moduleNo: '1', lessonNo: '1', title: 'Why drip', contentKind: 'video', mediaId: 'm1', body: '' }))
      .toEqual({ ok: true, value: { moduleNo: 1, lessonNo: 1, defaultTitle: 'Why drip', contentKind: 'video', mediaId: 'm1' } });
    expect(buildLesson({ moduleNo: '', lessonNo: '2', title: 'Read this', contentKind: 'article', mediaId: '', body: 'Long text' }))
      .toEqual({ ok: true, value: { moduleNo: 1, lessonNo: 2, defaultTitle: 'Read this', contentKind: 'article', body: 'Long text' } });
    expect(buildLesson({ moduleNo: '1', lessonNo: '1', title: 'x', contentKind: 'video', mediaId: '', body: '' })).toEqual({ ok: false, error: 'content' });
    expect(buildLesson({ moduleNo: '1', lessonNo: '0', title: 'x', contentKind: 'video', mediaId: 'm', body: '' })).toEqual({ ok: false, error: 'lessonno' });
    expect(buildLesson({ moduleNo: '1', lessonNo: '1', title: 'x', contentKind: 'quiz', mediaId: 'm', body: '' })).toEqual({ ok: false, error: 'kind' });
  });
});
