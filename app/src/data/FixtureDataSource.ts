import type {
  Account,
  AnomalyAlert,
  CashflowScore,
  Customer,
  EnrichedTransaction,
  SavingsRule,
  Subscription,
} from '@contracts/types';

import accountsJson from '@contracts/fixtures/accounts.json';
import alertsJson from '@contracts/fixtures/anomaly_alerts.json';
import customersJson from '@contracts/fixtures/customers.json';
import enrichedJson from '@contracts/fixtures/enriched_transactions.json';
import rulesJson from '@contracts/fixtures/savings_rules.json';
import scoresJson from '@contracts/fixtures/cashflow_scores.json';
import subscriptionsJson from '@contracts/fixtures/subscriptions.json';

import type {
  CreateSplitInput,
  DataSource,
  Split,
  SplitParticipant,
  SplitRequest,
  TransactionQuery,
  Transfer,
  TransferDraft,
  TransferRecipient,
} from './DataSource';
import { splitShareTransferId } from './DataSource';
import { sharesFor } from './shares';

const customers = customersJson as Customer[];
const accounts = accountsJson as Account[];
const transactions = enrichedJson as EnrichedTransaction[];
const subscriptions = subscriptionsJson as Subscription[];
const alerts = alertsJson as AnomalyAlert[];
const scores = scoresJson as CashflowScore[];
const rules = rulesJson as SavingsRule[];

/** Mutations only live in memory; a reload resets them. Good enough for the demo. */
const resolved = new Map<string, NonNullable<AnomalyAlert['resolution']>>();
const activated = new Map<string, { accountId: string; at: string }>();
const sentTransfers: Transfer[] = [];

const CODE_TTL_MS = 15 * 60 * 1000;

