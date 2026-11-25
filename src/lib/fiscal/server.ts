// Só no servidor (route handlers em src/app/api/fiscal). Usa a chave secreta do Supabase para gravar
// as notas: nenhum funcionário grava nota direto, só pede ao servidor, que confere tudo de novo.
// SUPABASE_SERVICE_ROLE_KEY e o token do emissor não têm NEXT_PUBLIC_: nunca vão para o navegador.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildNfce, canCancelNfce, FiscalError, nfceProblems, validCancelReason } from "@/lib/domain/fiscal";
import type { FiscalProvider } from "@/lib/fiscal/provider";
import { simulator } from "@/lib/fiscal/simulator";
import {
  rowToFiscalDocument,
  rowToOrder,
  rowToPayment,
  rowToProduct,
  rowToStore,
  rowToStoreFiscal,
  type FiscalDocumentRow,
  type OrderRow,
  type PaymentRow,
  type ProductRow,
  type StoreFiscalRow,
  type StoreRow,
} from "@/lib/store/mappers";
import type { FiscalDocument } from "@/lib/types";

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

/** Emite a NFC-e de um pedido (balcão, retirada ou entrega). */
export async function emitOrderNfce(token: string | null, input: { orderId: string; cpf?: string }): Promise<FiscalDocument> {
  const { sb, userId } = await asUser(token);
  const { data: orderRow } = await sb.from("orders").select("*").eq("id", input.orderId).maybeSingle<OrderRow>();
  if (!orderRow) throw new HttpError(404, "Pedido não encontrado.");
  const order = rowToOrder(orderRow);
  await requireCashier(sb, order.storeId, userId);

  const [fiscalRes, storeRes, productsRes, paymentsRes] = await Promise.all([
    sb.from("store_fiscal").select("*").eq("store_id", order.storeId).maybeSingle<StoreFiscalRow>(),
    sb.from("stores").select("*").eq("id", order.storeId).single<StoreRow>(),
    sb.from("products").select("*").eq("store_id", order.storeId),
    sb.from("payments").select("*").eq("order_id", order.id),
  ]);
  if (missingTable(fiscalRes.error?.code)) throw new HttpError(409, SETUP);
  const fiscal = fiscalRes.data ? rowToStoreFiscal(fiscalRes.data) : null;
  const problems = nfceProblems(order, fiscal, input.cpf);
  if (problems.length) throw new HttpError(422, problems[0]);
  if (!fiscal || storeRes.error || !storeRes.data) {
    console.error("NFC-e: ler a loja", storeRes.error?.code, storeRes.error?.message);
    throw new HttpError(500, "Não foi possível ler a loja.");
  }

  const provider = getProvider();
  if (fiscal.environment === "producao" && !provider.production) {
    throw new HttpError(422, "O emissor fiscal ainda não foi escolhido: a emissão em produção fica bloqueada. Use homologação.");
  }

  let payload;
  try {
    payload = buildNfce({
      order,
      store: rowToStore(storeRes.data),
      fiscal,
      products: ((productsRes.data ?? []) as ProductRow[]).map(rowToProduct),
      payments: ((paymentsRes.data ?? []) as PaymentRow[]).map(rowToPayment),
      cpf: input.cpf,
      now: new Date(),
    });
  } catch (err) {
    if (err instanceof FiscalError) throw new HttpError(422, err.message);
    throw err;
  }

  // Reserva a nota (o índice único barra duas notas ativas para o mesmo pedido) e o número.
  const db = admin();
  const { data: last } = await db
    .from("fiscal_documents")
    .select("number")
    .eq("store_id", order.storeId)
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
      store_id: order.storeId,
      order_id: order.id,
      environment: fiscal.environment,
      provider: provider.name,
      status: "processing",
      total: payload.total,
      cpf: payload.consumerCpf ?? null,
    })
    .select()
    .single<FiscalDocumentRow>();
  if (reserveError?.code === "23505") throw new HttpError(409, "Este pedido já tem uma nota emitida ou em processamento.");
  if (missingTable(reserveError?.code)) throw new HttpError(409, SETUP);
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
