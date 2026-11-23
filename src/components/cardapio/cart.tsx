"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { CartLine, Selections } from "@/lib/domain/pricing";
import { MAX_ITEM_QUANTITY } from "@/lib/store/actions";

interface CartState {
  lines: CartLine[];
  /** Mesa lida do QR code (?mesa=N). Quando existe, o pedido é sempre "na mesa". */
  table: number | null;
}

interface CartApi extends CartState {
  loaded: boolean;
  count: number;
  add: (productId: string, selections: Selections, quantity: number, notes?: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  setTable: (table: number | null) => void;
}

const CartContext = createContext<CartApi | null>(null);

function lineKey(productId: string, selections: Selections, notes?: string) {
  const sel = Object.keys(selections)
    .sort()
    .map((g) => `${g}:${[...selections[g]].sort().join(",")}`)
    .join("|");
  return `${productId}#${sel}#${notes ?? ""}`;
}

export function CartProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  const storageKey = `comanda:sacola:${slug}`;
  const [state, setState] = useState<CartState>({ lines: [], table: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const saved = raw ? (JSON.parse(raw) as Partial<CartState>) : null;
      // Ignora sacola salva com formato estranho em vez de quebrar a página.
      if (saved && Array.isArray(saved.lines)) {
        setState({
          lines: saved.lines.filter((l) => l && typeof l.productId === "string" && Number.isInteger(l.quantity) && l.quantity > 0),
          table: typeof saved.table === "number" ? saved.table : null,
        });
      }
    } catch {
      // sacola vazia
    }
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // sem espaço: a sacola vale só nesta visita
    }
  }, [state, loaded, storageKey]);

  const add = useCallback((productId: string, selections: Selections, quantity: number, notes?: string) => {
    const key = lineKey(productId, selections, notes);
    setState((s) => {
      const existing = s.lines.find((l) => l.key === key);
      const lines = existing
        ? s.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_ITEM_QUANTITY, l.quantity + quantity) } : l))
        : [...s.lines, { key, productId, selections, quantity, notes }];
      return { ...s, lines };
    });
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setState((s) => ({
      ...s,
      lines: quantity <= 0 ? s.lines.filter((l) => l.key !== key) : s.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_ITEM_QUANTITY, quantity) } : l)),
    }));
  }, []);

  const remove = useCallback((key: string) => setState((s) => ({ ...s, lines: s.lines.filter((l) => l.key !== key) })), []);
  const clear = useCallback(() => setState((s) => ({ ...s, lines: [] })), []);
  const setTable = useCallback((table: number | null) => setState((s) => ({ ...s, table })), []);

  const value = useMemo<CartApi>(
    () => ({
      ...state,
      loaded,
      count: state.lines.reduce((n, l) => n + l.quantity, 0),
      add,
      setQuantity,
      remove,
      clear,
      setTable,
    }),
    [state, loaded, add, setQuantity, remove, clear, setTable],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart fora do cardápio");
  return value;
}
