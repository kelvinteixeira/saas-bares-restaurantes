"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { Product, Store } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { readableInk } from "@/lib/color";
import { addToTab } from "@/lib/store/tabs";
import { usePainel } from "@/components/painel/painel-context";
import { DraftLines, MenuBrowser, useDraft, useStoreMenu } from "@/components/painel/menu/menu-browser";
import { ItemSheet } from "@/components/cardapio/item-sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { attempt, useToast } from "@/components/ui/toast";

/** Cardápio do garçom: escolhe os itens, revisa e manda para a cozinha. */
export function ItemPicker({ store, table, onCancel, onSent }: { store: Store; table: number; onCancel: () => void; onSent: () => void }) {
  const { db } = usePainel();
  const toast = useToast();
  const { categories, products } = useStoreMenu(store, db.categories, db.products);
  const { draft, byId, add, setQty, count, total, qtyOf } = useDraft(products);
  const [notes, setNotes] = useState("");
  const [sheet, setSheet] = useState<Product | null>(null);
  const [sending, setSending] = useState(false);

  function tap(product: Product) {
    if (!product.available) return;
    if (product.optionGroups.length) setSheet(product);
    else add(product, {}, 1);
  }

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
        <MenuBrowser categories={categories} products={products} variant="list" qtyOf={qtyOf} onTap={tap} />

        <aside id="lancamento" className="h-fit rounded-card border border-line lg:sticky lg:top-6">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-base font-semibold">Para enviar</h2>
            {count > 0 && (
              <span className="num text-sm text-muted">
                {count} {count === 1 ? "item" : "itens"}
              </span>
            )}
          </div>
          {draft.length === 0 ? (
            <p className="px-4 pt-2 pb-4 text-sm leading-6 text-muted">Toque nos itens do cardápio para montar o pedido da mesa.</p>
          ) : (
            <div className="mt-2">
              <DraftLines draft={draft} byId={byId} setQty={setQty} />
            </div>
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
