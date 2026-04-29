import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ChatMessage } from '@/components/ChatMessage';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { askAssistant } from '@/services/aiChat';
import { clearAll, listMessages } from '@/services/aiChatRepo';
import {
  AI_CONSENT_KEY,
  DAILY_AI_LIMIT,
  getAiConfig,
  getAiUsageToday,
  isAiLimitReached,
} from '@/services/aiProvider';
import type { ChatMessage as ChatMessageType } from '@/types';

const SUGGESTIONS = [
  'La ce bănci am cont?',
  'Top 5 merchants luna asta',
  'Cât am cheltuit pe Mâncare?',
  'Tranzacții la Lidl anul ăsta',
];

export default function AssistantScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [usage, setUsage] = useState<{ used: number; isBuiltin: boolean }>({
    used: 0,
    isBuiltin: false,
  });
  const [quotaReached, setQuotaReached] = useState(false);

  const reload = async () => {
    setMessages(await listMessages());
    const config = await getAiConfig();
    const consent = await AsyncStorage.getItem(AI_CONSENT_KEY);
    if (config.type === 'none' || consent !== 'true') {
      setAiAvailable({ ok: false, reason: 'consent_off' });
    } else {
      setAiAvailable({ ok: true });
    }
    if (config.type === 'builtin') {
      setUsage({ used: await getAiUsageToday(), isBuiltin: true });
      setQuotaReached(await isAiLimitReached());
    } else {
      setUsage({ used: 0, isBuiltin: false });
      setQuotaReached(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const onSend = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || loading || quotaReached) return;
    setInput('');
    setLoading(true);
    try {
      await askAssistant(q);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Necunoscută');
    } finally {
      setLoading(false);
      await reload();
    }
  };

  const onClear = () =>
    Alert.alert('Șterge conversația?', 'Toate mesajele vor fi șterse. Ireversibil.', [
      { text: 'Anulează', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await clearAll();
            await reload();
          })();
        },
      },
    ]);

  const renderHeaderRight = () => (
    <Pressable onPress={onClear} style={{ marginRight: 12 }} hitSlop={8}>
      <Ionicons name="trash-outline" size={20} color={C.text} />
    </Pressable>
  );

  if (aiAvailable && !aiAvailable.ok) {
    return (
      <View style={[styles.empty, { backgroundColor: C.background }]}>
        <Stack.Screen options={{ title: 'Asistent' }} />
        <Ionicons name="sparkles-outline" size={64} color={C.textSecondary} />
        <Text style={[styles.emptyText, { color: C.text }]}>Asistentul AI nu este activ.</Text>
        <Text style={[styles.emptySubtext, { color: C.textSecondary }]}>
          Activează-l din Setări → Asistent AI.
        </Text>
        <Pressable
          style={[styles.button, { backgroundColor: C.primary }]}
          onPress={() => router.push('/setari' as never)}
        >
          <Text style={styles.buttonText}>Mergi la Setări</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: C.background }]}
      keyboardVerticalOffset={88}
    >
      <Stack.Screen options={{ title: 'Asistent', headerRight: renderHeaderRight }} />
      {messages.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="sparkles" size={48} color={C.primary} />
          <Text style={[styles.emptyText, { color: C.text }]}>
            Întreabă orice despre finanțele tale.
          </Text>
          <Text style={[styles.emptySubtext, { color: C.textSecondary }]}>Exemple:</Text>
          <View style={styles.chipsWrap}>
            {SUGGESTIONS.map(s => (
              <Pressable
                key={s}
                onPress={() => void onSend(s)}
                style={[styles.chip, { borderColor: C.border }]}
              >
                <Text style={[styles.chipText, { color: C.text }]}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          data={[...messages].reverse()}
          inverted
          keyExtractor={m => m.id}
          renderItem={({ item }) => <ChatMessage message={item} />}
          contentContainerStyle={{ paddingVertical: 12 }}
        />
      )}

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={C.primary} />
          <Text style={{ color: C.textSecondary, marginLeft: 8 }}>Asistent gândește…</Text>
        </View>
      )}

      {usage.isBuiltin && (
        <Text
          style={[
            styles.quota,
            {
              color: quotaReached
                ? '#D84C4C'
                : usage.used >= DAILY_AI_LIMIT * 0.8
                  ? '#E8A53A'
                  : C.textSecondary,
            },
          ]}
        >
          {usage.used}/{DAILY_AI_LIMIT} azi
        </Text>
      )}

      {quotaReached && (
        <View style={[styles.banner, { backgroundColor: 'rgba(216,76,76,0.12)' }]}>
          <Text style={{ color: '#D84C4C', flex: 1 }}>
            Ai atins limita zilnică. Configurează cheia proprie din Setări.
          </Text>
          <Pressable onPress={() => router.push('/setari' as never)}>
            <Text style={{ color: '#D84C4C', fontWeight: '600' }}>Setări AI</Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.inputRow, { borderTopColor: C.border, backgroundColor: C.card }]}>
        <TextInput
          style={[styles.input, { color: C.text }]}
          placeholder="Întreabă ceva..."
          placeholderTextColor={C.textSecondary}
          value={input}
          onChangeText={setInput}
          editable={!quotaReached && !loading}
          multiline
        />
        <Pressable
          style={[
            styles.sendBtn,
            {
              backgroundColor: input.trim() && !loading && !quotaReached ? C.primary : C.border,
            },
          ]}
          onPress={() => void onSend()}
          disabled={!input.trim() || loading || quotaReached}
        >
          <Ionicons name="send" size={18} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 16, marginTop: 16, textAlign: 'center' },
  emptySubtext: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 },
  chip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    margin: 4,
  },
  chipText: { fontSize: 13 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  button: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', padding: 8, paddingHorizontal: 16 },
  quota: { fontSize: 11, paddingHorizontal: 16, paddingVertical: 4, textAlign: 'right' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginHorizontal: 8,
    borderRadius: 8,
  },
});
