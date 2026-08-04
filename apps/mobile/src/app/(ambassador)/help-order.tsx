// apps/mobile/src/app/(ambassador)/help-order.tsx · screen 163 (Help with Order). Thin screen (guide §3): a
// COACHING checklist the ambassador walks the farmer through on the FARMER's own login when their first order
// arrives — the app never places/confirms an order as someone else (Law 4/11). Behind `ambassador_app`.
// Degrade-never-die.
//
// §13 (NOT faked): the ambassador has NO contract to read another farmer's order (no order number, buyer name,
// item, ₹8,550 total), no buyer-reputation read, no farmer phone (PII-minimised referral), and no commission-plan
// amount. So the header is generic ("Help a farmer with their first order"), there is no order/buyer/total card
// and no Call button, the action items are fixed guidance (not a live order), and the earning line is generic
// (never "₹85 / 1% GMV"). Primary action opens the ambassador's real Field Visit log to schedule the visit.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';

const ACTIONS = ['reputation', 'escrow', 'transport', 'pack', 'dispatch'] as const;

export default function HelpOrder() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('ambassador_app');
  if (!enabled) return <ScreenScaffold title={t('amb.help.orderTitle')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('amb.help.orderTitle')} scroll footer={<Button title={t('amb.help.order.scheduleVisit')} onPress={() => router.push('/(ambassador)/visit-log')} />}>
      <View style={{ gap: space[3] }}>
        {/* Intro — generic, §13: no fabricated order/buyer/farmer identity */}
        <Card style={styles.intro}>
          <Text style={styles.heading}>{t('amb.help.order.heading')}</Text>
          <Text style={styles.note}>{t('amb.help.onBehalfNote')}</Text>
        </Card>

        {/* Why they may need help */}
        <View style={styles.tip}>
          <Text style={styles.tipIcon}>💡</Text>
          <Text style={styles.tipTxt}>{t('amb.help.order.why')}</Text>
        </View>

        {/* Action items — fixed coaching checklist */}
        <Text style={styles.section}>{t('amb.help.order.actionsTitle')}</Text>
        <Card style={{ gap: space[1] }}>
          {ACTIONS.map((a, i) => (
            <View key={a} style={[styles.actionRow, i > 0 && styles.divide]}>
              <Text style={styles.check}>○</Text>
              <Text style={styles.actionTxt}>{t(`amb.help.order.action.${a}`)}</Text>
            </View>
          ))}
        </Card>

        {/* Earning — §13: no fabricated ₹85 / 1% figure */}
        <View style={styles.earn}>
          <Text style={styles.earnIcon}>💰</Text>
          <Text style={styles.earnTxt}>{t('amb.help.order.earn')}</Text>
        </View>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  intro: { backgroundColor: color.primary50 },
  heading: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900 },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[2], lineHeight: font.size.sm * 1.5 },
  tip: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', backgroundColor: color.warningLight, borderRadius: radius.lg, padding: space[3] },
  tipIcon: { fontSize: 22 },
  tipTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: font.size.sm * 1.5 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[2] },
  actionRow: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', paddingVertical: space[2] },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  check: { fontFamily: font.body, fontSize: font.size.lg, color: color.primary600 },
  actionTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink800, lineHeight: font.size.sm * 1.5 },
  earn: { flexDirection: 'row', gap: space[3], alignItems: 'center', backgroundColor: color.accent, borderRadius: radius.lg, padding: space[3] },
  earnIcon: { fontSize: 24 },
  earnTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink900, lineHeight: font.size.sm * 1.5 },
});
