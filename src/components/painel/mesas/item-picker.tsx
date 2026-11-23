"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Minus, Plus, Search, Trash2 } from "lucide-react";
import type { Product, Store } from "@/lib/types";
import { fromPrice, hasVariablePrice, lineTotal, type CartLine, type Selections } from "@/lib/domain/pricing";
import { formatMoney } from "@/lib/format";
import { newId } from "@/lib/ids";
import { readableInk } from "@/lib/color";
import { addToTab } from "@/lib/store/tabs";
import { cn } from "@/lib/cn";
import { usePainel } from "@/components/painel/painel-context";
import { ItemSheet } from "@/components/cardapio/item-sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { attempt, useToast } from "@/components/ui/toast";

const MAX_QTY = 50;

/** Texto curto das escolhas de uma linha: "Inteira · Bacon". */
function choices(product: Product, selections: Selections): string {
  return product.optionGroups
    .flatMap((g) => (selections[g.id] ?? []).map((id) => g.options.find((o) => o.id === id)?.name))
    .filter(Boolean)
    .join(" · ");
}

/** Cardápio do garçom: escolhe os itens, revisa e manda para a cozinha. */
export function ItemPicker({ store, table, onCancel, onSent }: { store: Store; table: number; onCancel: () => void; onSent: () => void }) {
  const { db } = usePainel();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [draft, setDraft] = useState<CartLine[]>([]);
  const [notes, setNotes] = useState("");
  const [sheet, setSheet] = useState<Product | null>(null);
  const [sending, setSending] = useState(false);

  const categories = useMemo(
    () => db.categories.filter((c) => c.storeId === store.id && c.visible).sort((a, b) => a.position - b.position),
    [db.categories, store.id],
  );
  const products = useMemo(() => db.products.filter((p) => p.storeId === store.id), [db.products, store.id]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const q = query.trim().toLowerCase();
  const sections = categories
    .filter((c) => !category || c.id === category)
    .map((c) => ({
      category: c,
      items: products
        .filter((p) => p.categoryId === c.id && (!q || p.name.toLowerCase().includes(q)))
        .sort((a, b) => a.position - b.position),
    }))
    .filter((s) => s.items.length);

  const count = draft.reduce((n, l) => n + l.quantity, 0);
  const total = draft.reduce((sum, l) => {
    const p = byId.get(l.productId);
    return p ? sum + lineTotal(p, l) : sum;
  }, 0);

  function add(product: Product, selections: Selections, quantity: number, lineNotes?: string) {
    setDraft((list) => {
      // Mesmo item, mesmas escolhas e sem observação: soma na linha que já existe.
      const same = list.find(
        (l) => l.productId === product.id && !l.notes && !lineNotes && JSON.stringify(l.selections) === JSON.stringify(selections),
      );
      if (same) return list.map((l) => (l === same ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + quantity) } : l));
      return [...list, { key: newId(), productId: product.id, selections, quantity, notes: lineNotes?.trim() || undefined }];
    });
  }

  function tap(product: Product) {
    if (!product.available) return;
    if (product.optionGroups.length) setSheet(product);
    else add(product, {}, 1);
  }

  const setQty = (key: string, quantity: number) =>
    setDraft((list) => (quantity <= 0 ? list.filter((l) => l.key !== key) : list.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l))));

  async function send() {
    setSending(true);
    const order = await attempt(toast, () => addToTab(store.id, table, draft, notes));
    setSending(false);
    if (!order) return;
    toast(`Mesa ${table}: enviado para a cozinha`);
    onSent();
  }

  const brand = { "--brand": store.brandColor, "--brand-ink": readableInk(store.brandColor) } as React.CSSProperties;

  return (
    <div style={brand} className="pb-28 lg:pb-0">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Voltar para a comanda"
          className="grid size-10 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink"
        >
          <ArrowLeft className="size-5" strokeWidth={1.5} />
        </button>
        <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.01em]">Lançar na mesa {table}</h1>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
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
            {[{ id: null, name: "Tudo" }, ...categories].map((c) => (
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
              <ul className="mt-2 divide-y divide-line rounded-card border border-line">
                {items.map((p) => {
                  const inDraft = draft.filter((l) => l.productId === p.id).reduce((n, l) => n + l.quantity, 0);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => tap(p)}
                        disabled={!p.available}
                        className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium">{p.name}</span>
                          {p.optionGroups.length > 0 && (
                            <span className="block truncate text-xs text-muted">{p.optionGroups.map((g) => g.name).join(", ")}</span>
                          )}
                        </span>
                        {!p.available ? (
                          <span className="text-xs text-muted">Esgotado</span>
                        ) : (
                          <span className="num text-sm whitespace-nowrap">
                            {hasVariablePrice(p) && <span className="text-xs text-muted">a partir de </span>}
                            {formatMoney(fromPrice(p))}
                          </span>
                        )}
                        {inDraft > 0 ? (
                          <span className="num grid size-7 flex-none place-items-center rounded-full bg-accent text-xs font-semibold text-white">{inDraft}</span>
                        ) : (
                          <span className="grid size-7 flex-none place-items-center rounded-full border border-control text-muted">
                            <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <aside id="lancamento" className="h-fit rounded-card border border-line lg:sticky lg:top-6">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-base font-semibold">Para enviar</h2>
            {count > 0 && <span className="num text-sm text-muted">{count} {count === 1 ? "item" : "itens"}</span>}
          </div>
          {draft.length === 0 ? (
            <p className="px-4 pt-2 pb-4 text-sm leading-6 text-muted">Toque nos itens do cardápio para montar o pedido da mesa.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {draft.map((l) => {
                const p = byId.get(l.productId);
                if (!p) return null;
                const extra = choices(p, l.selections);
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
                      <button type="button" aria-label={`Menos ${p.name}`} onClick={() => setQty(l.key, l.quantity - 1)} className="grid size-8 place-items-center rounded-control border border-control hover:bg-raised">
                        {l.quantity === 1 ? <Trash2 className="size-3.5" strokeWidth={1.5} /> : <Minus className="size-3.5" strokeWidth={2} />}
                      </button>
                      <span className="num w-8 text-center text-sm font-medium" aria-live="polite">{l.quantity}</span>
                      <button type="button" aria-label={`Mais ${p.name}`} onClick={() => setQty(l.key, l.quantity + 1)} className="grid size-8 place-items-center rounded-control border border-control hover:bg-raised">
                        <Plus className="size-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-line px-4 py-3">
            <label htmlFor="obs-mesa" className="text-sm font-medium">
              Observação para a cozinha
            </label>
            <Textarea id="obs-mesa" className="mt-2" maxLength={200} placeholder="Ex.: servir as bebidas primeiro" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="hidden border-t border-line p-4 lg:block">
            <Button variant="primary" size="lg" className="w-full" disabled={!draft.length || sending} onClick={() => void send()}>
              {sending ? "Enviando…" : `Enviar para a cozinha · ${formatMoney(total)}`}
            </Button>
          </div>
        </aside>
      </div>

      {/* No celular, o botão fica preso embaixo. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 py-3 lg:hidden">
        <div className="flex items-center gap-3">
          <a href="#lancamento" className="min-w-0 flex-1 text-sm">
            <span className="num block font-semibold">{formatMoney(total)}</span>
            <span className="block text-xs text-muted">{count ? `${count} ${count === 1 ? "item" : "itens"} · revisar` : "Nada escolhido"}</span>
          </a>
          <Button variant="primary" size="lg" disabled={!draft.length || sending} onClick={() => void send()}>
            {sending ? "Enviando…" : "Enviar para a cozinha"}
          </Button>
        </div>
      </div>

      <ItemSheet
        product={sheet}
        canOrder
        closedLabel=""
        onClose={() => setSheet(null)}
        onAdd={(selections, quantity, lineNotes) => {
          if (sheet) add(sheet, selections, quantity, lineNotes);
          setSheet(null);
        }}
      />
    </div>
  );
}
