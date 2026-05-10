import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, Text } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { RecurringSeries, RecurringStatus } from '@/services/recurring';
import { statusColors } from '@/theme/colors';

const MAX_DISPLAY = 5;

interface Props {
  series: RecurringSeries[];
}

function statusLabel(s: RecurringStatus): string {
  if (s === 'active') return 'activ';
  if (s === 'missing') return 'lipsește';
  return 'oprit';
}

function statusColor(s: RecurringStatus, fallback: string): string {
  if (s === 'missing') return statusColors.critical;
  if (s === 'expired') return fallback;
  return statusColors.ok;
}

function daysSince(dateYmd: string, today: Date): number {
  const d = new Date(`${dateYmd}T00:00:00Z`).getTime();
  return Math.round((today.getTime() - d) / (1000 * 60 * 60 * 24));
}

export default function RecurringSummary({ series }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  if (series.length === 0) return null;

  const today = new Date();
  const visible = series.slice(0, MAX_DISPLAY);
  const hidden = series.length - visible.length;
  const activeCount = series.filter(s => s.status === 'active').length;
  const missingCount = series.filter(s => s.status === 'missing').length;

  return (
    <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={styles.header}>
        <Ionicons name="repeat" size={16} color={C.text} />
        <Text style={[styles.title, { color: C.text }]}>Abonamente recurente</Text>
        <Text style={[styles.subtitle, { color: C.textSecondary }]}>
          {activeCount} active{missingCount > 0 ? ` • ${missingCount} lipsesc` : ''}
        </Text>
      </View>
      <View style={styles.list}>
        {visible.map(s => (
          <View key={s.merchant_normalized} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.merchant, { color: C.text }]} numberOfLines={1}>
                {s.merchant_display}
              </Text>
              <Text style={[styles.meta, { color: C.textSecondary }]} numberOfLines={1}>
                {s.median_amount_ron.toFixed(2)} RON · ~{s.cadence_days} zile
                {s.category_name ? ` · ${s.category_name}` : ''}
                {s.status === 'missing'
                  ? ` · lipsește de ${daysSince(s.last_seen, today)} zile`
                  : ''}
              </Text>
            </View>
            <View
              style={[
                styles.badge,
                { backgroundColor: `${statusColor(s.status, C.textSecondary)}22` },
              ]}
            >
              <Text style={[styles.badgeText, { color: statusColor(s.status, C.textSecondary) }]}>
                {statusLabel(s.status)}
              </Text>
            </View>
          </View>
        ))}
      </View>
      {hidden > 0 ? (
        <Text style={[styles.more, { color: C.textSecondary }]}>+{hidden} altele</Text>
      ) : null}
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
  subtitle: {
    fontSize: 12,
    marginLeft: 'auto',
  },
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  merchant: {
    fontSize: 13,
    fontWeight: '500',
  },
  meta: {
    fontSize: 12,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  more: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
});
