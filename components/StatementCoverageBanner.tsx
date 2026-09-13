import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { loadCoverageReport, type AccountCoverage } from '@/services/statementCoverage';
import { statusColors } from '@/theme/colors';

/**
 * „N-ai încărcat extrasul pentru contul X".
 *
 * Userul nu introduce tranzacții manual: ce nu vine dintr-un extras nu există
 * în aplicație. O lună fără extras nu e o listă incompletă, ci una în care
 * cifrele afișate sunt false — de aceea semnalul stă pe Sumar, lângă cifrele
 * pe care le pune la îndoială.
 */
export function StatementCoverageBanner() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [pending, setPending] = useState<AccountCoverage[]>([]);
  const [hiddenForSession, setHiddenForSession] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadCoverageReport()
        .then(report => {
          if (active) setPending(report.accounts.filter(a => a.messages.length > 0));
        })
        .catch(() => {
          if (active) setPending([]);
        });
      return () => {
        active = false;
      };
    }, [])
  );

  const first = pending[0];
  if (first === undefined || hiddenForSession) return null;

  const message = first.messages[0] ?? '';
  const others = pending.length - 1;
  const suffix = others > 0 ? ` (+${others} ${others === 1 ? 'alt cont' : 'alte conturi'})` : '';

  return (
    <View style={[styles.card, { backgroundColor: C.card, borderColor: statusColors.warning }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${first.account_name}: ${message} Apasă pentru a deschide contul.`}
        style={styles.tappable}
        onPress={() =>
          router.push({
            pathname: '/conturi/[id]' as '/',
            params: { id: first.account_id },
          })
        }
      >
        <Ionicons name="document-attach-outline" size={20} color={statusColors.warning} />
        <Text style={[styles.text, { color: C.text }]} numberOfLines={3}>
          {first.account_name}: {message}
          {suffix}
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Ascunde avertismentul"
        hitSlop={12}
        onPress={() => setHiddenForSession(true)}
      >
        <Ionicons name="close" size={18} color={C.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  tappable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  text: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});
