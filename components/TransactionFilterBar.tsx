import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { TransactionFilter } from '@/services/transactions';
import { statusColors } from '@/theme/colors';
import type { ExpenseCategory, FinancialAccount } from '@/types';

type Props = {
  value: TransactionFilter;
  onChange: (next: TransactionFilter) => void;
  accounts: FinancialAccount[];
  categories: ExpenseCategory[];
};

type SheetKind = 'account' | 'category' | 'period' | 'amount' | null;

type PeriodPreset =
  | { kind: 'all' }
  | { kind: 'thisMonth' }
  | { kind: 'lastMonth' }
  | { kind: 'last3Months' }
  | { kind: 'thisYear' };

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidYmd(s: string): boolean {
  if (!YMD_RE.test(s)) return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  return ymd(d) === s;
}

function formatDateInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function presetToRange(p: PeriodPreset): { fromDate?: string; toDate?: string } {
  const now = new Date();
  if (p.kind === 'all') return {};
  if (p.kind === 'thisMonth') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { fromDate: ymd(from), toDate: ymd(to) };
  }
  if (p.kind === 'lastMonth') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return { fromDate: ymd(from), toDate: ymd(to) };
  }
  if (p.kind === 'last3Months') {
    const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { fromDate: ymd(from), toDate: ymd(to) };
  }
  const from = new Date(now.getFullYear(), 0, 1);
  const to = new Date(now.getFullYear(), 11, 31);
  return { fromDate: ymd(from), toDate: ymd(to) };
}

function formatPeriodLabel(filter: TransactionFilter): string {
  if (!filter.fromDate && !filter.toDate) return 'Toate';
  if (filter.fromDate && filter.toDate) return `${filter.fromDate} → ${filter.toDate}`;
  if (filter.fromDate) return `≥ ${filter.fromDate}`;
  return `≤ ${filter.toDate}`;
}

function formatAmountLabel(r: TransactionFilter['absAmountRange']): string {
  if (!r) return '—';
  if (r.min !== undefined && r.max !== undefined) return `${r.min} – ${r.max}`;
  if (r.min !== undefined) return `≥ ${r.min}`;
  if (r.max !== undefined) return `≤ ${r.max}`;
  return '—';
}

function isAnyFilterActive(f: TransactionFilter): boolean {
  return Boolean(
    f.account_id ||
    f.category_id ||
    f.uncategorized ||
    f.fromDate ||
    f.toDate ||
    (f.search && f.search.trim()) ||
    f.absAmountRange
  );
}

