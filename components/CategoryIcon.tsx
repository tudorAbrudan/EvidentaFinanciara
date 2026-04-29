import { Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const IONICON_NAME_RE = /^[a-z][a-z0-9-]*$/;

interface Props {
  icon?: string | null;
  size?: number;
  color?: string;
  fallback?: string;
}

export default function CategoryIcon({
  icon,
  size = 24,
  color,
  fallback = '🏷️',
}: Props) {
  if (icon && IONICON_NAME_RE.test(icon)) {
    return <Ionicons name={icon as IoniconName} size={size} color={color} />;
  }
  return <Text style={{ fontSize: size, lineHeight: size * 1.1 }}>{icon || fallback}</Text>;
}
