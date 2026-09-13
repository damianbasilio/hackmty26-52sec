import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';

// Lo que el usuario nos dice de cada suscripción. El engine no sabe si alguien
// usa un servicio: solo lo infiere por los cobros.
// ponytail: vive en este teléfono; si se quiere entre dispositivos, va a la base.

export type SubscriptionUsage = 'using' | 'not_using';

export type SubscriptionMark = {
  usage?: SubscriptionUsage;
  /** Pidió que le recordemos cancelarla. */
  cancelPending?: boolean;
};

type Marks = Record<string, SubscriptionMark>;

const STORAGE_KEY = 'capital-one.subscription-marks.v1';

let cache: Marks = {};
let loading: Promise<void> | null = null;
const listeners = new Set<(marks: Marks) => void>();

function emit() {
  listeners.forEach((listener) => listener(cache));
}

function load(): Promise<void> {
  loading ??= SecureStore.getItemAsync(STORAGE_KEY)
    .then((raw) => {
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object') cache = { ...(parsed as Marks), ...cache };
    })
    .catch(() => undefined)
    .finally(emit);
  return loading;
}

export function markSubscription(subscriptionId: string, patch: SubscriptionMark) {
  cache = { ...cache, [subscriptionId]: { ...cache[subscriptionId], ...patch } };
  SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(cache)).catch(() => undefined);
  emit();
}

export function useSubscriptionMarks(): Marks {
  const [marks, setMarks] = useState(cache);
  useEffect(() => {
    listeners.add(setMarks);
    load();
    return () => {
      listeners.delete(setMarks);
    };
  }, []);
  return marks;
}
