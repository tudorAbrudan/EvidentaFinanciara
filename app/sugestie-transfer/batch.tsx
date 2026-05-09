import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import {
  convertToTransfer,
  dismissTransferSuggestion,
  extractBrokerName,
  listPendingTransferSuggestions,
  type PendingTransferSuggestion,
  type TransferType,
} from '@/services/internalTransferSuggestion';
import type { FinancialAccount } from '@/types';

interface RowState {
  tx: PendingTransferSuggestion;
  selected: boolean;
  targetAccountId: string | null;
}

const TYPE_LABEL: Record<TransferType, string> = {
  cash: 'Retragere cash',
  savings_out: 'Către economii',
  savings_in: 'Din economii',
  investment_out: 'Către broker',
  investment_in: 'De la broker',
};

const TYPE_ICON: Record<TransferType, keyof typeof Ionicons.glyphMap> = {
  cash: 'cash-outline',
  savings_out: 'arrow-up-circle-outline',
  savings_in: 'arrow-down-circle-outline',
  investment_out: 'trending-up-outline',
  investment_in: 'trending-down-outline',
};

function targetTypeFor(t: TransferType): FinancialAccount['type'] {
  if (t === 'cash') return 'cash';
  if (t === 'savings_out' || t === 'savings_in') return 'savings';
  return 'investment';
}

function targetCreateLabel(t: TransferType, currency: string, brokerName?: string): string {
  if (t === 'cash') return `+ Creează cont Cash în ${currency}`;
  if (t === 'savings_out' || t === 'savings_in') return `+ Creează cont Economii în ${currency}`;
  return brokerName
    ? `+ Adaugă cont broker „${brokerName}" în ${currency}`
    : `+ Adaugă cont broker în ${currency}`;
}

