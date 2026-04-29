import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

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
        name="conturi"
        options={{
          title: 'Conturi',
          headerShown: false,
          tabBarIcon: ({ color }) => <Ionicons name="wallet" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tranzactii"
        options={{
          title: 'Tranzacții',
          headerShown: false,
          tabBarIcon: ({ color }) => <Ionicons name="list" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="categorii"
        options={{
          title: 'Categorii',
          tabBarIcon: ({ color }) => <Ionicons name="pricetags" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="setari"
        options={{
          title: 'Setări',
          tabBarIcon: ({ color }) => <Ionicons name="settings" size={22} color={color} />,
        }}
      />
      <Tabs.Screen name="evolutie" options={{ href: null }} />
    </Tabs>
  );
}
