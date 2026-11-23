"use client";

import { useMemo } from "react";
import type { Category, Product, Store } from "@/lib/types";
import { useDb } from "@/lib/store/db";
import { storeBySlug } from "@/lib/store/actions";

export type PublicStore =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "ready"; store: Store; categories: Category[]; products: Product[] };

/** A loja como o cliente vê: só categorias visíveis e com itens, na ordem do dono. */
export function usePublicStore(slug: string): PublicStore {
  const db = useDb();
  return useMemo<PublicStore>(() => {
    if (!db) return { state: "loading" };
    const store = storeBySlug(db, slug);
    if (!store) return { state: "missing" };
    const products = db.products
      .filter((p) => p.storeId === store.id)
      .sort((a, b) => a.position - b.position);
    const categories = db.categories
      .filter((c) => c.storeId === store.id && c.visible && products.some((p) => p.categoryId === c.id))
      .sort((a, b) => a.position - b.position);
    const visibleIds = new Set(categories.map((c) => c.id));
    return { state: "ready", store, categories, products: products.filter((p) => visibleIds.has(p.categoryId)) };
  }, [db, slug]);
}
