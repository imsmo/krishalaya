// apps/mobile/src/app/(system)/feedback.tsx · screen 195 (feedback CTA). Thin screen (guide §3): a 💛 hero, a
// star rating, "what works well?" feature chips, a free-text "what can we improve?" note, the founder note, and
// Maybe Later / Submit. Submitting opens a REAL low-priority support ticket (P-22 support module, idempotent —
// Law 3) with the rating + selections composed into the ticket subject. Behind `system_screens`.
// Degrade-never-die (designed states / inline error).
//
// §13 (NOT faked): the mobile contract has NO dedicated product-feedback endpoint — `support.open` accepts a
// subject only (no structured rating field, no free body, no attachment). So the rating + liked features + note are
// composed into the ticket SUBJECT (bounded, §system.composeFeedback), and the design's "🎤 Voice note" / "📷
// Screenshot" attach options CANNOT be wired (a ticket has no attachment path) — they show as a coming-soon note
// rather than dead buttons. The "reads every feedback personally · reply within 48 hours" line is the founder's
// static product copy (chrome), NOT a system-enforced SLA. A structured feedback+media endpoint is flagged.
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Input, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { submitFeedback } from '../../features/system/system.api';
import { FEEDBACK_FEATURES, feedbackFeatureLabelKey, canSubmitFeedback, composeFeedback } from '../../features/system/system';

const FEATURE_ICON: Record<string, string> = {
  voice: '🎤', mandi: '📊', weather: '🌧', payouts: '💰', protection: '🛡', worker: '👷',
};

export default function Feedback() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('system_screens');
  const [rating, setRating] = useState(0);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const canSubmit = useMemo(() => canSubmitFeedback(rating), [rating]);
  const toggle = (f: string) => setLiked((prev) => { const n = new Set(prev); if (n.has(f)) n.delete(f); else n.add(f); return n; });

  if (!enabled) return <ScreenScaffold title={t('system.feedback.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await submitFeedback(composeFeedback(rating, FEEDBACK_FEATURES.filter((f) => liked.has(f)), note));
      Alert.alert(t('system.feedback.title'), t('system.feedback.thanks'));
      router.back();
    } catch { Alert.alert(t('system.feedback.title'), t('system.feedback.failed')); }
    finally { setBusy(false); }
  };

  return (
    <ScreenScaffold
      title={t('system.feedback.title')}
      scroll
      footer={
        <View style={styles.footer}>
          <View style={{ flex: 1 }}><Button title={t('system.feedback.maybeLater')} variant="outline" onPress={() => router.back()} /></View>
          <View style={{ flex: 2 }}><Button title={t('system.feedback.submit')} loading={busy} disabled={!canSubmit} onPress={submit} /></View>
        </View>
      }
    >
      <View style={styles.hero}>
        <Text style={styles.heroIcon}>💛</Text>
        <Text style={styles.heroTitle}>{t('system.feedback.heading')}</Text>
        <Text style={styles.heroSub}>{t('system.feedback.sub')}</Text>
      </View>

      <Card>
        <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={t('system.feedback.rateHint')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setRating(n)} accessibilityRole="button" accessibilityLabel={`${n}`} hitSlop={8}>
              <Text style={[styles.star, { opacity: n <= rating ? 1 : 0.25 }]}>⭐</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.rateHint}>{t('system.feedback.rateHint')}</Text>
      </Card>

      <Text style={styles.section}>{t('system.feedback.worksWell')}</Text>
      <View style={styles.chips}>
        {FEEDBACK_FEATURES.map((f) => {
          const on = liked.has(f);
          return (
            <Pressable key={f} onPress={() => toggle(f)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{`${FEATURE_ICON[f]} ${t(feedbackFeatureLabelKey(f))}${on ? ' ✓' : ''}`}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.section}>{t('system.feedback.improve')}</Text>
      <Card>
        <Input value={note} onChangeText={setNote} multiline maxLength={250} placeholder={t('system.feedback.placeholder')} />
        <Text style={styles.attachNote}>{t('system.feedback.attachSoon')}</Text>
      </Card>

      <View style={styles.founder}>
        <Text style={styles.founderText}>{t('system.feedback.founderNote')}</Text>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space[2], padding: space[5], borderRadius: radius.lg, backgroundColor: color.primary50, marginBottom: space[3] },
  heroIcon: { fontSize: 48 },
  heroTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900, textAlign: 'center' },
  heroSub: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600, textAlign: 'center' },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: space[2] },
  star: { fontSize: 40 },
  rateHint: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, textAlign: 'center', marginTop: space[2] },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: 999, backgroundColor: color.earth100, borderWidth: 1, borderColor: color.earth200 },
  chipOn: { backgroundColor: color.successLight, borderColor: color.success },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  chipTextOn: { color: color.successDark },
  attachNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2] },
  founder: { marginTop: space[4], padding: space[3], borderRadius: radius.md, backgroundColor: color.successLight },
  founderText: { fontFamily: font.body, fontSize: font.size.sm, color: color.successDark, lineHeight: 20 },
  footer: { flexDirection: 'row', gap: space[3] },
});
