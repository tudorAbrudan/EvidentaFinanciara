import { DefaultTheme, DarkTheme } from '@react-navigation/native';
import { primary } from '@/theme/colors';

export const AppLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary,
  },
};

export const AppDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary,
  },
};
