import { StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { DisclosureSection } from '@/services/privacyPolicy';

interface Props {
  sections: DisclosureSection[];
}

export default function PrivacyPolicyView({ sections }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  return (
    <View>
      {sections.map(section => (
        <View key={section.heading} style={styles.section}>
          <Text style={[styles.heading, { color: C.text }]}>{section.heading}</Text>
          {section.paragraphs.map((p, i) => (
            <Text key={i} style={[styles.paragraph, { color: C.text }]}>
              {p}
            </Text>
          ))}
          {section.bullets ? (
            <View style={styles.bullets}>
              {section.bullets.map((b, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Text style={[styles.bulletDot, { color: C.textSecondary }]}>•</Text>
                  <Text style={[styles.bulletText, { color: C.text }]}>{b}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 22 },
  heading: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  paragraph: { fontSize: 14, lineHeight: 21, marginBottom: 8 },
  bullets: { marginTop: 4, gap: 6 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingRight: 4 },
  bulletDot: { fontSize: 14, lineHeight: 21 },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 21 },
});
