import type {
  Account,
  AnomalyAlert,
  CashflowScore,
  Customer,
  EnrichedTransaction,
  SavingsRule,
  Subscription,
} from '@contracts/types';
import type { PostgrestError } from '@supabase/supabase-js';

import type {
  CreateSplitInput,
  DataSource,
  Split,
  SplitParticipant,
  SplitRequest,
  TransactionQuery,
  Transfer,
  TransferInput,
} from './DataSource';
import { getSupabase } from './supabase';

const CODE_TTL_MS = 15 * 60 * 1000;
/** Colisión de llave única: otra división abierta ya tomó ese código. */
const UNIQUE_VIOLATION = '23505';

function randomHex(length: number): string {
  let out = '';
  while (out.length < length) {
    out += Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  }
  return out.slice(0, length);
}

function newId(prefix: string): string {
  return `${prefix}_${randomHex(32)}`;
}

function fourDigitCode(): string {
  return String(Math.floor(Math.random() * 9000) + 1000);
}

function fail(error: PostgrestError, fallback: string): never {
  throw new Error(error.message || fallback);
}

/**
 * Dos transportes, a propósito. Los motores (suscripciones, anomalías, score,
 * ahorro) los calcula el engine y se leen por HTTPS. Lo que el usuario *hace*
 * —transferencias y divisiones— va directo a Supabase bajo RLS, que es donde
 * el carril A puso las policies, el RPC join_split() y las publications de
 * Realtime.
 *
 * Nunca apuntes esto a api.nessieisreal.com: es HTTP plano, iOS ATS lo bloquea,
 * y el engine es el único que puede llamar a Nessie.
 */
export class ApiDataSource implements DataSource {
  constructor(private readonly baseUrl: string) {}

