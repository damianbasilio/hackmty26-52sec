import type {
  Account,
  AnomalyAlert,
  CashflowForecast,
  CashflowScore,
  Customer,
  EnrichedTransaction,
  IssuedChallenge,
  SavingsRule,
  Shield,
  ShieldAlert,
  ShieldResolution,
  Subscription,
  Verification,
  VerificationPurpose,
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
  TransferDraft,
  TransferRecipient,
} from './DataSource';
import { splitShareTransferId } from './DataSource';
import { getSupabase, supabase } from '../supabase';

/** Un engine colgado no debe dejar la pantalla cargando para siempre. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Mover dinero real toca Nessie dos veces; tarda más que una lectura. */
const TRANSFER_TIMEOUT_MS = 25_000;

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

/** El engine manda su propio texto en español dentro de `detail`. */
function readDetail(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  // 422 de pydantic: lista de errores por campo, no sirve para el usuario.
  return null;
}

/**
 * Dos transportes, a propósito.
 *
 * El dinero pasa por el engine: es el único que puede llamar a Nessie, el que
 * aplica retiro y depósito, y el que reconcilia por `id` para que un reintento
 * no cobre dos veces. Los motores (suscripciones, anomalías, score, ahorro) se
 * leen por ahí mismo.
 *
 * Las divisiones van directo a Supabase bajo RLS, que es donde viven el RPC
 * join_split() y las publications de Realtime: el engine no puede empujar un
 * evento al teléfono de quien se unió.
 *
 * Nunca apuntes esto a api.nessieisreal.com: es HTTP plano, iOS ATS lo bloquea.
 */