const splitRequests = new Map<string, SplitRequest>();
const splitParticipants = new Map<string, SplitParticipant[]>();
const transfers: Transfer[] = [];
const splitListeners = new Map<string, Set<(split: Split) => void>>();

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}_demo_${String(sequence).padStart(4, '0')}`;
}

/** Cuatro dígitos sin chocar con otra división abierta: igual que el índice parcial. */
function freeCode(): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = String(Math.floor(Math.random() * 9000) + 1000);
    const taken = [...splitRequests.values()].some(
      (request) => request.code === candidate && request.status === 'open',
    );
    if (!taken) return candidate;
  }
  throw new Error('No pudimos generar un código libre para la división.');
}

/** Espeja rebalance_split(): partes iguales y el sobrante a quien llegó primero. */
function rebalance(splitId: string): void {
  const request = splitRequests.get(splitId);
  const people = splitParticipants.get(splitId);
  if (!request || !people || people.length === 0) return;
  const amounts = sharesFor(request.total_cents, people.length);
  people.forEach((person, index) => {
    person.share_cents = amounts[index];
  });
}

function snapshot(splitId: string): Split {
  const request = splitRequests.get(splitId);
  if (!request) throw new Error(`La división ${splitId} ya no existe.`);
  return {
    request: { ...request },
    participants: (splitParticipants.get(splitId) ?? []).map((person) => ({ ...person })),
  };
}

function emit(splitId: string): void {
  const listeners = splitListeners.get(splitId);
  if (!listeners) return;
  const current = snapshot(splitId);
  listeners.forEach((listener) => listener(current));
}

function newParticipant(splitId: string, displayName: string): SplitParticipant {
  return {
    id: nextId('spp'),
    split_request_id: splitId,
    customer_id: null,
    display_name: displayName,
    share_cents: 0,
    is_creator: false,
    paid: false,
    paid_at: null,
    transfer_id: null,
    joined_at: new Date().toISOString(),
  };
}

export class FixtureDataSource implements DataSource {
  async getCustomer(): Promise<Customer> {
    return customers[0];
  }

  async getAccounts(): Promise<Account[]> {
    // Copia: con la misma referencia los useMemo no ven la cuenta nueva.
    // El abono de una transferencia a cuenta propia se suma aquí; el cargo lo
    // aplica la pantalla con outgoingCents. Sin esto el dinero desaparecía.
    return accounts.map((account) => {
      const incoming = sentTransfers
        .filter((transfer) => transfer.payee_account_id === account.id)
        .reduce((sum, transfer) => sum + transfer.amount_cents, 0);
      return incoming === 0 ? { ...account } : { ...account, balance_cents: account.balance_cents + incoming };
    });
  }

  async getTransactions({ accountId, from, to, limit }: TransactionQuery): Promise<EnrichedTransaction[]> {
    const out = transactions
      .filter((t) => t.account_id === accountId)
      .filter((t) => (from ? t.occurred_at.slice(0, 10) >= from : true))
      .filter((t) => (to ? t.occurred_at.slice(0, 10) <= to : true))
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    return limit ? out.slice(0, limit) : out;
  }

  async getSubscriptions(accountId: string): Promise<Subscription[]> {
    return subscriptions
      .filter((s) => s.account_id === accountId)
      .sort((a, b) => b.annual_cost_cents - a.annual_cost_cents);
  }

  async getAlerts(accountId: string, includeResolved = false): Promise<AnomalyAlert[]> {
    return alerts
      .filter((a) => a.account_id === accountId)
      .map((a) => (resolved.has(a.id) ? { ...a, resolution: resolved.get(a.id)!, resolved_at: new Date().toISOString() } : a))
      .filter((a) => includeResolved || !a.resolved_at)
      .sort((a, b) => b.score - a.score);
  }

  async getScore(accountId: string): Promise<CashflowScore> {
    const score = scores.find((s) => s.account_id === accountId);
    if (!score) throw new Error(`No hay score en fixtures para la cuenta ${accountId}`);
    return score;
  }

  async getSavingsRules(accountId: string): Promise<SavingsRule[]> {
    return rules
      .filter((r) => r.account_id === accountId)
      .map((r) => {
        const destination = activated.get(r.id);
        return destination
          ? { ...r, status: 'active' as const, destination_account_id: destination.accountId, activated_at: destination.at }
          : r;
      });
  }

  async resolveAlert(alertId: string, resolution: NonNullable<AnomalyAlert['resolution']>): Promise<void> {
    resolved.set(alertId, resolution);
  }

  async activateSavingsRule(ruleId: string, destinationAccountId: string): Promise<void> {
    activated.set(ruleId, { accountId: destinationAccountId, at: new Date().toISOString() });
  }

  async createSavingsAccount(nickname: string): Promise<Account> {
    const name = nickname.trim();
    if (!name) throw new Error('Ponle un nombre a tu cuenta de ahorro.');
    if (accounts.some((account) => account.nickname.toLowerCase() === name.toLowerCase())) {
      throw new Error('Ya tienes una cuenta con ese nombre.');
    }
    const account: Account = {
      id: nextId('acc_savings'),
      customer_id: customers[0].id,
      nickname: name,
      type: 'savings',
      last_four: String(Math.floor(Math.random() * 9000) + 1000),
      balance_cents: 0,
      currency: 'MXN',
      nessie_account_id: null,
      created_at: new Date().toISOString(),
    };
    accounts.push(account);
    return account;
  }

  async getRecipients(accountId: string): Promise<TransferRecipient[]> {
    const own: TransferRecipient[] = accounts
      .filter((account) => account.id !== accountId)
      .map((account) => ({
        id: `own_${account.id}`,
        name: account.nickname,
        bank: 'Capital One',
        last_four: account.last_four,
        account_id: account.id,
      }));
    const seen = new Set(own.map((r) => `${r.name}|${r.last_four ?? ''}`));
    for (const transfer of sentTransfers.filter((t) => t.account_id === accountId)) {
      const key = `${transfer.payee_name}|${transfer.payee_last_four ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      own.push({
        id: `payee_${key}`,
        name: transfer.payee_name,
        bank: transfer.payee_bank,
        last_four: transfer.payee_last_four,
        account_id: transfer.payee_account_id,
      });
    }
    return own;
  }

  async getTransfers(accountId: string): Promise<Transfer[]> {
    return sentTransfers.filter((transfer) => transfer.account_id === accountId);
  }

  async createTransfer(draft: TransferDraft): Promise<Transfer> {
    // Misma llave, misma transferencia: un reintento no cobra de nuevo.
    const already = sentTransfers.find((transfer) => transfer.id === draft.id);
    if (already) return already;
    const now = new Date().toISOString();
    const transfer: Transfer = {
      id: draft.id,
      account_id: draft.accountId,
      payee_account_id: draft.recipient.account_id,
      payee_name: draft.recipient.name,
      payee_bank: draft.recipient.bank,
      payee_last_four: draft.recipient.last_four,
      amount_cents: draft.amountCents,
      concept: draft.concept,
      // El engine real aplica el retiro y el depósito de una vez; los fixtures
      // imitan ese resultado para que la pantalla se vea igual sin backend.
      status: 'completed',
      failure_reason: null,
      created_at: now,
      completed_at: now,
    };
    sentTransfers.unshift(transfer);
    return transfer;
  }

  async createSplit({ accountId, totalCents, title }: CreateSplitInput): Promise<Split> {
    if (totalCents <= 0) throw new Error('El total de la división tiene que ser mayor a cero.');
    const owner = customers[0];
    const now = new Date();
    const request: SplitRequest = {
      id: nextId('spl'),
      account_id: accountId,
      created_by: owner.id,
      title: title ?? '',
      total_cents: totalCents,
      code: freeCode(),
      code_expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
      status: 'open',
      created_at: now.toISOString(),
      settled_at: null,
    };
    splitRequests.set(request.id, request);
    splitParticipants.set(request.id, [{
      ...newParticipant(request.id, `${owner.first_name} ${owner.last_name}`.trim()),
      customer_id: owner.id,
      share_cents: totalCents,
      is_creator: true,
    }]);
    return snapshot(request.id);
  }

  async getSplit(splitId: string): Promise<Split> {
    return snapshot(splitId);
  }

  async joinSplitByCode(code: string, displayName: string): Promise<Split> {
    const request = [...splitRequests.values()].find(
      (candidate) => candidate.code === code && candidate.status === 'open',
    );
    if (!request) throw new Error(`El código ${code} no corresponde a ninguna división activa.`);
    if (new Date(request.code_expires_at).getTime() <= Date.now()) {
      throw new Error('El código de la división ya expiró. Pídele al anfitrión uno nuevo.');
    }
    const people = splitParticipants.get(request.id) ?? [];
    if (!people.some((person) => person.display_name === displayName)) {
      people.push(newParticipant(request.id, displayName));
      splitParticipants.set(request.id, people);
      rebalance(request.id);
    }
    emit(request.id);
    return snapshot(request.id);
  }

  async addSplitGuest(splitId: string, displayName: string): Promise<Split> {
    const people = splitParticipants.get(splitId);
    if (!people) throw new Error(`La división ${splitId} ya no existe.`);
    people.push(newParticipant(splitId, displayName));
    rebalance(splitId);
    emit(splitId);
    return snapshot(splitId);
  }

  async paySplitShare(splitId: string, participantId: string): Promise<Split> {
    const request = splitRequests.get(splitId);
    const people = splitParticipants.get(splitId);
    if (!request || !people) throw new Error(`La división ${splitId} ya no existe.`);
    const person = people.find((candidate) => candidate.id === participantId);
    if (!person) throw new Error('No encontramos tu parte en esta división.');
    if (!person.paid) {
      const transfer = await this.createTransfer({
        id: splitShareTransferId(participantId),
        accountId: request.account_id,
        recipient: {
          id: `split_${request.id}`,
          name: request.title || 'División de gasto',
          bank: null,
          last_four: null,
          account_id: null,
        },
        amountCents: person.share_cents,
        concept: `Mi parte de la división ${request.code}`,
      });
      person.paid_at = transfer.created_at;
      person.paid = true;
      person.transfer_id = transfer.id;
      if (people.every((candidate) => candidate.paid)) {
        request.status = 'settled';
        request.settled_at = transfer.created_at;
      }
    }
    emit(splitId);
    return snapshot(splitId);
  }

  subscribeToSplit(splitId: string, onChange: (split: Split) => void): () => void {
    const listeners = splitListeners.get(splitId) ?? new Set<(split: Split) => void>();
    listeners.add(onChange);
    splitListeners.set(splitId, listeners);
    return () => {
      listeners.delete(onChange);
      if (listeners.size === 0) splitListeners.delete(splitId);
    };
  }

  /** Los fixtures son un corte fijo: no nacen alertas nuevas mientras la app corre. */
  subscribeToAlerts(): () => void {
    return () => {};
  }
}
