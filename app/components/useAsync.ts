import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

/**
 * Minimal loader for DataSource calls. `load` is intentionally out of the dependency
 * list so screens can pass an inline closure; pass `deps` for anything it reads.
 *
 * Las pestañas no se desmontan, así que sin recargar al volver a enfocarlas los
 * datos solo cambiaban al cerrar sesión. Esa recarga es silenciosa: no enciende
 * el spinner ni tira lo que ya se ve si falla.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<Omit<AsyncState<T>, 'reload'>>({
    data: null,
    error: null,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  const silent = useRef(false);
  const firstFocus = useRef(true);

  useEffect(() => {
    let alive = true;
    const quiet = silent.current;
    silent.current = false;
    if (!quiet) setState((prev) => ({ ...prev, loading: true, error: null }));
    load()
      .then((data) => {
        if (alive) setState({ data, error: null, loading: false });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const message = e instanceof Error ? e.message : 'No pudimos cargar la información.';
        setState((prev) => (quiet && prev.data !== null
          ? { ...prev, loading: false }
          : { data: null, error: message, loading: false }));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      silent.current = true;
      setNonce((n) => n + 1);
    }, []),
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
