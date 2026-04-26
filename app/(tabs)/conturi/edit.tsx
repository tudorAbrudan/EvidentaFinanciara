import { useEffect, useState } from 'react';
import {
  StyleSheet,
  Pressable,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { Text, View, ThemedTextInput } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import {
  FINANCIAL_ACCOUNT_TYPE_LABELS,
  type FinancialAccount,
  type FinancialAccountType,
} from '@/types';

const ACCOUNT_TYPES: FinancialAccountType[] = [
  'bank',
  'cash',
  'card',
  'savings',
  'investment',
  'other',
];

const CURRENCY_OPTIONS = ['RON', 'EUR', 'USD'] as const;

export default function EditFinancialAccountScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const params = useLocalSearchParams<{ id: string }>();
  const accountId = params.id as string;
  const { getAccount, updateAccount, refresh } = useFinancialAccounts(true);
  const headerHeight = useHeaderHeight();

  const [loadingAccount, setLoadingAccount] = useState(true);
  const [type, setType] = useState<FinancialAccountType>('bank');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<string>('RON');
  const [initialBalance, setInitialBalance] = useState('');
  const [iban, setIban] = useState('');
  const [bankName, setBankName] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAccount(accountId)
      .then((acc: FinancialAccount | null) => {
        if (cancelled || !acc) return;
        setType(acc.type);
        setName(acc.name);
        setCurrency(acc.currency);
        setInitialBalance(String(acc.initial_balance));
        setIban(acc.iban ?? '');
        setBankName(acc.bank_name ?? '');
        setNotes(acc.notes ?? '');
      })
      .finally(() => {
        if (!cancelled) setLoadingAccount(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, getAccount]);

  async function handleSubmit() {
    if (!name.trim()) {
      Alert.alert('Eroare', 'Introdu un nume pentru cont.');
      return;
    }
    const balanceNum = initialBalance.trim() ? Number(initialBalance.replace(',', '.')) : 0;
    if (Number.isNaN(balanceNum)) {
      Alert.alert('Eroare', 'Soldul inițial nu e un număr valid.');
      return;
    }
    setLoading(true);
    try {
      await updateAccount(accountId, {
        name: name.trim(),
        type,
        currency,
        initial_balance: balanceNum,
        iban: iban.trim() || null,
        bank_name: bankName.trim() || null,
        notes: notes.trim() || null,
      });
      await refresh();
      if (router.canGoBack()) router.back();
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut actualiza contul');
    } finally {
      setLoading(false);
    }
  }

  if (loadingAccount) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Editează cont' }} />
        <ActivityIndicator color={primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <Stack.Screen options={{ title: 'Editează cont' }} />
      <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.inner}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>Tip cont</Text>
          <View style={styles.typeRow}>
            {ACCOUNT_TYPES.map(t => {
              const selected = t === type;
              return (
                <Pressable
                  key={t}
                  onPress={() => setType(t)}
                  style={({ pressed }) => [
                    styles.typeChip,
                    {
                      borderColor: selected ? primary : C.border,
                      backgroundColor: selected ? `${primary}22` : 'transparent',
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[styles.typeChipText, { color: selected ? primary : C.text }]}>
                    {FINANCIAL_ACCOUNT_TYPE_LABELS[t]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Nume cont</Text>
          <ThemedTextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            editable={!loading}
          />

          <Text style={styles.label}>Monedă</Text>
          <View style={styles.typeRow}>
            {CURRENCY_OPTIONS.map(c => {
              const selected = c === currency;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCurrency(c)}
                  style={({ pressed }) => [
                    styles.typeChip,
                    {
                      borderColor: selected ? primary : C.border,
                      backgroundColor: selected ? `${primary}22` : 'transparent',
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[styles.typeChipText, { color: selected ? primary : C.text }]}>
                    {c}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Sold inițial</Text>
          <ThemedTextInput
            style={styles.input}
            placeholder="0.00"
            value={initialBalance}
            onChangeText={setInitialBalance}
            keyboardType="decimal-pad"
            editable={!loading}
          />
          <Text style={styles.hint}>
            Schimbarea soldului inițial afectează soldul curent (= inițial + tranzacții).
          </Text>

          {(type === 'bank' || type === 'savings' || type === 'card') && (
            <>
              <Text style={styles.label}>Bancă (opțional)</Text>
              <ThemedTextInput
                style={styles.input}
                value={bankName}
                onChangeText={setBankName}
                editable={!loading}
              />
              <Text style={styles.label}>IBAN (opțional)</Text>
              <ThemedTextInput
                style={styles.input}
                value={iban}
                onChangeText={setIban}
                autoCapitalize="characters"
                editable={!loading}
              />
            </>
          )}

          <Text style={styles.label}>Note (opțional)</Text>
          <ThemedTextInput
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
            value={notes}
            onChangeText={setNotes}
            multiline
            editable={!loading}
          />
        </ScrollView>
      </Pressable>
      <BottomActionBar label="Salvează" onPress={handleSubmit} loading={loading} safeArea />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  inner: { padding: 24, paddingBottom: 120 },
  label: { fontSize: 14, marginBottom: 6, opacity: 0.9 },
  hint: { fontSize: 12, opacity: 0.55, marginTop: -14, marginBottom: 20, lineHeight: 17 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 20,
  },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  typeChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  typeChipText: { fontSize: 14, fontWeight: '500' },
});
