import { createContext, useContext } from 'react';
import type { ThemePreference } from '@/services/settings';

export type { ThemePreference };

interface ThemePreferenceContextType {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

export const ThemePreferenceContext = createContext<ThemePreferenceContextType>({
  preference: 'auto',
  setPreference: () => {},
});

export function useThemePreference() {
  return useContext(ThemePreferenceContext);
}
