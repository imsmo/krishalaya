// apps/mobile/src/app/(worker)/help.tsx · screen 144 (Help & Support — worker). Thin screen (guide §3): a help
// hub — 4 quick actions, a common-questions accordion (static factual worker/wage help copy — not user data), and
// the fixed "your worker rights" panel (statutory/program info). Behind `worker_app`. Degrade-never-die.
//
// §13 (no contract → rendered honestly, never faked):
//  • "Ask AI · Voice" — there is no worker AI-assistant screen built yet (only the farmer one) → coming-soon,
//    never a cross-role screen faked in.
//  • "Call helpline" — no helpline number in app config/contract → coming-soon, never a fabricated tel: number
//    (same decision as the farmer help screen 123).
//  • "Report wage issue" — no labour-dispute endpoint → files a real high-priority SUPPORT TICKET (openTicket, P1,
//    idempotent Law 3), the same path as the wage-dispute screen (143).
//  • "My rights" — scrolls to the rights panel on this screen (real, no navigation target invented).
// The FAQ answers + rights are STATIC program/legal info (like PMSBY on screen 39), authored copy via i18n — not
// per-user data — so they are fixed labels, not fabricated values.
import React, { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Card, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { openTicket } from '../../features/profile/profile.api';
import { HELP_FAQS, HELP_RIGHTS, WAGE_TICKET_SEVERITY } from '../../features/labour/worker-help';

export default function WorkerHelp() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [openFaq, setOpenFaq] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const rightsY = useRef(0);

  if (!enabled) return <ScreenScaffold title={t('workerHelp.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const comingSoon = (title: string) => Alert.alert(title, t('workerHelp.comingSoon'));

  const reportWageIssue = () => {
    Alert.alert(t('workerHelp.action.report'), t('workerHelp.reportConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('workerHelp.reportCta'),
        onPress: async () => {
          setReporting(true);
          try {
            await openTicket({ subject: t('workerHelp.reportSubject'), severity: WAGE_TICKET_SEVERITY });
            Alert.alert(t('workerHelp.reportedTitle'), t('workerHelp.reportedBody'));
          } catch {
            Alert.alert(t('workerHelp.action.report'), t('common.error.generic'));
          } finally { setReporting(false); }
        },
      },
    ]);
  };

  const scrollToRights = () => scrollRef.current?.scrollTo({ y: Math.max(0, rightsY.current - space[3]), animated: true });

  return (
    <ScreenScaffold title={t('workerHelp.title')} scroll={false}>
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[6], gap: space[3] }}>
        {/* Quick actions */}
        <View style={styles.grid}>
          <Action icon="🤖" title={t('workerHelp.action.askAi')} sub={t('workerHelp.action.askAiSub')} onPress={() => comingSoon(t('workerHelp.action.askAi'))} />
          <Action icon="⚠" title={t('workerHelp.action.report')} sub={t('workerHelp.action.reportSub')} tone="danger" busy={reporting} onPress={reportWageIssue} />
          <Action icon="📞" title={t('workerHelp.action.call')} sub={t('workerHelp.action.callSoon')} onPress={() => comingSoon(t('workerHelp.action.call'))} />
          <Action icon="🛡" title={t('workerHelp.action.rights')} sub={t('workerHelp.action.rightsSub')} onPress={scrollToRights} />
        </View>

        {/* Common questions */}
        <Text style={styles.section}>{t('workerHelp.commonQ')}</Text>
        <Card>
          {HELP_FAQS.map((q, i) => {
            const on = openFaq === q;
            return (
              <View key={q} style={i > 0 ? styles.divide : undefined}>
                <Pressable onPress={() => setOpenFaq(on ? null : q)} accessibilityRole="button" accessibilityState={{ expanded: on }} style={styles.faqRow}>
                  <Text style={styles.faqQ} numberOfLines={2}>{t(`workerHelp.q.${q}.q`)}</Text>
                  <Text style={styles.chev}>{on ? '⌄' : '›'}</Text>
                </Pressable>
                {on ? <Text style={styles.faqA}>{t(`workerHelp.q.${q}.a`)}</Text> : null}
              </View>
            );
          })}
        </Card>

        {/* Your worker rights — fixed program/legal info */}
        <View onLayout={(e) => { rightsY.current = e.nativeEvent.layout.y; }}>
          <Text style={styles.section}>{t('workerHelp.rightsTitle')}</Text>
          <View style={styles.rights}>
            {HELP_RIGHTS.map((r) => (
              <View key={r} style={styles.rightRow}>
                <Text style={styles.tick}>✓</Text>
                <Text style={styles.rightTxt}>{t(`workerHelp.right.${r}`)}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </ScreenScaffold>
  );
}

function Action({ icon, title, sub, onPress, tone, busy }: { icon: string; title: string; sub: string; onPress: () => void; tone?: 'danger'; busy?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" style={[styles.action, tone === 'danger' && styles.actionDanger, busy && styles.actionBusy]}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={[styles.actionTitle, tone === 'danger' && styles.actionTitleDanger]}>{title}</Text>
      <Text style={styles.actionSub} numberOfLines={1}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  action: { width: '48%', flexGrow: 1, backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, padding: space[3], minHeight: 92 },
  actionDanger: { borderColor: color.danger, backgroundColor: color.dangerLight },
  actionBusy: { opacity: 0.6 },
  actionIcon: { fontSize: 24 },
  actionTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[1] },
  actionTitleDanger: { color: color.dangerDark },
  actionSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[2], marginBottom: space[2] },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  faqRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, gap: space[3] },
  faqQ: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
  chev: { fontFamily: font.body, fontSize: font.size.lg, color: color.ink400 },
  faqA: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.5, paddingBottom: space[3] },
  rights: { backgroundColor: color.successLight, borderRadius: radius.lg, padding: space[3], gap: space[2] },
  rightRow: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start' },
  tick: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.successDark },
  rightTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: font.size.sm * 1.4 },
});