  private async get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} en ${path}`);
    return (await res.json()) as T;
  }

  private async post<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), { method: 'POST', headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} en ${path}`);
    return (await res.json()) as T;
  }

  getCustomer(): Promise<Customer> {
    return this.get<Customer>('/customers/me');
  }

  getAccounts(): Promise<Account[]> {
    return this.get<Account[]>('/accounts');
  }

  getTransactions({ accountId, from, to, limit }: TransactionQuery): Promise<EnrichedTransaction[]> {
    return this.get<EnrichedTransaction[]>('/transactions', { account_id: accountId, from, to, limit });
  }

  getSubscriptions(accountId: string): Promise<Subscription[]> {
    return this.get<Subscription[]>('/subscriptions', { account_id: accountId });
  }

  getAlerts(accountId: string, includeResolved = false): Promise<AnomalyAlert[]> {
    return this.get<AnomalyAlert[]>('/anomalies', { account_id: accountId, include_resolved: includeResolved });
  }

  getScore(accountId: string): Promise<CashflowScore> {
    return this.get<CashflowScore>('/score', { account_id: accountId });
  }

  getSavingsRules(accountId: string): Promise<SavingsRule[]> {
    return this.get<SavingsRule[]>('/savings/rules', { account_id: accountId });
  }

  async resolveAlert(alertId: string, resolution: NonNullable<AnomalyAlert['resolution']>): Promise<void> {
    await this.post(`/anomalies/${alertId}/resolve`, { resolution });
  }

  async activateSavingsRule(ruleId: string, destinationAccountId: string): Promise<void> {
    await this.post(`/savings/rules/${ruleId}/activate`, { destination_account_id: destinationAccountId });
  }

  // -------------------------------------------------------------------------
  // Lo que el usuario hace. Supabase, no el engine.
  // -------------------------------------------------------------------------

  /** El id que ve la RLS. No sirve el de /customers/me: el engine va con service_role. */
  private async currentCustomerId(): Promise<string> {
    const { data, error } = await getSupabase().from('customers').select('id').limit(1).maybeSingle();
    if (error) fail(error, 'No pudimos identificar tu cliente.');
    if (!data) throw new Error('Tu usuario no está ligado a ningún cliente. Revisa db/link_auth_user.sql.');
    return data.id as string;
  }

  async sendTransfer(input: TransferInput): Promise<Transfer> {
    // Nace en `pending`: el engine la manda a Nessie y mueve el estado. La app
    // no tiene policy de update aquí, y así no puede darse por pagada sola.
    const { data, error } = await getSupabase()
      .from('transfers')
      .insert({
        id: newId('trf'),
        account_id: input.accountId,
        payee_name: input.payeeName,
        payee_bank: input.payeeBank ?? null,
        payee_last_four: input.payeeLastFour ?? null,
        amount_cents: input.amountCents,
        concept: input.concept ?? '',
      })
      .select()
      .single();
    if (error) fail(error, 'No pudimos registrar la transferencia.');
    return data as Transfer;
  }

  async getTransfers(accountId: string): Promise<Transfer[]> {
    const { data, error } = await getSupabase()
      .from('transfers')
      .select()
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });
    if (error) fail(error, 'No pudimos leer tus transferencias.');
    return (data ?? []) as Transfer[];
  }

  async createSplit({ accountId, totalCents, title }: CreateSplitInput): Promise<Split> {
    if (totalCents <= 0) throw new Error('El total de la división tiene que ser mayor a cero.');
    const supabase = getSupabase();
    const createdBy = await this.currentCustomerId();
    const splitId = newId('spl');

    // El índice único parcial sobre `code` solo cubre divisiones abiertas, así
    // que un choque es posible y esperado: se reintenta con otro código.
    let request: SplitRequest | null = null;
    for (let attempt = 0; attempt < 5 && !request; attempt += 1) {
      const { data, error } = await supabase
        .from('split_requests')
        .insert({
          id: splitId,
          account_id: accountId,
          created_by: createdBy,
          title: title ?? '',
          total_cents: totalCents,
          code: fourDigitCode(),
          code_expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
        })
        .select()
        .single();
      if (!error) {
        request = data as SplitRequest;
      } else if (error.code !== UNIQUE_VIOLATION) {
        fail(error, 'No pudimos crear la división.');
      }
    }
    if (!request) throw new Error('Todos los códigos están ocupados. Inténtalo de nuevo.');

    const { data: me, error: meError } = await supabase
      .from('customers')
      .select('first_name, last_name')
      .eq('id', createdBy)
      .single();
    if (meError) fail(meError, 'No pudimos leer tu nombre.');

    const { error: participantError } = await supabase.from('split_participants').insert({
      id: newId('spp'),
      split_request_id: request.id,
      customer_id: createdBy,
      display_name: `${me.first_name} ${me.last_name}`.trim(),
      share_cents: totalCents,
      is_creator: true,
    });
    if (participantError) fail(participantError, 'No pudimos agregarte a la división.');

    return this.getSplit(request.id);
  }

  async getSplit(splitId: string): Promise<Split> {
    const supabase = getSupabase();
    const [{ data: request, error: requestError }, { data: participants, error: participantsError }] =
      await Promise.all([
        supabase.from('split_requests').select().eq('id', splitId).single(),
        supabase
          .from('split_participants')
          .select()
          .eq('split_request_id', splitId)
          .order('joined_at', { ascending: true }),
      ]);
    if (requestError) fail(requestError, 'No pudimos leer la división.');
    if (participantsError) fail(participantsError, 'No pudimos leer a los participantes.');
    return {
      request: request as SplitRequest,
      participants: (participants ?? []) as SplitParticipant[],
    };
  }

  async joinSplitByCode(code: string, displayName: string): Promise<Split> {
    // Unirse no pasa por RLS: quien se une todavía no es participante y el
    // código no es columna de la fila. Por eso es una función definer.
    const { data, error } = await getSupabase()
      .rpc('join_split', { join_code: code, joiner_name: displayName })
      .single();
    if (error) fail(error, `El código ${code} no corresponde a ninguna división activa.`);
    return this.getSplit((data as { split_id: string }).split_id);
  }

  async addSplitGuest(splitId: string, displayName: string): Promise<Split> {
    const supabase = getSupabase();
    // customer_id null: alguien que no banquea aquí. El índice único de
    // participante por cliente trata los nulos como distintos, que es lo que
    // queremos para gente que no podemos identificar.
    const { error } = await supabase.from('split_participants').insert({
      id: newId('spp'),
      split_request_id: splitId,
      customer_id: null,
      display_name: displayName,
    });
    if (error) fail(error, 'No pudimos agregar a esa persona.');
    const { error: rebalanceError } = await supabase.rpc('rebalance_split', { target_split_id: splitId });
    if (rebalanceError) fail(rebalanceError, 'No pudimos repartir de nuevo las partes.');
    return this.getSplit(splitId);
  }

  async paySplitShare(splitId: string, participantId: string): Promise<Split> {
    const supabase = getSupabase();
    const split = await this.getSplit(splitId);
    const person = split.participants.find((candidate) => candidate.id === participantId);
    if (!person) throw new Error('No encontramos tu parte en esta división.');
    if (person.paid) return split;

    const transfer = await this.sendTransfer({
      accountId: split.request.account_id,
      payeeName: split.request.title || 'División de gasto',
      amountCents: person.share_cents,
      concept: `Mi parte de la división ${split.request.code}`,
    });

    // Solo paid_at y transfer_id están concedidas: share_cents no se puede tocar
    // desde el cliente, así que nadie se baja su parte antes de pagar.
    const { error } = await supabase
      .from('split_participants')
      .update({ paid_at: new Date().toISOString(), transfer_id: transfer.id })
      .eq('id', participantId);
    if (error) fail(error, 'No pudimos marcar tu parte como pagada.');

    return this.getSplit(splitId);
  }

  subscribeToSplit(splitId: string, onChange: (split: Split) => void): () => void {
    const supabase = getSupabase();
    const refresh = () => {
      this.getSplit(splitId).then(onChange).catch(() => {
        // Un evento perdido no rompe la pantalla: el siguiente vuelve a leer.
      });
    };
    const channel = supabase
      .channel(`division-${splitId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'split_participants', filter: `split_request_id=eq.${splitId}` },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'split_requests', filter: `id=eq.${splitId}` },
        refresh,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }

  subscribeToAlerts(accountId: string, onInsert: (alert: AnomalyAlert) => void): () => void {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`alertas-${accountId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'anomaly_alerts', filter: `account_id=eq.${accountId}` },
        (payload) => onInsert(payload.new as AnomalyAlert),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }
}
