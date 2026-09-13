import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { MotionPressable } from '@/components/Motion';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';

const LOGO = require('../assets/images/52pay-logo-cropped.png');

export function BrandLogo({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View accessibilityLabel="52Pay" style={[styles.frame, style]}>
      <Image resizeMode="contain" source={LOGO} style={styles.logo} />
    </View>
  );
}

export function BrandHeader({ onAvatarPress }: { onAvatarPress?: () => void }) {
  const palette = usePalette();
  const Avatar = onAvatarPress ? MotionPressable : View;
  return (
    <View style={styles.header}>
      <BrandLogo />
      <Avatar
        {...(onAvatarPress ? { accessibilityLabel: 'Abrir perfil', accessibilityRole: 'button', onPress: onAvatarPress } : {})}
        style={[styles.avatar, { borderColor: palette.border }]}>
        <Text style={[styles.initials, { color: palette.muted }]}>DP</Text>
      </Avatar>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: 150, height: 46, overflow: 'hidden' },
  logo: { width: 150, height: 46 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#12171D', borderWidth: StyleSheet.hairlineWidth },
  initials: { fontSize: 16, fontWeight: '600' },
});
