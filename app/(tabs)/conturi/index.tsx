import { useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  View as RNView,
  Text as RNText,
} from 'react-native';
import { router, useFocusEffect, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import { FINANCIAL_ACCOUNT_TYPE_LABELS } from '@/types';

export default function ConturiListScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const { accounts, loading, error, refresh } = useFinancialAccounts(true);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [])
  );

  const totalRon = accounts
    .filter(a => a.currency === 'RON' && !a.archived)
    .reduce((s, a) => s + (a.balance ?? a.initial_balance), 0);

  const activeAccounts = accounts.filter(a => !a.archived);
  const archivedAccounts = accounts.filter(a => a.archived);

  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>
      <Stack.Screen options={{ title: 'Conturi financiare' }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.primary} />
        }
      >
        {/* Total RON sumar */}
        {activeAccounts.some(a => a.currency === 'RON') && (
          <RNView
            style={[styles.summaryCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
          >
            <RNText style={[styles.summaryLabel, { color: C.textSecondary }]}>
              Sold total (RON)
            </RNText>
            <RNText
              style={[
                styles.summaryValue,
                { color: totalRon >= 0 ? statusColors.ok : statusColors.critical },
              ]}
            >
              {totalRon >= 0 ? '+' : ''}
              {totalRon.toFixed(2)} RON
            </RNText>
            <RNText style={[styles.summarySub, { color: C.textSecondary }]}>
              {activeAccounts.length}{' '}
              {activeAccounts.length === 1 ? 'cont activ' : 'conturi active'}
            </RNText>
          </RNView>
        )}

        {error && (
          <RNView
            style={[
              styles.errorBanner,
              {
                backgroundColor: scheme === 'dark' ? 'rgba(216,76,76,0.18)' : '#FFEBEE',
                borderColor: statusColors.critical,
              },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={16} color={statusColors.critical} />
            <RNText style={[styles.errorText, { color: statusColors.critical }]}>{error}</RNText>
          </RNView>
        )}

        {/* Conturi active */}
        {activeAccounts.length > 0 && (
          <>
            <RNText style={[styles.sectionTitle, { color: C.textSecondary }]}>
              Conturi active
            </RNText>
            {activeAccounts.map(acc => (
              <AccountRow key={acc.id} account={acc} C={C} scheme={scheme} />
            ))}
          </>
        )}

        {/* Conturi arhivate */}
        {archivedAccounts.length > 0 && (
          <>
            <RNText style={[styles.sectionTitle, { color: C.textSecondary, marginTop: 16 }]}>
              Conturi arhivate
            </RNText>
            {archivedAccounts.map(acc => (
              <AccountRow key={acc.id} account={acc} C={C} scheme={scheme} />
            ))}
          </>
        )}

        {accounts.length === 0 && !loading && (
          <RNView
            style={[styles.emptyCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
          >
            <Ionicons
              name="wallet-outline"
              size={48}
              color={C.textSecondary}
              style={{ opacity: 0.4 }}
            />
            <RNText style={[styles.emptyTitle, { color: C.text }]}>Niciun cont</RNText>
            <RNText style={[styles.emptySub, { color: C.textSecondary }]}>
              Adaugă un cont pentru a importa extrase sau a separa fluxurile financiare.
            </RNText>
          </RNView>
        )}
      </ScrollView>

      <BottomActionBar
        label="Adaugă cont"
        icon={<Ionicons name="add" size={18} color="#fff" />}
        onPress={() => router.push('/(tabs)/conturi/add')}
        safeArea
      />
    </RNView>
  );
}

function AccountRow({
  account,
  C,
  scheme,
}: {
  account: ReturnType<typeof useFinancialAccounts>['accounts'][0];
  C: typeof Colors.light;
  scheme: 'light' | 'dark';
}) {
  const balance = account.balance ?? account.initial_balance;
  const balanceColor = balance >= 0 ? statusColors.ok : statusColors.critical;
  return (
    <Pressable
      onPress={() => router.push(`/(tabs)/conturi/${account.id}` as const)}
      style={({ pressed }) => [
        styles.accountCard,
        {
          backgroundColor: C.card,
          shadowColor: C.cardShadow,
          opacity: account.archived ? 0.7 : 1,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <RNView
        style={[
          styles.iconWrap,
          {
            backgroundColor:
              account.color || (scheme === 'dark' ? 'rgba(158,181,103,0.2)' : '#E8F5E9'),
          },
        ]}
      >
        <Ionicons
          name={(account.icon as React.ComponentProps<typeof Ionicons>['name']) || 'wallet'}
          size={22}
          color={account.color ? '#fff' : primary}
        />
      </RNView>
      <RNView style={styles.accountContent}>
        <RNText style={[styles.accountName, { color: C.text }]} numberOfLines={1}>
          {account.name}
        </RNText>
        <RNText style={[styles.accountSub, { color: C.textSecondary }]} numberOfLines={1}>
          {FINANCIAL_ACCOUNT_TYPE_LABELS[account.type]}
          {account.bank_name ? ` • ${account.bank_name}` : ''}
          {account.archived ? ' • arhivat' : ''}
        </RNText>
      </RNView>
      <RNView style={styles.accountBalance}>
        <RNText style={[styles.balanceValue, { color: balanceColor }]}>{balance.toFixed(2)}</RNText>
        <RNText style={[styles.balanceCurrency, { color: C.textSecondary }]}>
          {account.currency}
        </RNText>
      </RNView>
      <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 96 },

  summaryCard: {
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  summaryLabel: { fontSize: 12, marginBottom: 4 },
  summaryValue: { fontSize: 26, fontWeight: '700' },
  summarySub: { fontSize: 12, marginTop: 4 },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  errorText: { fontSize: 13, flex: 1 },

  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },

  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 12,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountContent: { flex: 1, gap: 2 },
  accountName: { fontSize: 15, fontWeight: '600' },
  accountSub: { fontSize: 12 },
  accountBalance: { alignItems: 'flex-end' },
  balanceValue: { fontSize: 14, fontWeight: '700' },
  balanceCurrency: { fontSize: 11 },

  emptyCard: {
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    gap: 8,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginTop: 8 },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 18, opacity: 0.8 },
});
