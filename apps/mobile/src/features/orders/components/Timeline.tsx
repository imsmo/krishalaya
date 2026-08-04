// apps/mobile/src/features/orders/components/Timeline.tsx · a vertical progress timeline for shipment tracking.
// Feature-specific composite, ui-native tokens only (guide §3). Presentational: it renders pre-computed steps
// (see order-status.trackingSteps) — reached steps are filled, the current step is emphasized.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { color, font, space, radius } from '@krishalaya/ui-native';
import type { TrackingStep } from '../order-status';

export function Timeline({ steps, labelFor }: { steps: TrackingStep[]; labelFor: (key: string) => string }) {
  return (
    <View>
      {steps.map((s, i) => (
        <View key={s.key} style={styles.row} accessibilityRole="text" accessibilityState={{ selected: s.current }}>
          <View style={styles.rail}>
            <View style={[styles.dot, s.reached && styles.dotOn, s.current && styles.dotCurrent]} />
            {i < steps.length - 1 ? <View style={[styles.line, s.reached && styles.lineOn]} /> : null}
          </View>
          <Text style={[styles.label, s.reached && styles.labelOn, s.current && styles.labelCurrent]}>{labelFor(s.key)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  rail: { alignItems: 'center', width: 20 },
  dot: { width: 14, height: 14, borderRadius: radius.pill, backgroundColor: color.ink200, marginTop: 2 },
  dotOn: { backgroundColor: color.primary600 },
  dotCurrent: { backgroundColor: color.primary600, borderWidth: 3, borderColor: color.primary100 },
  line: { width: 2, flex: 1, minHeight: 28, backgroundColor: color.ink200, marginVertical: 2 },
  lineOn: { backgroundColor: color.primary600 },
  label: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink400, paddingBottom: space[4] },
  labelOn: { color: color.ink700 },
  labelCurrent: { color: color.ink900, fontWeight: font.weight.bold },
});
