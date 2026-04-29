import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EvidenceList } from '@/components/EvidenceList';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { statusColors } from '@/theme/colors';
import type { ChatMessage as ChatMessageType } from '@/types';

interface Props {
  message: ChatMessageType;
}

function renderBoldedText(text: string, color: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return (
        <Text key={i} style={{ fontWeight: '700', color }}>
          {p.slice(2, -2)}
        </Text>
      );
    }
    return (
      <Text key={i} style={{ color }}>
        {p}
      </Text>
    );
  });
}

export function ChatMessage({ message }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [open, setOpen] = useState(false);

  if (message.role === 'system_error') {
    return (
      <View style={[styles.errorBubble, { borderColor: statusColors.critical }]}>
        <Text style={{ color: statusColors.critical }}>{message.content}</Text>
      </View>
    );
  }

  const isUser = message.role === 'user';
  const bg = isUser ? C.primary : C.card;
  const fg = isUser ? '#ffffff' : C.text;

  return (
    <View style={[styles.row, { justifyContent: isUser ? 'flex-end' : 'flex-start' }]}>
      <View
        style={[
          styles.bubble,
          { backgroundColor: bg, alignSelf: isUser ? 'flex-end' : 'flex-start' },
        ]}
      >
        <Text style={{ color: fg }}>{renderBoldedText(message.content, fg)}</Text>
        {!isUser && message.evidence && message.evidence.length > 0 && (
          <View>
            <Pressable onPress={() => setOpen(o => !o)} style={styles.evidenceToggle}>
              <Ionicons
                name={open ? 'chevron-down' : 'chevron-forward'}
                size={14}
                color={C.textSecondary}
              />
              <Text style={{ color: C.textSecondary, fontSize: 12, marginLeft: 4 }}>
                Sursa: {message.evidence.length}
              </Text>
            </Pressable>
            {open && <EvidenceList evidence={message.evidence} />}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginVertical: 4, paddingHorizontal: 12 },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  errorBubble: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 6,
    backgroundColor: 'rgba(216, 76, 76, 0.08)',
  },
  evidenceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
});
