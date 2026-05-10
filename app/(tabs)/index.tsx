import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, Stack } from 'expo-router';
import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Alert,
  View as RNView,
  Text as RNText,
  Modal,
} from 'react-native';

import InsightsCard from '@/components/InsightsCard';
import RecurringSummary from '@/components/RecurringSummary';
import { TransferSuggestionBanner } from '@/components/TransferSuggestionBanner';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useCategories } from '@/hooks/useCategories';
import { useCategoryTransactions, UNCATEGORIZED_KEY } from '@/hooks/useCategoryTransactions';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import { useMonthlyAnalysis } from '@/hooks/useMonthlyAnalysis';
import { computeMonthlyInsights, type MonthlyInsight } from '@/services/insights';
import { detectRecurringSeries, type RecurringSeries } from '@/services/recurring';
import { formatYearMonth, updateTransaction } from '@/services/transactions';
import { primary, statusColors } from '@/theme/colors';
import type { Transaction, ExpenseCategory } from '@/types';

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

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(n => parseInt(n, 10));
  const d = new Date(y, m - 1 + delta, 1);
  return formatYearMonth(d);
}

export default function FinanciarHubScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const [yearMonth, setYearMonth] = useState(() => formatYearMonth(new Date()));
  const [accountFilter, setAccountFilter] = useState<string | undefined>(undefined);
  const [expandedCatKey, setExpandedCatKey] = useState<string | null>(null);
  const [pickerTxId, setPickerTxId] = useState<string | null>(null);
  const [pickerSaving, setPickerSaving] = useState(false);
  const [insights, setInsights] = useState<MonthlyInsight[]>([]);
  const [recurring, setRecurring] = useState<RecurringSeries[]>([]);

  // Schimbarea filtrelor (lună sau cont) invalidează lista expandată.
  useEffect(() => {
    setExpandedCatKey(null);
  }, [yearMonth, accountFilter]);

  // Insights lunari (compară luna curentă vs media ultimelor 3 luni). Best-effort.
  useEffect(() => {
    let cancelled = false;
    void computeMonthlyInsights(yearMonth, accountFilter)
      .then(items => {
        if (!cancelled) setInsights(items);
      })
      .catch(() => {
        if (!cancelled) setInsights([]);
      });
    return () => {
      cancelled = true;
    };
  }, [yearMonth, accountFilter]);

  // Detectează abonamente recurente pe ultimele 6 luni. Independent de filtrul
  // lunii; se recalculează la modificări de tranzacții (refresh).
  useEffect(() => {
    let cancelled = false;
    void detectRecurringSeries()
      .then(items => {
        if (!cancelled) setRecurring(items);
      })
      .catch(() => {
        if (!cancelled) setRecurring([]);
      });
    return () => {
      cancelled = true;
    };
  }, [yearMonth, accountFilter]);

  const { accounts, refresh: refreshAccounts } = useFinancialAccounts(false);
  const { categories } = useCategories();
  const { analysis, loading, refresh } = useMonthlyAnalysis(yearMonth, accountFilter);

  const {
    transactions: expandedTxs,
    loading: expandedLoading,
    error: expandedError,
    refresh: refreshExpanded,
  } = useCategoryTransactions(yearMonth, expandedCatKey, accountFilter);

  const categoryMap = useMemo(() => {
    const m = new Map<string, { name: string; icon?: string }>();
    categories.forEach(c => m.set(c.id, { name: c.name, icon: c.icon }));
    return m;
  }, [categories]);

  useFocusEffect(
    useCallback(() => {
      void refreshAccounts();
      void refresh();
      void refreshExpanded();
    }, [refreshAccounts, refresh, refreshExpanded])
  );

  const totals = analysis?.totals;
  const breakdown = useMemo(() => analysis?.breakdown ?? [], [analysis]);
  const recent = analysis?.recent ?? [];

  useEffect(() => {
    if (expandedCatKey === null) return;
    const stillExists = breakdown.some(
      b => (b.category_id ?? UNCATEGORIZED_KEY) === expandedCatKey
    );
    if (!stillExists && !loading) {
      setExpandedCatKey(null);
    }
  }, [breakdown, expandedCatKey, loading]);

  const handleCategoryPick = useCallback(
    async (newCategoryId: string | null) => {
      if (!pickerTxId) return;
      if (pickerSaving) return;
      setPickerSaving(true);
      try {
        await updateTransaction(pickerTxId, { category_id: newCategoryId });
        setPickerTxId(null);
        await Promise.all([refresh(), refreshExpanded()]);
      } catch (e) {
        Alert.alert(
          'Nu s-a putut schimba categoria',
          e instanceof Error ? e.message : 'Eroare necunoscută'
        );
      } finally {
        setPickerSaving(false);
      }
    },
    [pickerTxId, pickerSaving, refresh, refreshExpanded]
  );
  const todayYm = formatYearMonth(new Date());
  const isCurrentMonth = yearMonth === todayYm;

  const accountOptions = useMemo(
    () => [
      { id: 'all', name: 'Toate conturile' },
      ...accounts.map(a => ({ id: a.id, name: a.name })),
    ],
    [accounts]
  );

  function changeMonth(delta: number) {
    setYearMonth(prev => shiftMonth(prev, delta));
  }

  function goToCurrentMonth() {
    setYearMonth(todayYm);
  }

  function openImport() {
    // 0 conturi → cere crearea primului cont
    if (accounts.length === 0) {
      Alert.alert(
        'Niciun cont',
        'Creează întâi un cont (BT, cash, etc.) ca să poți importa extrasul în el.',
        [
          { text: 'Anulează', style: 'cancel' },
          {
            text: 'Creează cont',
            onPress: () => router.push('/conturi/add'),
          },
        ]
      );
      return;
    }
    // Filtru deja activ → folosește-l
    if (accountFilter) {
      router.push({
        pathname: '/conturi/import',
        params: { account_id: accountFilter },
      });
      return;
    }
    // Un singur cont → direct la import
    if (accounts.length === 1) {
      router.push({
        pathname: '/conturi/import',
        params: { account_id: accounts[0].id },
      });
      return;
    }
    // Multiple conturi: Alert cu primele 3 + acces la lista completă
    const top = accounts.slice(0, 3);
    Alert.alert(
      'În ce cont importezi?',
      'Alege contul în care vrei să adaugi tranzacțiile din extras.',
      [
        ...top.map(a => ({
          text: a.name,
          onPress: () =>
            router.push({
              pathname: '/conturi/import',
              params: { account_id: a.id },
            }),
        })),
        ...(accounts.length > 3
          ? [
              {
                text: 'Alt cont…',
                onPress: () => router.push('/conturi'),
              },
            ]
          : []),
        { text: 'Anulează', style: 'cancel' as const },
      ]
    );
  }

  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>
      <Stack.Screen
        options={{
          title: 'Gestiune financiară',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/setari' as never)}
              style={{ marginRight: 12 }}
              hitSlop={8}
            >
              <Ionicons name="settings-outline" size={22} color={C.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              void refresh();
            }}
            tintColor={C.primary}
          />
        }
      >
        {/* Month picker */}
        <RNView style={[styles.monthBar, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <Pressable
            onPress={() => changeMonth(-1)}
            style={({ pressed }) => [styles.monthArrow, pressed && { opacity: 0.6 }]}
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </Pressable>
          <Pressable onPress={goToCurrentMonth} style={styles.monthLabelWrap}>
            <RNText style={[styles.monthLabel, { color: C.text }]}>{ymToLabel(yearMonth)}</RNText>
            {!isCurrentMonth && (
              <RNText style={[styles.monthHint, { color: primary }]}>
                Apasă pentru luna curentă
              </RNText>
            )}
          </Pressable>
          <Pressable
            onPress={() => changeMonth(1)}
            disabled={isCurrentMonth}
            style={({ pressed }) => [
              styles.monthArrow,
              pressed && { opacity: 0.6 },
              isCurrentMonth && { opacity: 0.3 },
            ]}
            hitSlop={8}
          >
            <Ionicons name="chevron-forward" size={22} color={C.text} />
          </Pressable>
        </RNView>

        <InsightsCard insights={insights} />

        <RecurringSummary series={recurring} />

        {/* Account filter chips */}
        {accounts.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContent}
            style={styles.chipsRow}
          >
            {accountOptions.map(opt => {
              const isActive = (opt.id === 'all' && !accountFilter) || opt.id === accountFilter;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => setAccountFilter(opt.id === 'all' ? undefined : opt.id)}
                  style={[
                    styles.chip,
                    { borderColor: C.border, backgroundColor: C.card },
                    isActive && { backgroundColor: primary, borderColor: primary },
                  ]}
                >
                  <RNText
                    style={[styles.chipText, { color: isActive ? '#fff' : C.text }]}
                    numberOfLines={1}
                  >
                    {opt.name}
                  </RNText>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Totals */}
        <RNView style={styles.totalsRow}>
          <TotalCard
            label="Venituri"
            value={totals?.income_ron ?? 0}
            color={statusColors.ok}
            icon="arrow-down-circle"
            C={C}
          />
          <TotalCard
            label="Cheltuieli"
            value={totals?.expense_ron ?? 0}
            color={statusColors.critical}
            icon="arrow-up-circle"
            sign="-"
            C={C}
          />
          <TotalCard
            label="Net"
            value={totals?.net_ron ?? 0}
            color={(totals?.net_ron ?? 0) >= 0 ? statusColors.ok : statusColors.critical}
            icon="trending-up"
            forceSign
            C={C}
          />
        </RNView>

        {/* Primary action: Import extras */}
        <Pressable
          onPress={openImport}
          style={({ pressed }) => [
            styles.importBtn,
            { backgroundColor: primary },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Ionicons name="download-outline" size={20} color="#fff" />
          <RNView style={{ flex: 1 }}>
            <RNText style={styles.importBtnTitle}>Importă extras</RNText>
            <RNText style={styles.importBtnSub}>
              PDF/CSV de la BT, ING, Revolut, OTP — auto-categorizare
            </RNText>
          </RNView>
          <Ionicons name="chevron-forward" size={18} color="#fff" />
        </Pressable>

        {/* Quick actions */}
        <RNView style={styles.actionsRow}>
          <Pressable
            onPress={() => router.push('/(tabs)/evolutie')}
            style={({ pressed }) => [
              styles.actionBtnSecondary,
              { borderColor: C.border, backgroundColor: C.card },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons name="bar-chart-outline" size={18} color={C.text} />
            <RNText style={[styles.actionTextSecondary, { color: C.text }]}>Evoluție</RNText>
          </Pressable>
          <Pressable
            onPress={() => router.push('/conturi')}
            style={({ pressed }) => [
              styles.actionBtnSecondary,
              { borderColor: C.border, backgroundColor: C.card },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons name="wallet-outline" size={18} color={C.text} />
            <RNText style={[styles.actionTextSecondary, { color: C.text }]}>Conturi</RNText>
          </Pressable>
          <Pressable
            onPress={() => router.push('/categorii')}
            style={({ pressed }) => [
              styles.actionBtnSecondary,
              { borderColor: C.border, backgroundColor: C.card },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons name="pricetag-outline" size={18} color={C.text} />
            <RNText style={[styles.actionTextSecondary, { color: C.text }]}>Categorii</RNText>
          </Pressable>
        </RNView>

        <TransferSuggestionBanner />

        {/* Category breakdown */}
        <RNText style={[styles.sectionTitle, { color: C.textSecondary }]}>
          Cheltuieli pe categorii
        </RNText>
        {breakdown.length === 0 && !loading ? (
          <RNView
            style={[styles.emptyCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
          >
            <Ionicons
              name="pie-chart-outline"
              size={32}
              color={C.textSecondary}
              style={{ opacity: 0.5 }}
            />
            <RNText style={[styles.emptySub, { color: C.textSecondary }]}>
              Nicio cheltuială înregistrată în luna selectată.
            </RNText>
          </RNView>
        ) : (
          <RNView
            style={[styles.breakdownCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
          >
            {breakdown.map((item, idx) => {
              const key = item.category_id ?? UNCATEGORIZED_KEY;
              const expanded = expandedCatKey === key;
              return (
                <RNView key={`${key}-${idx}`}>
                  <CategoryRow
                    item={item}
                    expanded={expanded}
                    onPress={() => setExpandedCatKey(prev => (prev === key ? null : key))}
                    C={C}
                  />
                  {expanded && (
                    <CategoryTransactionsList
                      loading={expandedLoading}
                      error={expandedError}
                      transactions={expandedTxs}
                      categoryMap={categoryMap}
                      C={C}
                      onRetry={() => {
                        void refreshExpanded();
                      }}
                      onCategoryEdit={txId => setPickerTxId(txId)}
                    />
                  )}
                </RNView>
              );
            })}
          </RNView>
        )}

        {expandedCatKey === null && (
          <>
            {/* Recent transactions */}
            <RNView style={styles.txHeader}>
              <RNText style={[styles.sectionTitle, { color: C.textSecondary }]}>
                Tranzacții recente
              </RNText>
              {recent.length > 0 && (
                <RNText style={[styles.txCount, { color: C.textSecondary }]}>
                  {recent.length}
                </RNText>
              )}
            </RNView>
            {recent.length === 0 && !loading ? (
              <RNView
                style={[styles.emptyCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
              >
                <Ionicons
                  name="receipt-outline"
                  size={32}
                  color={C.textSecondary}
                  style={{ opacity: 0.5 }}
                />
                <RNText style={[styles.emptySub, { color: C.textSecondary }]}>
                  Nicio tranzacție în luna selectată.
                </RNText>
              </RNView>
            ) : (
              recent.map(t => (
                <TransactionRow
                  key={t.id}
                  tx={t}
                  categoryName={t.category_id ? categoryMap.get(t.category_id)?.name : undefined}
                  C={C}
                  onPress={() =>
                    router.push({
                      pathname: '/tranzactii/[id]',
                      params: { id: t.id },
                    })
                  }
                />
              ))
            )}
          </>
        )}
      </ScrollView>

      <BottomActionBar
        label="Tranzacție nouă"
        icon={<Ionicons name="add" size={18} color="#fff" />}
        onPress={() =>
          router.push({
            pathname: '/tranzactii/[id]',
            params: accountFilter ? { id: 'new', account_id: accountFilter } : { id: 'new' },
          })
        }
        safeArea
      />

      <CategoryQuickPickerModal
        visible={pickerTxId !== null}
        categories={categories}
        currentCategoryId={
          pickerTxId ? (expandedTxs.find(t => t.id === pickerTxId)?.category_id ?? null) : null
        }
        onPick={catId => {
          void handleCategoryPick(catId);
        }}
        onClose={() => !pickerSaving && setPickerTxId(null)}
        C={C}
        saving={pickerSaving}
      />
    </RNView>
  );
}

function TotalCard({
  label,
  value,
  color,
  icon,
  sign,
  forceSign,
  C,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  sign?: '+' | '-';
  forceSign?: boolean;
  C: typeof Colors.light;
}) {
  let prefix = '';
  if (sign) prefix = sign;
  else if (forceSign) prefix = value >= 0 ? '+' : '';
  return (
    <RNView style={[styles.totalsCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
      <Ionicons name={icon} size={18} color={color} />
      <RNText style={[styles.totalsLabel, { color: C.textSecondary }]}>{label}</RNText>
      <RNText style={[styles.totalsValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {prefix}
        {Math.round(value).toLocaleString('ro-RO')}
      </RNText>
    </RNView>
  );
}

function CategoryTransactionsList({
  loading,
  error,
  transactions,
  categoryMap,
  C,
  onRetry,
  onCategoryEdit,
}: {
  loading: boolean;
  error: string | null;
  transactions: Transaction[];
  categoryMap: Map<string, { name: string; icon?: string }>;
  C: typeof Colors.light;
  onRetry: () => void;
  onCategoryEdit: (txId: string) => void;
}) {
  if (loading) {
    return (
      <RNView style={styles.expandedLoading}>
        <RNText style={{ color: C.textSecondary, fontSize: 12 }}>Se încarcă…</RNText>
      </RNView>
    );
  }
  if (error) {
    return (
      <RNView style={styles.expandedError}>
        <RNText style={{ color: statusColors.critical, fontSize: 12, marginBottom: 6 }}>
          Nu s-a putut încărca lista
        </RNText>
        <Pressable onPress={onRetry} hitSlop={8}>
          <RNText style={{ color: primary, fontSize: 12, fontWeight: '600' }}>Reîncearcă</RNText>
        </Pressable>
      </RNView>
    );
  }
  if (transactions.length === 0) {
    return (
      <RNView style={styles.expandedEmpty}>
        <RNText style={{ color: C.textSecondary, fontSize: 12 }}>
          Nicio tranzacție în această categorie.
        </RNText>
      </RNView>
    );
  }
  return (
    <RNView style={styles.expandedList}>
      {transactions.map(t => (
        <ExpandedTransactionRow
          key={t.id}
          tx={t}
          categoryName={(t.category_id && categoryMap.get(t.category_id)?.name) || 'Necategorizat'}
          C={C}
          onPress={() =>
            router.push({
              pathname: '/tranzactii/[id]',
              params: { id: t.id },
            })
          }
          onCategoryPress={() => onCategoryEdit(t.id)}
        />
      ))}
    </RNView>
  );
}

function CategoryQuickPickerModal({
  visible,
  categories,
  currentCategoryId,
  onPick,
  onClose,
  C,
  saving,
}: {
  visible: boolean;
  categories: ExpenseCategory[];
  currentCategoryId: string | null;
  onPick: (categoryId: string | null) => void;
  onClose: () => void;
  C: typeof Colors.light;
  saving?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.pickerBackdrop} onPress={onClose}>
        <Pressable style={[styles.pickerSheet, { backgroundColor: C.card }]} onPress={() => {}}>
          <RNView style={styles.pickerHeader}>
            <RNText style={[styles.pickerTitle, { color: C.text }]}>Schimbă categoria</RNText>
            <Pressable onPress={onClose} hitSlop={8}>
              <RNText style={{ color: primary, fontSize: 14, fontWeight: '600' }}>Anulează</RNText>
            </Pressable>
          </RNView>
          <ScrollView style={{ maxHeight: 420 }}>
            {categories.map(cat => {
              const isCurrent = cat.id === currentCategoryId;
              return (
                <Pressable
                  key={cat.id}
                  onPress={() => onPick(cat.id)}
                  disabled={saving}
                  style={({ pressed }) => [
                    styles.pickerItem,
                    { borderBottomColor: C.border },
                    pressed && { opacity: 0.7 },
                    saving && { opacity: 0.5 },
                  ]}
                >
                  <RNView style={[styles.pickerDot, { backgroundColor: cat.color || primary }]} />
                  <RNText style={[styles.pickerItemText, { color: C.text }]}>{cat.name}</RNText>
                  {isCurrent && <Ionicons name="checkmark" size={18} color={primary} />}
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => onPick(null)}
              disabled={saving}
              style={({ pressed }) => [
                styles.pickerItem,
                { borderBottomColor: C.border, borderTopWidth: 1, borderTopColor: C.border },
                pressed && { opacity: 0.7 },
                saving && { opacity: 0.5 },
              ]}
            >
              <RNView style={[styles.pickerDot, { backgroundColor: C.textSecondary }]} />
              <RNText style={[styles.pickerItemText, { color: C.text }]}>Necategorizat</RNText>
              {currentCategoryId === null && (
                <Ionicons name="checkmark" size={18} color={primary} />
              )}
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CategoryRow({
  item,
  expanded,
  onPress,
  C,
}: {
  item: import('@/services/transactions').CategoryBreakdownItem;
  expanded: boolean;
  onPress: () => void;
  C: typeof Colors.light;
}) {
  const barColor = item.color || primary;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.catRow, pressed && { opacity: 0.85 }]}
    >
      <RNView style={styles.catTopRow}>
        <RNView style={styles.catLabelWrap}>
          <RNView style={[styles.catDot, { backgroundColor: barColor }]} />
          <RNText style={[styles.catName, { color: C.text }]} numberOfLines={1}>
            {item.category_name}
          </RNText>
        </RNView>
        <RNView style={styles.catRightWrap}>
          <RNText style={[styles.catAmount, { color: C.text }]}>
            {Math.round(item.total_ron).toLocaleString('ro-RO')} RON
          </RNText>
          <Ionicons
            name={expanded ? 'chevron-down' : 'chevron-forward'}
            size={16}
            color={C.textSecondary}
            style={{ marginLeft: 6 }}
          />
        </RNView>
      </RNView>
      <RNView style={[styles.catBarBg, { backgroundColor: `${C.border}80` }]}>
        <RNView
          style={[
            styles.catBarFill,
            {
              backgroundColor: barColor,
              width: `${Math.max(2, Math.min(100, item.percentage))}%`,
            },
          ]}
        />
      </RNView>
      <RNText style={[styles.catMeta, { color: C.textSecondary }]}>
        {item.percentage.toFixed(1)}% • {item.transaction_count}{' '}
        {item.transaction_count === 1 ? 'tranzacție' : 'tranzacții'}
      </RNText>
    </Pressable>
  );
}

function TransactionRow({
  tx,
  categoryName,
  C,
  onPress,
}: {
  tx: Transaction;
  categoryName?: string;
  C: typeof Colors.light;
  onPress: () => void;
}) {
  const isPositive = tx.amount >= 0;
  const color = tx.is_internal_transfer
    ? C.textSecondary
    : isPositive
      ? statusColors.ok
      : statusColors.critical;
  const sign = isPositive ? '+' : '';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.txRow,
        { backgroundColor: C.card, shadowColor: C.cardShadow },
        pressed && { opacity: 0.9 },
      ]}
    >
      <RNView style={{ flex: 1 }}>
        <RNText style={[styles.txTitle, { color: C.text }]} numberOfLines={1}>
          {tx.merchant ||
            tx.description ||
            (tx.is_internal_transfer ? 'Transfer intern' : 'Tranzacție')}
        </RNText>
        <RNText style={[styles.txSub, { color: C.textSecondary }]} numberOfLines={1}>
          {tx.date}
          {categoryName ? ` • ${categoryName}` : ''}
          {tx.is_internal_transfer ? ' • transfer' : ''}
          {tx.is_refund ? ' • retur' : ''}
        </RNText>
      </RNView>
      <RNText style={[styles.txAmount, { color }]}>
        {sign}
        {tx.amount.toFixed(2)} {tx.currency}
      </RNText>
    </Pressable>
  );
}

function ExpandedTransactionRow({
  tx,
  categoryName,
  C,
  onPress,
  onCategoryPress,
}: {
  tx: Transaction;
  categoryName: string;
  C: typeof Colors.light;
  onPress: () => void;
  onCategoryPress: () => void;
}) {
  const isPositive = tx.amount >= 0;
  const color = tx.is_internal_transfer
    ? C.textSecondary
    : isPositive
      ? statusColors.ok
      : statusColors.critical;
  const sign = isPositive ? '+' : '';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.txRow,
        { backgroundColor: C.card, shadowColor: C.cardShadow },
        pressed && { opacity: 0.9 },
      ]}
    >
      <RNView style={{ flex: 1 }}>
        <RNText style={[styles.txTitle, { color: C.text }]} numberOfLines={1}>
          {tx.merchant ||
            tx.description ||
            (tx.is_internal_transfer ? 'Transfer intern' : 'Tranzacție')}
        </RNText>
        <RNView style={styles.txExpandedSubRow}>
          <RNText style={[styles.txSub, { color: C.textSecondary }]}>
            {tx.date}
            {tx.is_refund ? ' • retur' : ''}
          </RNText>
          <Pressable
            onPress={onCategoryPress}
            hitSlop={6}
            style={({ pressed }) => [
              styles.txCategoryPill,
              { backgroundColor: `${primary}22`, borderColor: `${primary}55` },
              pressed && { opacity: 0.7 },
            ]}
          >
            {tx.category_learned ? (
              <Ionicons
                name="sparkles"
                size={11}
                color={primary}
                style={{ marginRight: 4 }}
                accessibilityLabel="Categorie atribuită automat din istoric"
              />
            ) : null}
            <RNText style={[styles.txCategoryPillText, { color: primary }]} numberOfLines={1}>
              {categoryName}
            </RNText>
          </Pressable>
        </RNView>
      </RNView>
      <RNText style={[styles.txAmount, { color }]}>
        {sign}
        {tx.amount.toFixed(2)} {tx.currency}
      </RNText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 96 },

  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  monthArrow: { padding: 6 },
  monthLabelWrap: { flex: 1, alignItems: 'center' },
  monthLabel: { fontSize: 16, fontWeight: '600' },
  monthHint: { fontSize: 11, marginTop: 2 },

  chipsRow: { flexGrow: 0, marginBottom: 12 },
  chipsContent: { gap: 8, paddingHorizontal: 2 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: 200,
  },
  chipText: { fontSize: 12, fontWeight: '500' },

  totalsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },

  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  importBtnTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  importBtnSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },

  totalsCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 4,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  totalsLabel: { fontSize: 11 },
  totalsValue: { fontSize: 16, fontWeight: '700' },

  actionsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  actionBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
  },
  actionTextSecondary: { fontWeight: '600', fontSize: 13 },

  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },

  breakdownCard: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  catRow: { paddingVertical: 8 },
  catTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  catRightWrap: { flexDirection: 'row', alignItems: 'center' },
  catLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  catDot: { width: 10, height: 10, borderRadius: 5 },
  catName: { fontSize: 14, fontWeight: '500', flex: 1 },
  catAmount: { fontSize: 14, fontWeight: '600' },
  catBarBg: { height: 6, borderRadius: 3, overflow: 'hidden' },
  catBarFill: { height: '100%', borderRadius: 3 },
  catMeta: { fontSize: 11, marginTop: 4 },

  txHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  txCount: { fontSize: 12 },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  txTitle: { fontSize: 14, fontWeight: '500', marginBottom: 2 },
  txSub: { fontSize: 12 },
  txAmount: { fontSize: 14, fontWeight: '700' },
  txExpandedSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  txCategoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    maxWidth: 180,
  },
  txCategoryPillText: { fontSize: 11, fontWeight: '600' },

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

  expandedList: { paddingTop: 8, paddingBottom: 4, gap: 4 },
  expandedLoading: { paddingVertical: 12, alignItems: 'center' },
  expandedError: { paddingVertical: 12, alignItems: 'center' },
  expandedEmpty: { paddingVertical: 12, alignItems: 'center' },

  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 24,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  pickerTitle: { fontSize: 16, fontWeight: '700' },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerDot: { width: 12, height: 12, borderRadius: 6 },
  pickerItemText: { flex: 1, fontSize: 14, fontWeight: '500' },
});
