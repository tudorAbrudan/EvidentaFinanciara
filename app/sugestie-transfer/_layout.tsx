import { Stack } from 'expo-router';

export default function SugestieTransferLayout() {
  return (
    <Stack>
      <Stack.Screen name="batch" options={{ title: 'Sugestie transfer intern' }} />
    </Stack>
  );
}
