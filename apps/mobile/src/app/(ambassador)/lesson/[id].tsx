// apps/mobile/src/app/(ambassador)/lesson/[id].tsx · screen 165 (Training Video / lesson player). Thin screen
// (guide §3): shows a lesson — for a video, fetches a presigned media URL and opens it (the SERVER gates the URL
// to a clean asset). Header shows real duration + module position; the description, an "Up next" list of the real
// following lessons, and Mark-Complete / Take-Quiz actions. The learner marks watched/complete (REAL markProgress;
// server recomputes the enrollment %). Params carry enrollmentId + courseId (server re-checks ownership — no IDOR).
// Behind `ambassador_training`. Degrade-never-die.
//
// §13 (NOT faked): CourseLesson has {moduleNo, lessonNo, defaultTitle, contentKind, durationSecs, quiz} — NO
// per-lesson language, NO star rating, and NO chapter list. So the meta line shows the real duration + "Module N
// of M" (M = real distinct-module count) but NO fabricated "Hindi · ⭐4.9 (124)"; there is no fabricated chapter
// track ("0:00 · Open the create screen ✓ Watched"), no fabricated "2:14 / 6:21" scrubber, and no subtitle/speed/
// offline chips (no such contract). There is no in-app video dep yet, so playback opens the presigned URL via the
// OS player (Linking) rather than a fabricated embedded player; the progress/complete write is real.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { CourseLesson } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getLessons, lessonMediaUrl, markProgress } from '../../../features/education/education.api';
import { parseQuiz } from '../../../features/education/learn';
import { moduleCount, nextLessons } from '../../../features/ambassador/training-hub';

export default function LessonPlayer() {
  const { id, courseId, enrollmentId } = useLocalSearchParams<{ id: string; courseId: string; enrollmentId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('ambassador_training');
  const [lessons, setLessons] = useState<CourseLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id || !courseId) return;
    setLoading(true);
    setLessons(await getLessons(courseId));
    setLoading(false);
  }, [id, courseId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const lesson = useMemo(() => lessons.find((l) => l.id === id) ?? null, [lessons, id]);
  const upNext = useMemo(() => (id ? nextLessons(lessons, id) : []), [lessons, id]);
  const mins = lesson?.durationSecs ? Math.max(1, Math.round(lesson.durationSecs / 60)) : null;
  const modTotal = moduleCount(lessons);
  const hasQuiz = !!lesson && parseQuiz(lesson.quiz) !== null;

  if (!enabled) return <ScreenScaffold title={t('amb.lesson.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const play = async () => {
    if (!lesson?.mediaId) return;
    setBusy(true);
    try {
      const url = await lessonMediaUrl(lesson.mediaId);
      if (!url) { Alert.alert(t('amb.lesson.title'), t('amb.lesson.videoUnavailable')); return; }
      const ok = await Linking.canOpenURL(url);
      if (ok) await Linking.openURL(url); else Alert.alert(t('amb.lesson.title'), t('amb.lesson.videoUnavailable'));
    } finally { setBusy(false); }
  };

  const markDone = async () => {
    if (!enrollmentId || !id) return;
    setBusy(true);
    try {
      await markProgress(enrollmentId, id, { secondsWatched: lesson?.durationSecs ?? 0, completed: true });
      router.back();
    } catch { Alert.alert(t('amb.lesson.title'), t('amb.lesson.markFailed')); }
    finally { setBusy(false); }
  };

  return (
    <ScreenScaffold title={lesson?.defaultTitle ?? t('amb.lesson.title')} scroll>
      {loading ? <SkeletonCard lines={6} /> : !lesson ? (
        <EmptyState title={t('amb.lesson.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <View style={{ gap: space[3] }}>
          {/* Video area — opens presigned URL via OS player (no fabricated embedded scrubber) */}
          <Pressable onPress={play} accessibilityRole="button" disabled={!lesson.mediaId} style={styles.video}>
            <Text style={styles.videoIcon}>{lesson.mediaId ? '▶' : '🎓'}</Text>
            <Text style={styles.videoLabel}>{lesson.mediaId ? t('amb.lesson.play') : t(`amb.contentKind.${lesson.contentKind}`)}</Text>
          </Pressable>

          {/* Meta — real duration + module position only (§13: no language/rating) */}
          <Text style={styles.meta}>{t('amb.lesson.meta', { min: mins != null ? String(mins) : t('common.dash'), mod: String(lesson.moduleNo), total: String(modTotal || 1) })}</Text>

          {lesson.body ? <Card><Text style={styles.body}>{lesson.body}</Text></Card> : null}

          {/* Up next — real subsequent lessons */}
          {upNext.length > 0 ? (
            <>
              <Text style={styles.section}>{t('amb.lesson.upNext')}</Text>
              <Card style={{ gap: space[1] }}>
                {upNext.map((l, i) => (
                  <Pressable key={l.id} onPress={() => router.push({ pathname: '/(ambassador)/lesson/[id]', params: { id: l.id, courseId: courseId!, enrollmentId: enrollmentId! } })} accessibilityRole="button" style={[styles.upRow, i > 0 && styles.divide]}>
                    <Text style={styles.upIcon}>🎬</Text>
                    <Text style={styles.upTitle} numberOfLines={2}>{l.defaultTitle}</Text>
                    <Text style={styles.chev}>›</Text>
                  </Pressable>
                ))}
              </Card>
            </>
          ) : null}

          <View style={{ gap: space[2], marginTop: space[2] }}>
            <Button title={t('amb.lesson.markDone')} loading={busy} disabled={busy} onPress={markDone} />
            {hasQuiz ? <Button title={t('amb.lesson.takeQuiz')} variant="outline" onPress={() => router.push({ pathname: '/(ambassador)/quiz/[id]', params: { id: lesson.id, courseId: courseId!, enrollmentId: enrollmentId! } })} /> : null}
          </View>
        </View>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  video: { height: 180, borderRadius: radius.lg, backgroundColor: color.ink900, alignItems: 'center', justifyContent: 'center', gap: space[2] },
  videoIcon: { fontSize: 40, color: color.card },
  videoLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.card },
  meta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  body: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700, lineHeight: font.size.md * 1.5 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[2] },
  upRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], minHeight: 48 },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  upIcon: { fontSize: 20 },
  upTitle: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  chev: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink400 },
});
