// apps/mobile/src/app/(ambassador)/training.tsx · screen 94 (Training Hub). Thin screen (guide §3): the ambassador
// training content — a summary header (videos / completed / minutes remaining) + each course rendered as a section
// of lesson rows with their REAL progress state, plus a Reference row to the FAQ. Behind `ambassador_training`.
// Degrade-never-die.
//
// §13 (NOT faked): CourseLesson has no per-lesson language/subtitle field and no prerequisite/lock field, so each
// row shows only the REAL status (✓ completed / N min watched / not started) — never a fabricated "Hindi ·
// Gujarati subtitles" or "🔒 After KYC tutorial". Section titles are the real course titles; counts + minutes are
// derived live from lessons + the caller's own lesson-progress. The FAQ row links to the in-app FAQ screen with no
// fabricated "PDF · 6 pages" metadata.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Course, CourseLesson, Enrollment, LessonProgress } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { browseCourses, myEnrollments, getLessons, getProgress } from '../../features/education/education.api';
import { lessonStatus, minutesWatched, hubSummary, sortLessons } from '../../features/ambassador/training-hub';

interface Section { course: Course; enrollment: Enrollment | null; lessons: CourseLesson[]; progress: LessonProgress[] }

export default function Training() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('ambassador_training');
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    try {
      const [c, e] = await Promise.all([browseCourses(), myEnrollments()]);
      const enrByCourse = new Map(e.items.map((x) => [x.courseId, x]));
      const secs = await Promise.all(c.items.map(async (course): Promise<Section> => {
        const enrollment = enrByCourse.get(course.id) ?? null;
        const [lessons, progress] = await Promise.all([
          getLessons(course.id),
          enrollment ? getProgress(enrollment.id) : Promise.resolve([] as LessonProgress[]),
        ]);
        return { course, enrollment, lessons: sortLessons(lessons), progress };
      }));
      setSections(secs);
    } catch { setFailed(true); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  const allLessons = useMemo(() => sections.flatMap((s) => s.lessons), [sections]);
  const allProgress = useMemo(() => sections.flatMap((s) => s.progress), [sections]);
  const summary = hubSummary(allLessons, allProgress);

  const openLesson = useCallback((s: Section, lessonId: string) => {
    if (s.enrollment) router.push({ pathname: '/(ambassador)/lesson/[id]', params: { id: lessonId, courseId: s.course.id, enrollmentId: s.enrollment.id } });
    else router.push({ pathname: '/(ambassador)/course/[id]', params: { id: s.course.id } });
  }, [router]);

  if (!enabled) return <ScreenScaffold title={t('amb.training.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('amb.training.title')} scroll>
      {loading ? <SkeletonCard lines={6} /> : failed ? (
        <EmptyState title={t('common.somethingWrong')} actionLabel={t('common.retry')} onAction={load} />
      ) : sections.length === 0 ? (
        <EmptyState title={t('amb.training.empty.title')} message={t('amb.training.empty.message')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <View style={{ gap: space[3] }}>
          <Text style={styles.subtitle}>{t('amb.training.subtitle')}</Text>
          <View style={styles.summary}>
            <Text style={styles.summaryTxt}>
              {t('amb.training.summary', { videos: String(summary.videos), completed: String(summary.completed), mins: String(summary.minsRemaining) })}
            </Text>
          </View>

          {sections.map((s) => (
            <View key={s.course.id} style={{ gap: space[2] }}>
              <Text style={styles.section}>{s.course.defaultTitle}</Text>
              <Card style={{ gap: space[1] }}>
                {s.lessons.length === 0 ? (
                  <Text style={styles.emptyLesson}>{t('amb.training.noLessons')}</Text>
                ) : s.lessons.map((l, i) => (
                  <Pressable key={l.id} onPress={() => openLesson(s, l.id)} accessibilityRole="button" style={[styles.lessonRow, i > 0 && styles.divide]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lessonTitle} numberOfLines={2}>{l.defaultTitle}</Text>
                      <Text style={[styles.lessonStatus, lessonStatus(s.progress, l.id) === 'completed' && styles.doneStatus]}>{statusLabel(s.progress, l.id, t)}</Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                ))}
              </Card>
            </View>
          ))}

          {/* Reference — links to the in-app FAQ (no fabricated PDF/page metadata) */}
          <Text style={styles.section}>{t('amb.training.reference')}</Text>
          <Pressable onPress={() => router.push('/(ambassador)/faq')} accessibilityRole="button">
            <Card style={styles.refRow}>
              <Text style={styles.refIcon}>📄</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.lessonTitle}>{t('amb.training.faqTitle')}</Text>
                <Text style={styles.lessonStatus}>{t('amb.training.faqSub')}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Card>
          </Pressable>
        </View>
      )}
    </ScreenScaffold>
  );
}

function statusLabel(progress: LessonProgress[], lessonId: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  const s = lessonStatus(progress, lessonId);
  if (s === 'completed') return t('amb.training.status.completed');
  if (s === 'watching') return t('amb.training.status.watching', { mins: String(minutesWatched(progress, lessonId)) });
  return t('amb.training.status.notStarted');
}

const styles = StyleSheet.create({
  subtitle: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  summary: { backgroundColor: color.primary50, borderRadius: radius.md, paddingVertical: space[2], paddingHorizontal: space[3] },
  summaryTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary800 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[2] },
  lessonRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], minHeight: 48 },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  lessonTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  lessonStatus: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  doneStatus: { color: color.successDark, fontWeight: font.weight.semibold },
  emptyLesson: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  chevron: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink400 },
  refRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  refIcon: { fontSize: 24 },
});
