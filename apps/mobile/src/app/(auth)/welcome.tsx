// apps/mobile/src/app/(auth)/welcome.tsx · screen 01 (Welcome) — rebuilt to match the Phase-1 design
// (Krishalaya_Design_System/screens/01-welcome.html): brand mark + "From Farm to Future" tag, two soft
// decorative glows (accent top-right, primary bottom-left), a framed hero illustration, the bilingual promise
// (vernacular line + display title), the subtitle, a full-width gold "Get Started" CTA, and a "Sign in" link.
// Pure presentation — no data, no business logic (guide §3). All copy via i18n (hi/en/gu); all colour/space/
// radius/type from ui-native tokens (never hardcoded). Cannot throw → no loading/empty/error states needed (no
// fetch); the global AppErrorBoundary remains the last resort (Law 12).
//
// The logo mark uses the ui-native <Icon name="wheat"> vector and the hero uses the <BrandHero> illustration —
// both react-native-svg components ported 1:1 from the design (no emoji, no raster). Tokens-only colours.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button, BrandHero, Icon, color, font, space, radius, shadow } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';

export default function Welcome() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Decorative background glows (design ::before / ::after) — purely ornamental, hidden from a11y. */}
      <View pointerEvents="none" style={styles.glowTop} accessibilityElementsHidden importantForAccessibility="no" />
      <View pointerEvents="none" style={styles.glowBottom} accessibilityElementsHidden importantForAccessibility="no" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} bounces={false}>
        {/* Logo / brand */}
        <View style={styles.brandBlock}>
          <View style={styles.logoMark} accessibilityElementsHidden importantForAccessibility="no">
            <Icon name="wheat" size={52} color={color.accent300} weight={2.5} />
          </View>
          <Text style={styles.brandName}>{t('app.name')}</Text>
          <Text style={styles.brandTag}>{t('welcome.tagline')}</Text>
        </View>

        {/* Hero illustration (design's farmer-with-phone vector). */}
        <View style={styles.hero}>
          <BrandHero size={260} />
        </View>

        {/* Title + subtitle */}
        <View style={styles.content}>
          <Text style={styles.titleVern}>{t('welcome.heroVern')}</Text>
          <Text style={styles.title}>{t('welcome.title')}</Text>
          <Text style={styles.subtitle}>{t('welcome.subtitle')}</Text>
        </View>
      </ScrollView>

      {/* Actions pinned to the bottom (above safe-area inset). */}
      <View style={styles.actions}>
        <Button title={t('welcome.getStarted')} size="lg" onPress={() => router.push('/(auth)/language')} />
        <Pressable
          onPress={() => router.push('/(auth)/phone')}
          accessibilityRole="button"
          accessibilityLabel={`${t('welcome.haveAccount')} ${t('welcome.signIn')}`}
          hitSlop={12}
          style={styles.signinWrap}
        >
          <Text style={styles.signinText}>
            {t('welcome.haveAccount')} <Text style={styles.signinStrong}>{t('welcome.signIn')}</Text>
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page, overflow: 'hidden' },
  // Glows
  glowTop: { position: 'absolute', top: -100, right: -100, width: 300, height: 300, borderRadius: 150, backgroundColor: color.accent200, opacity: 0.45 },
  glowBottom: { position: 'absolute', bottom: 80, left: -120, width: 320, height: 320, borderRadius: 160, backgroundColor: color.primary100, opacity: 0.4 },

  scroll: { flexGrow: 1, paddingTop: space[12], paddingHorizontal: space[6] },

  // Brand
  brandBlock: { alignItems: 'center' },
  logoMark: { width: 88, height: 88, borderRadius: radius.xl, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center', marginBottom: space[4], ...shadow.floating },
  brandName: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.ink800, letterSpacing: -0.4 },
  brandTag: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: space[1] },

  // Hero
  hero: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', paddingVertical: space[6] },

  // Content
  content: { alignItems: 'center', paddingBottom: space[4] },
  titleVern: { fontFamily: font.vernacular, fontSize: font.size.xl, fontWeight: font.weight.semibold, color: color.primary700, textAlign: 'center', marginBottom: space[3], lineHeight: 30 },
  title: { fontFamily: font.display, fontSize: font.size['3xl'], fontWeight: font.weight.bold, color: color.ink800, textAlign: 'center', letterSpacing: -0.5, marginBottom: space[3], lineHeight: 36 },
  subtitle: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, textAlign: 'center', lineHeight: 24 },

  // Actions
  actions: { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4] },
  signinWrap: { marginTop: space[4], alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  signinText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, textAlign: 'center' },
  signinStrong: { color: color.primary700, fontWeight: font.weight.semibold },
});
