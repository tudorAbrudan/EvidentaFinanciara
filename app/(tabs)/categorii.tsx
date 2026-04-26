import { useEffect, useState } from 'react';
import {
  StyleSheet,
  Pressable,
  Alert,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  View as RNView,
  Text as RNText,
} from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ThemedTextInput } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { useCategories } from '@/hooks/useCategories';
import type { ExpenseCategory } from '@/types';
import { useCallback } from 'react';

export default function CategoriiScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const {
    categories,
    spending,
    loading,
    refresh,
    createCategory,
    updateCategory,
    archiveCategory,
    deleteCategory,
  } = useCategories(true);

  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editLimit, setEditLimit] = useState('');
  const [saving, setSaving] = useState(false);

  const spendingMap = new Map<string, number>();
  spending.forEach(s => spendingMap.set(s.category.id, s.spent_ron));

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setEditName('');
    setEditIcon('');
    setEditLimit('');
  }

  function openEdit(cat: ExpenseCategory) {
    setEditing(cat);
    setCreating(false);
    setEditName(cat.name);
    setEditIcon(cat.icon ?? '');
    setEditLimit(cat.monthly_limit !== undefined ? String(cat.monthly_limit) : '');
  }

  function closeModal() {
    setEditing(null);
    setCreating(false);
  }

  async function handleSave() {
    if (!editName.trim()) {
      Alert.alert('Eroare', 'Numele categoriei nu poate fi gol.');
      return;
    }
    const limitParsed = editLimit.trim() ? Number(editLimit.replace(',', '.')) : undefined;
    if (limitParsed !== undefined && (Number.isNaN(limitParsed) || limitParsed < 0)) {
      Alert.alert('Eroare', 'Limita lunară nu e un număr valid.');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updateCategory(editing.id, {
          name: editName.trim(),
          icon: editIcon.trim() || null,
          monthly_limit: limitParsed ?? null,
        });
      } else {
        await createCategory({
          name: editName.trim(),
          icon: editIcon.trim() || undefined,
          monthly_limit: limitParsed,
        });
      }
      await refresh();
      closeModal();
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva categoria');
    } finally {
      setSaving(false);
    }
  }

  function handleArchiveToggle(cat: ExpenseCategory) {
    archiveCategory(cat.id, !cat.archived)
      .then(refresh)
      .catch(e => Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut actualiza.'));
  }

  function handleDelete(cat: ExpenseCategory) {
    if (cat.is_system) {
      Alert.alert(
        'Categorie sistem',
        'Categoriile sistem nu pot fi șterse — doar arhivate sau cu limită setată.'
      );
      return;
    }
    Alert.alert(
      'Șterge categoria',
      `„${cat.name}" va fi ștearsă. Tranzacțiile asociate își vor pierde categoria.`,
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCategory(cat.id);
              await refresh();
            } catch (e) {
              Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut șterge.');
            }
          },
        },
      ]
    );
  }

  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>
      <Stack.Screen options={{ title: 'Categorii cheltuieli' }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {categories.length === 0 && !loading && (
          <RNView style={styles.emptyWrap}>
            <Ionicons name="pricetags-outline" size={48} color={C.textSecondary} />
            <RNText style={[styles.emptyTitle, { color: C.text }]}>
              Nu există categorii încă
            </RNText>
          </RNView>
        )}
        {categories.map(cat => {
          const spent = spendingMap.get(cat.id) ?? 0;
          const pct = cat.monthly_limit ? spent / cat.monthly_limit : 0;
          const overBudget = cat.monthly_limit && spent > cat.monthly_limit;
          return (
            <Pressable
              key={cat.id}
              onPress={() => openEdit(cat)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: C.card, shadowColor: C.cardShadow },
                cat.archived && { opacity: 0.5 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <RNView style={styles.cardHeader}>
                <RNText style={styles.icon}>{cat.icon ?? '🏷️'}</RNText>
                <RNView style={{ flex: 1 }}>
                  <RNText style={[styles.cardTitle, { color: C.text }]} numberOfLines={1}>
                    {cat.name}
                    {cat.is_system ? (
                      <RNText style={[styles.systemBadge, { color: C.textSecondary }]}> · sistem</RNText>
                    ) : null}
                  </RNText>
                  {cat.monthly_limit ? (
                    <RNText style={[styles.cardSub, { color: C.textSecondary }]}>
                      {spent.toFixed(0)} / {cat.monthly_limit.toFixed(0)} RON
                    </RNText>
                  ) : (
                    <RNText style={[styles.cardSub, { color: C.textSecondary }]}>
                      {spent.toFixed(0)} RON cheltuiți
                    </RNText>
                  )}
                </RNView>
                <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
              </RNView>

              {cat.monthly_limit ? (
                <RNView style={[styles.progressTrack, { backgroundColor: C.border }]}>
                  <RNView
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.min(pct * 100, 100)}%`,
                        backgroundColor: overBudget
                          ? statusColors.critical
                          : pct > 0.8
                            ? statusColors.warning
                            : primary,
                      },
                    ]}
                  />
                </RNView>
              ) : null}

              <RNView style={styles.cardActions}>
                <Pressable
                  onPress={() => handleArchiveToggle(cat)}
                  style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons
                    name={cat.archived ? 'eye-outline' : 'archive-outline'}
                    size={14}
                    color={C.textSecondary}
                  />
                  <RNText style={[styles.smallBtnText, { color: C.textSecondary }]}>
                    {cat.archived ? 'Reactivează' : 'Arhivează'}
                  </RNText>
                </Pressable>
                {!cat.is_system && (
                  <Pressable
                    onPress={() => handleDelete(cat)}
                    style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons name="trash-outline" size={14} color={statusColors.critical} />
                    <RNText style={[styles.smallBtnText, { color: statusColors.critical }]}>
                      Șterge
                    </RNText>
                  </Pressable>
                )}
              </RNView>
            </Pressable>
          );
        })}
      </ScrollView>

      <BottomActionBar
        label="Adaugă categorie"
        icon={<Ionicons name="add" size={18} color="#fff" />}
        onPress={openCreate}
        safeArea
      />

      <Modal
        visible={editing !== null || creating}
        animationType="slide"
        transparent
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeModal} />
          <RNView style={[styles.modalCard, { backgroundColor: C.card }]}>
            <RNText style={[styles.modalTitle, { color: C.text }]}>
              {editing ? 'Editează categoria' : 'Categorie nouă'}
            </RNText>
            <RNText style={[styles.label, { color: C.textSecondary }]}>Nume</RNText>
            <ThemedTextInput
              style={styles.input}
              placeholder="ex. Mâncare livrată"
              value={editName}
              onChangeText={setEditName}
            />
            <RNText style={[styles.label, { color: C.textSecondary }]}>Iconiță (emoji)</RNText>
            <ThemedTextInput
              style={styles.input}
              placeholder="🍕"
              value={editIcon}
              onChangeText={setEditIcon}
              maxLength={4}
            />
            <RNText style={[styles.label, { color: C.textSecondary }]}>Limită lunară (RON)</RNText>
            <ThemedTextInput
              style={styles.input}
              placeholder="500"
              value={editLimit}
              onChangeText={setEditLimit}
              keyboardType="decimal-pad"
            />
            <RNText style={[styles.hint, { color: C.textSecondary }]}>
              Lasă gol pentru fără limită. La depășire vei vedea badge roșu.
            </RNText>

            <RNView style={styles.modalActions}>
              <Pressable
                onPress={closeModal}
                style={({ pressed }) => [
                  styles.modalBtn,
                  { borderColor: C.border, backgroundColor: 'transparent' },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <RNText style={{ color: C.text, fontWeight: '500' }}>Anulează</RNText>
              </Pressable>
              <Pressable
                onPress={handleSave}
                disabled={saving}
                style={({ pressed }) => [
                  styles.modalBtn,
                  { backgroundColor: primary, borderColor: primary },
                  pressed && { opacity: 0.85 },
                  saving && { opacity: 0.5 },
                ]}
              >
                <RNText style={{ color: '#fff', fontWeight: '600' }}>
                  {saving ? 'Salvează…' : 'Salvează'}
                </RNText>
              </Pressable>
            </RNView>
          </RNView>
        </KeyboardAvoidingView>
      </Modal>
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 96 },

  card: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { fontSize: 22 },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  cardSub: { fontSize: 12, marginTop: 2 },
  systemBadge: { fontSize: 11, fontWeight: '400' },

  progressTrack: { marginTop: 10, height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },

  cardActions: { flexDirection: 'row', gap: 12, marginTop: 10 },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  smallBtnText: { fontSize: 12 },

  emptyWrap: { alignItems: 'center', paddingVertical: 64, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '500' },

  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: {
    padding: 24,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  hint: { fontSize: 11, marginTop: -4, marginBottom: 12 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
  },
});
