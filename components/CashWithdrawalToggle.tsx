import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { FinancialAccount } from '@/types';

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

const CASH_WITHDRAWAL_REGEX = /\b(retragere|extragere|atm|bancomat|cash\s*withdrawal|numerar)\b/i;
function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export function CashWithdrawalToggle(props: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const cashAccounts = props.accounts.filter(
    a => a.type === 'cash' && !a.archived && a.currency === props.currency
  );

  const prevMatchRef = useRef(false);
  useEffect(() => {
    if (!props.autoDetect || props.readOnly) return;
    if (props.amount >= 0) {
      prevMatchRef.current = false;
      return;
    }
    const haystack = normalize(`${props.description} ${props.merchant}`);
    const matches = CASH_WITHDRAWAL_REGEX.test(haystack);
    const prev = prevMatchRef.current;
    prevMatchRef.current = matches;
    if (!prev && matches) {
      props.onEnabledChange(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.amount, props.description, props.merchant, props.autoDetect]);

  if (props.amount >= 0) return null;

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
        <Text style={[styles.label, { color: C.text }]}>
          Este retragere de cash din contul bancar
        </Text>
      </Pressable>

      {props.enabled && !props.readOnly && (
        <View style={{ marginTop: 8 }}>
          <Text style={[styles.subLabel, { color: C.textSecondary }]}>Cont destinație:</Text>
          {cashAccounts.length === 0 ? (
            <Pressable
              style={[styles.createBtn, { borderColor: C.primary }]}
              onPress={() =>
                router.push({
                  pathname: '/conturi/add' as '/',
                  params: { type: 'cash', currency: props.currency },
                })
              }
            >
              <Text style={{ color: C.primary }}>+ Creează cont Cash în {props.currency}</Text>
            </Pressable>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {cashAccounts.map(a => (
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
