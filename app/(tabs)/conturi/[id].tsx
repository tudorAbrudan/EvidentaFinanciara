import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Alert,
  View as RNView,
  Text as RNText,
} from 'react-native';

import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useCategories } from '@/hooks/useCategories';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import { useTransactions } from '@/hooks/useTransactions';
import { getBankStatementsForAccount, deleteBankStatement } from '@/services/bankStatements';
import { backfillMissingRates, countMissingRates } from '@/services/transactions';
import { primary, statusColors } from '@/theme/colors';
import { FINANCIAL_ACCOUNT_TYPE_LABELS, type BankStatement, type Transaction } from '@/types';

export default function FinancialAccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const accountId = id as string;
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const {
    accounts,
    refresh: refreshAccounts,
    deleteAccount,
    archiveAccount,
  } = useFinancialAccounts(true);
  const account = accounts.find(a => a.id === accountId);

  const filter = useMemo(() => ({ account_id: accountId, limit: 50 }), [accountId]);
  const { transactions, monthlyTotals, loading, refresh } = useTransactions(filter);
  const { categories } = useCategories();
  const [statements, setStatements] = useState<BankStatement[]>([]);
  const [missingRates, setMissingRates] = useState(0);
  const [backfilling, setBackfilling] = useState(false);

  const categoryMap = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach(c => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const loadStatements = useCallback(async () => {
    try {
      const rows = await getBankStatementsForAccount(accountId);
      setStatements(rows);
    } catch {
      setStatements([]);
    }
  }, [accountId]);

  const loadMissingRates = useCallback(async () => {
    try {
      setMissingRates(await countMissingRates(accountId));
    } catch {
      setMissingRates(0);
    }
  }, [accountId]);

  useFocusEffect(
    useCallback(() => {
      void refreshAccounts();
      void refresh();
      void loadStatements();
      void loadMissingRates();
    }, [loadStatements, loadMissingRates, refresh, refreshAccounts])
  );

  async function handleBackfillRates() {
    setBackfilling(true);
    try {
      const result = await backfillMissingRates(accountId);
      await Promise.all([refresh(), loadMissingRates()]);
      if (result.failed === 0 && result.updated > 0) {
        Alert.alert('Cursuri actualizate', `${result.updated} tranzacții convertite în RON.`);
      } else if (result.updated > 0 && result.failed > 0) {
        Alert.alert(
          'Parțial',
          `${result.updated} convertite, ${result.failed} fără curs (verifică conexiunea).`
        );
      } else if (result.updated === 0 && result.failed > 0) {
        Alert.alert(
          'Eroare',
          'Nu s-a putut obține cursul BNR. Verifică conexiunea la internet și încearcă din nou.'
        );
      } else {
        Alert.alert('Cursuri', 'Nu există tranzacții fără curs.');
      }
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Recalcularea cursurilor a eșuat.');
    } finally {
      setBackfilling(false);
    }
  }

  if (!account) {
    return (
      <RNView style={[styles.container, { backgroundColor: C.background }]}>
        <Stack.Screen options={{ title: 'Cont financiar' }} />
        <RNView style={styles.emptyWrap}>
          <Ionicons
            name="wallet-outline"
            size={64}
            color={C.textSecondary}
            style={{ opacity: 0.4 }}
          />
          <RNText style={[styles.emptyTitle, { color: C.text }]}>Contul nu a fost găsit</RNText>
        </RNView>
      </RNView>
    );
  }

  const balance = account.balance ?? account.initial_balance;
  const balanceColor = balance >= 0 ? statusColors.ok : statusColors.critical;

  function handleDelete() {
    Alert.alert(
      'Șterge contul',
      `Ești sigur? Tranzacțiile contului „${account!.name}" rămân (fără cont legat), dar istoricul de importuri (extrase) se șterge.`,
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteAccount(accountId);
                if (router.canGoBack()) router.back();
                else router.replace('/(tabs)/conturi');
              } catch (e) {
                Alert.alert(
                  'Eroare',
                  e instanceof Error ? e.message : 'Nu s-a putut șterge contul.'
                );
              }
            })();
          },
        },
      ]
    );
  }

  function handleArchiveToggle() {
    if (!account) return;
    archiveAccount(accountId, !account.archived).catch(e => {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut actualiza contul.');
    });
  }

  function handleDeleteStatement(s: BankStatement) {
    Alert.alert(
      'Șterge importul',
      `Importul din ${s.period_from} → ${s.period_to} (${s.transaction_count} tranzacții). Cum continuăm?`,
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Doar importul',
          onPress: () => {
            void (async () => {
              try {
                await deleteBankStatement(s.id, false);
                await Promise.all([loadStatements(), refresh(), refreshAccounts()]);
              } catch (e) {
                Alert.alert(
                  'Eroare',
                  e instanceof Error ? e.message : 'Nu s-a putut șterge importul.'
                );
              }
            })();
          },
        },
        {
          text: 'Cu tranzacții',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteBankStatement(s.id, true);
                await Promise.all([loadStatements(), refresh(), refreshAccounts()]);
              } catch (e) {
                Alert.alert(
                  'Eroare',
                  e instanceof Error ? e.message : 'Nu s-a putut șterge importul.'
                );
              }
            })();
          },
        },
      ]
    );
  }

  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>
      <Stack.Screen options={{ title: account.name }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => { void refresh(); }} tintColor={C.primary} />
        }
      >
        {/* Balance card */}
        <RNView
          style={[styles.balanceCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
        >
          <RNText style={[styles.balanceLabel, { color: C.textSecondary }]}>Sold curent</RNText>
          <RNText style={[styles.balanceValue, { color: balanceColor }]}>
            {balance.toFixed(2)} {account.currency}
          </RNText>
          <RNText style={[styles.accountSubtitle, { color: C.textSecondary }]}>
            {FINANCIAL_ACCOUNT_TYPE_LABELS[account.type]}
            {account.bank_name ? ` • ${account.bank_name}` : ''}
            {account.archived ? ' • Arhivat' : ''}
          </RNText>
        </RNView>

        {/* Monthly totals */}
        {monthlyTotals && (
          <RNView style={styles.totalsRow}>
            <RNView
              style={[styles.totalsCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
            >
              <Ionicons name="arrow-down-circle" size={18} color={statusColors.ok} />
              <RNText style={[styles.totalsLabel, { color: C.textSecondary }]}>Venituri</RNText>
              <RNText style={[styles.totalsValue, { color: statusColors.ok }]}>
                +{monthlyTotals.income_ron.toFixed(0)}
              </RNText>
            </RNView>
            <RNView
              style={[styles.totalsCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
            >
              <Ionicons name="arrow-up-circle" size={18} color={statusColors.critical} />
              <RNText style={[styles.totalsLabel, { color: C.textSecondary }]}>Cheltuieli</RNText>
              <RNText style={[styles.totalsValue, { color: statusColors.critical }]}>
                -{monthlyTotals.expense_ron.toFixed(0)}
              </RNText>
            </RNView>
            <RNView
              style={[styles.totalsCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
            >
              <Ionicons name="trending-up" size={18} color={primary} />
              <RNText style={[styles.totalsLabel, { color: C.textSecondary }]}>Net</RNText>
              <RNText
                style={[
                  styles.totalsValue,
                  { color: monthlyTotals.net_ron >= 0 ? statusColors.ok : statusColors.critical },
                ]}
              >
                {monthlyTotals.net_ron >= 0 ? '+' : ''}
                {monthlyTotals.net_ron.toFixed(0)}
              </RNText>
            </RNView>
          </RNView>
        )}

        {/* Quick actions */}
        <RNView style={styles.actionsRow}>
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/(tabs)/tranzactii/[id]',
                params: { account_id: accountId },
              })
            }
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: primary },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons name="add-circle-outline" size={18} color="#fff" />
            <RNText style={styles.actionText}>Tranzacție nouă</RNText>
          </Pressable>
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/(tabs)/conturi/import',
                params: { account_id: accountId },
              })
            }
            style={({ pressed }) => [
              styles.actionBtnSecondary,
              { borderColor: C.border, backgroundColor: C.card },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons name="cloud-upload-outline" size={18} color={C.text} />
            <RNText style={[styles.actionTextSecondary, { color: C.text }]}>Import extras</RNText>
          </Pressable>
        </RNView>

        {/* Banner: cursuri lipsă */}
        {missingRates > 0 && (
          <RNView
            style={[
              styles.fxBanner,
              { backgroundColor: C.card, borderColor: statusColors.warning },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={20} color={statusColors.warning} />
            <RNView style={{ flex: 1 }}>
              <RNText style={[styles.fxBannerTitle, { color: C.text }]}>
                {missingRates}{' '}
                {missingRates === 1
                  ? 'tranzacție fără curs valutar'
                  : 'tranzacții fără curs valutar'}
              </RNText>
              <RNText style={[styles.fxBannerSub, { color: C.textSecondary }]}>
                Totalurile lunare exclud aceste sume. Recalculează când ai internet.
              </RNText>
            </RNView>
            <Pressable
              onPress={() => { void handleBackfillRates(); }}
              disabled={backfilling}
              hitSlop={8}
              style={({ pressed }) => [
                styles.fxBannerBtn,
                { backgroundColor: primary },
                (pressed || backfilling) && { opacity: 0.7 },
              ]}
            >
              <RNText style={styles.fxBannerBtnText}>
                {backfilling ? 'Lucrez…' : 'Recalculează'}
              </RNText>
            </Pressable>
          </RNView>
        )}

        {/* Account info */}
        <RNText style={[styles.sectionTitle, { color: C.textSecondary }]}>Detalii cont</RNText>
        <RNView style={[styles.infoCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          {account.iban ? <InfoRow label="IBAN" value={account.iban} C={C} /> : null}
          {account.bank_name ? <InfoRow label="Bancă" value={account.bank_name} C={C} /> : null}
          <InfoRow
            label="Sold inițial"
            value={`${account.initial_balance.toFixed(2)} ${account.currency}`}
            C={C}
          />
          {account.notes ? <InfoRow label="Note" value={account.notes} C={C} /> : null}
        </RNView>

        {/* Bank statements history */}
        {statements.length > 0 && (
          <>
            <RNView style={styles.txHeader}>
              <RNText style={[styles.sectionTitle, { color: C.textSecondary }]}>
                Istoric importuri
              </RNText>
              <RNText style={[styles.txCount, { color: C.textSecondary }]}>
                {statements.length}
              </RNText>
            </RNView>
            {statements.map(s => (
              <StatementRow
                key={s.id}
                stmt={s}
                currency={account.currency}
                C={C}
                onDelete={() => handleDeleteStatement(s)}
              />
            ))}
          </>
        )}

        {/* Transactions */}
        <RNView style={styles.txHeader}>
          <RNText style={[styles.sectionTitle, { color: C.textSecondary }]}>
            Tranzacții recente
          </RNText>
          {transactions.length > 0 && (
            <RNText style={[styles.txCount, { color: C.textSecondary }]}>
              {transactions.length}
            </RNText>
          )}
        </RNView>

        {transactions.length === 0 && !loading ? (
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
              Nicio tranzacție. Apasă „Tranzacție nouă" pentru a începe.
            </RNText>
          </RNView>
        ) : (
          transactions.map(t => (
            <TransactionRow
              key={t.id}
              tx={t}
              currency={account.currency}
              categoryName={t.category_id ? categoryMap.get(t.category_id) : undefined}
              C={C}
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/tranzactii/[id]',
                  params: { id: t.id },
                })
              }
            />
          ))
        )}

        {/* Manage actions */}
        <RNView style={styles.manageRow}>
          <Pressable
            onPress={() =>
              router.push({ pathname: '/(tabs)/conturi/edit', params: { id: accountId } })
            }
            style={({ pressed }) => [
              styles.manageBtn,
              { borderColor: C.border, backgroundColor: C.card },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons name="create-outline" size={16} color={C.text} />
            <RNText style={[styles.manageText, { color: C.text }]}>Editează</RNText>
          </Pressable>
          <Pressable
            onPress={handleArchiveToggle}
            style={({ pressed }) => [
              styles.manageBtn,
              { borderColor: C.border, backgroundColor: C.card },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons
              name={account.archived ? 'archive' : 'archive-outline'}
              size={16}
              color={C.text}
            />
            <RNText style={[styles.manageText, { color: C.text }]}>
              {account.archived ? 'Reactivează' : 'Arhivează'}
            </RNText>
          </Pressable>
          <Pressable
            onPress={handleDelete}
            style={({ pressed }) => [
              styles.manageBtn,
              { borderColor: statusColors.critical, backgroundColor: C.card },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons name="trash-outline" size={16} color={statusColors.critical} />
            <RNText style={[styles.manageText, { color: statusColors.critical }]}>Șterge</RNText>
          </Pressable>
        </RNView>
      </ScrollView>

      <BottomActionBar
        label="Tranzacție nouă"
        icon={<Ionicons name="add" size={18} color="#fff" />}
        onPress={() =>
          router.push({
            pathname: '/(tabs)/tranzactii/[id]',
            params: { account_id: accountId },
          })
        }
        safeArea
      />
    </RNView>
  );
}

function InfoRow({ label, value, C }: { label: string; value: string; C: typeof Colors.light }) {
  return (
    <RNView style={styles.infoRow}>
      <RNText style={[styles.infoLabel, { color: C.textSecondary }]}>{label}</RNText>
      <RNText style={[styles.infoValue, { color: C.text }]} numberOfLines={2}>
        {value}
      </RNText>
    </RNView>
  );
}

function StatementRow({
  stmt,
  currency,
  C,
  onDelete,
}: {
  stmt: BankStatement;
  currency: string;
  C: typeof Colors.light;
  onDelete: () => void;
}) {
  const importedDate = stmt.imported_at.slice(0, 10);
  return (
    <RNView style={[styles.stmtRow, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
      <RNView style={{ flex: 1 }}>
        <RNText style={[styles.txTitle, { color: C.text }]} numberOfLines={1}>
          {stmt.period_from} → {stmt.period_to}
        </RNText>
        <RNText style={[styles.txSub, { color: C.textSecondary }]} numberOfLines={1}>
          Importat {importedDate} • {stmt.transaction_count} tranzacții
        </RNText>
        <RNText style={[styles.txSub, { color: C.textSecondary }]} numberOfLines={1}>
          <RNText style={{ color: statusColors.ok }}>+{stmt.total_inflow.toFixed(0)}</RNText>
          {' / '}
          <RNText style={{ color: statusColors.critical }}>
            -{stmt.total_outflow.toFixed(0)}
          </RNText>{' '}
          {currency}
        </RNText>
      </RNView>
      <Pressable
        onPress={onDelete}
        hitSlop={10}
        style={({ pressed }) => [styles.stmtDelete, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="trash-outline" size={18} color={statusColors.critical} />
      </Pressable>
    </RNView>
  );
}

function TransactionRow({
  tx,
  currency,
  categoryName,
  C,
  onPress,
}: {
  tx: Transaction;
  currency: string;
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
        {tx.amount.toFixed(2)} {tx.currency || currency}
      </RNText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 96 },

  balanceCard: {
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  balanceLabel: { fontSize: 13, marginBottom: 4 },
  balanceValue: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5 },
  accountSubtitle: { fontSize: 13, marginTop: 6 },

  totalsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
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

  actionsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 12,
  },
  actionBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
  },
  actionText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  actionTextSecondary: { fontWeight: '600', fontSize: 14 },

  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  infoCard: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 20,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 8,
    gap: 12,
  },
  infoLabel: { fontSize: 13, flexShrink: 0 },
  infoValue: { fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'right' },

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

  stmtRow: {
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
  stmtDelete: { padding: 6 },

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
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginTop: 16 },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 18 },

  fxBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  fxBannerTitle: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  fxBannerSub: { fontSize: 12 },
  fxBannerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  fxBannerBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  manageRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  manageBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
  },
  manageText: { fontSize: 13, fontWeight: '500' },
});
