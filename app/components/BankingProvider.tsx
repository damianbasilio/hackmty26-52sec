import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { useAuth } from '@/components/AuthProvider';
import { dataSource } from '@/src/data';
import type { Transfer, TransferDraft, TransferRecipient } from '@/src/data/DataSource';

type BankingContextValue = {
  /** Checking account the transfer screens operate on. */
  accountId: string | null;
  transfers: Transfer[];
  recipients: TransferRecipient[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  sendTransfer: (draft: TransferDraft) => Promise<Transfer>;
};

const BankingContext = createContext<BankingContextValue | null>(null);


export function BankingProvider({ children }: PropsWithChildren) {
  const { signedIn } = useAuth();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [recipients, setRecipients] = useState<TransferRecipient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!signedIn) {
      setAccountId(null);
      setTransfers([]);
      setRecipients([]);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      const accounts = await dataSource.getAccounts();
      const checking = accounts.find((account) => account.type === 'checking') ?? accounts[0];
      if (!checking) throw new Error('No encontramos tu cuenta de cheques.');
      const [sent, contacts] = await Promise.all([
        dataSource.getTransfers(checking.id),
        dataSource.getRecipients(checking.id),
      ]);
      if (!alive) return;
      setAccountId(checking.id);
      setTransfers(sent);
      setRecipients(contacts);
    })()
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : 'No pudimos cargar tus transferencias.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [nonce, signedIn]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const sendTransfer = useCallback(async (draft: TransferDraft) => {
    const transfer = await dataSource.createTransfer(draft);
    // Reusar el id de un reintento devuelve la misma fila: no la dupliques aquí.
    setTransfers((current) =>
      current.some((item) => item.id === transfer.id) ? current : [transfer, ...current],
    );
    const { payee_clabe: clabe } = transfer;
    setRecipients((current) =>
      !clabe || current.some((item) => item.clabe === clabe)
        ? current
        : [...current, {
            id: `payee_${clabe}`,
            name: transfer.payee_name,
            bank: transfer.payee_bank,
            last_four: transfer.payee_last_four,
            clabe,
            account_id: null,
          }],
    );
    return transfer;
  }, []);

  const value = useMemo<BankingContextValue>(() => ({
    accountId,
    transfers,
    recipients,
    loading,
    error,
    reload,
    sendTransfer,
  }), [accountId, error, loading, recipients, reload, sendTransfer, transfers]);

  return <BankingContext.Provider value={value}>{children}</BankingContext.Provider>;
}

export function useBanking() {
  const value = useContext(BankingContext);
  if (!value) throw new Error('useBanking debe usarse dentro de BankingProvider.');
  return value;
}