export function TransactionFilterBar({ value, onChange, accounts, categories }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [sheet, setSheet] = useState<SheetKind>(null);

  const accountLabel = useMemo(() => {
    if (!value.account_id) return 'Toate';
    return accounts.find(a => a.id === value.account_id)?.name ?? 'Toate';
  }, [accounts, value.account_id]);

  const categoryLabel = useMemo(() => {
    if (value.uncategorized) return 'Necategorizat';
    if (!value.category_id) return 'Toate';
    return categories.find(c => c.id === value.category_id)?.name ?? 'Toate';
  }, [categories, value.category_id, value.uncategorized]);
  const categoryActive = Boolean(value.category_id || value.uncategorized);

  const chipStyle = (active: boolean) => ({
    backgroundColor: active ? C.tint : C.card,
    borderColor: active ? C.tint : C.border,
  });
  const chipText = (active: boolean) => ({ color: active ? C.background : C.text });

  function clearAll() {
    onChange({});
  }

  return (
    <View style={[styles.container, { backgroundColor: C.background, borderColor: C.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <Chip
          icon="wallet-outline"
          label={`Cont: ${accountLabel}`}
          active={Boolean(value.account_id)}
          onPress={() => setSheet('account')}
          onClear={
            value.account_id ? () => onChange({ ...value, account_id: undefined }) : undefined
          }
          style={chipStyle(Boolean(value.account_id))}
          textStyle={chipText(Boolean(value.account_id))}
        />
        <Chip
          icon="pricetag-outline"
          label={`Categorie: ${categoryLabel}`}
          active={categoryActive}
          onPress={() => setSheet('category')}
          onClear={
            categoryActive
              ? () => onChange({ ...value, category_id: undefined, uncategorized: undefined })
              : undefined
          }
          style={chipStyle(categoryActive)}
          textStyle={chipText(categoryActive)}
        />
        <Chip
          icon="calendar-outline"
          label={`Per: ${formatPeriodLabel(value)}`}
          active={Boolean(value.fromDate || value.toDate)}
          onPress={() => setSheet('period')}
          onClear={
            value.fromDate || value.toDate
              ? () => onChange({ ...value, fromDate: undefined, toDate: undefined })
              : undefined
          }
          style={chipStyle(Boolean(value.fromDate || value.toDate))}
          textStyle={chipText(Boolean(value.fromDate || value.toDate))}
        />
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={C.textSecondary} />
          <TextInput
            placeholder="Descriere"
            placeholderTextColor={C.textSecondary}
            value={value.search ?? ''}
            onChangeText={s => onChange({ ...value, search: s.length > 0 ? s : undefined })}
            style={[styles.searchInput, { color: C.text }]}
          />
        </View>
        <Chip
          icon="cash-outline"
          label={`Sumă: ${formatAmountLabel(value.absAmountRange)}`}
          active={Boolean(value.absAmountRange)}
          onPress={() => setSheet('amount')}
          onClear={
            value.absAmountRange
              ? () => onChange({ ...value, absAmountRange: undefined })
              : undefined
          }
          style={chipStyle(Boolean(value.absAmountRange))}
          textStyle={chipText(Boolean(value.absAmountRange))}
        />
        {isAnyFilterActive(value) && (
          <Pressable onPress={clearAll} style={[styles.clearBtn, { borderColor: C.border }]}>
            <Text style={{ color: C.textSecondary }}>Curăță</Text>
          </Pressable>
        )}
      </ScrollView>

      {sheet === 'account' && (
        <AccountSheet
          accounts={accounts}
          selectedId={value.account_id}
          onSelect={id => {
            onChange({ ...value, account_id: id });
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'category' && (
        <CategorySheet
          categories={categories}
          selectedId={value.category_id}
          uncategorized={Boolean(value.uncategorized)}
          onSelect={selection => {
            if (selection.kind === 'all') {
              onChange({ ...value, category_id: undefined, uncategorized: undefined });
            } else if (selection.kind === 'uncategorized') {
              onChange({ ...value, category_id: undefined, uncategorized: true });
            } else {
              onChange({ ...value, category_id: selection.id, uncategorized: undefined });
            }
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'period' && (
        <PeriodSheet
          value={value}
          onApply={range => {
            onChange({ ...value, ...range });
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'amount' && (
        <AmountSheet
          value={value.absAmountRange}
          onApply={r => {
            onChange({ ...value, absAmountRange: r });
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </View>
  );
}

function Chip(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
  onClear?: () => void;
  style: { backgroundColor: string; borderColor: string };
  textStyle: { color: string };
}) {
  return (
    <Pressable onPress={props.onPress} style={[styles.chip, props.style]}>
      <Ionicons name={props.icon} size={14} color={props.textStyle.color} />
      <Text style={[styles.chipLabel, props.textStyle]} numberOfLines={1}>
        {props.label}
      </Text>
      {props.onClear && (
        <Pressable hitSlop={8} onPress={props.onClear}>
          <Ionicons name="close" size={14} color={props.textStyle.color} />
        </Pressable>
      )}
    </Pressable>
  );
}

function AccountSheet({
  accounts,
  selectedId,
  onSelect,
  onClose,
}: {
  accounts: FinancialAccount[];
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  onClose: () => void;
}) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: C.card }]}>
        <Text style={[styles.sheetTitle, { color: C.text }]}>Cont</Text>
        <Pressable
          onPress={() => onSelect(undefined)}
          style={[styles.sheetRow, { borderBottomColor: C.border }]}
        >
          <Text style={{ color: C.text }}>Toate conturile</Text>
          {!selectedId && <Ionicons name="checkmark" size={18} color={C.tint} />}
        </Pressable>
        {accounts.map(a => (
          <Pressable
            key={a.id}
            onPress={() => onSelect(a.id)}
            style={[styles.sheetRow, { borderBottomColor: C.border }]}
          >
            <Text style={{ color: C.text }}>{a.name}</Text>
            {selectedId === a.id && <Ionicons name="checkmark" size={18} color={C.tint} />}
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

type CategorySelection = { kind: 'all' } | { kind: 'uncategorized' } | { kind: 'id'; id: string };

function CategorySheet({
  categories,
  selectedId,
  uncategorized,
  onSelect,
  onClose,
}: {
  categories: ExpenseCategory[];
  selectedId?: string;
  uncategorized: boolean;
  onSelect: (selection: CategorySelection) => void;
  onClose: () => void;
}) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: C.card }]}>
        <Text style={[styles.sheetTitle, { color: C.text }]}>Categorie</Text>
        <ScrollView style={styles.categoryList}>
          <Pressable
            onPress={() => onSelect({ kind: 'all' })}
            style={[styles.sheetRow, { borderBottomColor: C.border }]}
          >
            <Text style={{ color: C.text }}>Toate categoriile</Text>
            {!selectedId && !uncategorized && (
              <Ionicons name="checkmark" size={18} color={C.tint} />
            )}
          </Pressable>
          <Pressable
            onPress={() => onSelect({ kind: 'uncategorized' })}
            style={[styles.sheetRow, { borderBottomColor: C.border }]}
          >
            <Text style={{ color: C.text }}>Necategorizat</Text>
            {uncategorized && <Ionicons name="checkmark" size={18} color={C.tint} />}
          </Pressable>
          {categories.map(c => (
            <Pressable
              key={c.id}
              onPress={() => onSelect({ kind: 'id', id: c.id })}
              style={[styles.sheetRow, { borderBottomColor: C.border }]}
            >
              <View style={styles.categoryRowLabel}>
                {c.color && <View style={[styles.categoryDot, { backgroundColor: c.color }]} />}
                <Text style={{ color: C.text }}>{c.name}</Text>
              </View>
              {selectedId === c.id && <Ionicons name="checkmark" size={18} color={C.tint} />}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function PeriodSheet({
  value,
  onApply,
  onClose,
}: {
  value: TransactionFilter;
  onApply: (range: { fromDate?: string; toDate?: string }) => void;
  onClose: () => void;
}) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [customFrom, setCustomFrom] = useState(value.fromDate ?? '');
  const [customTo, setCustomTo] = useState(value.toDate ?? '');
  const [error, setError] = useState<string | null>(null);

  function applyCustom() {
    const from = customFrom.trim();
    const to = customTo.trim();
    if (from && !isValidYmd(from)) {
      setError('„De la" trebuie să fie YYYY-MM-DD valid.');
      return;
    }
    if (to && !isValidYmd(to)) {
      setError('„Până la" trebuie să fie YYYY-MM-DD valid.');
      return;
    }
    if (from && to && from > to) {
      setError('„De la" trebuie să fie ≤ „Până la".');
      return;
    }
    setError(null);
    onApply({ fromDate: from || undefined, toDate: to || undefined });
  }

  const presets: { label: string; preset: PeriodPreset }[] = [
    { label: 'Toate', preset: { kind: 'all' } },
    { label: 'Luna asta', preset: { kind: 'thisMonth' } },
    { label: 'Luna trecută', preset: { kind: 'lastMonth' } },
    { label: 'Ultimele 3 luni', preset: { kind: 'last3Months' } },
    { label: 'An curent', preset: { kind: 'thisYear' } },
  ];

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: C.card }]}>
        <Text style={[styles.sheetTitle, { color: C.text }]}>Perioadă</Text>
        {presets.map(p => (
          <Pressable
            key={p.label}
            onPress={() => onApply(presetToRange(p.preset))}
            style={[styles.sheetRow, { borderBottomColor: C.border }]}
          >
            <Text style={{ color: C.text }}>{p.label}</Text>
          </Pressable>
        ))}
        <Text style={[styles.sheetSubTitle, { color: C.textSecondary }]}>
          Interval custom (YYYY-MM-DD)
        </Text>
        <View style={styles.amountInputs}>
          <TextInput
            placeholder="De la (YYYY-MM-DD)"
            placeholderTextColor={C.textSecondary}
            value={customFrom}
            onChangeText={t => setCustomFrom(formatDateInput(t))}
            keyboardType="number-pad"
            maxLength={10}
            style={[styles.amountInput, { color: C.text, borderColor: C.border }]}
          />
          <TextInput
            placeholder="Până la (YYYY-MM-DD)"
            placeholderTextColor={C.textSecondary}
            value={customTo}
            onChangeText={t => setCustomTo(formatDateInput(t))}
            keyboardType="number-pad"
            maxLength={10}
            style={[styles.amountInput, { color: C.text, borderColor: C.border }]}
          />
        </View>
        {error && <Text style={{ color: statusColors.critical }}>{error}</Text>}
        <Pressable onPress={applyCustom} style={[styles.applyBtn, { backgroundColor: C.tint }]}>
          <Text style={{ color: C.background, fontWeight: '600' }}>Aplică interval</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function AmountSheet({
  value,
  onApply,
  onClose,
}: {
  value: TransactionFilter['absAmountRange'];
  onApply: (range: TransactionFilter['absAmountRange']) => void;
  onClose: () => void;
}) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [minStr, setMinStr] = useState(value?.min !== undefined ? String(value.min) : '');
  const [maxStr, setMaxStr] = useState(value?.max !== undefined ? String(value.max) : '');
  const [error, setError] = useState<string | null>(null);

  function apply() {
    const min = minStr.trim() === '' ? undefined : Number(minStr);
    const max = maxStr.trim() === '' ? undefined : Number(maxStr);
    if (min !== undefined && Number.isNaN(min)) {
      setError('Min nu e număr valid.');
      return;
    }
    if (max !== undefined && Number.isNaN(max)) {
      setError('Max nu e număr valid.');
      return;
    }
    if (min !== undefined && max !== undefined && min > max) {
      setError('Min trebuie să fie ≤ Max.');
      return;
    }
    setError(null);
    if (min === undefined && max === undefined) {
      onApply(undefined);
      return;
    }
    onApply({ min, max });
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: C.card }]}>
        <Text style={[styles.sheetTitle, { color: C.text }]}>Sumă (valori absolute)</Text>
        <View style={styles.amountInputs}>
          <TextInput
            placeholder="Min"
            placeholderTextColor={C.textSecondary}
            keyboardType="numeric"
            value={minStr}
            onChangeText={setMinStr}
            style={[styles.amountInput, { color: C.text, borderColor: C.border }]}
          />
          <TextInput
            placeholder="Max"
            placeholderTextColor={C.textSecondary}
            keyboardType="numeric"
            value={maxStr}
            onChangeText={setMaxStr}
            style={[styles.amountInput, { color: C.text, borderColor: C.border }]}
          />
        </View>
        {error && <Text style={{ color: statusColors.critical }}>{error}</Text>}
        <Pressable onPress={apply} style={[styles.applyBtn, { backgroundColor: C.tint }]}>
          <Text style={{ color: C.background, fontWeight: '600' }}>Aplică</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: { gap: 6, alignItems: 'center', paddingRight: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipLabel: { fontSize: 13, maxWidth: 160 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    minWidth: 140,
  },
  searchInput: { flex: 1, paddingVertical: 4, fontSize: 13 },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 8,
  },
  sheetTitle: { fontSize: 16, fontWeight: '600' },
  sheetSubTitle: { fontSize: 12, marginTop: 8 },
  sheetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  categoryList: { maxHeight: 360 },
  categoryRowLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  categoryDot: { width: 10, height: 10, borderRadius: 5 },
  amountInputs: { flexDirection: 'row', gap: 8 },
  amountInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  applyBtn: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
});
