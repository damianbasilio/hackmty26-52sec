import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

export type TransferRecipient = {
  id: string;
  name: string;
  initials: string;
  bank: string;
  accountLastFour: string;
  color: string;
};

export type TransferReceipt = {
  id: string;
  recipient: TransferRecipient;
  amountCents: number;
  concept: string;
  createdAt: string;
};

export const TRANSFER_RECIPIENTS: TransferRecipient[] = [
  { id: 'recipient_mariana', name: 'Mariana Ríos', initials: 'MR', bank: 'Capital One', accountLastFour: '1048', color: '#E3F0FA' },
  { id: 'recipient_diego', name: 'Diego Garza', initials: 'DG', bank: 'Capital One', accountLastFour: '7812', color: '#FCE7E5' },
  { id: 'recipient_luis', name: 'Luis Mendoza', initials: 'LM', bank: 'Otro banco', accountLastFour: '3390', color: '#E7F4EB' },
];

type BankingContextValue = {
  transfers: TransferReceipt[];
  outgoingCents: number;
  sendTransfer: (input: Omit<TransferReceipt, 'id' | 'createdAt'>) => Promise<TransferReceipt>;
};

const BankingContext = createContext<BankingContextValue | null>(null);

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function BankingProvider({ children }: PropsWithChildren) {
  const [transfers, setTransfers] = useState<TransferReceipt[]>([]);

  const sendTransfer = useCallback(async (input: Omit<TransferReceipt, 'id' | 'createdAt'>) => {
    await wait(680);
    const receipt: TransferReceipt = {
      ...input,
      id: `transfer_${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setTransfers((current) => [receipt, ...current]);
    return receipt;
  }, []);

  const value = useMemo<BankingContextValue>(() => ({
    transfers,
    outgoingCents: transfers.reduce((sum, transfer) => sum + transfer.amountCents, 0),
    sendTransfer,
  }), [sendTransfer, transfers]);

  return <BankingContext.Provider value={value}>{children}</BankingContext.Provider>;
}

export function useBanking() {
  const value = useContext(BankingContext);
  if (!value) throw new Error('useBanking debe usarse dentro de BankingProvider.');
  return value;
}
