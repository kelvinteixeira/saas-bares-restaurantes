"use client";

// Peças do cardápio usadas pela equipe (garçom e PDV): busca e categorias, lista ou grade de itens,
// e o rascunho do pedido com as quantidades.

import { useMemo, useState } from "react";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import type { Category, Product, Store } from "@/lib/types";
import { fromPrice, hasVariablePrice, lineTotal, type CartLine, type Selections } from "@/lib/domain/pricing";
import { formatMoney } from "@/lib/format";
import { newId } from "@/lib/ids";
import { cn } from "@/lib/cn";

export const MAX_QTY = 50;

/** Texto curto das escolhas de uma linha: "Inteira · Bacon". */
export function choicesText(product: Product, selections: Selections): string {
  return product.optionGroups
    .flatMap((g) => (selections[g.id] ?? []).map((id) => g.options.find((o) => o.id === id)?.name))
    .filter(Boolean)
    .join(" · ");
}

/** Rascunho do pedido: linhas, soma, e como juntar itens iguais. */
export function useDraft(products: Product[]) {
  const [draft, setDraft] = useState<CartLine[]>([]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function add(product: Product, selections: Selections, quantity: number, notes?: string) {
    setDraft((list) => {
      // Mesmo item, mesmas escolhas e sem observação: soma na linha que já existe.
      const same = list.find(
        (l) => l.productId === product.id && !l.notes && !notes && JSON.stringify(l.selections) === JSON.stringify(selections),
      );
      if (same) return list.map((l) => (l === same ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + quantity) } : l));
      return [...list, { key: newId(), productId: product.id, selections, quantity, notes: notes?.trim() || undefined }];
    });
  }

  const setQty = (key: string, quantity: number) =>
    setDraft((list) =>
      quantity <= 0 ? list.filter((l) => l.key !== key) : list.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l)),
    );

  const count = draft.reduce((n, l) => n + l.quantity, 0);
  const total = draft.reduce((sum, l) => {
    const p = byId.get(l.productId);
    return p ? sum + lineTotal(p, l) : sum;
  }, 0);
  const qtyOf = (productId: string) => draft.filter((l) => l.productId === productId).reduce((n, l) => n + l.quantity, 0);

  return { draft, byId, add, setQty, clear: () => setDraft([]), count, total, qtyOf };
}

export function useStoreMenu(store: Store, categories: Category[], products: Product[]) {
  const visible = useMemo(
    () => categories.filter((c) => c.storeId === store.id && c.visible).sort((a, b) => a.position - b.position),
    [categories, store.id],
  );
  const own = useMemo(() => products.filter((p) => p.storeId === store.id), [products, store.id]);
  return { categories: visible, products: own };
}

/**
 * Busca, categorias e itens. "list" é a lista do garçom no celular; "grid" são os botões grandes do PDV.
 * Item sem opções entra direto; item com opções chama onOptions.
 */
