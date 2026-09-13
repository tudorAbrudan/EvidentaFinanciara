import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import {
  afterFailure,
  afterSuccess,
  INITIAL_THROTTLE,
  isLocked,
  remainingLockMs,
  type ThrottleState,
} from '@/services/appLockThrottle';
import * as settings from '@/services/settings';

export function useAppLock() {
  const [lockEnabled, setLockEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [throttle, setThrottle] = useState<ThrottleState>(INITIAL_THROTTLE);
  const [pinLockMsLeft, setPinLockMsLeft] = useState(0);

  useEffect(() => {
    void settings.getAppLockThrottle().then(setThrottle);
  }, []);

  // Tick cât timp introducerea PIN-ului e blocată, ca UI-ul să numere descrescător.
  useEffect(() => {
    const update = () => setPinLockMsLeft(remainingLockMs(throttle, Date.now()));
    update();
    if (!isLocked(throttle, Date.now())) return;
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [throttle]);

  useEffect(() => {
    void settings.getAppLockEnabled().then(enabled => {
      setLockEnabledState(enabled);
      if (enabled) setLocked(true);
    });
  }, []);

  useEffect(() => {
    if (!lockEnabled) return;
    void LocalAuthentication.hasHardwareAsync().then(has => {
      if (has)
        void LocalAuthentication.supportedAuthenticationTypesAsync().then(() =>
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
    const now = Date.now();
    // Citim starea proaspătă din storage: contorul trebuie să reziste la
    // repornirea aplicației, altfel limitarea se ocolește prin kill & restart.
    const current = await settings.getAppLockThrottle();
    if (isLocked(current, now)) {
      setThrottle(current);
      return false;
    }

    const stored = await settings.getAppLockPin();
    if (stored === pin) {
      const next = afterSuccess();
      await settings.setAppLockThrottle(next);
      setThrottle(next);
      setLocked(false);
      return true;
    }

    const next = afterFailure(current, now);
    await settings.setAppLockThrottle(next);
    setThrottle(next);
    return false;
  }, []);

  const refreshLockEnabled = useCallback(() => {
    void settings.getAppLockEnabled().then(setLockEnabledState);
  }, []);

  return {
    lockEnabled,
    locked: lockEnabled && locked,
    biometricAvailable,
    unlockWithBiometric,
    unlockWithPin,
    /** Milisecunde rămase din blocarea PIN-ului; 0 = neblocat. */
    pinLockMsLeft,
    refreshLockEnabled,
  };
}
