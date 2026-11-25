"use client";

// Cashback: o checkout pergunta o saldo do WhatsApp; o painel liga e ajusta a porcentagem.
// Na loja do Supabase o saldo vem do banco (SQL 007, cashback_info); na loja local, das mesmas regras.

import type { Store } from "@/lib/types";
import { balanceOf, cashbackOf, validPhone } from "@/lib/domain/cashback";
import { getDb } from "@/lib/store/db";
import { updateStore } from "@/lib/store/actions";
import { friendly, isRemoteStore } from "@/lib/store/remote";
import { getSupabase } from "@/lib/supabase/client";

export interface CashbackInfo {
  enabled: boolean;
  rate: number;
  balance: number;
}

export async function getCashbackInfo(storeId: string, phone: string): Promise<CashbackInfo> {
  if (isRemoteStore(storeId)) {
    const { data, error } = await getSupabase().rpc("cashback_info", { p_store: storeId, p_phone: phone });
    // Antes do SQL 007 a função não existe: a loja fica sem cashback.
    if (error || !data) return { enabled: false, rate: 0, balance: 0 };
    return data as CashbackInfo;
  }
  const db = getDb();
  const store = db.stores.find((s) => s.id === storeId);
  const cb = store ? cashbackOf(store) : null;
  const valid = validPhone(phone);
  return {
    enabled: Boolean(cb?.enabled),
    rate: cb?.rate ?? 0,
    balance: valid && store ? balanceOf(db.cashbackEntries ?? [], store.id, valid) : 0,
  };
}

export class CashbackSettingsError extends Error {}

export async function saveCashbackSettings(storeId: string, settings: NonNullable<Store["cashback"]>) {
  if (!Number.isInteger(settings.rate) || settings.rate < 1 || settings.rate > 30) {
    throw new CashbackSettingsError("A porcentagem vai de 1% a 30%.");
  }
  if (!Number.isInteger(settings.validDays) || settings.validDays < 7 || settings.validDays > 365) {
    throw new CashbackSettingsError("A validade vai de 7 a 365 dias.");
  }
  try {
    await updateStore(storeId, (s) => {
      s.cashback = settings;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    // Coluna inexistente: o SQL 007 ainda não rodou.
    if (/cashback|column|schema cache/i.test(message)) {
      throw new CashbackSettingsError("O cashback ainda não está ligado no banco. Rode o arquivo supabase/migrations/007_cashback.sql no Supabase.");
    }
    throw new CashbackSettingsError(friendly({ message }, "Não foi possível salvar.").message);
  }
}
