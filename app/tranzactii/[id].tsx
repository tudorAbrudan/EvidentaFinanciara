import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  StyleSheet,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';

import CategoryIcon from '@/components/CategoryIcon';
import { Text, View, ThemedTextInput } from '@/components/Themed';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useCategories } from '@/hooks/useCategories';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import { useTransactions } from '@/hooks/useTransactions';
import {
  getTransaction,
  findPossibleDuplicate,
  findInternalTransferCandidatesNear,
  linkAsInternalTransfer,
} from '@/services/transactions';
import { primary, statusColors } from '@/theme/colors';
import type { ExpenseCategory, FinancialAccount, Transaction } from '@/types';

type TxKind = 'expense' | 'income';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * După salvarea unei tranzacții manuale, caută în jurul datei perechi de
 * tranzacții care arată ca transfer intern (sume opuse, conturi diferite,
 * dată ±2 zile, neîncă marcate). Dacă găsește exact o pereche, le leagă.
 * Best-effort — nu blochează salvarea, nu deranjează userul cu dialog.
 */
async function autoLinkNearbyTransfer(pivotDate: string): Promise<void> {
  const candidates = await findInternalTransferCandidatesNear(pivotDate, 5);
  for (const c of candidates) {
    try {
      await linkAsInternalTransfer(c.outflow.id, c.inflow.id);
    } catch {
      // perechea nu îndeplinește vreo constrângere — ignorăm
    }
  }
}

