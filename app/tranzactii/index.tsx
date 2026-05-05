import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';

import { TransactionFilterBar } from '@/components/TransactionFilterBar';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useCategories } from '@/hooks/useCategories';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import { useTransactions } from '@/hooks/useTransactions';
import { setBulkDeleteIds } from '@/services/bulkDeleteHandoff';
import type { TransactionFilter } from '@/services/transactions';
import { statusColors } from '@/theme/colors';

function isAnyActive(f: TransactionFilter): boolean {
  return Boolean(
    f.account_id || f.fromDate || f.toDate || (f.search && f.search.trim()) || f.absAmountRange
  );
}

export default function TransactionsList() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [filter, setFilter] = useState<TransactionFilter>({});

  const { transactions, loading } = useTransactions(filter);
  const { accounts } = useFinancialAccounts();
  const { categories } = useCategories();

  const accountById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  const showBulkDelete = isAnyActive(filter) && transactions.length > 0;

  function startBulkDelete() {
    setBulkDeleteIds(transactions.map(t => t.id));
    router.push('/tranzactii/sterge-bulk');
  }

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <Stack.Screen
        options={{
          title: 'Tranzacții',
          headerRight: () =>
            showBulkDelete ? (
              <Pressable onPress={startBulkDelete} hitSlop={8} style={styles.headerBtn}>
                <Ionicons name="trash-outline" size={20} color={statusColors.critical} />
                <Text style={[styles.headerBtnText, { color: statusColors.critical }]}>
                  Șterge filtrate
                </Text>
              </Pressable>
            ) : null,
        }}
      />

      <TransactionFilterBar value={filter} onChange={setFilter} accounts={accounts} />

      {loading && transactions.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={t => t.id}
          contentContainerStyle={{ paddingBottom: 96 }}
          renderItem={({ item }) => {
            const account = item.account_id ? accountById.get(item.account_id) : undefined;
            const category = item.category_id ? categoryById.get(item.category_id) : undefined;
            const amountColor = item.amount >= 0 ? statusColors.ok : C.text;
            return (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/tranzactii/[id]',
                    params: { id: item.id },
                  })
                }
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: C.card, borderColor: C.border, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <View style={styles.rowMain}>
                  <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
                    {item.merchant || item.description || 'Tranzacție'}
                  </Text>
                  <Text style={[styles.subtitle, { color: C.textSecondary }]} numberOfLines={1}>
                    {item.date}
                    {account ? ` • ${account.name}` : ''}
                    {category ? ` • ${category.name}` : ''}
                  </Text>
                </View>
                <Text style={[styles.amount, { color: amountColor }]}>
                  {item.amount.toFixed(2)} {item.currency}
                </Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ color: C.textSecondary }}>
                {isAnyActive(filter)
                  ? 'Niciun rezultat pentru filtrele selectate.'
                  : 'Nicio tranzacție.'}
              </Text>
            </View>
          }
        />
      )}
      <Pressable
        onPress={() => router.push({ pathname: '/tranzactii/[id]', params: { id: 'new' } })}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: C.primary, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Ionicons name="add" size={26} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1, marginRight: 12 },
  title: { fontSize: 15, fontWeight: '600' },
  subtitle: { fontSize: 13, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '600' },
  empty: { padding: 32, alignItems: 'center' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 },
  headerBtnText: { fontSize: 13, fontWeight: '500' },
});
