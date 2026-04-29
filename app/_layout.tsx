import { ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import { useColorScheme as useColorSchemeNative } from 'react-native';

import AppLockScreen from '@/components/AppLockScreen';
import OnboardingWizard from '@/components/OnboardingWizard';
import { AppLightTheme, AppDarkTheme } from '@/constants/Theme';
import { useAppLock } from '@/hooks/useAppLock';
import { useCloudSync } from '@/hooks/useCloudSync';
import { ThemePreferenceContext } from '@/hooks/useThemeScheme';
import type { ThemePreference } from '@/hooks/useThemeScheme';
import * as settings from '@/services/settings';

export { ErrorBoundary } from 'expo-router';

export default function RootLayout() {
  const systemScheme = useColorSchemeNative();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('auto');
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const appLock = useAppLock();
  useCloudSync();

  useEffect(() => {
    void settings.getThemePreference().then(setThemePreferenceState);
    void settings.isOnboardingDone().then(done => {
      setNeedsOnboarding(!done);
      setOnboardingChecked(true);
    });
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setThemePreferenceState(p);
    void settings.setThemePreference(p);
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setNeedsOnboarding(false);
    appLock.refreshLockEnabled();
  }, [appLock]);

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
        {onboardingChecked && needsOnboarding && !appLock.locked && (
          <OnboardingWizard onComplete={handleOnboardingComplete} />
        )}
      </ThemeProvider>
    </ThemePreferenceContext.Provider>
  );
}
