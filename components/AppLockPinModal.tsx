import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet, Alert, Platform } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { radius } from '@/theme/layout';
import * as settings from '@/services/settings';

interface AppLockPinModalProps {
  visible: boolean;
  onDismiss: () => void;
  /** Dacă true, afișează Alert după salvare (comportament Setări). */
  showSuccessAlert?: boolean;
  /** Apelat după PIN setat cu succes, înainte de dismiss. */
  onPinSaved?: () => void;
}

export default function AppLockPinModal({
  visible,
  onDismiss,
  showSuccessAlert = true,
  onPinSaved,
}: AppLockPinModalProps) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');

  useEffect(() => {
    if (!visible) {
      setPin1('');
      setPin2('');
    }
  }, [visible]);

  async function handleSubmit() {
    if (Platform.OS === 'web') {
      onDismiss();
      return;
    }
    if (pin1.length < 4) {
      Alert.alert('Eroare', 'PIN-ul trebuie să aibă cel puțin 4 cifre.');
      return;
    }
    if (pin1 !== pin2) {
      Alert.alert('Eroare', 'PIN-urile nu coincid.');
      return;
    }
    try {
      await settings.setAppLockPin(pin1);
      await settings.setAppLockEnabled(true);
      onPinSaved?.();
      if (showSuccessAlert) {
        Alert.alert(
          'Activ',
          'Aplicația va fi blocată la ieșire sau la redeschidere. Poți folosi Face ID / Touch ID sau PIN.'
        );
      }
      onDismiss();
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut seta');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={[styles.box, { backgroundColor: C.card }]}>
          <Text style={[styles.title, { color: C.text }]}>Setare PIN blocare</Text>
          <Text style={[styles.hint, { color: C.textSecondary }]}>Alege un PIN de 4–8 cifre.</Text>
          <TextInput
            style={[
              styles.pinInput,
              { color: C.text, borderColor: C.border, backgroundColor: C.background },
            ]}
            value={pin1}
            onChangeText={t => setPin1(t.replace(/\D/g, '').slice(0, 8))}
            placeholder="PIN"
            placeholderTextColor={C.textSecondary}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={8}
          />
          <TextInput
            style={[
              styles.pinInput,
              { color: C.text, borderColor: C.border, backgroundColor: C.background },
            ]}
            value={pin2}
            onChangeText={t => setPin2(t.replace(/\D/g, '').slice(0, 8))}
            placeholder="Confirmă PIN"
            placeholderTextColor={C.textSecondary}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={8}
          />
          <View style={styles.btns}>
            <Pressable style={[styles.btnOutline, { borderColor: primary }]} onPress={onDismiss}>
              <Text style={[styles.btnOutlineText, { color: primary }]}>Anulare</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, { backgroundColor: primary }]}
              onPress={handleSubmit}
            >
              <Text style={styles.btnPrimaryText}>Salvează</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  box: {
    borderRadius: radius.xl,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  hint: { fontSize: 14, marginBottom: 12 },
  pinInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    letterSpacing: 4,
    marginBottom: 12,
    textAlign: 'center',
  },
  btns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btnOutline: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnOutlineText: { fontSize: 16, fontWeight: '600' },
  btnPrimary: {
    flex: 1,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
