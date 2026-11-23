"use client";

import { createContext, useContext } from "react";
import type { Account, Db, Store, StoreRole } from "@/lib/types";

export interface PainelValue {
  db: Db;
  account: Account;
  store: Store;
  now: Date;
  /** Função de quem está logado nesta loja. */
  role: StoreRole;
  /** Som de pedido novo (a preferência fica neste navegador). */
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
}

export const PainelContext = createContext<PainelValue | null>(null);

export function usePainel(): PainelValue {
  const value = useContext(PainelContext);
  if (!value) throw new Error("usePainel fora do painel");
  return value;
}
