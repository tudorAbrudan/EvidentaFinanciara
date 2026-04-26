import React from 'react';
import { Pressable, Text, StyleSheet, View, Platform } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { radius } from '@/theme/layout';

interface FloatingPillButtonProps {
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
}

/** CTA pill deasupra tab bar-ului (înlocuiește FAB-ul rotund). */
export function FloatingPillButton({ label, icon, onPress }: FloatingPillButtonProps) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: C.primary, opacity: pressed ? 0.9 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {icon}
        <Text style={styles.btnText}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
    alignItems: 'stretch',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: radius.pill,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
      },
      android: { elevation: 5 },
    }),
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
