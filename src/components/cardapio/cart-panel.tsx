"use client";

import Link from "next/link";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import type { Product, Store } from "@/lib/types";
import { lineTotal } from "@/lib/domain/pricing";
import { formatMoney } from "@/lib/format";
import { useCart } from "@/components/cardapio/cart";
import { brandButton } from "@/components/cardapio/brand";

export function cartSubtotal(lines: ReturnType<typeof useCart>["lines"], products: Product[]) {
  return lines.reduce((sum, l) => {
    const p = products.find((x) => x.id === l.productId);
    return p ? sum + lineTotal(p, l) : sum;
  }, 0);
}

/** Linhas da sacola com quantidade editável. Itens que sumiram do cardápio aparecem como indisponíveis. */
export function CartLines({ products }: { products: Product[] }) {
  const cart = useCart();
  return (
    <ul>
      {cart.lines.map((l) => {
        const p = products.find((x) => x.id === l.productId);
        if (!p) {
          return (
            <li key={l.key} className="flex items-center justify-between gap-3 border-b border-rule py-3 text-sm text-muted">
              Item que saiu do cardápio
              <button type="button" onClick={() => cart.remove(l.key)} className="font-medium text-negative">
                Remover
              </button>
            </li>
          );
        }
        const details = p.optionGroups.flatMap((g) =>
          (l.selections[g.id] ?? []).map((id) => g.options.find((o) => o.id === id)?.name ?? ""),
        );
        return (
          <li key={l.key} className="flex gap-3 border-b border-rule py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-[15px]">{p.name}</p>
              {details.length > 0 && <p className="text-[13px] text-muted">{details.join(" · ")}</p>}
              {l.notes && <p className="text-[13px] text-muted">Obs.: {l.notes}</p>}
              {!p.available && <p className="text-[13px] font-medium text-negative">Esgotou. Remova para continuar.</p>}
              <p className="num mt-1 text-sm font-medium">{formatMoney(lineTotal(p, l))}</p>
            </div>
            <div className="flex h-9 flex-none items-center self-end rounded-full border border-control">
              <button
                type="button"
                aria-label={`Diminuir ${p.name}`}
                onClick={() => cart.setQuantity(l.key, l.quantity - 1)}
                className="grid size-9 place-items-center rounded-full"
              >
                <Minus className="size-3.5" strokeWidth={1.75} />
              </button>
              <span className="num w-5 text-center text-sm">{l.quantity}</span>
              <button
                type="button"
                aria-label={`Aumentar ${p.name}`}
                onClick={() => cart.setQuantity(l.key, l.quantity + 1)}
                className="grid size-9 place-items-center rounded-full"
              >
                <Plus className="size-3.5" strokeWidth={1.75} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function CartSummary({ store, products, canOrder }: { store: Store; products: Product[]; canOrder: boolean }) {
  const cart = useCart();
  const subtotal = cartSubtotal(cart.lines, products);
  const blocked = cart.lines.some((l) => !products.find((p) => p.id === l.productId)?.available);

  if (!cart.lines.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted">
        <ShoppingBag className="size-6" strokeWidth={1.25} aria-hidden="true" />
        Sua sacola está vazia. Toque num item para adicionar.
      </div>
    );
  }

  return (
    <div>
      <CartLines products={products} />
      <div className="mt-3 flex items-baseline justify-between border-t border-rule pt-3">
        <span className="text-sm text-muted">Subtotal</span>
        <span className="num text-[17px] font-semibold">{formatMoney(subtotal)}</span>
      </div>
      {!cart.table && store.delivery.enabled && store.delivery.minOrder > subtotal && (
        <p className="mt-1 text-[13px] text-muted">
          Entrega a partir de {formatMoney(store.delivery.minOrder)} em produtos. Retirada não tem mínimo.
        </p>
      )}
      {canOrder && !blocked ? (
        <Link href={`/${store.slug}/checkout`} className={brandButton("mt-4 w-full")}>
          Continuar
        </Link>
      ) : (
        <button type="button" disabled className={brandButton("mt-4 w-full")}>
          {blocked ? "Remova os itens esgotados" : "Loja fechada agora"}
        </button>
      )}
    </div>
  );
}
