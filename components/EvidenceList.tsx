import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { EvidenceItem } from '@/types';

interface Props {
  evidence: EvidenceItem[];
}

const INITIAL_VISIBLE = 10;

export function EvidenceList({ evidence }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [showAll, setShowAll] = useState(false);

  if (evidence.length === 0) return null;

  const visible = showAll ? evidence : evidence.slice(0, INITIAL_VISIBLE);
  const remaining = evidence.length - visible.length;

  const onPress = (item: EvidenceItem) => {
    if (item.kind === 'transaction') router.push(`/tranzactii/${item.id}` as never);
    else if (item.kind === 'account') router.push(`/conturi/${item.id}` as never);
  };

  return (
    <View style={[styles.container, { borderColor: C.border }]}>
      {visible.map((it, idx) => (
        <Pressable
          key={`${it.kind}-${'id' in it ? it.id : it.label}-${idx}`}
          onPress={() => onPress(it)}
          style={({ pressed }) => [
            styles.row,
            {
              borderBottomColor: C.border,
              backgroundColor: pressed ? C.primaryMuted : 'transparent',
            },
          ]}
        >
          <Text style={[styles.text, { color: C.text }]} numberOfLines={1}>
            {renderItem(it)}
          </Text>
          {(it.kind === 'transaction' || it.kind === 'account') && (
            <Ionicons name="chevron-forward" size={14} color={C.textSecondary} />
          )}
        </Pressable>
      ))}
      {remaining > 0 && (
        <Pressable onPress={() => setShowAll(true)} style={styles.row}>
          <Text style={[styles.more, { color: C.tint }]}>arată toate ({evidence.length})</Text>
        </Pressable>
      )}
    </View>
  );
}

function renderItem(it: EvidenceItem): string {
  switch (it.kind) {
    case 'transaction':
      return `${it.date} • ${it.merchant || '—'} • ${it.amount.toFixed(2)} • ${it.account}`;
    case 'account':
      return `${it.name} (${it.type})`;
    case 'category':
      return it.parent ? `${it.parent} / ${it.name}` : it.name;
    case 'aggregate':
      return `${it.label} • ${it.period} • ${it.total.toFixed(2)} (${it.count})`;
  }
}

const styles = StyleSheet.create({
  container: { borderTopWidth: 1, marginTop: 8, paddingTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  text: { fontSize: 13, flex: 1 },
  more: { fontSize: 13, fontWeight: '500' },
});
