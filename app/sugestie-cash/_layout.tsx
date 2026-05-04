import { Stack } from 'expo-router';

export default function SugestieCashLayout() {
  return (
    <Stack>
      <Stack.Screen name="batch" options={{ title: 'Sugestie cash' }} />
    </Stack>
  );
}
