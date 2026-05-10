import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, Text } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { MonthlyInsight } from '@/services/insights';
import { statusColors } from '@/theme/colors';

interface Props {
  insights: MonthlyInsight[];
}

function iconFor(insight: MonthlyInsight): keyof typeof Ionicons.glyphMap {
  if (insight.severity === 'warning') return 'trending-up';
  if (insight.severity === 'positive') return 'trending-down';
  return 'sparkles-outline';
}

function colorFor(insight: MonthlyInsight, fallback: string): string {
  if (insight.severity === 'warning') return statusColors.critical;
  if (insight.severity === 'positive') return statusColors.ok;
  return fallback;
}

export default function InsightsCard({ insights }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  if (insights.length === 0) return null;

  return (
    <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={styles.header}>
        <Ionicons name="sparkles" size={16} color={C.text} />
        <Text style={[styles.title, { color: C.text }]}>Ce e diferit luna asta?</Text>
      </View>
      <View style={styles.list}>
        {insights.map(it => (
          <View key={it.id} style={styles.row}>
            <Ionicons
              name={iconFor(it)}
              size={16}
              color={colorFor(it, C.textSecondary)}
              style={styles.rowIcon}
            />
            <Text style={[styles.rowText, { color: C.text }]}>{it.message}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  list: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  rowIcon: {
    marginTop: 2,
  },
  rowText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
