import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export const CATEGORY_ICONS: IoniconName[] = [
  // Mâncare
  'fast-food',
  'restaurant',
  'cafe',
  'pizza',
  'wine',
  'beer',
  // Transport
  'bus',
  'car-sport',
  'bicycle',
  'subway',
  'airplane',
  'train',
  'boat',
  // Casă & utilități
  'home',
  'bed',
  'flash',
  'water',
  'wifi',
  'flame',
  // Sănătate & sport
  'medkit',
  'heart',
  'fitness',
  'barbell',
  // Educație & muncă
  'school',
  'book',
  'briefcase',
  'laptop',
  // Distracție
  'happy',
  'game-controller',
  'musical-notes',
  'film',
  'ticket',
  // Cumpărături
  'bag-handle',
  'cart',
  'shirt',
  'gift',
  // Diverse
  'paw',
  'hammer',
  'leaf',
  'cash',
  'card',
  'wallet',
  'repeat',
  'swap-horizontal',
  'ellipsis-horizontal',
];

interface Props {
  value?: string | null;
  onChange: (icon: string) => void;
  color?: string;
}

export default function IconPicker({ value, onChange, color }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const tint = color ?? primary;

  return (
    <View style={styles.grid}>
      {CATEGORY_ICONS.map(name => {
        const selected = value === name;
        return (
          <Pressable
            key={name}
            onPress={() => onChange(name)}
            style={({ pressed }) => [
              styles.cell,
              {
                backgroundColor: selected ? tint : 'transparent',
                borderColor: selected ? tint : C.border,
              },
              pressed && !selected && { opacity: 0.6 },
            ]}
          >
            <Ionicons name={name} size={20} color={selected ? '#fff' : C.text} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cell: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
