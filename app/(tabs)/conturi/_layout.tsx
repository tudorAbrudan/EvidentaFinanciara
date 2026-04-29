import { Stack } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function ConturiLayout() {
  const scheme = useColorScheme() ?? 'light';
  const palette = Colors[scheme];
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.background },
        headerTitleStyle: { color: palette.text },
        headerTintColor: palette.tint,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Conturi' }} />
      <Stack.Screen name="[id]" options={{ title: 'Cont' }} />
      <Stack.Screen name="add" options={{ title: 'Adaugă cont', presentation: 'modal' }} />
      <Stack.Screen name="edit" options={{ title: 'Editează cont', presentation: 'modal' }} />
      <Stack.Screen name="import" options={{ title: 'Import extras' }} />
    </Stack>
  );
}
