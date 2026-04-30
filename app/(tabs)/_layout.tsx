import { Ionicons } from '@expo/vector-icons';
import { Tabs, router } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function TabLayout() {
  const scheme = useColorScheme() ?? 'light';
  const palette = Colors[scheme];

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.tint,
        tabBarStyle: { backgroundColor: palette.background, borderTopColor: palette.border },
        headerStyle: { backgroundColor: palette.background },
        headerTitleStyle: { color: palette.text },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Sumar',
          tabBarIcon: ({ color }) => <Ionicons name="pie-chart" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="evolutie"
        options={{
          title: 'Evoluție',
          tabBarIcon: ({ color }) => <Ionicons name="trending-up" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="adauga"
        options={{
          title: 'Adaugă',
          tabBarIcon: ({ color }) => <Ionicons name="add-circle" size={28} color={color} />,
        }}
        listeners={{
          tabPress: e => {
            e.preventDefault();
            router.push({ pathname: '/tranzactii/[id]', params: { id: 'new' } });
          },
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <Ionicons name="chatbubbles" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="setari"
        options={{
          title: 'Setări',
          tabBarIcon: ({ color }) => <Ionicons name="settings" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
