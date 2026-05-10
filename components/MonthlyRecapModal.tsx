import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { MonthlyRecap } from '@/services/monthlyRecap';
import { primary, statusColors } from '@/theme/colors';

const RO_MONTHS = [
  'Ianuarie',
  'Februarie',
  'Martie',
  'Aprilie',
  'Mai',
  'Iunie',
  'Iulie',
  'August',
  'Septembrie',
  'Octombrie',
  'Noiembrie',
  'Decembrie',
];

function ymToLabel(ym: string): string {
  const [y, m] = ym.split('-').map(n => parseInt(n, 10));
  if (!y || !m) return ym;
  return `${RO_MONTHS[m - 1]} ${y}`;
}

interface Props {
  recap: MonthlyRecap | null;
  onDismiss: () => void;
}

export default function MonthlyRecapModal({ recap, onDismiss }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  if (!recap) return null;

  const deltaColor =
    recap.delta_vs_previous_pct == null
      ? C.textSecondary
      : recap.delta_vs_previous_pct > 0
        ? statusColors.critical
        : statusColors.ok;

  const deltaText =
    recap.delta_vs_previous_pct == null
      ? null
      : recap.delta_vs_previous_pct > 0
        ? `cu ${Math.round(recap.delta_vs_previous_pct)}% mai mult față de luna anterioară`
        : `cu ${Math.round(Math.abs(recap.delta_vs_previous_pct))}% mai puțin față de luna anterioară`;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={styles.header}>
            <Ionicons name="calendar" size={20} color={primary} />
            <Text style={[styles.title, { color: C.text }]}>{ymToLabel(recap.month)} pe scurt</Text>
          </View>

          <View style={styles.section}>
            <Text style={[styles.label, { color: C.textSecondary }]}>Cheltuieli totale</Text>
            <Text style={[styles.amount, { color: C.text }]}>
              {recap.expense_ron.toFixed(2)} RON
            </Text>
            {deltaText ? (
              <Text style={[styles.delta, { color: deltaColor }]}>{deltaText}</Text>
            ) : null}
          </View>

          {recap.top_categories.length > 0 ? (
            <View style={styles.section}>
              <Text style={[styles.label, { color: C.textSecondary }]}>Top categorii</Text>
              {recap.top_categories.map(c => (
                <View key={c.category_id ?? c.name} style={styles.catRow}>
                  <Text style={[styles.catName, { color: C.text }]} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text style={[styles.catAmount, { color: C.text }]}>
                    {c.amount_ron.toFixed(0)} RON
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {recap.highlight_insight ? (
            <View
              style={[styles.insight, { borderColor: C.border, backgroundColor: C.background }]}
            >
              <Ionicons name="sparkles" size={14} color={primary} />
              <Text style={[styles.insightText, { color: C.text }]}>{recap.highlight_insight}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.btnText}>OK, înțeles</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: { fontSize: 18, fontWeight: '700' },
  section: { gap: 4 },
  label: { fontSize: 12 },
  amount: { fontSize: 24, fontWeight: '700' },
  delta: { fontSize: 13, marginTop: 2 },
  catRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  catName: { flex: 1, fontSize: 14, marginRight: 8 },
  catAmount: { fontSize: 14, fontWeight: '600' },
  insight: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  insightText: { flex: 1, fontSize: 13, lineHeight: 18 },
  btn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
