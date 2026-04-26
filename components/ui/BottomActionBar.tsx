import React from 'react';
import { Pressable, Text, StyleSheet, View, ActivityIndicator, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { radius } from '@/theme/layout';

interface BottomActionBarProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  /** Adaugă safe area inset jos (pentru ecrane stack fără tab bar). Default: false. */
  safeArea?: boolean;
}

export function BottomActionBar({
  label,
  onPress,
  loading,
  disabled,
  icon,
  safeArea = false,
}: BottomActionBarProps) {
  const insets = useSafeAreaInsets();
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: C.surface,
          borderTopColor: C.border,
          paddingBottom: safeArea ? insets.bottom + 4 : 4,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        disabled={loading || disabled}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: C.primary },
          (loading || disabled) && styles.btnDisabled,
          pressed && styles.btnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            {icon}
            <Text style={styles.btnText}>{label}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 16,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: { elevation: 4 },
    }),
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 32,
    borderRadius: radius.pill,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
