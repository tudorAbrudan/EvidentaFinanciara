import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import PrivacyPolicyView from '@/components/PrivacyPolicyView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { POLICY_LAST_UPDATED, PRIVACY_POLICY_FULL } from '@/services/privacyPolicy';

export default function ConfidentialitateScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: C.background }]}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: 'Confidențialitate' }} />

      <View style={styles.intro}>
        <Text style={[styles.lede, { color: C.text }]}>
          Politica de confidențialitate a aplicației Finanțe Personale.
        </Text>
        <Text style={[styles.subtle, { color: C.textSecondary }]}>
          Versiunea curentă: {POLICY_LAST_UPDATED}
        </Text>
      </View>

      <PrivacyPolicyView sections={PRIVACY_POLICY_FULL} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  intro: { marginBottom: 18 },
  lede: { fontSize: 15, lineHeight: 22, marginBottom: 4 },
  subtle: { fontSize: 13 },
});
