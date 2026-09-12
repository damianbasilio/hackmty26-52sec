import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Tabs } from 'expo-router';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';

type TabSpec = {
  name: string;
  title: string;
  symbol: ComponentProps<typeof SymbolView>['name'];
};

const TABS: TabSpec[] = [
  { name: 'index', title: 'Inicio', symbol: { ios: 'house.fill', android: 'home', web: 'home' } },
  { name: 'movimientos', title: 'Movimientos', symbol: { ios: 'list.bullet', android: 'list', web: 'list' } },
  { name: 'suscripciones', title: 'Suscripciones', symbol: { ios: 'arrow.triangle.2.circlepath', android: 'autorenew', web: 'autorenew' } },
  { name: 'salud', title: 'Salud', symbol: { ios: 'gauge.medium', android: 'speed', web: 'speed' } },
  { name: 'ahorro', title: 'Ahorro', symbol: { ios: 'banknote.fill', android: 'savings', web: 'savings' } },
];

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
        // Disable the static render of the header on web to avoid a hydration error.
        headerShown: useClientOnlyValue(false, true),
      }}>
      {TABS.map(({ name, title, symbol }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color }) => <SymbolView name={symbol} tintColor={color} size={26} />,
          }}
        />
      ))}
    </Tabs>
  );
}
