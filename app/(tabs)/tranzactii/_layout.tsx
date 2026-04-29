import { Stack } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function TranzactiiLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Tranzacții' }} />
      <Stack.Screen name="[id]" options={{ title: 'Tranzacție', presentation: 'modal' }} />
    </Stack>
  );
}