export default function TransactionEditorScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const headerHeight = useHeaderHeight();
  const params = useLocalSearchParams<{
    id?: string;
    account_id?: string;
    prefill_amount?: string;
    prefill_date?: string;
    prefill_merchant?: string;
    prefill_description?: string;
    prefill_kind?: 'expense' | 'income';
  }>();
  const editingId = params.id && params.id !== 'new' ? (params.id as string) : undefined;
  const initialAccountId = params.account_id as string | undefined;

  const { accounts } = useFinancialAccounts();
  const { categories } = useCategories();
  const { createTransaction, updateTransaction, deleteTransaction, refresh } = useTransactions();

  const [loadingTx, setLoadingTx] = useState(!!editingId);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<TxKind>(params.prefill_kind ?? 'expense');
  const [accountId, setAccountId] = useState<string | undefined>(initialAccountId);
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [date, setDate] = useState<string>(params.prefill_date ?? todayIso());
  const [amountStr, setAmountStr] = useState<string>(params.prefill_amount ?? '');
  const [merchant, setMerchant] = useState(params.prefill_merchant ?? '');
  const [description, setDescription] = useState(params.prefill_description ?? '');
  const [notes, setNotes] = useState('');
  const [isRefund, setIsRefund] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    void getTransaction(editingId)
      .then((tx: Transaction | null) => {
        if (cancelled || !tx) return;
        setKind(tx.amount >= 0 ? 'income' : 'expense');
        setAccountId(tx.account_id);
        setCategoryId(tx.category_id);
        setDate(tx.date);
        setAmountStr(Math.abs(tx.amount).toFixed(2));
        setMerchant(tx.merchant ?? '');
        setDescription(tx.description ?? '');
        setNotes(tx.notes ?? '');
        setIsRefund(tx.is_refund);
      })
      .finally(() => {
        if (!cancelled) setLoadingTx(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editingId]);

  const account = accounts.find(a => a.id === accountId);
  const currency = account?.currency ?? 'RON';
  const category = categories.find(c => c.id === categoryId);

  async function performSave(signedAmount: number) {
    if (editingId) {
      await updateTransaction(editingId, {
        account_id: accountId ?? null,
        date,
        amount: signedAmount,
        currency,
        amount_ron: currency === 'RON' ? signedAmount : null,
        description: description.trim() || null,
        merchant: merchant.trim() || null,
        category_id: categoryId ?? null,
        notes: notes.trim() || null,
        is_refund: isRefund,
      });
    } else {
      await createTransaction({
        account_id: accountId,
        date,
        amount: signedAmount,
        currency,
        description: description.trim() || undefined,
        merchant: merchant.trim() || undefined,
        category_id: categoryId,
        source: 'manual',
        notes: notes.trim() || undefined,
        is_refund: isRefund,
      });
      // Detectează transferuri interne în jurul datei (lăsat să ruleze fără
      // a bloca UI). Dacă găsește o pereche perfectă, o leagă automat.
      autoLinkNearbyTransfer(date).catch(() => {});
    }
    await refresh();
    if (router.canGoBack()) router.back();
  }

  async function handleSubmit() {
    const parsed = Number(amountStr.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert('Eroare', 'Suma trebuie să fie un număr pozitiv.');
      return;
    }
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      Alert.alert('Eroare', 'Data trebuie să fie în format YYYY-MM-DD.');
      return;
    }
    const signedAmount = kind === 'expense' ? -Math.abs(parsed) : Math.abs(parsed);

    setLoading(true);
    try {
      // Verifică duplicate înainte de save (doar la creare, nu la editare)
      if (!editingId) {
        const dup = await findPossibleDuplicate({
          account_id: accountId,
          date,
          amount: signedAmount,
          merchant: merchant.trim() || undefined,
          description: description.trim() || undefined,
        });
        if (dup) {
          const dupLabel =
            dup.merchant ||
            dup.description ||
            (dup.is_internal_transfer ? 'Transfer' : 'Tranzacție');
          const dupAmt = `${dup.amount.toFixed(2)} ${dup.currency}`;
          setLoading(false);
          Alert.alert(
            'Pare duplicat',
            `Există deja o tranzacție similară:\n\n${dupLabel} • ${dup.date} • ${dupAmt}\n\nVrei să o adaugi oricum?`,
            [
              { text: 'Anulează', style: 'cancel' },
              {
                text: 'Adaugă oricum',
                style: 'destructive',
                onPress: () => {
                  void (async () => {
                    setLoading(true);
                    try {
                      await performSave(signedAmount);
                    } catch (e) {
                      Alert.alert(
                        'Eroare',
                        e instanceof Error ? e.message : 'Nu s-a putut salva tranzacția'
                      );
                    } finally {
                      setLoading(false);
                    }
                  })();
                },
              },
            ]
          );
          return;
        }
      }

      await performSave(signedAmount);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva tranzacția');
    } finally {
      setLoading(false);
    }
  }

  function handleDelete() {
    if (!editingId) return;
    Alert.alert('Șterge tranzacția', 'Operația nu poate fi anulată.', [
      { text: 'Anulează', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteTransaction(editingId);
              await refresh();
              if (router.canGoBack()) router.back();
            } catch (e) {
              Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut șterge.');
            }
          })();
        },
      },
    ]);
  }

  if (loadingTx) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Tranzacție' }} />
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
      <Stack.Screen
        options={{
          title: editingId ? 'Editează tranzacție' : 'Tranzacție nouă',
          headerLeft: () => (
            <Pressable
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace('/');
              }}
              style={({ pressed }) => [
                { paddingHorizontal: 12, paddingVertical: 6 },
                pressed && { opacity: 0.6 },
              ]}
              hitSlop={8}
              accessibilityLabel="Închide"
            >
              <Ionicons name="close" size={26} color={C.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Kind */}
        <Text style={styles.label}>Tip</Text>
        <View style={styles.kindRow}>
          <KindButton
            active={kind === 'expense'}
            color={statusColors.critical}
            icon="arrow-up-circle"
            label="Cheltuială"
            onPress={() => setKind('expense')}
            C={C}
          />
          <KindButton
            active={kind === 'income'}
            color={statusColors.ok}
            icon="arrow-down-circle"
            label="Venit"
            onPress={() => setKind('income')}
            C={C}
          />
        </View>

        {/* Amount */}
        <Text style={styles.label}>Sumă ({currency})</Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="0.00"
          value={amountStr}
          onChangeText={setAmountStr}
          keyboardType="decimal-pad"
          editable={!loading}
        />

        {/* Account */}
        <Text style={styles.label}>Cont</Text>
        <Pressable
          onPress={() => setShowAccountPicker(v => !v)}
          style={[styles.selector, { borderColor: C.border, backgroundColor: C.card }]}
        >
          <Text style={[styles.selectorText, { color: account ? C.text : C.textSecondary }]}>
            {account ? `${account.name} (${account.currency})` : 'Fără cont (numerar liber)'}
          </Text>
          <Ionicons
            name={showAccountPicker ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={C.textSecondary}
          />
        </Pressable>
        {showAccountPicker && (
          <View style={[styles.pickerCard, { borderColor: C.border, backgroundColor: C.card }]}>
            <Pressable
              onPress={() => {
                setAccountId(undefined);
                setShowAccountPicker(false);
              }}
              style={({ pressed }) => [styles.pickerItem, pressed && { opacity: 0.7 }]}
            >
              <Text style={{ color: !accountId ? primary : C.text }}>
                Fără cont (numerar liber)
              </Text>
            </Pressable>
            {accounts.map(a => (
              <AccountPickerItem
                key={a.id}
                acc={a}
                active={a.id === accountId}
                onPress={() => {
                  setAccountId(a.id);
                  setShowAccountPicker(false);
                }}
                C={C}
              />
            ))}
          </View>
        )}

        {/* Category */}
        <Text style={styles.label}>Categorie</Text>
        <Pressable
          onPress={() => setShowCategoryPicker(v => !v)}
          style={[styles.selector, { borderColor: C.border, backgroundColor: C.card }]}
        >
          <View style={styles.selectorInner}>
            {category ? (
              <CategoryIcon icon={category.icon} size={18} color={category.color ?? primary} />
            ) : null}
            <Text style={[styles.selectorText, { color: category ? C.text : C.textSecondary }]}>
              {category ? category.name : 'Fără categorie'}
            </Text>
          </View>
          <Ionicons
            name={showCategoryPicker ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={C.textSecondary}
          />
        </Pressable>
        {showCategoryPicker && (
          <View style={[styles.pickerCard, { borderColor: C.border, backgroundColor: C.card }]}>
            <Pressable
              onPress={() => {
                setCategoryId(undefined);
                setShowCategoryPicker(false);
              }}
              style={({ pressed }) => [styles.pickerItem, pressed && { opacity: 0.7 }]}
            >
              <Text style={{ color: !categoryId ? primary : C.text }}>Fără categorie</Text>
            </Pressable>
            {categories.map(c => (
              <CategoryPickerItem
                key={c.id}
                cat={c}
                active={c.id === categoryId}
                onPress={() => {
                  setCategoryId(c.id);
                  setShowCategoryPicker(false);
                }}
                C={C}
              />
            ))}
          </View>
        )}

        {/* Date */}
        <Text style={styles.label}>Data (YYYY-MM-DD)</Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="2026-01-15"
          value={date}
          onChangeText={setDate}
          autoCapitalize="none"
          editable={!loading}
        />

        {/* Merchant */}
        <Text style={styles.label}>Magazin / Comerciant (opțional)</Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="ex. Kaufland, Petrom"
          value={merchant}
          onChangeText={setMerchant}
          editable={!loading}
        />

        {/* Description */}
        <Text style={styles.label}>Descriere (opțional)</Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="ex. Cumpărături săptămânale"
          value={description}
          onChangeText={setDescription}
          editable={!loading}
        />

        {/* Refund toggle */}
        {kind === 'income' && (
          <Pressable
            onPress={() => setIsRefund(v => !v)}
            style={[styles.toggleRow, { borderColor: C.border }]}
          >
            <Ionicons
              name={isRefund ? 'checkbox' : 'square-outline'}
              size={20}
              color={isRefund ? primary : C.textSecondary}
            />
            <Text style={{ flex: 1, color: C.text }}>Este retur la o cheltuială</Text>
          </Pressable>
        )}

        {/* Notes */}
        <Text style={styles.label}>Note (opțional)</Text>
        <ThemedTextInput
          style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
          value={notes}
          onChangeText={setNotes}
          multiline
          editable={!loading}
        />

        {editingId && (
          <Pressable
            onPress={handleDelete}
            style={({ pressed }) => [
              styles.deleteBtn,
              { borderColor: statusColors.critical },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons name="trash-outline" size={16} color={statusColors.critical} />
            <Text style={{ color: statusColors.critical, fontWeight: '500' }}>
              Șterge tranzacția
            </Text>
          </Pressable>
        )}
      </ScrollView>
      <BottomActionBar
        label="Salvează"
        onPress={() => {
          void handleSubmit();
        }}
        loading={loading}
        safeArea
      />
    </KeyboardAvoidingView>
  );
}

function KindButton({
  active,
  color,
  icon,
  label,
  onPress,
  C,
}: {
  active: boolean;
  color: string;
  icon: 'arrow-up-circle' | 'arrow-down-circle';
  label: string;
  onPress: () => void;
  C: typeof Colors.light;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.kindBtn,
        {
          borderColor: active ? color : C.border,
          backgroundColor: active ? `${color}22` : 'transparent',
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Ionicons name={icon} size={18} color={active ? color : C.textSecondary} />
      <Text style={[styles.kindText, { color: active ? color : C.text }]}>{label}</Text>
    </Pressable>
  );
}

function AccountPickerItem({
  acc,
  active,
  onPress,
  C,
}: {
  acc: FinancialAccount & { balance?: number };
  active: boolean;
  onPress: () => void;
  C: typeof Colors.light;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.pickerItem, pressed && { opacity: 0.7 }]}
    >
      <Text style={{ color: active ? primary : C.text, flex: 1 }}>{acc.name}</Text>
      <Text style={{ color: C.textSecondary, fontSize: 12 }}>{acc.currency}</Text>
    </Pressable>
  );
}

function CategoryPickerItem({
  cat,
  active,
  onPress,
  C,
}: {
  cat: ExpenseCategory;
  active: boolean;
  onPress: () => void;
  C: typeof Colors.light;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.pickerItem, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.pickerItemInner}>
        <CategoryIcon icon={cat.icon} size={18} color={cat.color ?? primary} />
        <Text style={{ color: active ? primary : C.text, flex: 1 }}>{cat.name}</Text>
      </View>
      {cat.monthly_limit ? (
        <Text style={{ color: C.textSecondary, fontSize: 12 }}>limită {cat.monthly_limit} RON</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
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
  kindRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  kindBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderWidth: 1,
    borderRadius: 12,
  },
  kindText: { fontWeight: '600', fontSize: 14 },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  selectorText: { flex: 1, fontSize: 15 },
  selectorInner: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  pickerItemInner: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  pickerCard: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 20,
    paddingVertical: 4,
    maxHeight: 320,
  },
  pickerItem: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 20,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 8,
  },
});
