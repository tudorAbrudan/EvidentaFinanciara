import { useHeaderHeight } from '@react-navigation/elements';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  StyleSheet,
  Pressable,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';

import { Text, View, ThemedTextInput } from '@/components/Themed';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import { primary } from '@/theme/colors';
import { FINANCIAL_ACCOUNT_TYPE_LABELS, type FinancialAccountType } from '@/types';

const ACCOUNT_TYPES: FinancialAccountType[] = [
  'bank',
  'cash',
  'card',
  'savings',
  'investment',
  'other',
];

const CURRENCY_OPTIONS = ['RON', 'EUR', 'USD'] as const;

export default function AddFinancialAccountScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const params = useLocalSearchParams<{ type?: string }>();
  const { createAccount, refresh } = useFinancialAccounts();
  const headerHeight = useHeaderHeight();

  const initialType = (params.type as FinancialAccountType) || 'bank';
  const [type, setType] = useState<FinancialAccountType>(initialType);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<string>('RON');
  const [initialBalance, setInitialBalance] = useState('');
  const [iban, setIban] = useState('');
  const [bankName, setBankName] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

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
      await createAccount({
        name: name.trim(),
        type,
        currency,
        initial_balance: balanceNum,
        initial_balance_date: new Date().toISOString().slice(0, 10),
        iban: iban.trim() || undefined,
        bank_name: bankName.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      await refresh();
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/conturi');
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut crea contul');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
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
            placeholder={
              type === 'cash'
                ? 'ex. Numerar portofel'
                : type === 'savings'
                  ? 'ex. Economii BCR'
                  : 'ex. Cont curent ING'
            }
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

          {(type === 'bank' || type === 'savings' || type === 'card') && (
            <>
              <Text style={styles.label}>Bancă (opțional)</Text>
              <ThemedTextInput
                style={styles.input}
                placeholder="ex. ING, BCR, BT"
                value={bankName}
                onChangeText={setBankName}
                editable={!loading}
              />
              <Text style={styles.label}>IBAN (opțional)</Text>
              <ThemedTextInput
                style={styles.input}
                placeholder="RO00 BANK 0000 0000 0000 0000"
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
            placeholder="Detalii suplimentare"
            value={notes}
            onChangeText={setNotes}
            multiline
            editable={!loading}
          />
        </ScrollView>
      </Pressable>
      <BottomActionBar label="Salvează" onPress={() => { void handleSubmit(); }} loading={loading} safeArea />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { padding: 24, paddingBottom: 120 },
  label: { fontSize: 14, marginBottom: 6, opacity: 0.9 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 20,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  typeChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  typeChipText: { fontSize: 14, fontWeight: '500' },
});
