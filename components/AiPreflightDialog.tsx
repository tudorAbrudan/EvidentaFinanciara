import { Ionicons } from '@expo/vector-icons';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import {
  AI_PROVIDER_NAME,
  AI_PROVIDER_TERMS_URL,
  preflightDescription,
  type PreflightInfo,
} from '@/services/privacyPolicy';
import { primary } from '@/theme/colors';
import { radius } from '@/theme/layout';

interface Props {
  visible: boolean;
  info: PreflightInfo | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Pre-flight dialog afișat înainte de fiecare upload de extras (PDF/CSV) la Mistral.
 * Răspunde la cerința Apple „obtain the user's permission before sending data" pentru
 * fluxurile de upload de fișiere — fiecare fișier necesită confirmare explicită.
 */
export default function AiPreflightDialog({ visible, info, onCancel, onConfirm }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  if (!info) return null;

  const meta: string[] = [];
  if (typeof info.sizeKb === 'number') meta.push(`${info.sizeKb} KB`);
  if (typeof info.pages === 'number')
    meta.push(`${info.pages} ${info.pages === 1 ? 'pagină' : 'pagini'}`);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={styles.titleRow}>
            <Ionicons name="cloud-upload-outline" size={22} color={C.tint} />
            <Text style={[styles.title, { color: C.text }]}>Trimit la {AI_PROVIDER_NAME}?</Text>
          </View>

          <View style={[styles.fileBox, { backgroundColor: C.surface, borderColor: C.border }]}>
            <Ionicons name="document-outline" size={18} color={C.textSecondary} />
            <View style={styles.fileMeta}>
              <Text
                style={[styles.fileName, { color: C.text }]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {info.fileName}
              </Text>
              {meta.length > 0 ? (
                <Text style={[styles.fileSub, { color: C.textSecondary }]}>{meta.join(' · ')}</Text>
              ) : null}
            </View>
          </View>

          <Text style={[styles.body, { color: C.text }]}>{preflightDescription(info)}</Text>

          <Pressable
            onPress={() => {
              void Linking.openURL(AI_PROVIDER_TERMS_URL);
            }}
            style={styles.termsRow}
          >
            <Ionicons name="open-outline" size={14} color={C.tint} />
            <Text style={[styles.termsLink, { color: C.tint }]}>Termenii {AI_PROVIDER_NAME}</Text>
          </Pressable>

          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                styles.btn,
                styles.btnCancel,
                { borderColor: C.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.btnText, { color: C.text }]}>Anulează</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: primary, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.btnText, { color: '#fff' }]}>Trimite la {AI_PROVIDER_NAME}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 20,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  title: { fontSize: 17, fontWeight: '700' },
  fileBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  fileMeta: { flex: 1 },
  fileName: { fontSize: 14, fontWeight: '600' },
  fileSub: { fontSize: 12, marginTop: 2 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  termsLink: { fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancel: { borderWidth: 1.5 },
  btnText: { fontSize: 14, fontWeight: '700' },
});
