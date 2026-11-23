"use client";

import { createContext, useContext } from "react";
import type { Account, Db, Store } from "@/lib/types";

export interface PainelValue {
  db: Db;
  account: Account;
  store: Store;
  now: Date;
}

export const PainelContext = createContext<PainelValue | null>(null);

export function usePainel(): PainelValue {
  const value = useContext(PainelContext);
  if (!value) throw new Error("usePainel fora do painel");
  return value;
}
