// apps/mobile/src/features/messaging/components/MessageBubble.tsx · one chat message. Feature composite, ui-native
// tokens only (guide §3). Presentational: renders a pre-computed MessageView — mine (right, primary) vs theirs
// (left, card). Text renders inline; image/voice show a labeled chip (inline media thumbnail needs the media
// download-link wiring — flagged). A flagged message shows a subtle moderation marker.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { color, font, space, radius } from '@krishalaya/ui-native';
import type { MessageView } from '../message-view';

export function MessageBubble({ view, imageLabel, voiceLabel, flaggedLabel, time }: {
  view: MessageView; imageLabel: string; voiceLabel: string; flaggedLabel: string; time?: string;
}) {
  const mine = view.mine;
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        {view.kind === 'text' ? (
          <Text style={[styles.text, mine && styles.textMine]}>{view.body}</Text>
        ) : view.kind === 'image' ? (
          <Text style={[styles.media, mine && styles.textMine]}>📷 {imageLabel}</Text>
        ) : view.kind === 'voice' ? (
          <Text style={[styles.media, mine && styles.textMine]}>🎤 {voiceLabel}</Text>
        ) : null}
        {view.flagged ? <Text style={styles.flagged}>{flaggedLabel}</Text> : null}
        {time ? <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>{time}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginVertical: space[1] },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.lg },
  mine: { backgroundColor: color.primary600, borderBottomRightRadius: radius.sm },
  theirs: { backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderBottomLeftRadius: radius.sm },
  text: { fontFamily: font.body, fontSize: font.size.md, color: color.ink800 },
  textMine: { color: color.white },
  time: { fontFamily: font.body, fontSize: 9, marginTop: 4, alignSelf: 'flex-end' },
  timeMine: { color: color.white, opacity: 0.7 },
  timeTheirs: { color: color.ink400 },
  media: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
  flagged: { fontFamily: font.body, fontSize: font.size.xs, color: color.dangerDark, marginTop: 2 },
});
