import type { PropsWithChildren } from 'react';
import { ImageBackground, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

const HERO_TEXTURE = require('../assets/images/hero-organic.png');

export function HeroCard({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return (
    <View style={styles.shadow}>
      <View style={styles.backing} />
      <ImageBackground
        source={HERO_TEXTURE}
        resizeMode="cover"
        imageStyle={styles.image}
        style={[styles.card, style]}>
        <View pointerEvents="none" style={styles.scrim} />
        {children}
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    position: 'relative',
    marginBottom: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#001A3D',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.16,
        shadowRadius: 24,
      },
      android: { elevation: 8 },
      default: { boxShadow: '0 16px 34px rgba(0, 26, 61, 0.16)' },
    }),
  },
  backing: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: -8,
    height: 40,
    borderRadius: 22,
    backgroundColor: '#DDE0D7',
  },
  card: {
    minHeight: 218,
    overflow: 'hidden',
    borderRadius: 26,
    padding: 24,
    justifyContent: 'space-between',
  },
  image: { borderRadius: 26 },
  scrim: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0, 20, 44, 0.12)',
  },
});
