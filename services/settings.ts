import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { SnapshotFrequency } from '@/types';

const KEY_NOTIF_DAYS = 'settings_notif_days';
const KEY_APP_LOCK_ENABLED = 'app_lock_enabled';
const KEY_APP_LOCK_PIN = 'app_lock_pin';
const KEY_PUSH_ENABLED = 'settings_push_enabled';
const KEY_CLOUD_SYNC_ENABLED = 'settings_cloud_sync_enabled';
const KEY_CLOUD_SNAPSHOT_FREQUENCY = 'settings_cloud_snapshot_frequency';
const KEY_CLOUD_SNAPSHOT_RETENTION = 'settings_cloud_snapshot_retention';

export async function getNotificationDays(): Promise<number> {
  const v = await AsyncStorage.getItem(KEY_NOTIF_DAYS);
  if (v == null) return 7;
  const n = parseInt(v, 10);
  return isNaN(n) ? 7 : Math.max(1, Math.min(90, n));
}

export async function setNotificationDays(days: number): Promise<void> {
  const v = Math.max(1, Math.min(90, days));
  await AsyncStorage.setItem(KEY_NOTIF_DAYS, String(v));
}

export async function getPushEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY_PUSH_ENABLED);
  return v !== 'false';
}

export async function setPushEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_PUSH_ENABLED, enabled ? 'true' : 'false');
}

export async function getAppLockEnabled(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const v = await SecureStore.getItemAsync(KEY_APP_LOCK_ENABLED);
  return v === 'true';
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(KEY_APP_LOCK_ENABLED, enabled ? 'true' : 'false');
}

export async function getAppLockPin(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  return await SecureStore.getItemAsync(KEY_APP_LOCK_PIN);
}

export async function setAppLockPin(pin: string): Promise<void> {
  if (Platform.OS === 'web') return;
  if (pin.length < 4) throw new Error('PIN-ul trebuie să aibă cel puțin 4 cifre.');
  await SecureStore.setItemAsync(KEY_APP_LOCK_PIN, pin);
}

export async function clearAppLockPin(): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(KEY_APP_LOCK_PIN);
}

const KEY_ONBOARDING_DONE = 'settings_onboarding_done';

export async function isOnboardingDone(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY_ONBOARDING_DONE);
  return v === 'true';
}

export async function setOnboardingDone(): Promise<void> {
  await AsyncStorage.setItem(KEY_ONBOARDING_DONE, 'true');
}

export async function resetOnboarding(): Promise<void> {
  await AsyncStorage.removeItem(KEY_ONBOARDING_DONE);
}

export type ThemePreference = 'light' | 'dark' | 'auto';

const KEY_THEME_PREFERENCE = 'settings_theme_preference';

export async function getThemePreference(): Promise<ThemePreference> {
  const v = await AsyncStorage.getItem(KEY_THEME_PREFERENCE);
  if (v === 'light' || v === 'dark' || v === 'auto') return v;
  return 'auto';
}

export async function setThemePreference(pref: ThemePreference): Promise<void> {
  await AsyncStorage.setItem(KEY_THEME_PREFERENCE, pref);
}

// ────────────────────────────────────────────────────────────────────────────
// Cloud sync (iCloud)
// ────────────────────────────────────────────────────────────────────────────

export async function getCloudSyncEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY_CLOUD_SYNC_ENABLED);
  return v === 'true';
}

export async function setCloudSyncEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_CLOUD_SYNC_ENABLED, enabled ? 'true' : 'false');
}

export async function getCloudSnapshotFrequency(): Promise<SnapshotFrequency> {
  const v = await AsyncStorage.getItem(KEY_CLOUD_SNAPSHOT_FREQUENCY);
  if (v === 'off' || v === 'daily' || v === 'every3days' || v === 'weekly' || v === 'monthly') {
    return v;
  }
  return 'weekly';
}

export async function setCloudSnapshotFrequency(freq: SnapshotFrequency): Promise<void> {
  await AsyncStorage.setItem(KEY_CLOUD_SNAPSHOT_FREQUENCY, freq);
}

export async function getCloudSnapshotRetention(): Promise<number> {
  const v = await AsyncStorage.getItem(KEY_CLOUD_SNAPSHOT_RETENTION);
  if (v == null) return 7;
  const n = parseInt(v, 10);
  return isNaN(n) ? 7 : Math.max(1, Math.min(60, n));
}

export async function setCloudSnapshotRetention(n: number): Promise<void> {
  const v = Math.max(1, Math.min(60, n));
  await AsyncStorage.setItem(KEY_CLOUD_SNAPSHOT_RETENTION, String(v));
}