export default function SugestieTransferBatch() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const { accounts } = useFinancialAccounts();
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const pending = await listPendingTransferSuggestions();
      setRows(
        pending.map(tx => {
          const targetType = targetTypeFor(tx.suggested_type);
          const matching = accounts.filter(
            a => a.type === targetType && !a.archived && a.currency === tx.currency
          );
          const onlyOne = matching.length === 1 ? matching[0].id : null;
          return { tx, selected: true, targetAccountId: onlyOne };
        })
      );
    } finally {
      setLoading(false);
    }
  }, [accounts]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleSelect = (txId: string) =>
    setRows(prev => prev.map(r => (r.tx.id === txId ? { ...r, selected: !r.selected } : r)));

  const setTarget = (txId: string, accId: string) =>
    setRows(prev => prev.map(r => (r.tx.id === txId ? { ...r, targetAccountId: accId } : r)));

  const skipRow = async (txId: string) => {
    await dismissTransferSuggestion(txId);
    setRows(prev => prev.filter(r => r.tx.id !== txId));
  };

  const skipAll = async () => {
    setBusy(true);
    try {
      for (const r of rows) {
        await dismissTransferSuggestion(r.tx.id);
      }
      router.back();
    } catch (e) {
      await loadData();
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Skip a eșuat');
    } finally {
      setBusy(false);
    }
  };

  const confirmSelected = async () => {
    const selected = rows.filter(r => r.selected);
    const missingTarget = selected.find(r => !r.targetAccountId);
    if (missingTarget) {
      Alert.alert(
        'Cont destinație lipsă',
        'Alege un cont destinație pentru fiecare tranzacție bifată sau debifează rândurile fără destinație.'
      );
      return;
    }
    setBusy(true);
    try {
      for (const r of selected) {
        if (r.targetAccountId) {
          await convertToTransfer(r.tx.id, r.targetAccountId);
        }
      }
      router.back();
    } catch (e) {
      await loadData();
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Conversia a eșuat');
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = rows.filter(r => r.selected && r.targetAccountId).length;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: C.background }]}>
        <Stack.Screen options={{ title: 'Sugestie transfer intern' }} />
        <Text style={{ color: C.textSecondary }}>Se încarcă...</Text>
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: C.background }]}>
        <Stack.Screen options={{ title: 'Sugestie transfer intern' }} />
        <Text style={{ color: C.textSecondary, textAlign: 'center', padding: 24 }}>
          Nu ai tranzacții cu sugestie de transfer intern. Înapoi.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={[styles.btn, { backgroundColor: C.primary }]}
        >
          <Text style={styles.btnText}>OK</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <Stack.Screen options={{ title: 'Sugestie transfer intern' }} />
      <Text style={[styles.heading, { color: C.text }]}>
        {rows.length} {rows.length === 1 ? 'tranzacție detectată' : 'tranzacții detectate'}
      </Text>
      <Text style={[styles.subheading, { color: C.textSecondary }]}>
        Vrei să le aloci într-un cont propriu?
      </Text>

      <FlatList
        data={rows}
        keyExtractor={r => r.tx.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => {
          const targetType = targetTypeFor(item.tx.suggested_type);
          const matching = accounts.filter(
            a => a.type === targetType && !a.archived && a.currency === item.tx.currency
          );
          return (
            <View style={[styles.row, { backgroundColor: C.card, borderColor: C.border }]}>
              <Pressable onPress={() => toggleSelect(item.tx.id)} style={styles.rowHeader}>
                <Ionicons
                  name={item.selected ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={item.selected ? C.primary : C.textSecondary}
                />
                <View style={{ flex: 1 }}>
                  <View style={styles.titleRow}>
                    <Ionicons
                      name={TYPE_ICON[item.tx.suggested_type]}
                      size={14}
                      color={C.primary}
                    />
                    <Text style={[styles.badge, { color: C.primary }]}>
                      {TYPE_LABEL[item.tx.suggested_type]}
                    </Text>
                  </View>
                  <Text style={[styles.rowTitle, { color: C.text }]} numberOfLines={1}>
                    {item.tx.description || item.tx.merchant || 'Tranzacție'}
                  </Text>
                  <Text style={[styles.rowMeta, { color: C.textSecondary }]}>
                    {Math.abs(item.tx.amount).toFixed(2)} {item.tx.currency} • {item.tx.date}
                  </Text>
                </View>
              </Pressable>

              {item.selected && (
                <View style={{ marginTop: 8 }}>
                  <Text style={[styles.label, { color: C.textSecondary }]}>Cont destinație:</Text>
                  {matching.length === 0 ? (
                    (() => {
                      const brokerName =
                        targetType === 'investment'
                          ? extractBrokerName(item.tx.description, item.tx.merchant)
                          : undefined;
                      return (
                        <Pressable
                          style={[styles.btnSecondary, { borderColor: C.primary }]}
                          onPress={() =>
                            router.push({
                              pathname: '/conturi/add' as '/',
                              params: {
                                type: targetType,
                                currency: item.tx.currency,
                                ...(brokerName ? { name: brokerName } : {}),
                              },
                            })
                          }
                        >
                          <Text style={[styles.btnSecondaryText, { color: C.primary }]}>
                            {targetCreateLabel(
                              item.tx.suggested_type,
                              item.tx.currency,
                              brokerName
                            )}
                          </Text>
                        </Pressable>
                      );
                    })()
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {matching.map(a => (
                          <Pressable
                            key={a.id}
                            onPress={() => setTarget(item.tx.id, a.id)}
                            style={[
                              styles.chip,
                              {
                                borderColor: item.targetAccountId === a.id ? C.primary : C.border,
                                backgroundColor:
                                  item.targetAccountId === a.id ? C.primary : 'transparent',
                              },
                            ]}
                          >
                            <Text
                              style={{
                                color: item.targetAccountId === a.id ? '#fff' : C.text,
                              }}
                            >
                              {a.name}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  )}
                </View>
              )}

              <Pressable onPress={() => void skipRow(item.tx.id)} style={styles.skipBtn}>
                <Text style={{ color: C.textSecondary, fontSize: 12 }}>
                  ✗ Skip această tranzacție
                </Text>
              </Pressable>
            </View>
          );
        }}
      />

      <View style={[styles.footer, { backgroundColor: C.background, borderTopColor: C.border }]}>
        <Pressable disabled={busy} onPress={() => router.back()} style={styles.btnGhost}>
          <Text style={{ color: C.textSecondary }}>Anulează</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => void skipAll()} style={styles.btnGhost}>
          <Text style={{ color: C.textSecondary }}>Skip toate</Text>
        </Pressable>
        <Pressable
          disabled={busy || selectedCount === 0}
          onPress={() => void confirmSelected()}
          style={[styles.btn, { backgroundColor: selectedCount === 0 ? C.border : C.primary }]}
        >
          <Text style={styles.btnText}>Confirmă ({selectedCount})</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '700', paddingHorizontal: 16 },
  subheading: { fontSize: 14, paddingHorizontal: 16, marginBottom: 16 },
  row: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  badge: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  rowTitle: { fontSize: 15, fontWeight: '500' },
  rowMeta: { fontSize: 13, marginTop: 2 },
  label: { fontSize: 12, marginBottom: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  skipBtn: { marginTop: 8, alignSelf: 'flex-start' },
  footer: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
  },
  btn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '600' },
  btnGhost: { padding: 12, alignItems: 'center', justifyContent: 'center' },
  btnSecondary: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  btnSecondaryText: { fontWeight: '500' },
});
