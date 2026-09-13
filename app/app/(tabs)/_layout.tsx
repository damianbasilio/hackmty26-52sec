import { SymbolView } from 'expo-symbols';
import { useEffect, type ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type TabSpec = {
  name: string;
  title: string;
  symbol: ComponentProps<typeof SymbolView>['name'];
};

const TABS: TabSpec[] = [
  { name: 'index', title: 'Inicio', symbol: { ios: 'house.fill', android: 'home', web: 'home' } },
  { name: 'movimientos', title: 'Tarjeta', symbol: { ios: 'creditcard.fill', android: 'credit_card', web: 'credit_card' } },
  { name: 'suscripciones', title: 'Suscrip.', symbol: { ios: 'arrow.triangle.2.circlepath', android: 'autorenew', web: 'autorenew' } },
  { name: 'salud', title: 'Salud', symbol: { ios: 'person.fill', android: 'person', web: 'person' } },
  { name: 'ahorro', title: 'Ahorro', symbol: { ios: 'wallet.bifold.fill', android: 'account_balance_wallet', web: 'account_balance_wallet' } },
];

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
        tabBarInactiveTintColor: Colors[colorScheme].tabIconDefault,
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
        tabBarStyle: [
          styles.bar,
          {
            backgroundColor: '#0E1318',
            borderTopColor: 'rgba(255,255,255,0.09)',
          },
        ],
      }}>
      {TABS.map(({ name, title, symbol }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon color={String(color)} focused={focused} symbol={symbol} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

function TabIcon({
  color,
  focused,
  symbol,
}: {
  color: string;
  focused: boolean;
  symbol: TabSpec['symbol'];
}) {
  const progress = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(focused ? 1 : 0, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
  }, [focused, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.72 + progress.value * 0.28,
    transform: [{ translateY: -progress.value * 2 }, { scale: 0.94 + progress.value * 0.08 }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <SymbolView name={symbol} tintColor={color} size={23} />
    </Animated.View>
  );
}

const styles = {
  bar: {
    position: 'absolute' as const,
    height: Platform.OS === 'ios' ? 92 : 76,
    left: 12,
    right: 12,
    bottom: Platform.OS === 'ios' ? 8 : 10,
    borderRadius: 30,
    borderTopWidth: 0.5,
    paddingTop: 10,
    overflow: 'hidden' as const,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.35,
        shadowRadius: 28,
      },
      android: { elevation: 12 },
      default: { boxShadow: '0 -10px 28px rgba(0, 0, 0, 0.34)' },
    }),
  },
  item: { paddingVertical: 3 },
  label: { fontSize: 10.5, fontWeight: '600' as const, marginTop: 2 },
};
