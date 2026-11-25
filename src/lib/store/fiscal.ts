"use client";

// NFC-e no painel. Loja do Supabase: quem emite é o servidor da Comanda (/api/fiscal/nfce), que
// confere tudo de novo e fala com o emissor. Loja local (demonstração): o simulador, aqui mesmo.

import type { FiscalDocument, StoreFiscal } from "@/lib/types";
import { buildNfce, canCancelNfce, fiscalConfigProblems, FiscalError, nfceProblems, validCancelReason } from "@/lib/domain/fiscal";
import { simulator } from "@/lib/fiscal/simulator";
import { newId } from "@/lib/ids";
import { onlyDigits } from "@/lib/format";
import { getDb, mutate } from "@/lib/store/db";
import { friendly, isRemoteStore, remoteUpsertFiscalDoc, remoteUpsertStoreFiscal } from "@/lib/store/remote";
import { rowToStoreFiscal, storeFiscalToRow, type StoreFiscalRow } from "@/lib/store/mappers";
import { getSupabase } from "@/lib/supabase/client";

export { FiscalError };

const SETUP = "A NFC-e ainda não está ligada no banco. Rode o arquivo supabase/migrations/012_nfce.sql no Supabase.";

export function newStoreFiscal(storeId: string): StoreFiscal {
  return {
    storeId,
    enabled: false,
    environment: "homologacao",
    cnpj: "",
    ie: "",
    legalName: "",
    regime: "simples",
    defaultNcm: "21069090",
    defaultCfop: "5102",
    defaultTaxCode: "102",
    updatedAt: new Date().toISOString(),
  };
}

export async function saveStoreFiscal(input: StoreFiscal): Promise<StoreFiscal> {
  const cfg: StoreFiscal = { ...input, cnpj: onlyDigits(input.cnpj), ie: onlyDigits(input.ie), legalName: input.legalName.trim() };
  const problems = fiscalConfigProblems(cfg);
  if (problems.length) throw new FiscalError(problems[0]);
  if (isRemoteStore(cfg.storeId)) {
    const { data, error } = await getSupabase().from("store_fiscal").upsert(storeFiscalToRow(cfg)).select().single<StoreFiscalRow>();
    if (error?.code === "PGRST205" || error?.code === "42P01") throw new FiscalError(SETUP);
    if (error || !data) throw new FiscalError(friendly(error, "Não foi possível salvar os dados fiscais.").message);
    const saved = rowToStoreFiscal(data);
    remoteUpsertStoreFiscal(saved);
    return saved;
  }
  return mutate((db) => {
    db.storeFiscal = [...(db.storeFiscal ?? []).filter((f) => f.storeId !== cfg.storeId), { ...cfg, updatedAt: new Date().toISOString() }];
    return cfg;
  });
}

async function callServer(path: string, body: unknown): Promise<FiscalDocument> {
  const { data } = await getSupabase().auth.getSession();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { document?: FiscalDocument; error?: string };
  if (!res.ok || !json.document) throw new FiscalError(json.error ?? "Não foi possível falar com o servidor da nota.");
  remoteUpsertFiscalDoc(json.document);
  return json.document;
}

/** Emite a NFC-e de um pedido (balcão, retirada ou entrega). CPF na nota é opcional. */
export async function emitNfce(orderId: string, cpf?: string): Promise<FiscalDocument> {
  const db = getDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new FiscalError("Pedido não encontrado.");
  if (isRemoteStore(order.storeId)) return callServer("/api/fiscal/nfce", { orderId, cpf: cpf ? onlyDigits(cpf) : undefined });

  const fiscal = (db.storeFiscal ?? []).find((f) => f.storeId === order.storeId);
  const problems = nfceProblems(order, fiscal, cpf);
  if (problems.length) throw new FiscalError(problems[0]);
  const active = (db.fiscalDocs ?? []).some((d) => d.orderId === orderId && (d.status === "processing" || d.status === "authorized"));
  if (active) throw new FiscalError("Este pedido já tem uma nota emitida ou em processamento.");
  const store = db.stores.find((s) => s.id === order.storeId)!;
  const payload = buildNfce({ order, store, fiscal: fiscal!, products: db.products, payments: db.payments ?? [], cpf, now: new Date() });
  const number = Math.max(0, ...(db.fiscalDocs ?? []).filter((d) => d.storeId === order.storeId).map((d) => d.number ?? 0)) + 1;
  const result = await simulator.emit(payload, { number, series: 1 });
  const now = new Date().toISOString();
  const doc: FiscalDocument = {
    id: newId(),
    storeId: order.storeId,
    orderId,
    environment: fiscal!.environment,
    provider: simulator.name,
    status: result.status,
    number: result.number,
    series: result.series,
    accessKey: result.accessKey,
    protocol: result.protocol,
    total: payload.total,
    cpf: payload.consumerCpf,
    message: result.message,
    createdAt: now,
    updatedAt: now,
  };
  mutate((d) => {
    d.fiscalDocs = [...(d.fiscalDocs ?? []), doc];
  });
  return doc;
}

export async function cancelNfce(doc: FiscalDocument, reason: string): Promise<FiscalDocument> {
  if (!canCancelNfce(doc, new Date())) throw new FiscalError("Só dá para cancelar nota autorizada, até 30 minutos depois.");
  if (!validCancelReason(reason)) throw new FiscalError("Escreva o motivo do cancelamento (de 15 a 255 letras).");
  if (isRemoteStore(doc.storeId)) return callServer("/api/fiscal/nfce/cancelar", { documentId: doc.id, reason });
  const now = new Date().toISOString();
  return mutate((db) => {
    const d = (db.fiscalDocs ?? []).find((x) => x.id === doc.id);
    if (!d) throw new FiscalError("Nota não encontrada.");
    Object.assign(d, { status: "cancelled", cancelledAt: now, updatedAt: now, message: `Cancelada: ${reason.trim()}` });
    return { ...d };
  });
}

/** Qual emissor o servidor está usando ("simulador" = sem valor fiscal). Loja local: sempre o simulador. */
export async function fiscalProviderInfo(storeId: string): Promise<{ provider: string; production: boolean }> {
  if (!isRemoteStore(storeId)) return { provider: simulator.name, production: false };
  try {
    const res = await fetch("/api/fiscal/nfce");
    const json = (await res.json()) as { provider?: string; production?: boolean };
    return { provider: json.provider ?? "desconhecido", production: Boolean(json.production) };
  } catch {
    return { provider: "desconhecido", production: false };
  }
}