export class ApiDataSource implements DataSource {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
    body?: unknown,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    // Sin `new URL`: el polyfill de React Native resuelve rutas relativas con
    // un endsWith que se come el path cuando la base es un túnel.
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.baseUrl.replace(/\/+$/, '')}${path}${query ? `?${query}` : ''}`;
    // El engine sabe quién eres por este token, no por un cliente fijo: sin él responde 401.
    const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        throw new Error('El servidor tardó demasiado en responder. Revisa tu conexión.');
      }
      throw new Error('No pudimos conectarnos con el servidor. Revisa tu conexión.');
    } finally {
      clearTimeout(timer);
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(readDetail(payload) ?? `${res.status} ${res.statusText} en ${path}`);
    }
    return payload as T;
  }

  private get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    return this.request<T>('GET', path, params);
  }

  private post<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    return this.request<T>('POST', path, params);
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

  createSavingsAccount(nickname: string): Promise<Account> {
    return this.request<Account>('POST', '/accounts', {}, { nickname: nickname.trim() });
  }

  // El engine es quien mueve el dinero: hace el retiro y el depósito en Nessie
  // y deja la fila en `transfers`. Es idempotente por `id`, así que reenviar el
  // mismo borrador reconcilia en vez de cobrar dos veces.

  async getRecipients(accountId: string): Promise<TransferRecipient[]> {
    const [accounts, previous] = await Promise.all([
      this.getAccounts(),
      this.getTransfers(accountId),
    ]);

    const recipients: TransferRecipient[] = accounts
      .filter((account) => account.id !== accountId)
      .map((account) => ({
        id: `own_${account.id}`,
        name: account.nickname,
        bank: 'Capital One',
        last_four: account.last_four,
        clabe: account.clabe,
        account_id: account.id,
      }));

    // Solo se vuelve a enviar a quien tiene CLABE guardada: un nombre y cuatro dígitos no llegan a ninguna cuenta.
    const seen = new Set(recipients.map((r) => r.clabe));
    for (const transfer of previous) {
      if (!transfer.payee_clabe || seen.has(transfer.payee_clabe)) continue;
      seen.add(transfer.payee_clabe);
      recipients.push({
        id: `payee_${transfer.payee_clabe}`,
        name: transfer.payee_name,
        bank: transfer.payee_bank,
        last_four: transfer.payee_last_four,
        clabe: transfer.payee_clabe,
        account_id: null,
      });
    }
    return recipients;
  }

  getTransfers(accountId: string): Promise<Transfer[]> {
    return this.get<Transfer[]>('/transfers', { account_id: accountId });
  }

  createTransfer(draft: TransferDraft): Promise<Transfer> {
    return this.request<Transfer>(
      'POST',
      '/transfers',
      {},
      {
        id: draft.id,
        account_id: draft.accountId,
        // Con CLABE el engine encuentra la cuenta; el id solo vale para cuentas propias.
        payee_account_id: draft.recipient.clabe ? null : draft.recipient.account_id,
        payee_clabe: draft.recipient.clabe,
        payee_name: draft.recipient.name,
        payee_bank: draft.recipient.bank,
        payee_last_four: draft.recipient.last_four,
        amount_cents: draft.amountCents,
        concept: draft.concept,
      },
      TRANSFER_TIMEOUT_MS,
    );
  }

  // -------------------------------------------------------------------------
  // Divisiones. Van por Supabase, no por el engine: ahí viven el RPC
  // join_split() y las publications de Realtime. El pago de cada parte sí
  // vuelve al engine, por createTransfer.
  // -------------------------------------------------------------------------

  /** El id que ve la RLS. No sirve el de /customers/me: el engine va con service_role. */
  private async currentCustomerId(): Promise<string> {
    const { data, error } = await getSupabase().from('customers').select('id').limit(1).maybeSingle();
    if (error) fail(error, 'No pudimos identificar tu cliente.');
    if (!data) throw new Error('Tu usuario no está ligado a ningún cliente. Revisa db/link_auth_user.sql.');
    return data.id as string;
  }
  async createSplit({ accountId, totalCents, title }: CreateSplitInput): Promise<Split> {
    if (totalCents <= 0) throw new Error('El total de la división tiene que ser mayor a cero.');
    const supabase = getSupabase();
    const createdBy = await this.currentCustomerId();
    const splitId = newId('spl');
    // La RLS rechazaría el insert con una cuenta ajena: se valida contra las tuyas.
    const { data: ownAccounts, error: accountsError } = await supabase.from('accounts').select('id, type');
    if (accountsError) fail(accountsError, 'No pudimos leer tus cuentas.');
    const own = ownAccounts ?? [];
    const chargeAccountId = own.some((account) => account.id === accountId)
      ? accountId
      : (own.find((account) => account.type === 'checking') ?? own[0])?.id;
    if (!chargeAccountId) throw new Error('No hay ninguna cuenta para cargar tu parte.');

    // El índice único parcial sobre `code` solo cubre divisiones abiertas, así
    // que un choque es posible y esperado: se reintenta con otro código.
    let request: SplitRequest | null = null;
    for (let attempt = 0; attempt < 5 && !request; attempt += 1) {
      const { data, error } = await supabase
        .from('split_requests')
        .insert({
          id: splitId,
          account_id: chargeAccountId,
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
      // El anfitrión ya pagó la cuenta completa: recibe las partes, no paga la suya.
      paid_at: new Date().toISOString(),
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
    const split = await this.getSplit(splitId);
    const person = split.participants.find((candidate) => candidate.id === participantId);
    if (!person) throw new Error('No encontramos tu parte en esta división.');
    if (person.paid) return split;

    const accounts = await this.getAccounts();
    const payer = accounts.find((account) => account.type === 'checking') ?? accounts[0];
    if (!payer) throw new Error('No hay ninguna cuenta para pagar tu parte.');

    // La cuenta del anfitrión no es tuya y la RLS no te deja verla: el engine
    // hace la transferencia hacia ella y marca paid_at en el mismo paso. El id
    // sale del participante, así un reintento nunca cobra la parte dos veces.
    const { transfer } = await this.request<{ transfer: Transfer }>(
      'POST',
      `/splits/${splitId}/participants/${participantId}/pay`,
      {},
      { transfer_id: splitShareTransferId(participantId), account_id: payer.id },
      TRANSFER_TIMEOUT_MS,
    );
    if (transfer.status !== 'completed') {
      throw new Error(transfer.failure_reason ?? 'No pudimos pagar tu parte.');
    }
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

  // -------------------------------------------------------------------------
  // Mi dinero y Escudo. El estado del Escudo vive en la memoria del engine.
  // -------------------------------------------------------------------------

  getForecast(accountId: string): Promise<CashflowForecast> {
    return this.get<CashflowForecast>('/forecast', { account_id: accountId });
  }

  getShield(): Promise<Shield> {
    return this.get<Shield>('/shield');
  }

  getShieldAlerts(includeResolved = false): Promise<ShieldAlert[]> {
    return this.get<ShieldAlert[]>('/shield/alerts', { include_resolved: includeResolved });
  }

  resolveShieldAlert(
    alertId: string,
    resolution: NonNullable<ShieldAlert['resolution']>,
    verification?: Verification,
  ): Promise<ShieldResolution> {
    return this.request<ShieldResolution>('POST', `/shield/alerts/${alertId}/resolve`, {}, { resolution, ...verification });
  }

  lockCard(): Promise<Shield> {
    return this.post<Shield>('/shield/lock-card');
  }

  releaseShield(verification: Verification): Promise<Shield> {
    return this.request<Shield>('POST', '/shield/release', {}, verification);
  }

  setAutoProtect(enabled: boolean, verification?: Verification): Promise<Shield> {
    return this.request<Shield>('PATCH', '/shield/settings', {}, { auto_protect: enabled, ...verification });
  }

  requestChallenge(purpose: VerificationPurpose, target: string): Promise<IssuedChallenge> {
    return this.request<IssuedChallenge>('POST', '/shield/challenges', {}, { purpose, target });
  }
}
