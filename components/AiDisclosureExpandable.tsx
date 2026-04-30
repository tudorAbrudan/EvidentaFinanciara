import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import PrivacyPolicyView from '@/components/PrivacyPolicyView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { AI_DISCLOSURE, AI_PROVIDER_TERMS_URL } from '@/services/privacyPolicy';
import { radius } from '@/theme/layout';

/**
 * Block expandabil cu detalii despre ce date sunt trimise către Mistral AI.
 * Apare lângă checkbox-ul de consimțământ în onboarding și setări.
 */
export default function AiDisclosureExpandable() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.container, { backgroundColor: C.surface, borderColor: C.border }]}>
      <Pressable
        onPress={() => setOpen(o => !o)}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Ascunde detaliile AI' : 'Arată ce date trimit la AI'}
      >
        <Ionicons
          name="information-circle-outline"
          size={18}
          color={C.tint}
          style={styles.headerIcon}
        />
        <Text style={[styles.headerText, { color: C.text }]}>
          Ce date trimit la Mistral AI și cum revoc?
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.textSecondary} />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          <PrivacyPolicyView sections={AI_DISCLOSURE} />
          <Pressable
            onPress={() => {
              void Linking.openURL(AI_PROVIDER_TERMS_URL);
            }}
            style={styles.linkRow}
          >
            <Ionicons name="open-outline" size={16} color={C.tint} />
            <Text style={[styles.linkText, { color: C.tint }]}>Termenii Mistral AI</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              router.push('/confidentialitate');
            }}
            style={styles.linkRow}
          >
            <Ionicons name="document-text-outline" size={16} color={C.tint} />
            <Text style={[styles.linkText, { color: C.tint }]}>
              Politica de confidențialitate completă
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: radius.md,
    marginTop: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  headerIcon: { marginRight: 2 },
  headerText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  body: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 4 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  linkText: { fontSize: 14, fontWeight: '600' },
});
