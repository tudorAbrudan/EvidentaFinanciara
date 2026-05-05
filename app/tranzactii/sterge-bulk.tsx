import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useCategories } from '@/hooks/useCategories';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import { consumeBulkDeleteIds } from '@/services/bulkDeleteHandoff';
import { bulkDeleteTransactions, getTransaction } from '@/services/transactions';
import { statusColors } from '@/theme/colors';
import type { Transaction } from '@/types';

export default function StergeBulkScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const { accounts } = useFinancialAccounts();
  const { categories } = useCategories();

  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const ids = consumeBulkDeleteIds();
    if (!ids || ids.length === 0) {
      setExpired(true);
      setTxs([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const loaded = await Promise.all(ids.map(id => getTransaction(id)));
      if (cancelled) return;
      const ok = loaded.filter((t): t is Transaction => t !== null);
      setTxs(ok);
      setSelected(new Set(ok.map(t => t.id)));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const accountById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  const counters = useMemo(() => {
    if (!txs) return { count: 0, sumAbs: 0, transfers: 0, fromStatement: 0 };
    let sumAbs = 0;
    let transfers = 0;
    let fromStatement = 0;
    for (const t of txs) {
      if (!selected.has(t.id)) continue;
      sumAbs += Math.abs(t.amount);
      if (t.is_internal_transfer) transfers += 1;
      if (t.statement_id) fromStatement += 1;
    }
    return { count: selected.size, sumAbs, transfers, fromStatement };
  }, [txs, selected]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmDelete() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    Alert.alert(
      `Ștergi ${ids.length} tranzacții?`,
      'Această acțiune e ireversibilă. Pentru tranzacțiile care fac parte din transferuri interne, contrapartida va deveni tranzacție obișnuită. Marcajul de duplicat se va anula. Statement-urile rămase fără tranzacții se vor șterge automat.',
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: () => {
            setDeleting(true);
            void (async () => {
              try {
                const res = await bulkDeleteTransactions(ids);
                const stmtSuffix =
                  res.statementsRemoved > 0
                    ? ` · ${res.statementsRemoved} extras${res.statementsRemoved === 1 ? '' : 'e'} eliminat${res.statementsRemoved === 1 ? '' : 'e'}`
                    : '';
                Alert.alert('Gata', `${res.deletedCount} tranzacții șterse${stmtSuffix}.`, [
                  { text: 'OK', onPress: () => router.back() },
                ]);
              } catch {
                Alert.alert('Eroare', 'Ștergerea a eșuat. Încearcă din nou.');
                setDeleting(false);
              }
            })();
          },
        },
      ]
    );
  }

  if (expired) {
    return (
      <View style={[styles.center, { backgroundColor: C.background }]}>
        <Stack.Screen options={{ title: 'Confirmă ștergerea' }} />
        <Text style={{ color: C.textSecondary, textAlign: 'center', padding: 24 }}>
          Sesiunea de ștergere a expirat. Întoarce-te la Tranzacții și încearcă din nou.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={[styles.fallbackBtn, { backgroundColor: C.tint }]}
        >
          <Text style={{ color: C.background }}>Înapoi</Text>
        </Pressable>
      </View>
    );
  }

  if (txs === null) {
    return (
      <View style={[styles.center, { backgroundColor: C.background }]}>
        <Stack.Screen options={{ title: 'Confirmă ștergerea' }} />
        <ActivityIndicator color={C.tint} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <Stack.Screen options={{ title: 'Confirmă ștergerea' }} />

      <View style={[styles.summary, { borderBottomColor: C.border }]}>
        <Text style={[styles.summaryTitle, { color: C.text }]}>
          {counters.count} selectate · sumă {counters.sumAbs.toFixed(2)}
        </Text>
        {(counters.transfers > 0 || counters.fromStatement > 0) && (
          <Text style={[styles.summarySub, { color: C.textSecondary }]}>
            {counters.transfers > 0 && `${counters.transfers} transferuri interne`}
            {counters.transfers > 0 && counters.fromStatement > 0 && ' · '}
            {counters.fromStatement > 0 && `${counters.fromStatement} din extrase`}
          </Text>
        )}
      </View>

      <FlatList
        data={txs}
        keyExtractor={t => t.id}
        contentContainerStyle={{ paddingBottom: 96 }}
        renderItem={({ item }) => {
          const checked = selected.has(item.id);
          const account = item.account_id ? accountById.get(item.account_id) : undefined;
          const category = item.category_id ? categoryById.get(item.category_id) : undefined;
          const amountColor = item.amount >= 0 ? statusColors.ok : C.text;
          return (
            <Pressable
              onPress={() => toggle(item.id)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: C.card, borderColor: C.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons
                name={checked ? 'checkbox' : 'square-outline'}
                size={22}
                color={checked ? C.tint : C.textSecondary}
              />
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
          <View style={styles.center}>
            <Text style={{ color: C.textSecondary }}>Niciuna de afișat.</Text>
          </View>
        }
      />

      <BottomActionBar
        label={
          deleting
            ? 'Se șterge...'
            : `Șterge ${selected.size} tranzac${selected.size === 1 ? 'ție' : 'ții'}`
        }
        onPress={confirmDelete}
        loading={deleting}
        disabled={selected.size === 0 || deleting}
        icon={<Ionicons name="trash-outline" size={16} color="#fff" />}
        safeArea
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summary: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  summaryTitle: { fontSize: 14, fontWeight: '600' },
  summarySub: { fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1 },
  title: { fontSize: 15 },
  subtitle: { fontSize: 12 },
  amount: { fontSize: 15, fontWeight: '600' },
  fallbackBtn: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
});
