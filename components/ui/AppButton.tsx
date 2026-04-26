import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { radius } from '@/theme/layout';

type Variant = 'primary' | 'secondary' | 'outline';

interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  icon?: React.ReactNode;
}

export function AppButton({
  title,
  onPress,
  variant = 'primary',
  disabled,
  style,
  textStyle,
  icon,
}: AppButtonProps) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';
  const isOutline = variant === 'outline';

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        isPrimary && { backgroundColor: disabled ? C.border : C.primary },
        isSecondary && { backgroundColor: C.primaryMuted },
        isOutline && {
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderColor: C.primary,
        },
        pressed && !disabled && { opacity: 0.88 },
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      {icon}
      <Text
        style={[
          styles.label,
          isPrimary && styles.labelOnPrimary,
          (isSecondary || isOutline) && { color: C.primary },
          isOutline && { fontWeight: '600' },
          textStyle,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    minHeight: 48,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  labelOnPrimary: {
    color: '#ffffff',
  },
});
