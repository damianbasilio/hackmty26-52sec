import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { useAuth } from '@/components/AuthProvider';
import { dataSource } from '@/src/data';
import type { Transfer, TransferDraft, TransferRecipient } from '@/src/data/DataSource';

export type SplitParticipant = {
  id: string;
  name: string;
  initials: string;
  color: string;
};

export const NEARBY_PARTICIPANTS: SplitParticipant[] = [
  { id: 'recipient_mariana', name: 'Mariana Ríos', initials: 'MR', color: '#E3F0FA' },
  { id: 'recipient_diego', name: 'Diego Garza', initials: 'DG', color: '#FCE7E5' },
  { id: 'recipient_luis', name: 'Luis Mendoza', initials: 'LM', color: '#E7F4EB' },
];

type BankingContextValue = {
  /** Checking account the transfer screens operate on. */
  accountId: string | null;
  transfers: Transfer[];
  recipients: TransferRecipient[];
  /**
   * Money already committed out of this account. Misma fórmula que
   * `available_balance_cents` del engine: el saldo de Nessie no se mueve solo,
   * así que las transferencias salientes se restan aquí.
   */
  outgoingCents: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
  sendTransfer: (draft: TransferDraft) => Promise<Transfer>;
  createSplitRequest: (totalCents: number, participants: SplitParticipant[]) => Promise<string>;
};

const BankingContext = createContext<BankingContextValue | null>(null);

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

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
    setRecipients((current) =>
      current.some((item) => item.name === transfer.payee_name && item.last_four === transfer.payee_last_four)
        ? current
        : [...current, {
            id: `payee_${transfer.payee_name}|${transfer.payee_last_four ?? ''}`,
            name: transfer.payee_name,
            bank: transfer.payee_bank,
            last_four: transfer.payee_last_four,
            account_id: transfer.payee_account_id,
          }],
    );
    return transfer;
  }, []);

  const createSplitRequest = useCallback(async () => {
    await wait(620);
    return `split_${Date.now()}`;
  }, []);

  const value = useMemo<BankingContextValue>(() => ({
    accountId,
    transfers,
    recipients,
    outgoingCents: transfers
      .filter((transfer) => transfer.status === 'pending' || transfer.status === 'completed')
      .reduce((sum, transfer) => sum + transfer.amount_cents, 0),
    loading,
    error,
    reload,
    sendTransfer,
    createSplitRequest,
  }), [accountId, createSplitRequest, error, loading, recipients, reload, sendTransfer, transfers]);

  return <BankingContext.Provider value={value}>{children}</BankingContext.Provider>;
}

export function useBanking() {
  const value = useContext(BankingContext);
  if (!value) throw new Error('useBanking debe usarse dentro de BankingProvider.');
  return value;
}
