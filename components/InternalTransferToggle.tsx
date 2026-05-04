import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { FinancialAccount } from '@/types';

export type DetectedTransferType = 'cash' | 'savings_out' | 'savings_in' | null;

interface Props {
  amount: number;
  description: string;
  merchant: string;
  currency: string;
  accounts: FinancialAccount[];
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  targetAccountId: string | null;
  onTargetChange: (id: string | null) => void;
  autoDetect: boolean;
  readOnly?: boolean;
}

const CASH_RE = /\b(retragere|extragere|atm|bancomat|cash\s*withdrawal|numerar)\b/i;
const SAVINGS_OUT_RE =
  /\b(transfer\s+(la|spre|catre)\s+(economii|depozit)|alimentare\s+(cont\s+)?economii|constituire\s+depozit|economisire)\b/i;
const SAVINGS_IN_RE =
  /\b(transfer\s+(din|de\s+la)\s+(economii|depozit)|retragere\s+(din\s+)?economii|lichidare\s+depozit)\b/i;

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function detect(amount: number, description: string, merchant: string): DetectedTransferType {
  const haystack = normalize(`${description} ${merchant}`);
  if (amount < 0) {
    if (CASH_RE.test(haystack)) return 'cash';
    if (SAVINGS_OUT_RE.test(haystack)) return 'savings_out';
    return null;
  }
  if (amount > 0) {
    if (SAVINGS_IN_RE.test(haystack)) return 'savings_in';
    return null;
  }
  return null;
}

function effectiveType(detected: DetectedTransferType, amount: number): DetectedTransferType {
  if (detected) return detected;
  if (amount < 0) return 'cash';
  return null;
}

const TYPE_LABEL: Record<NonNullable<DetectedTransferType>, string> = {
  cash: 'Este retragere de cash din contul bancar',
  savings_out: 'Este transfer către cont de economii',
  savings_in: 'Este retragere din cont de economii',
};

function targetAccountTypeFor(t: NonNullable<DetectedTransferType>): FinancialAccount['type'] {
  return t === 'cash' ? 'cash' : 'savings';
}

function createBtnLabel(t: NonNullable<DetectedTransferType>, currency: string): string {
  return t === 'cash'
    ? `+ Creează cont Cash în ${currency}`
    : `+ Creează cont Economii în ${currency}`;
}

export function InternalTransferToggle(props: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const detected = detect(props.amount, props.description, props.merchant);
  const effective = effectiveType(detected, props.amount);

  const prevMatchRef = useRef<DetectedTransferType>(null);
  useEffect(() => {
    if (!props.autoDetect || props.readOnly) return;
    const prev = prevMatchRef.current;
    prevMatchRef.current = detected;
    if (!prev && detected) {
      props.onEnabledChange(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.amount, props.description, props.merchant, props.autoDetect]);

  if (!effective) return null;

  const targetType = targetAccountTypeFor(effective);
  const matchingAccounts = props.accounts.filter(
    a => a.type === targetType && !a.archived && a.currency === props.currency
  );

  return (
    <View style={styles.box}>
      <Pressable
        disabled={props.readOnly}
        onPress={() => props.onEnabledChange(!props.enabled)}
        style={styles.toggleRow}
      >
        <Ionicons
          name={props.enabled ? 'checkbox' : 'square-outline'}
          size={22}
          color={props.enabled ? C.primary : C.textSecondary}
        />
        <Text style={[styles.label, { color: C.text }]}>{TYPE_LABEL[effective]}</Text>
      </Pressable>

      {props.enabled && !props.readOnly && (
        <View style={{ marginTop: 8 }}>
          <Text style={[styles.subLabel, { color: C.textSecondary }]}>Cont destinație:</Text>
          {matchingAccounts.length === 0 ? (
            <Pressable
              style={[styles.createBtn, { borderColor: C.primary }]}
              onPress={() =>
                router.push({
                  pathname: '/conturi/add' as '/',
                  params: { type: targetType, currency: props.currency },
                })
              }
            >
              <Text style={{ color: C.primary }}>{createBtnLabel(effective, props.currency)}</Text>
            </Pressable>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {matchingAccounts.map(a => (
                  <Pressable
                    key={a.id}
                    onPress={() => props.onTargetChange(a.id)}
                    style={[
                      styles.chip,
                      {
                        borderColor: props.targetAccountId === a.id ? C.primary : C.border,
                        backgroundColor: props.targetAccountId === a.id ? C.primary : 'transparent',
                      },
                    ]}
                  >
                    <Text style={{ color: props.targetAccountId === a.id ? '#fff' : C.text }}>
                      {a.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingHorizontal: 16, paddingVertical: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { fontSize: 14, flex: 1 },
  subLabel: { fontSize: 12, marginBottom: 6 },
  createBtn: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
});
