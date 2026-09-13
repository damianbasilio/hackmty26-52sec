import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Pantalla con campos que sube con el teclado. En iOS el ScrollView ajusta sus
 * insets y deja el campo enfocado a la vista; con el padding del
 * KeyboardAvoidingView además del inset el contenido quedaba pegado al fondo.
 */
export function FormScroll({
  children,
  contentContainerStyle,
}: PropsWithChildren<{ contentContainerStyle?: StyleProp<ViewStyle> }>) {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'android' ? 'height' : undefined} style={styles.flex}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={contentContainerStyle}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
