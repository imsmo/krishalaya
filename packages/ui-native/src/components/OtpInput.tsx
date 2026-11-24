// packages/ui-native/src/components/OtpInput.tsx · a segmented N-digit OTP field. Renders `length` boxes but is
// driven by a single hidden TextInput (the simplest robust RN pattern — avoids focus-juggling bugs across
// keyboards). Numeric-only, one-time-code autofill, calls onComplete when full. Value is controlled by the
// caller so the verify screen can clear it on error.
import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputInstance } from 'react-native';
import { color, font, radius, space } from '../theme';

export interface OtpInputProps {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  error?: boolean;
  testID?: string;
}

export function OtpInput({ value, onChange, length = 6, onComplete, autoFocus, error, testID }: OtpInputProps) {
  const ref = useRef<TextInputInstance>(null);
  const handle = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, length);
    onChange(digits);
    if (digits.length === length) onComplete?.(digits);
  };
  const cells = Array.from({ length });
  return (
    <Pressable onPress={() => ref.current?.focus()} testID={testID}>
      <View style={styles.row}>
        {cells.map((_, i) => {
          const filled = i < value.length;
          const active = i === value.length;
          return (
            <View key={i} style={[styles.cell, active && styles.cellActive, error && styles.cellError]}>
              <Text style={styles.digit}>{filled ? value[i] : ''}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={handle}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus={autoFocus}
        maxLength={length}
        style={styles.hidden}
        accessibilityLabel="One-time passcode"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[2], justifyContent: 'center' },
  cell: {
    width: 46, height: 56, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.ink200,
    backgroundColor: color.white, alignItems: 'center', justifyContent: 'center',
  },
  cellActive: { borderColor: color.primary600 },
  cellError: { borderColor: color.danger },
  digit: { fontFamily: font.body, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.ink800 },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
});