export function MenuBrowser({
  categories,
  products,
  variant,
  qtyOf,
  onTap,
}: {
  categories: Category[];
  products: Product[];
  variant: "list" | "grid";
  qtyOf: (productId: string) => number;
  onTap: (product: Product) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const sections = categories
    .filter((c) => !category || c.id === category)
    .map((c) => ({
      category: c,
      items: products.filter((p) => p.categoryId === c.id && (!q || p.name.toLowerCase().includes(q))).sort((a, b) => a.position - b.position),
    }))
    .filter((s) => s.items.length);

  return (
    <div className="min-w-0">
      <label className="relative block">
        <span className="sr-only">Buscar item</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" strokeWidth={1.5} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar no cardápio"
          className="h-11 w-full rounded-[10px] border border-line bg-surface pr-3 pl-9 text-[15px] outline-none hover:border-control focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {[{ id: null as string | null, name: "Tudo" }, ...categories].map((c) => (
          <button
            key={c.id ?? "tudo"}
            type="button"
            onClick={() => setCategory(c.id)}
            aria-pressed={category === c.id}
            className={cn(
              "h-9 flex-none rounded-full border px-3.5 text-sm",
              category === c.id ? "border-ink bg-ink text-white" : "border-line bg-surface hover:bg-raised",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {sections.length === 0 && <p className="mt-6 text-sm text-muted">Nenhum item com esse nome.</p>}
      {sections.map(({ category: c, items }) => (
        <section key={c.id} className="mt-5">
          <h2 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{c.name}</h2>
          {variant === "list" ? (
            <ul className="mt-2 divide-y divide-line rounded-card border border-line">
              {items.map((p) => (
                <li key={p.id}>
                  <ListItem product={p} qty={qtyOf(p.id)} onTap={() => onTap(p)} />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
              {items.map((p) => (
                <li key={p.id}>
                  <GridItem product={p} qty={qtyOf(p.id)} onTap={() => onTap(p)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function Price({ product }: { product: Product }) {
  if (!product.available) return <span className="text-xs text-muted">Esgotado</span>;
  return (
    <span className="num text-sm whitespace-nowrap">
      {hasVariablePrice(product) && <span className="text-xs text-muted">a partir de </span>}
      {formatMoney(fromPrice(product))}
    </span>
  );
}

function QtyBadge({ qty }: { qty: number }) {
  return qty > 0 ? (
    <span className="num grid size-7 flex-none place-items-center rounded-full bg-accent text-xs font-semibold text-white">{qty}</span>
  ) : (
    <span className="grid size-7 flex-none place-items-center rounded-full border border-control text-muted">
      <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

function ListItem({ product, qty, onTap }: { product: Product; qty: number; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={!product.available}
      className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{product.name}</span>
        {product.optionGroups.length > 0 && (
          <span className="block truncate text-xs text-muted">{product.optionGroups.map((g) => g.name).join(", ")}</span>
        )}
      </span>
      <Price product={product} />
      <QtyBadge qty={qty} />
    </button>
  );
}

function GridItem({ product, qty, onTap }: { product: Product; qty: number; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={!product.available}
      aria-label={qty ? `${product.name}, ${qty} no pedido` : product.name}
      className={cn(
        "relative flex h-full min-h-[92px] w-full flex-col justify-between gap-2 rounded-card border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        qty ? "border-accent bg-accent-soft/60" : "border-line bg-surface hover:bg-raised",
      )}
    >
      <span className="line-clamp-2 pr-7 text-sm leading-5 font-medium">{product.name}</span>
      <Price product={product} />
      {qty > 0 && (
        <span className="num absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-full bg-accent text-xs font-semibold text-white">{qty}</span>
      )}
    </button>
  );
}

/** Linhas do rascunho com menos, quantidade e mais. */
export function DraftLines({
  draft,
  byId,
  setQty,
}: {
  draft: CartLine[];
  byId: Map<string, Product>;
  setQty: (key: string, quantity: number) => void;
}) {
  return (
    <ul className="divide-y divide-line">
      {draft.map((l) => {
        const p = byId.get(l.productId);
        if (!p) return null;
        const extra = choicesText(p, l.selections);
        return (
          <li key={l.key} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{p.name}</span>
                {extra && <span className="block text-xs text-muted">{extra}</span>}
                {l.notes && <span className="mt-0.5 block text-xs text-pill-warning-ink">{l.notes}</span>}
              </span>
              <span className="num text-sm">{formatMoney(lineTotal(p, l))}</span>
            </div>
            <div className="mt-2 flex items-center gap-1">
              <button
                type="button"
                aria-label={`Menos ${p.name}`}
                onClick={() => setQty(l.key, l.quantity - 1)}
                className="grid size-8 place-items-center rounded-control border border-control hover:bg-raised"
              >
                {l.quantity === 1 ? <Trash2 className="size-3.5" strokeWidth={1.5} /> : <Minus className="size-3.5" strokeWidth={2} />}
              </button>
              <span className="num w-8 text-center text-sm font-medium" aria-live="polite">
                {l.quantity}
              </span>
              <button
                type="button"
                aria-label={`Mais ${p.name}`}
                onClick={() => setQty(l.key, l.quantity + 1)}
                className="grid size-8 place-items-center rounded-control border border-control hover:bg-raised"
              >
                <Plus className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
