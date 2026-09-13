import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion, SlideInDown } from 'react-native-reanimated';

import type { Verification, VerificationPurpose } from '@contracts/types';

import { useAuth } from '@/components/AuthProvider';
import { PinEntry } from '@/components/PinEntry';
import { Text } from '@/components/Themed';
import { usePalette } from '@/components/palette';
import { dataSource } from '@/src/data';

export type VerifyRequest = {
  title: string;
  reason: string;
  purpose: VerificationPurpose;
  /** Alert id, `shield` or `settings`: the challenge only unlocks that one action. */
  target: string;
  run: (verification: Verification) => Promise<void>;
};

/**
 * Tu PIN abre un código que emite y valida el engine. El PIN solo no basta:
 * vive en el teléfono y una sesión robada llamaría al engine sin él.
 */
export function VerifySheet({ request, onClose }: { request: VerifyRequest | null; onClose: () => void }) {
  const palette = usePalette();
  const { verifyTransactionPin } = useAuth();
  const [pin, setPin] = useState('');
  const [pinErrors, setPinErrors] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setPin('');
    setMessage(null);
    setBusy(false);
  }, [request]);

  async function confirm(value: string) {
    if (!request || busy) return;
    setBusy(true);
    setMessage(null);
    if (!(await verifyTransactionPin(value))) {
      setMessage('El PIN no coincide. Revisa e inténtalo nuevamente.');
      setPin('');
      setPinErrors((count) => count + 1);
      setBusy(false);
      return;
    }
    try {
      const issued = await dataSource.requestChallenge(request.purpose, request.target);
      await request.run({ challenge_id: issued.challenge.id, code: issued.code });
      onClose();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'No pudimos verificarte. Inténtalo otra vez.');
      setPin('');
      setBusy(false);
    }
  }

  return (
    <Modal animationType="none" onRequestClose={onClose} transparent visible={request !== null}>
      <Animated.View entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)} style={styles.backdrop}>
        <Pressable accessibilityLabel="Cancelar" disabled={busy} onPress={onClose} style={StyleSheet.absoluteFill} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View
            entering={SlideInDown.duration(260).reduceMotion(ReduceMotion.System)}
            style={[styles.sheet, { backgroundColor: palette.surface }]}>
            <View style={[styles.handle, { backgroundColor: palette.border }]} />
            <View style={styles.heading}>
              <SymbolView
                name={{ ios: 'lock.shield.fill', android: 'verified_user', web: 'shield' }}
                tintColor={palette.accent}
                size={22}
              />
              <View style={styles.copy}>
                <Text style={styles.title}>{request?.title ?? ''}</Text>
                <Text style={[styles.reason, { color: palette.muted }]}>{request?.reason ?? ''}</Text>
              </View>
            </View>
            <PinEntry
              accessibilityLabel="PIN para confirmar que eres tú"
              autoFocus
              disabled={busy}
              errorKey={pinErrors}
              onChange={setPin}
              onComplete={confirm}
              value={pin}
            />
            {busy ? <Text style={[styles.reason, { color: palette.muted }]}>Verificando…</Text> : null}
            {message ? (
              <View style={[styles.message, { backgroundColor: palette.dangerSoft }]}>
                <Text style={[styles.messageText, { color: palette.danger }]}>{message}</Text>
              </View>
            ) : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 16, 36, 0.42)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 34, gap: 16 },
  handle: { alignSelf: 'center', width: 38, height: 5, borderRadius: 999 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  copy: { flex: 1, gap: 3 },
  title: { fontSize: 17, fontWeight: '700' },
  reason: { fontSize: 13, lineHeight: 18 },
  message: { borderRadius: 15, paddingHorizontal: 14, paddingVertical: 11 },
  messageText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
