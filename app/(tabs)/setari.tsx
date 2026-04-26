import { View, Text, StyleSheet } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function Settings() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <Text style={[styles.heading, { color: C.text }]}>Setări</Text>
      <Text style={[styles.body, { color: C.textSecondary }]}>
        Backup, AI provider și blocare aplicație vor fi disponibile aici.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  heading: { fontSize: 22, fontWeight: '600', marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 22 },
});
