import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  Platform,
} from 'react-native';

import AppLockPinModal from '@/components/AppLockPinModal';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import {
  AI_CONSENT_KEY,
  DAILY_AI_LIMIT,
  PROVIDER_DEFAULTS,
  type AiProviderType,
  getAiConfig,
  saveAiConfig,
  saveAiApiKey,
  getAiUsageToday,
} from '@/services/aiProvider';
import { exportBackup, importBackup } from '@/services/backup';
import * as cloudSync from '@/services/cloudSync';
import { hasDemoData, deleteDemoData } from '@/services/demoData';
import {
  resetOnboarding,
  getAppLockEnabled,
  setAppLockEnabled,
  clearAppLockPin,
  getCloudSyncEnabled,
  setCloudSyncEnabled,
  getCloudSnapshotFrequency,
  setCloudSnapshotFrequency,
  getCloudSnapshotRetention,
} from '@/services/settings';
import { primary } from '@/theme/colors';
import { radius } from '@/theme/layout';
import { SNAPSHOT_FREQUENCY_LABELS, type SnapshotFrequency } from '@/types';

export default function Settings() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [demoExists, setDemoExists] = useState(false);
  const [deletingDemo, setDeletingDemo] = useState(false);

  // AI state
  const [aiLoading, setAiLoading] = useState(true);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiProvider, setAiProvider] = useState<AiProviderType>('builtin');
  const [aiUrl, setAiUrl] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiConsent, setAiConsent] = useState(false);
  const [aiUsageToday, setAiUsageToday] = useState(0);

  // App lock state
  const [lockLoading, setLockLoading] = useState(true);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);

  // Cloud sync state
  const [cloudLoading, setCloudLoading] = useState(true);
  const [cloudAvailable, setCloudAvailable] = useState(false);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudFreq, setCloudFreq] = useState<SnapshotFrequency>('weekly');
  const [cloudRetention, setCloudRetention] = useState(7);
  const [cloudLastUploaded, setCloudLastUploaded] = useState<number | null>(null);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudRestoring, setCloudRestoring] = useState(false);

  useEffect(() => {
    refreshDemoStatus();
    void loadAi();
    void loadLock();
    void loadCloud();
  }, []);

  function refreshDemoStatus() {
    hasDemoData()
      .then(setDemoExists)
      .catch(() => {});
  }

  async function loadAi() {
    try {
      const [config, usage, consentRaw] = await Promise.all([
        getAiConfig(),
        getAiUsageToday(),
        AsyncStorage.getItem(AI_CONSENT_KEY),
      ]);
      setAiProvider(config.type);
      setAiUrl(config.url);
      setAiApiKey(config.apiKey);
      setAiModel(config.model);
      setAiUsageToday(usage);
      setAiConsent(consentRaw === 'true');
    } finally {
      setAiLoading(false);
    }
  }

  async function loadLock() {
    try {
      const enabled = await getAppLockEnabled();
      setLockEnabled(enabled);
    } finally {
      setLockLoading(false);
    }
  }

  async function loadCloud() {
    try {
      const [available, enabled, freq, retention, state] = await Promise.all([
        cloudSync.isAvailable(),
        getCloudSyncEnabled(),
        getCloudSnapshotFrequency(),
        getCloudSnapshotRetention(),
        cloudSync.getCloudState(),
      ]);
      setCloudAvailable(available);
      setCloudEnabled(enabled);
      setCloudFreq(freq);
      setCloudRetention(retention);
      setCloudLastUploaded(state.lastUploadedAt);
    } finally {
      setCloudLoading(false);
    }
  }

  async function handleToggleCloud(value: boolean) {
    if (cloudLoading) return;
    if (value && !cloudAvailable) {
      Alert.alert(
        'iCloud indisponibil',
        'Verifică în Setări iOS dacă ești autentificat în iCloud și aplicația are acces.'
      );
      return;
    }
    setCloudEnabled(value);
    await setCloudSyncEnabled(value);
    if (value) {
      void handleSyncNow();
    }
  }

  async function handleChangeFrequency(freq: SnapshotFrequency) {
    setCloudFreq(freq);
    await setCloudSnapshotFrequency(freq);
  }

  async function handleSyncNow() {
    if (cloudSyncing) return;
    setCloudSyncing(true);
    try {
      const uploaded = await cloudSync.uploadManifestIfChanged();
      const snap = await cloudSync.maybeSnapshot(cloudFreq, cloudRetention);
      const state = await cloudSync.getCloudState();
      setCloudLastUploaded(state.lastUploadedAt);
      const msg = uploaded
        ? snap
          ? 'Backup și snapshot trimise în iCloud.'
          : 'Backup trimis în iCloud.'
        : 'Datele sunt deja sincronizate.';
      Alert.alert('Sync', msg);
    } catch (e) {
      Alert.alert('Eroare sync', e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      setCloudSyncing(false);
    }
  }

  function handleRestoreFromCloud() {
    Alert.alert(
      'Restaurare din iCloud',
      'Datele locale curente vor fi ÎNLOCUITE complet cu cele din iCloud. Acțiunea e ireversibilă.',
      [
        { text: 'Anulare', style: 'cancel' },
        {
          text: 'Restaurează',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (cloudRestoring) return;
              setCloudRestoring(true);
              try {
                const res = await cloudSync.restoreFromCloud();
                Alert.alert('Restaurat', `${res.recordCount} înregistrări restaurate din iCloud.`);
                refreshDemoStatus();
              } catch (e) {
                Alert.alert('Eroare', e instanceof Error ? e.message : 'Eroare necunoscută');
              } finally {
                setCloudRestoring(false);
              }
            })();
          },
        },
      ]
    );
  }

  function formatLastUploaded(ts: number | null): string {
    if (!ts) return 'niciodată';
    const d = new Date(ts);
    return d.toLocaleString('ro-RO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
          onPress: () => {
            void (async () => {
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
            })();
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
          onPress: () => {
            void (async () => {
              try {
                await resetOnboarding();
                Alert.alert('Gata', 'Repornește aplicația ca să vezi onboarding-ul.');
              } catch (e) {
                Alert.alert('Eroare', e instanceof Error ? e.message : 'Eroare necunoscută');
              }
            })();
          },
        },
      ]
    );
  }

  function aiCanSave(): boolean {
    if (aiSaving) return false;
    if (aiProvider === 'none') return true;
    if (!aiConsent) return false;
    if (aiProvider === 'external') {
      return aiUrl.trim().length > 0 && aiApiKey.trim().length > 0 && aiModel.trim().length > 0;
    }
    return true;
  }

  async function handleSaveAi() {
    if (!aiCanSave()) return;
    setAiSaving(true);
    try {
      const defaults = PROVIDER_DEFAULTS[aiProvider];
      if (aiProvider === 'external') {
        await saveAiConfig({ type: 'external', url: aiUrl.trim(), model: aiModel.trim() });
        await saveAiApiKey(aiApiKey.trim());
      } else {
        await saveAiConfig({ type: aiProvider, url: defaults.url, model: defaults.model });
        if (aiProvider === 'none') {
          await saveAiApiKey('');
        }
      }
      if (aiProvider !== 'none' && aiConsent) {
        await AsyncStorage.setItem(AI_CONSENT_KEY, 'true');
      }
      Alert.alert('Salvat', 'Configurația AI a fost actualizată.');
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      setAiSaving(false);
    }
  }

  function handleToggleLock(value: boolean) {
    if (lockLoading) return;
    if (value) {
      setPinModalVisible(true);
    } else {
      Alert.alert(
        'Dezactivează blocarea',
        'Aplicația nu va mai cere PIN sau biometric la pornire. PIN-ul curent va fi șters.',
        [
          { text: 'Anulare', style: 'cancel' },
          {
            text: 'Dezactivează',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await setAppLockEnabled(false);
                  await clearAppLockPin();
                  setLockEnabled(false);
                } catch (e) {
                  Alert.alert('Eroare', e instanceof Error ? e.message : 'Eroare necunoscută');
                }
              })();
            },
          },
        ]
      );
    }
  }

  function handlePinSaved() {
    setLockEnabled(true);
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: C.background }]}
      contentContainerStyle={styles.scrollContent}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Setări',
          headerStyle: { backgroundColor: C.background },
          headerTitleStyle: { color: C.text },
          headerTintColor: C.text,
          headerBackTitle: 'Înapoi',
        }}
      />

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: C.text }]}>Backup & restaurare</Text>
        <Text style={[styles.body, { color: C.textSecondary }]}>
          Backup-ul include conturi, categorii, tranzacții, extrase bancare și cursuri valutare.
        </Text>

        <Pressable
          onPress={() => {
            void handleExport();
          }}
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
          onPress={() => {
            void handleImport();
          }}
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

      {Platform.OS === 'ios' ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Backup în iCloud</Text>
          <Text style={[styles.body, { color: C.textSecondary }]}>
            Sincronizare automată în iCloud Drive. Datele se urcă la pornirea sau închiderea
            aplicației.
          </Text>

          {cloudLoading ? (
            <ActivityIndicator color={primary} />
          ) : (
            <>
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleLabel, { color: C.text }]}>
                  {cloudEnabled ? 'Activ' : 'Dezactivat'}
                </Text>
                <Switch
                  value={cloudEnabled}
                  onValueChange={handleToggleCloud}
                  trackColor={{ false: C.border, true: primary }}
                  thumbColor="#fff"
                />
              </View>

              {!cloudAvailable ? (
                <Text style={[styles.hintSmall, { color: '#D84C4C' }]}>
                  iCloud nu este disponibil pe acest dispozitiv.
                </Text>
              ) : null}

              {cloudEnabled && cloudAvailable ? (
                <>
                  <Text style={[styles.fieldLabel, { color: C.text }]}>Frecvență snapshot</Text>
                  <View style={styles.chipRow}>
                    {(
                      ['off', 'daily', 'every3days', 'weekly', 'monthly'] as SnapshotFrequency[]
                    ).map(f => {
                      const selected = cloudFreq === f;
                      return (
                        <Pressable
                          key={f}
                          onPress={() => void handleChangeFrequency(f)}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: selected ? primary : 'transparent',
                              borderColor: selected ? primary : C.border,
                            },
                          ]}
                        >
                          <Text style={[styles.chipText, { color: selected ? '#fff' : C.text }]}>
                            {SNAPSHOT_FREQUENCY_LABELS[f]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={[styles.hintSmall, { color: C.textSecondary }]}>
                    Ultimul backup: {formatLastUploaded(cloudLastUploaded)}
                  </Text>

                  <Pressable
                    onPress={() => {
                      void handleSyncNow();
                    }}
                    disabled={cloudSyncing}
                    style={({ pressed }) => [
                      styles.button,
                      {
                        backgroundColor: C.tint,
                        opacity: cloudSyncing ? 0.6 : pressed ? 0.85 : 1,
                        marginTop: 12,
                      },
                    ]}
                  >
                    {cloudSyncing ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.buttonText}>Sincronizează acum</Text>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={handleRestoreFromCloud}
                    disabled={cloudRestoring}
                    style={({ pressed }) => [
                      styles.button,
                      styles.buttonSecondary,
                      {
                        borderColor: C.tint,
                        opacity: cloudRestoring ? 0.6 : pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    {cloudRestoring ? (
                      <ActivityIndicator color={C.tint} />
                    ) : (
                      <Text style={[styles.buttonText, { color: C.tint }]}>
                        Restaurează din iCloud
                      </Text>
                    )}
                  </Pressable>
                </>
              ) : null}
            </>
          )}
        </View>
      ) : null}

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
        <Text style={[styles.sectionTitle, { color: C.text }]}>Asistent AI</Text>
        <Text style={[styles.body, { color: C.textSecondary }]}>
          Alege provider-ul AI sau dezactivează asistentul.
        </Text>

        {aiLoading ? (
          <ActivityIndicator color={primary} />
        ) : (
          <>
            <View style={styles.chipRow}>
              {(['builtin', 'external', 'none'] as AiProviderType[]).map(p => {
                const selected = aiProvider === p;
                const label =
                  p === 'builtin' ? 'Finanțe AI' : p === 'external' ? 'Cheie proprie' : 'Fără AI';
                return (
                  <Pressable
                    key={p}
                    onPress={() => setAiProvider(p)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: selected ? primary : 'transparent',
                        borderColor: selected ? primary : C.border,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: selected ? '#fff' : C.text }]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {aiProvider === 'builtin' ? (
              <Text style={[styles.hintSmall, { color: C.textSecondary }]}>
                {aiUsageToday} / {DAILY_AI_LIMIT} cereri folosite azi.
              </Text>
            ) : null}

            {aiProvider === 'external' ? (
              <View>
                <Text style={[styles.fieldLabel, { color: C.text }]}>URL API</Text>
                <TextInput
                  value={aiUrl}
                  onChangeText={setAiUrl}
                  placeholder="https://api.openai.com/v1"
                  placeholderTextColor={C.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.input,
                    { color: C.text, borderColor: C.border, backgroundColor: C.card },
                  ]}
                />
                <Text style={[styles.fieldLabel, { color: C.text }]}>Cheie API</Text>
                <TextInput
                  value={aiApiKey}
                  onChangeText={setAiApiKey}
                  placeholder="sk-..."
                  placeholderTextColor={C.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  style={[
                    styles.input,
                    { color: C.text, borderColor: C.border, backgroundColor: C.card },
                  ]}
                />
                <Text style={[styles.fieldLabel, { color: C.text }]}>Model</Text>
                <TextInput
                  value={aiModel}
                  onChangeText={setAiModel}
                  placeholder="gpt-4o-mini"
                  placeholderTextColor={C.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.input,
                    { color: C.text, borderColor: C.border, backgroundColor: C.card },
                  ]}
                />
              </View>
            ) : null}

            {aiProvider !== 'none' ? (
              <Pressable style={styles.consentRow} onPress={() => setAiConsent(!aiConsent)}>
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: aiConsent ? primary : C.border,
                      backgroundColor: aiConsent ? primary : 'transparent',
                    },
                  ]}
                >
                  {aiConsent ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                </View>
                <Text style={[styles.consentText, { color: C.text }]}>
                  Sunt de acord ca textul tranzacțiilor trimis la AI să fie procesat de provider.
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => {
                void handleSaveAi();
              }}
              disabled={!aiCanSave()}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: C.tint,
                  opacity: !aiCanSave() ? 0.5 : pressed ? 0.85 : 1,
                  marginTop: 12,
                },
              ]}
            >
              {aiSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Salvează AI</Text>
              )}
            </Pressable>
          </>
        )}
      </View>

      {Platform.OS !== 'web' ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Blocare app</Text>
          <Text style={[styles.body, { color: C.textSecondary }]}>
            Cere PIN sau Face ID / Touch ID la pornirea aplicației.
          </Text>

          {lockLoading ? (
            <ActivityIndicator color={primary} />
          ) : (
            <>
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleLabel, { color: C.text }]}>
                  {lockEnabled ? 'Activă' : 'Dezactivată'}
                </Text>
                <Switch
                  value={lockEnabled}
                  onValueChange={handleToggleLock}
                  trackColor={{ false: C.border, true: primary }}
                  thumbColor="#fff"
                />
              </View>

              {lockEnabled ? (
                <Pressable
                  onPress={() => setPinModalVisible(true)}
                  style={({ pressed }) => [
                    styles.button,
                    styles.buttonSecondary,
                    { borderColor: C.tint, opacity: pressed ? 0.85 : 1, marginTop: 12 },
                  ]}
                >
                  <Text style={[styles.buttonText, { color: C.tint }]}>Schimbă PIN</Text>
                </Pressable>
              ) : null}
            </>
          )}
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

      <AppLockPinModal
        visible={pinModalVisible}
        onDismiss={() => setPinModalVisible(false)}
        onPinSaved={handlePinSaved}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  hintSmall: { fontSize: 13, marginTop: -4, marginBottom: 8 },
  fieldLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  consentText: { flex: 1, fontSize: 13, lineHeight: 18 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  toggleLabel: { fontSize: 15, fontWeight: '500' },
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
