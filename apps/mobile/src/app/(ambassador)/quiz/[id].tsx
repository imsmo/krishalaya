// apps/mobile/src/app/(ambassador)/quiz/[id].tsx · screen 166 (Knowledge Quiz). Thin screen (guide §3): renders the
// lesson's quiz ONE question at a time (design 166 — progress hero, lettered options, optional hint, Skip / Submit
// Answer). Answers are held locally; on the last question it scores with the PURE `scoreQuiz` and posts the score +
// completion via REAL markProgress (the SERVER stores the score + recomputes the enrollment). Params carry
// enrollmentId (server re-checks ownership — no IDOR). Behind `ambassador_training`. Degrade-never-die.
//
// §13 (NOT faked): QuizQuestion is {q, options, answer, hint?} parsed from the opaque lesson.quiz. So:
//  • "Question N of 5" + the 60%-progress bar are REAL (current index / real question count).
//  • "Pass: N/total correct" is the REAL threshold derived from QUIZ_PASS_PCT via passThreshold() — NOT the mockup's
//    hardcoded "4/5" (our contract is 60%, so a 5-question quiz needs 3).
//  • The "Onboarding Module 2" eyebrow degrades to the lesson's REAL module number ("Module {n}") — there is no
//    course-name field on CourseLesson, so we never fabricate "Onboarding".
//  • The "💡 Hint" block renders ONLY when the author supplied a hint on that question; absent → no block (never a
//    fabricated hint like the mockup's).
//  • The "⏱ 1:42" countdown is DROPPED — there is no per-quiz time-limit contract, so a timer would be fabricated.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { CourseLesson } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getLessons, markProgress } from '../../../features/education/education.api';
import { parseQuiz, scoreQuiz, passThreshold, type QuizQuestion, type QuizResult } from '../../../features/education/learn';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function Quiz() {
  const { id, courseId, enrollmentId } = useLocalSearchParams<{ id: string; courseId?: string; enrollmentId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('ambassador_training');
  const [lesson, setLesson] = useState<CourseLesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [current, setCurrent] = useState(0);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const cid = courseId ?? '';
    const ls = cid ? await getLessons(cid) : [];
    setLesson(ls.find((l) => l.id === id) ?? null);
    setLoading(false);
  }, [id, courseId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const questions: QuizQuestion[] | null = useMemo(() => (lesson ? parseQuiz(lesson.quiz) : null), [lesson]);
  const total = questions?.length ?? 0;
  const isLast = current >= total - 1;

  if (!enabled) return <ScreenScaffold title={t('amb.quiz.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const submitAll = async (finalAnswers: Record<number, number>) => {
    if (!questions || !enrollmentId || !id) return;
    const r = scoreQuiz(questions, questions.map((_, i) => finalAnswers[i] ?? null));
    setResult(r);
    setBusy(true);
    try { await markProgress(enrollmentId, id, { quizScore: r.scorePct, completed: r.passed }); }
    catch { Alert.alert(t('amb.quiz.title'), t('amb.quiz.submitFailed')); }
    finally { setBusy(false); }
  };

  // Advance one question; on the last, score + submit. `skipped` leaves the answer unset.
  const advance = async () => {
    if (isLast) { await submitAll(answers); return; }
    setCurrent((c) => Math.min(c + 1, total - 1));
  };

  const q = questions ? questions[current] : null;
  const selected = answers[current];
  const modNo = lesson?.moduleNo ?? null;
  const passNeeded = passThreshold(total);
  const progressPct = total > 0 ? Math.round(((current + 1) / total) * 100) : 0;

  return (
    <ScreenScaffold
      title={t('amb.quiz.title')}
      scroll
      footer={
        result ? (
          <Button title={t('amb.quiz.done')} onPress={() => router.back()} />
        ) : q ? (
          <View style={styles.ctaRow}>
            <Button title={t('amb.quiz.skip')} variant="outline" onPress={advance} disabled={busy} />
            <View style={{ flex: 1.5 }}>
              <Button title={t('amb.quiz.submitAnswer')} onPress={advance} loading={busy} disabled={selected == null || busy} />
            </View>
          </View>
        ) : undefined
      }
    >
      {loading ? <SkeletonCard lines={6} /> : !questions ? (
        <EmptyState title={t('amb.quiz.unavailable.title')} message={t('amb.quiz.unavailable.message')} />
      ) : result ? (
        <Card style={{ alignItems: 'center' }}>
          <StatusPill label={t(result.passed ? 'amb.quiz.passed' : 'amb.quiz.failed')} tone={result.passed ? 'success' : 'danger'} />
          <Text style={styles.score}>{t('amb.quiz.score', { score: String(result.scorePct), correct: String(result.correct), total: String(result.total) })}</Text>
          {!result.passed ? <Text style={styles.retry}>{t('amb.quiz.retryNote')}</Text> : null}
        </Card>
      ) : q ? (
        <View style={{ gap: space[4] }}>
          {/* Progress hero */}
          <View style={styles.hero}>
            {modNo != null ? <Text style={styles.heroEyebrow}>{t('amb.quiz.module', { n: String(modNo) })}</Text> : null}
            <Text style={styles.heroQOf}>{t('amb.quiz.qOf', { n: String(current + 1), total: String(total) })}</Text>
            <Text style={styles.heroPass}>{t('amb.quiz.pass', { n: String(passNeeded), total: String(total) })}</Text>
            <View style={styles.track}><View style={[styles.fill, { width: `${progressPct}%` }]} /></View>
          </View>

          {/* Question + lettered options */}
          <Text style={styles.q}>{q.q}</Text>
          <View style={{ gap: space[2] }}>
            {q.options.map((opt, oi) => {
              const sel = selected === oi;
              return (
                <Pressable key={oi} onPress={() => setAnswers((a) => ({ ...a, [current]: oi }))} style={[styles.opt, sel && styles.optOn]} accessibilityRole="radio" accessibilityState={{ selected: sel }}>
                  <View style={[styles.letter, sel && styles.letterOn]}><Text style={[styles.letterText, sel && styles.letterTextOn]}>{LETTERS[oi] ?? String(oi + 1)}</Text></View>
                  <Text style={[styles.optText, sel && styles.optTextOn]}>{opt}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Optional hint — only when the author supplied one (§13) */}
          {q.hint ? (
            <View style={styles.hint}>
              <Text style={styles.hintText}><Text style={styles.hintLabel}>{t('amb.quiz.hintLabel')} </Text>{q.hint}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <EmptyState title={t('amb.quiz.unavailable.title')} message={t('amb.quiz.unavailable.message')} />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { padding: space[4], borderRadius: radius.lg, backgroundColor: color.ink900, gap: space[2] },
  heroEyebrow: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.card, opacity: 0.85, textTransform: 'uppercase', letterSpacing: 0.8 },
  heroQOf: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.card },
  heroPass: { fontFamily: font.body, fontSize: font.size.xs, color: color.card, opacity: 0.85 },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden', marginTop: space[1] },
  fill: { height: '100%', borderRadius: 2, backgroundColor: color.gold500 },
  q: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, lineHeight: font.size.lg * 1.3 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.md, borderWidth: 2, borderColor: color.ink200, backgroundColor: color.card, minHeight: 48 },
  optOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  letter: { width: 32, height: 32, borderRadius: 16, backgroundColor: color.earth200, alignItems: 'center', justifyContent: 'center' },
  letterOn: { backgroundColor: color.primary600 },
  letterText: { fontFamily: font.display, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink700 },
  letterTextOn: { color: color.card },
  optText: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink800 },
  optTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  hint: { padding: space[3], borderRadius: radius.md, backgroundColor: color.infoLight },
  hintText: { fontFamily: font.body, fontSize: font.size.xs, color: color.infoDark, lineHeight: font.size.xs * 1.5 },
  hintLabel: { fontWeight: font.weight.bold },
  ctaRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  score: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[3] },
  retry: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[2], textAlign: 'center' },
});
