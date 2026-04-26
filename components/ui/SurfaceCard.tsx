import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { radius } from '@/theme/layout';
import { Platform } from 'react-native';

interface SurfaceCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  noShadow?: boolean;
}

/** Card alb integrat pe fundalul ecranului (Mindify). */
export function SurfaceCard({ children, style, noShadow }: SurfaceCardProps) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: C.card,
          shadowColor: C.cardShadow,
        },
        noShadow && styles.noShadow,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  noShadow: {
    ...Platform.select({
      ios: { shadowOpacity: 0 },
      android: { elevation: 0 },
      default: {},
    }),
  },
});
