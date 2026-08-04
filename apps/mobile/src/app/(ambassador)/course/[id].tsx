// apps/mobile/src/app/(ambassador)/course/[id].tsx · course detail + lessons + ENROLL (part of 94/165). Thin
// screen (guide §3): the course, its lessons, and the caller's enrollment + progress. Enrol is REAL + idempotent
// (Law 3; a paid enrol moves money SERVER-SIDE — Law 11). Tapping a lesson opens the player with the enrollment +
// lesson context. Behind `ambassador_training`. Money via MoneyText. Degrade-never-die.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Course, CourseLesson, Enrollment, LessonProgress } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ProgressBar, StatusPill, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getCourse, getLessons, myEnrollments, getProgress, enroll } from '../../../features/education/education.api';
import { courseProgressPct, lessonCompleted } from '../../../features/education/learn';

export default function CourseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('ambassador_training');
  const [course, setCourse] = useState<Course | null>(null);
  const [lessons, setLessons] = useState<CourseLesson[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [progress, setProgress] = useState<LessonProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [c, ls, es] = await Promise.all([getCourse(id), getLessons(id), myEnrollments()]);
    setCourse(c); setLessons(c?.lessons?.length ? c.lessons : ls);
    const mine = es.items.find((e) => e.courseId === id) ?? null;
    setEnrollment(mine);
    setProgress(mine ? await getProgress(mine.id) : []);
    setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('amb.training.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const onEnroll = async () => {
    if (!id) return;
    setBusy(true);
    try { await enroll(id); await load(); }
    catch (e) {
      const msg = e instanceof SdkError && e.status === 402 ? t('amb.course.paymentRequired')
        : e instanceof SdkError && e.isConflict ? t('amb.course.alreadyEnrolled')
        : t('amb.course.enrollFailed');
      Alert.alert(t('amb.course.enrollTitle'), msg);
    } finally { setBusy(false); }
  };

  const pct = courseProgressPct(lessons, progress);

  return (
    <ScreenScaffold
      title={course?.defaultTitle ?? ' '}
      footer={!enrollment && course ? <Button title={course.priceMinor === '0' ? t('amb.course.enrollFree') : t('amb.course.enroll')} loading={busy} disabled={busy} onPress={onEnroll} /> : undefined}
    >
      {loading ? <SkeletonCard lines={6} /> : !course ? (
        <EmptyState title={t('amb.course.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <>
          <Card>
            <View style={styles.row}>
              <Text style={styles.level}>{t(`amb.level.${course.level}`)}</Text>
              {course.priceMinor === '0' ? <Text style={styles.free}>{t('amb.training.free')}</Text> : <MoneyText minor={course.priceMinor} currencyCode={course.currencyCode} langCode={lang} size="md" />}
            </View>
            {enrollment ? (
              <View style={{ marginTop: space[3] }}>
                <Text style={styles.meta}>{t('amb.course.progress', { pct: String(pct) })}</Text>
                <View style={{ marginTop: space[1] }}><ProgressBar value={pct / 100} /></View>
              </View>
            ) : null}
          </Card>

          <Text style={styles.section}>{t('amb.course.lessons')}</Text>
          <FlatList
            data={lessons}
            keyExtractor={(l) => l.id}
            scrollEnabled={false}
            renderItem={({ item, index }) => {
              const done = lessonCompleted(progress, item.id);
              const locked = !enrollment;
              return (
                <Pressable
                  disabled={locked}
                  onPress={() => router.push({ pathname: '/(ambassador)/lesson/[id]', params: { id: item.id, courseId: course.id, enrollmentId: enrollment!.id } })}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: locked }}
                >
                  <Card style={[styles.lesson, locked && styles.locked]}>
                    <Text style={styles.lessonNo}>{index + 1}</Text>
                    <Text style={styles.lessonTitle} numberOfLines={2}>{item.defaultTitle}</Text>
                    {done ? <StatusPill label={t('amb.course.done')} tone="success" /> : <Text style={styles.kind}>{t(`amb.contentKind.${item.contentKind}`)}</Text>}
                  </Card>
                </Pressable>
              );
            }}
          />
          {!enrollment ? <Text style={styles.note}>{t('amb.course.enrollToStart')}</Text> : null}
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  level: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  free: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.successDark },
  meta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700, marginTop: space[4], marginBottom: space[2] },
  lesson: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[2] },
  locked: { opacity: 0.6 },
  lessonNo: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.primary700, width: 22 },
  lessonTitle: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink800 },
  kind: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, marginTop: space[2] },
});
