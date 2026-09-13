import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, Text } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { MonthlyInsight } from '@/services/insights';
import { statusColors } from '@/theme/colors';

interface Props {
  insights: MonthlyInsight[];
  /**
   * Când luna nu e acoperită integral de extrase, afirmațiile comparative nu se
   * mai afișează deloc: „cheltuiești cu 40% mai puțin" pe o lună cu un extras
   * lipsă e pur și simplu falsă. Arătăm în locul lor motivul.
   */
  incompleteNote?: string | null;
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

export default function InsightsCard({ insights, incompleteNote }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  if (incompleteNote != null && incompleteNote !== '') {
    return (
      <View style={[styles.card, { backgroundColor: C.card, borderColor: statusColors.warning }]}>
        <View style={styles.header}>
          <Ionicons name="alert-circle-outline" size={16} color={statusColors.warning} />
          <Text style={[styles.title, { color: C.text }]}>Date incomplete</Text>
        </View>
        <Text style={[styles.rowText, { color: C.textSecondary }]}>{incompleteNote}</Text>
      </View>
    );
  }

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
