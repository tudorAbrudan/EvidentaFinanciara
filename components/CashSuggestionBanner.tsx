import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { countPendingCashSuggestions } from '@/services/cashSuggestion';

export function CashSuggestionBanner() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [count, setCount] = useState(0);
  const [hiddenForSession, setHiddenForSession] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      countPendingCashSuggestions()
        .then(c => {
          if (active) setCount(c);
        })
        .catch(() => {
          if (active) setCount(0);
        });
      return () => {
        active = false;
      };
    }, [])
  );

  if (count === 0 || hiddenForSession) return null;

  return (
    <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <Pressable
        style={styles.tappable}
        onPress={() =>
          router.push({
            pathname: '/sugestie-cash/batch' as '/',
            params: { source: 'summary' },
          })
        }
      >
        <Ionicons name="cash-outline" size={20} color={C.primary} />
        <Text style={[styles.text, { color: C.text }]} numberOfLines={2}>
          Ai {count} {count === 1 ? 'retragere' : 'retrageri'} de cash{' '}
          {count === 1 ? 'neclasificată' : 'neclasificate'} în ultimul an. Tap să le clasifici.
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Ascunde sugestia"
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
