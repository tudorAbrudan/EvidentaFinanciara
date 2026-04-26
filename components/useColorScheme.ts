import { useColorScheme as useColorSchemeCore } from 'react-native';
import { useContext } from 'react';
import { ThemePreferenceContext } from '@/hooks/useThemeScheme';

export const useColorScheme = () => {
  const { preference } = useContext(ThemePreferenceContext);
  const systemScheme = useColorSchemeCore();
  if (preference !== 'auto') return preference;
  return systemScheme === 'unspecified' || systemScheme == null ? 'light' : systemScheme;
};
