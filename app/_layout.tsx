import { ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useState, useEffect } from 'react';
import { useColorScheme as useColorSchemeNative } from 'react-native';

import AppLockScreen from '@/components/AppLockScreen';
import { AppLightTheme, AppDarkTheme } from '@/constants/Theme';
import { ThemePreferenceContext } from '@/hooks/useThemeScheme';
import type { ThemePreference } from '@/hooks/useThemeScheme';
import { useAppLock } from '@/hooks/useAppLock';
import * as settings from '@/services/settings';

export { ErrorBoundary } from 'expo-router';

export default function RootLayout() {
  const systemScheme = useColorSchemeNative();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('auto');
  const appLock = useAppLock();

  useEffect(() => {
    settings.getThemePreference().then(setThemePreferenceState);
  }, []);

  function setPreference(p: ThemePreference) {
    setThemePreferenceState(p);
    void settings.setThemePreference(p);
  }

  const effectiveScheme: 'light' | 'dark' =
    themePreference === 'auto' ? (systemScheme === 'dark' ? 'dark' : 'light') : themePreference;

  return (
    <ThemePreferenceContext.Provider value={{ preference: themePreference, setPreference }}>
      <ThemeProvider value={effectiveScheme === 'dark' ? AppDarkTheme : AppLightTheme}>
        <Stack screenOptions={{ headerShown: false }} />
        {appLock.locked && (
          <AppLockScreen
            biometricAvailable={appLock.biometricAvailable}
            onUnlockBiometric={appLock.unlockWithBiometric}
            onUnlockPin={appLock.unlockWithPin}
          />
        )}
      </ThemeProvider>
    </ThemePreferenceContext.Provider>
  );
}
