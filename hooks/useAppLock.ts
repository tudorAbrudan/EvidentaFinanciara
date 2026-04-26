import { useEffect, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as settings from '@/services/settings';

export function useAppLock() {
  const [lockEnabled, setLockEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    settings.getAppLockEnabled().then(enabled => {
      setLockEnabledState(enabled);
      if (enabled) setLocked(true);
    });
  }, []);

  useEffect(() => {
    if (!lockEnabled) return;
    LocalAuthentication.hasHardwareAsync().then(has => {
      if (has)
        LocalAuthentication.supportedAuthenticationTypesAsync().then(() =>
          setBiometricAvailable(true)
        );
    });
  }, [lockEnabled]);

  useEffect(() => {
    if (!lockEnabled) return;
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'background') setLocked(true);
    });
    return () => sub.remove();
  }, [lockEnabled]);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    const { success } = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Deschide aplicația',
    });
    if (success) setLocked(false);
    return success;
  }, []);

  const unlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    const stored = await settings.getAppLockPin();
    if (stored === pin) {
      setLocked(false);
      return true;
    }
    return false;
  }, []);

  const refreshLockEnabled = useCallback(() => {
    settings.getAppLockEnabled().then(setLockEnabledState);
  }, []);

  return {
    lockEnabled,
    locked: lockEnabled && locked,
    biometricAvailable,
    unlockWithBiometric,
    unlockWithPin,
    refreshLockEnabled,
  };
}
