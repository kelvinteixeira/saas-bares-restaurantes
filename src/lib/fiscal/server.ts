// Só no servidor (route handlers em src/app/api/fiscal). Usa a chave secreta do Supabase para gravar
// as notas: nenhum funcionário grava nota direto, só pede ao servidor, que confere tudo de novo.
// SUPABASE_SERVICE_ROLE_KEY e o token do emissor não têm NEXT_PUBLIC_: nunca vão para o navegador.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildNfce, buildTabNfce, canCancelNfce, FiscalError, nfceProblems, validCancelReason, type NfcePayload } from "@/lib/domain/fiscal";
import type { FiscalProvider } from "@/lib/fiscal/provider";
import { simulator } from "@/lib/fiscal/simulator";
import {
  rowToFiscalDocument,
  rowToOrder,
  rowToPayment,
  rowToProduct,
  rowToStore,
  rowToStoreFiscal,
  rowToTab,
  type TabRow,
  type FiscalDocumentRow,
  type OrderRow,
  type PaymentRow,
  type ProductRow,
  type StoreFiscalRow,
  type StoreRow,
} from "@/lib/store/mappers";
import type { FiscalDocument, StoreFiscal } from "@/lib/types";

if (typeof window !== "undefined") throw new Error("src/lib/fiscal/server.ts é só do servidor.");

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Emissor configurado no servidor (FISCAL_PROVIDER). Sem escolha, o simulador. */
export function getProvider(): FiscalProvider {
  const name = (process.env.FISCAL_PROVIDER ?? "simulador").toLowerCase();
  if (name === "simulador") return simulator;
  throw new HttpError(500, `O emissor fiscal "${name}" ainda não está ligado na Comanda.`);
}

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) throw new HttpError(500, "O servidor não está configurado para emitir notas.");
  return { url, anon, service };
}

/** Cliente com o login de quem pediu: lê só o que as regras (RLS) deixam essa pessoa ler. */
async function asUser(token: string | null): Promise<{ sb: SupabaseClient; userId: string }> {
  if (!token) throw new HttpError(401, "Entre na sua conta para emitir notas.");
  const { url, anon } = env();
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sua sessão expirou. Entre de novo.");
  return { sb, userId: data.user.id };
}

function admin(): SupabaseClient {
  const { url, service } = env();
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireCashier(sb: SupabaseClient, storeId: string, userId: string) {
  const { data } = await sb.from("store_members").select("role").eq("store_id", storeId).eq("user_id", userId).maybeSingle<{ role: string }>();
  if (!data || !["owner", "manager", "cashier"].includes(data.role)) {
    throw new HttpError(403, "Só o caixa, o gerente ou o dono emitem e cancelam notas.");
  }
}

const missingTable = (code?: string) => code === "PGRST205" || code === "42P01";
const SETUP = "A NFC-e ainda não está ligada no banco. Rode o arquivo supabase/migrations/012_nfce.sql no Supabase.";

const SETUP_TAB = "A nota da mesa ainda não está ligada no banco. Rode o arquivo supabase/migrations/013_nfce_mesa.sql no Supabase.";

/** Lê os dados fiscais e a loja, e confere se o emissor pode emitir no ambiente escolhido. */
async function fiscalContext(sb: SupabaseClient, storeId: string) {
  const [fiscalRes, storeRes, productsRes] = await Promise.all([
    sb.from("store_fiscal").select("*").eq("store_id", storeId).maybeSingle<StoreFiscalRow>(),
    sb.from("stores").select("*").eq("id", storeId).single<StoreRow>(),
    sb.from("products").select("*").eq("store_id", storeId),
  ]);
  if (missingTable(fiscalRes.error?.code)) throw new HttpError(409, SETUP);
  if (storeRes.error || !storeRes.data) {
    console.error("NFC-e: ler a loja", storeRes.error?.code, storeRes.error?.message);
    throw new HttpError(500, "Não foi possível ler a loja.");
  }
  return {
    fiscal: fiscalRes.data ? rowToStoreFiscal(fiscalRes.data) : null,
    store: rowToStore(storeRes.data),
    products: ((productsRes.data ?? []) as ProductRow[]).map(rowToProduct),
  };
}

function checkProvider(fiscal: StoreFiscal): FiscalProvider {
  const provider = getProvider();
  if (fiscal.environment === "producao" && !provider.production) {
    throw new HttpError(422, "O emissor fiscal ainda não foi escolhido: a emissão em produção fica bloqueada. Use homologação.");
  }
  return provider;
}

function build<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof FiscalError) throw new HttpError(422, err.message);
    throw err;
  }
}

