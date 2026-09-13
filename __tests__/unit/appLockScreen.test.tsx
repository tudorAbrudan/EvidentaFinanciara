import { render, screen } from '@testing-library/react-native';
import React from 'react';

import AppLockScreen from '@/components/AppLockScreen';

jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(),
  hasHardwareAsync: jest.fn(),
  supportedAuthenticationTypesAsync: jest.fn(),
}));
jest.mock('expo-symbols', () => ({
  SymbolView: () => null,
}));

const noop = async () => false;

describe('AppLockScreen — stare blocată după prea multe PIN-uri greșite', () => {
  it('afișează timpul rămas și dezactivează butonul', () => {
    render(
      <AppLockScreen
        biometricAvailable={false}
        onUnlockBiometric={noop}
        onUnlockPin={noop}
        pinLockMsLeft={125_000}
      />
    );
    expect(screen.getByText(/Prea multe încercări greșite/)).toBeTruthy();
    expect(screen.getByText(/2 min 5 s/)).toBeTruthy();
  });

  it('menționează biometria ca alternativă doar când e disponibilă', () => {
    const { unmount } = render(
      <AppLockScreen
        biometricAvailable
        onUnlockBiometric={noop}
        onUnlockPin={noop}
        pinLockMsLeft={30_000}
      />
    );
    expect(screen.getByText(/Face ID \/ Touch ID rămâne disponibil/)).toBeTruthy();
    unmount();

    render(
      <AppLockScreen
        biometricAvailable={false}
        onUnlockBiometric={noop}
        onUnlockPin={noop}
        pinLockMsLeft={30_000}
      />
    );
    expect(screen.queryByText(/rămâne disponibil/)).toBeNull();
  });

  it('fără blocare nu afișează mesajul', () => {
    render(
      <AppLockScreen
        biometricAvailable={false}
        onUnlockBiometric={noop}
        onUnlockPin={noop}
        pinLockMsLeft={0}
      />
    );
    expect(screen.queryByText(/Prea multe încercări/)).toBeNull();
  });
});
