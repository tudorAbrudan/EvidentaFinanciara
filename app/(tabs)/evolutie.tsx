import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  View as RNView,
  Text as RNText,
  ActivityIndicator,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { useCategories } from '@/hooks/useCategories';
import * as tx from '@/services/transactions';

const RANGE_OPTIONS = [
  { months: 3, label: '3 luni' },
  { months: 6, label: '6 luni' },
  { months: 12, label: '12 luni' },
];

const RO_MONTHS_SHORT = [
  'Ian',
  'Feb',
  'Mar',
  'Apr',
  'Mai',
  'Iun',
  'Iul',
  'Aug',
  'Sep',
  'Oct',
  'Noi',
  'Dec',
];

function ymToShortLabel(ym: string): string {
  const [, m] = ym.split('-').map(n => parseInt(n, 10));
  if (!m) return ym;
  return RO_MONTHS_SHORT[m - 1];
}

export default function EvolutieScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const [monthsBack, setMonthsBack] = useState(6);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [evolution, setEvolution] = useState<tx.CategoryEvolution[]>([]);
  const [totalsByMonth, setTotalsByMonth] = useState<{ ym: string; total: number }[]>([]);

  const { categories } = useCategories();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const catIds = categories.map(c => c.id);
      catIds.push(null as unknown as string); // pentru „Necategorizat"
      const evo = await tx.getCategoryEvolution(catIds as (string | null)[], monthsBack);
      setEvolution(evo);

      // Calculăm și totalul lunar (suma tuturor categoriilor) pentru chartul agregat
      const months = evo[0]?.series.map(s => s.yearMonth) ?? [];
      const totals = months.map(ym => {
        const sum = evo.reduce((acc, ev) => {
          const pt = ev.series.find(s => s.yearMonth === ym);
          return acc + (pt?.total_ron ?? 0);
        }, 0);
        return { ym, total: sum };
      });
      setTotalsByMonth(totals);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcare evoluție');
    } finally {
      setLoading(false);
    }
  }, [categories, monthsBack]);

  useEffect(() => {
    if (categories.length > 0) refresh();
  }, [refresh, categories.length]);

  const maxTotal = useMemo(() => Math.max(1, ...totalsByMonth.map(t => t.total)), [totalsByMonth]);

  const topCategories = useMemo(() => {
    const withTotals = evolution.map(ev => {
      const sum = ev.series.reduce((s, p) => s + p.total_ron, 0);
      const cat = categories.find(c => c.id === ev.category_id);
      return {
        category_id: ev.category_id,
        name: cat?.name ?? 'Necategorizat',
        color: cat?.color || primary,
        total: sum,
        series: ev.series,
      };
    });
    return withTotals
      .filter(c => c.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [evolution, categories]);

  const grandTotal = useMemo(() => totalsByMonth.reduce((s, t) => s + t.total, 0), [totalsByMonth]);

  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>
      <Stack.Screen options={{ title: 'Evoluție cheltuieli' }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.primary} />
        }
      >
        {/* Range picker */}
        <RNView style={styles.rangeRow}>
          {RANGE_OPTIONS.map(opt => {
            const isActive = opt.months === monthsBack;
            return (
              <Pressable
                key={opt.months}
                onPress={() => setMonthsBack(opt.months)}
                style={[
                  styles.rangeBtn,
                  { borderColor: C.border, backgroundColor: C.card },
                  isActive && { backgroundColor: primary, borderColor: primary },
                ]}
              >
                <RNText
                  style={[
                    styles.rangeText,
                    { color: isActive ? '#fff' : C.text },
                    isActive && { fontWeight: '600' },
                  ]}
                >
                  {opt.label}
                </RNText>
              </Pressable>
            );
          })}
        </RNView>

        {/* Summary card */}
        <RNView
          style={[styles.summaryCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
        >
          <RNText style={[styles.summaryLabel, { color: C.textSecondary }]}>
            Total cheltuieli ({monthsBack} luni)
          </RNText>
          <RNText style={[styles.summaryValue, { color: statusColors.critical }]}>
            -{Math.round(grandTotal).toLocaleString('ro-RO')} RON
          </RNText>
          {monthsBack > 0 && (
            <RNText style={[styles.summarySub, { color: C.textSecondary }]}>
              Media lunară: {Math.round(grandTotal / monthsBack).toLocaleString('ro-RO')} RON
            </RNText>
          )}
        </RNView>

        {/* Bar chart pentru totaluri lunare */}
        <RNText style={[styles.sectionTitle, { color: C.textSecondary }]}>Cheltuieli lunare</RNText>
        {loading && totalsByMonth.length === 0 ? (
          <ActivityIndicator color={primary} style={{ marginVertical: 32 }} />
        ) : (
          <RNView
            style={[styles.chartCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
          >
            <RNView style={styles.chartArea}>
              {totalsByMonth.map(t => {
                const heightPct = maxTotal > 0 ? (t.total / maxTotal) * 100 : 0;
                return (
                  <RNView key={t.ym} style={styles.chartBarCol}>
                    <RNView style={styles.chartBarWrap}>
                      <RNView
                        style={[
                          styles.chartBar,
                          {
                            backgroundColor: primary,
                            height: `${Math.max(2, heightPct)}%`,
                          },
                        ]}
                      />
                    </RNView>
                    <RNText style={[styles.chartBarLabel, { color: C.textSecondary }]}>
                      {ymToShortLabel(t.ym)}
                    </RNText>
                    <RNText style={[styles.chartBarValue, { color: C.text }]}>
                      {t.total > 0 ? Math.round(t.total / 1000) + 'k' : '—'}
                    </RNText>
                  </RNView>
                );
              })}
            </RNView>
          </RNView>
        )}

        {/* Top categorii */}
        <RNText style={[styles.sectionTitle, { color: C.textSecondary }]}>Top categorii</RNText>
        {error ? (
          <RNView
            style={[styles.emptyCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
          >
            <Ionicons
              name="alert-circle-outline"
              size={32}
              color={statusColors.critical}
              style={{ opacity: 0.7 }}
            />
            <RNText style={[styles.emptySub, { color: statusColors.critical }]}>{error}</RNText>
          </RNView>
        ) : topCategories.length === 0 && !loading ? (
          <RNView
            style={[styles.emptyCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
          >
            <Ionicons
              name="bar-chart-outline"
              size={32}
              color={C.textSecondary}
              style={{ opacity: 0.5 }}
            />
            <RNText style={[styles.emptySub, { color: C.textSecondary }]}>
              Nu există date pentru intervalul selectat.
            </RNText>
          </RNView>
        ) : (
          <RNView style={[styles.catCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
            {topCategories.map((cat, idx) => {
              const monthlyAvg = cat.total / monthsBack;
              const lastValue = cat.series[cat.series.length - 1]?.total_ron ?? 0;
              const prevValue = cat.series[cat.series.length - 2]?.total_ron ?? 0;
              const trend = prevValue > 0 ? ((lastValue - prevValue) / prevValue) * 100 : 0;
              return (
                <RNView
                  key={`${cat.category_id ?? 'none'}-${idx}`}
                  style={[
                    styles.catRow,
                    idx > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: C.border,
                    },
                  ]}
                >
                  <RNView style={styles.catRowTop}>
                    <RNView style={styles.catRowLabel}>
                      <RNView style={[styles.catDot, { backgroundColor: cat.color }]} />
                      <RNText style={[styles.catName, { color: C.text }]} numberOfLines={1}>
                        {cat.name}
                      </RNText>
                    </RNView>
                    <RNText style={[styles.catTotal, { color: C.text }]}>
                      {Math.round(cat.total).toLocaleString('ro-RO')} RON
                    </RNText>
                  </RNView>
                  <RNView style={styles.catRowMeta}>
                    <RNText style={[styles.catMeta, { color: C.textSecondary }]}>
                      Medie: {Math.round(monthlyAvg).toLocaleString('ro-RO')} RON/lună
                    </RNText>
                    {prevValue > 0 && (
                      <RNView style={styles.trendWrap}>
                        <Ionicons
                          name={trend >= 0 ? 'trending-up' : 'trending-down'}
                          size={14}
                          color={trend >= 0 ? statusColors.critical : statusColors.ok}
                        />
                        <RNText
                          style={[
                            styles.trendText,
                            { color: trend >= 0 ? statusColors.critical : statusColors.ok },
                          ]}
                        >
                          {trend >= 0 ? '+' : ''}
                          {trend.toFixed(0)}%
                        </RNText>
                      </RNView>
                    )}
                  </RNView>
                  {/* Sparkline */}
                  <RNView style={styles.sparkRow}>
                    {cat.series.map((p, i) => {
                      const max = Math.max(1, ...cat.series.map(s => s.total_ron));
                      const h = (p.total_ron / max) * 100;
                      return (
                        <RNView
                          key={`${p.yearMonth}-${i}`}
                          style={[
                            styles.sparkBar,
                            {
                              backgroundColor: cat.color,
                              height: `${Math.max(2, h)}%`,
                              opacity: 0.8,
                            },
                          ]}
                        />
                      );
                    })}
                  </RNView>
                </RNView>
              );
            })}
          </RNView>
        )}
      </ScrollView>
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  rangeRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  rangeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  rangeText: { fontSize: 13 },

  summaryCard: {
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  summaryLabel: { fontSize: 12, marginBottom: 4 },
  summaryValue: { fontSize: 26, fontWeight: '700' },
  summarySub: { fontSize: 12, marginTop: 4 },

  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },

  chartCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  chartArea: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 160 },
  chartBarCol: { flex: 1, alignItems: 'center', height: '100%' },
  chartBarWrap: {
    flex: 1,
    width: '70%',
    justifyContent: 'flex-end',
  },
  chartBar: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  chartBarLabel: { fontSize: 10, marginTop: 4 },
  chartBarValue: { fontSize: 10, fontWeight: '600' },

  catCard: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  catRow: { paddingVertical: 12 },
  catRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  catRowLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  catDot: { width: 10, height: 10, borderRadius: 5 },
  catName: { fontSize: 14, fontWeight: '500' },
  catTotal: { fontSize: 14, fontWeight: '600' },
  catRowMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  catMeta: { fontSize: 11 },
  trendWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  trendText: { fontSize: 11, fontWeight: '600' },

  sparkRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 32,
  },
  sparkBar: { flex: 1, borderTopLeftRadius: 2, borderTopRightRadius: 2, minHeight: 2 },

  emptyCard: {
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