/** Reserva a nota (o índice único barra duas notas ativas para o mesmo pedido ou comanda), chama o emissor e grava. */
async function reserveAndEmit(
  storeId: string,
  target: { order_id: string } | { tab_id: string },
  fiscal: StoreFiscal,
  provider: FiscalProvider,
  payload: NfcePayload,
): Promise<FiscalDocument> {
  const db = admin();
  const { data: last } = await db
    .from("fiscal_documents")
    .select("number")
    .eq("store_id", storeId)
    .eq("environment", fiscal.environment)
    .eq("provider", provider.name)
    .not("number", "is", null)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle<{ number: number }>();
  const number = (last?.number ?? 0) + 1;
  const { data: reserved, error: reserveError } = await db
    .from("fiscal_documents")
    .insert({
      store_id: storeId,
      ...target,
      environment: fiscal.environment,
      provider: provider.name,
      status: "processing",
      total: payload.total,
      cpf: payload.consumerCpf ?? null,
    })
    .select()
    .single<FiscalDocumentRow>();
  const isTab = "tab_id" in target;
  if (reserveError?.code === "23505") {
    throw new HttpError(409, isTab ? "Esta comanda já tem uma nota emitida ou em processamento." : "Este pedido já tem uma nota emitida ou em processamento.");
  }
  if (missingTable(reserveError?.code)) throw new HttpError(409, SETUP);
  // Coluna tab_id ainda não existe (SQL 013).
  if (isTab && (reserveError?.code === "PGRST204" || reserveError?.code === "42703")) throw new HttpError(409, SETUP_TAB);
  if (reserveError || !reserved) {
    console.error("NFC-e: reservar a nota", reserveError?.code, reserveError?.message);
    throw new HttpError(500, "Não foi possível registrar a nota.");
  }

  let result;
  try {
    result = await provider.emit(payload, { companyId: fiscal.providerCompanyId, number, series: 1 });
  } catch (err) {
    result = { status: "error" as const, message: err instanceof Error ? err.message : "O emissor não respondeu." };
  }
  const { data: saved, error: saveError } = await db
    .from("fiscal_documents")
    .update({
      status: result.status,
      number: result.number ?? null,
      series: result.series ?? null,
      access_key: result.accessKey ?? null,
      protocol: result.protocol ?? null,
      danfe_url: result.danfeUrl ?? null,
      xml_url: result.xmlUrl ?? null,
      message: result.message ?? null,
      provider_ref: result.providerRef ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reserved.id)
    .select()
    .single<FiscalDocumentRow>();
  if (saveError || !saved) {
    console.error("NFC-e: gravar a resposta", saveError?.code, saveError?.message);
    throw new HttpError(500, "A nota foi enviada, mas não deu para gravar a resposta. Confira no emissor.");
  }
  return rowToFiscalDocument(saved);
}

/** Emite a NFC-e de um pedido (balcão, retirada ou entrega). */
export async function emitOrderNfce(token: string | null, input: { orderId: string; cpf?: string }): Promise<FiscalDocument> {
  const { sb, userId } = await asUser(token);
  const { data: orderRow } = await sb.from("orders").select("*").eq("id", input.orderId).maybeSingle<OrderRow>();
  if (!orderRow) throw new HttpError(404, "Pedido não encontrado.");
  const order = rowToOrder(orderRow);
  await requireCashier(sb, order.storeId, userId);

  const ctx = await fiscalContext(sb, order.storeId);
  const problems = nfceProblems(order, ctx.fiscal, input.cpf);
  if (problems.length || !ctx.fiscal) throw new HttpError(422, problems[0] ?? "Configure os dados fiscais.");
  const fiscal = ctx.fiscal;
  const provider = checkProvider(fiscal);
  const { data: payments } = await sb.from("payments").select("*").eq("order_id", order.id);
  const payload = build(() =>
    buildNfce({
      order,
      store: ctx.store,
      fiscal,
      products: ctx.products,
      payments: ((payments ?? []) as PaymentRow[]).map(rowToPayment),
      cpf: input.cpf,
      now: new Date(),
    }),
  );
  return reserveAndEmit(order.storeId, { order_id: order.id }, fiscal, provider, payload);
}

/** Emite a NFC-e da comanda de uma mesa (fechada e paga). */
export async function emitTabNfce(token: string | null, input: { tabId: string; cpf?: string }): Promise<FiscalDocument> {
  const { sb, userId } = await asUser(token);
  const { data: tabRow } = await sb.from("tabs").select("*").eq("id", input.tabId).maybeSingle<TabRow>();
  if (!tabRow) throw new HttpError(404, "Comanda não encontrada.");
  const tab = rowToTab(tabRow);
  await requireCashier(sb, tab.storeId, userId);

  const ctx = await fiscalContext(sb, tab.storeId);
  if (!ctx.fiscal) throw new HttpError(422, "A emissão de NFC-e está desligada nas configurações fiscais.");
  const fiscal = ctx.fiscal;
  const [ordersRes, paymentsRes] = await Promise.all([
    sb.from("orders").select("*").eq("tab_id", tab.id),
    sb.from("payments").select("*").eq("tab_id", tab.id),
  ]);
  const payload = build(() =>
    buildTabNfce({
      tab,
      orders: ((ordersRes.data ?? []) as OrderRow[]).map(rowToOrder),
      store: ctx.store,
      fiscal,
      products: ctx.products,
      payments: ((paymentsRes.data ?? []) as PaymentRow[]).map(rowToPayment),
      cpf: input.cpf,
      now: new Date(),
    }),
  );
  const provider = checkProvider(fiscal);
  return reserveAndEmit(tab.storeId, { tab_id: tab.id }, fiscal, provider, payload);
}

/** Cancela uma NFC-e autorizada (dentro do prazo). */
export async function cancelNfce(token: string | null, input: { documentId: string; reason: string }): Promise<FiscalDocument> {
  const { sb, userId } = await asUser(token);
  const { data: row, error } = await sb.from("fiscal_documents").select("*").eq("id", input.documentId).maybeSingle<FiscalDocumentRow>();
  if (missingTable(error?.code)) throw new HttpError(409, SETUP);
  if (!row) throw new HttpError(404, "Nota não encontrada.");
  const doc = rowToFiscalDocument(row);
  await requireCashier(sb, doc.storeId, userId);
  if (!canCancelNfce(doc, new Date())) throw new HttpError(422, "Só dá para cancelar nota autorizada, até 30 minutos depois.");
  if (!validCancelReason(input.reason)) throw new HttpError(422, "Escreva o motivo do cancelamento (de 15 a 255 letras).");

  const provider = getProvider();
  if (provider.name !== doc.provider) throw new HttpError(409, "Esta nota foi emitida por outro emissor. Cancele por lá.");
  const { data: fiscalRow } = await sb.from("store_fiscal").select("provider_company_id").eq("store_id", doc.storeId).maybeSingle<{ provider_company_id: string | null }>();
  const res = await provider.cancel(doc, input.reason.trim(), { companyId: fiscalRow?.provider_company_id ?? undefined });
  if (!res.ok) throw new HttpError(422, res.message ?? "O emissor recusou o cancelamento.");
  const now = new Date().toISOString();
  const { data: saved } = await admin()
    .from("fiscal_documents")
    .update({ status: "cancelled", cancelled_at: now, updated_at: now, message: `Cancelada: ${input.reason.trim()}` })
    .eq("id", doc.id)
    .select()
    .single<FiscalDocumentRow>();
  if (!saved) throw new HttpError(500, "Cancelada no emissor, mas não deu para gravar. Confira no emissor.");
  return rowToFiscalDocument(saved);
}
