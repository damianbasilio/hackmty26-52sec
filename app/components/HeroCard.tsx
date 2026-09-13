import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export function HeroCard({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return (
    <View style={styles.shadow}>
      <View style={[styles.card, style]}>
        <View pointerEvents="none" style={styles.glow} />
        <View pointerEvents="none" style={styles.arcOuter} />
        <View pointerEvents="none" style={styles.arcInner} />
        <View pointerEvents="none" style={styles.brandSlash} />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    position: 'relative',
    marginBottom: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.3,
        shadowRadius: 30,
      },
      android: { elevation: 4 },
      default: { boxShadow: '0 16px 34px rgba(0, 0, 0, 0.28)' },
    }),
  },
  card: {
    minHeight: 218,
    overflow: 'hidden',
    borderRadius: 26,
    padding: 24,
    justifyContent: 'space-between',
    backgroundColor: '#11161C',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.11)',
  },
  glow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    top: -120,
    left: -80,
    backgroundColor: 'rgba(82,100,124,0.10)',
  },
  arcOuter: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    borderWidth: 34,
    borderColor: 'rgba(154,168,188,0.07)',
    top: -175,
    right: -112,
  },
  arcInner: {
    position: 'absolute',
    width: 226,
    height: 226,
    borderRadius: 113,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    top: -123,
    right: -68,
  },
  brandSlash: {
    position: 'absolute',
    width: 13,
    height: 34,
    borderRadius: 3,
    top: 28,
    right: 28,
    backgroundColor: '#FF3B57',
    transform: [{ skewX: '-24deg' }],
  },
});
