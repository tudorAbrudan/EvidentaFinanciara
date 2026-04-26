import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { exportBackup, importBackup } from '@/services/backup';
import { hasDemoData, deleteDemoData } from '@/services/demoData';
import { resetOnboarding } from '@/services/settings';

export default function Settings() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [demoExists, setDemoExists] = useState(false);
  const [deletingDemo, setDeletingDemo] = useState(false);

  useEffect(() => {
    refreshDemoStatus();
  }, []);

  function refreshDemoStatus() {
    hasDemoData()
      .then(setDemoExists)
      .catch(() => {});
  }

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      await exportBackup();
    } catch (e) {
      Alert.alert('Eroare export', e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      setExporting(false);
    }
  }

  async function handleImport() {
    if (importing) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      setImporting(true);
      const summary = await importBackup(res.assets[0].uri);
      const lines = [`Importate: ${summary.imported}`, `Sărite (deja existau): ${summary.skipped}`];
      if (summary.errors.length > 0) {
        lines.push('', 'Erori:');
        lines.push(...summary.errors.slice(0, 5));
        if (summary.errors.length > 5) {
          lines.push(`… și încă ${summary.errors.length - 5}`);
        }
      }
      Alert.alert('Import finalizat', lines.join('\n'));
      refreshDemoStatus();
    } catch (e) {
      Alert.alert('Eroare import', e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      setImporting(false);
    }
  }

  function handleDeleteDemo() {
    Alert.alert(
      'Șterge datele demo',
      'Ștergi contul demo și toate tranzacțiile fictive asociate. Acțiunea e ireversibilă.',
      [
        { text: 'Anulare', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: async () => {
            if (deletingDemo) return;
            setDeletingDemo(true);
            try {
              await deleteDemoData();
              setDemoExists(false);
            } catch (e) {
              Alert.alert('Eroare', e instanceof Error ? e.message : 'Eroare necunoscută');
            } finally {
              setDeletingDemo(false);
            }
          },
        },
      ]
    );
  }

  function handleResetOnboarding() {
    Alert.alert(
      'Reia onboarding',
      'La următoarea pornire a aplicației vei vedea din nou wizard-ul de configurare. Datele existente rămân neschimbate.',
      [
        { text: 'Anulare', style: 'cancel' },
        {
          text: 'Confirmă',
          onPress: async () => {
            try {
              await resetOnboarding();
              Alert.alert('Gata', 'Repornește aplicația ca să vezi onboarding-ul.');
            } catch (e) {
              Alert.alert('Eroare', e instanceof Error ? e.message : 'Eroare necunoscută');
            }
          },
        },
      ]
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: C.background }]}
      contentContainerStyle={styles.scrollContent}
    >
      <Text style={[styles.heading, { color: C.text }]}>Setări</Text>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: C.text }]}>Backup & restaurare</Text>
        <Text style={[styles.body, { color: C.textSecondary }]}>
          Backup-ul include conturi, categorii, tranzacții, extrase bancare și cursuri valutare.
        </Text>

        <Pressable
          onPress={handleExport}
          disabled={exporting || importing}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: C.tint,
              opacity: exporting || importing ? 0.6 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {exporting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Exportă backup</Text>
          )}
        </Pressable>

        <Pressable
          onPress={handleImport}
          disabled={exporting || importing}
          style={({ pressed }) => [
            styles.button,
            styles.buttonSecondary,
            {
              borderColor: C.tint,
              opacity: exporting || importing ? 0.6 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {importing ? (
            <ActivityIndicator color={C.tint} />
          ) : (
            <Text style={[styles.buttonText, { color: C.tint }]}>Importă backup</Text>
          )}
        </Pressable>
      </View>

      {demoExists ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Cont demo</Text>
          <Text style={[styles.body, { color: C.textSecondary }]}>
            Există un cont demo cu tranzacții fictive. Îl poți șterge — datele tale reale rămân
            neschimbate.
          </Text>
          <Pressable
            onPress={handleDeleteDemo}
            disabled={deletingDemo}
            style={({ pressed }) => [
              styles.button,
              styles.buttonDestructive,
              { opacity: deletingDemo ? 0.6 : pressed ? 0.85 : 1 },
            ]}
          >
            {deletingDemo ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Șterge datele demo</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: C.text }]}>Onboarding</Text>
        <Text style={[styles.body, { color: C.textSecondary }]}>
          Reia tutorialul de configurare la următoarea pornire a aplicației.
        </Text>
        <Pressable
          onPress={handleResetOnboarding}
          style={({ pressed }) => [
            styles.button,
            styles.buttonSecondary,
            { borderColor: C.tint, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: C.tint }]}>Reia onboarding</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: C.text }]}>În curând</Text>
        <Text style={[styles.body, { color: C.textSecondary }]}>
          Provider AI și blocarea aplicației vor fi configurabile aici (le-ai setat deja la
          onboarding).
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: '600', marginBottom: 16 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  button: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  buttonDestructive: {
    backgroundColor: '#D84C4C',
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
