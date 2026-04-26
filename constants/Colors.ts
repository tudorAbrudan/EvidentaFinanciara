/**
 * Culori app – delegare către theme (Mindify-inspired sage)
 */
import { light, dark } from '@/theme/colors';

export default {
  light: {
    ...light,
    tint: light.primary,
  },
  dark: {
    ...dark,
    tint: dark.primary,
  },
};
