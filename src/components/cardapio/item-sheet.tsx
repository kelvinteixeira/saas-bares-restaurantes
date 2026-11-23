"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { Product } from "@/lib/types";
import { groupRule, unitPrice, validateSelections, type Selections } from "@/lib/domain/pricing";
import { formatMoney } from "@/lib/format";
import { Modal } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { brandButton } from "@/components/cardapio/brand";
import { cn } from "@/lib/cn";

export function ItemSheet({
  product,
  canOrder,
  closedLabel,
  onClose,
  onAdd,
}: {
  product: Product | null;
  canOrder: boolean;
  closedLabel: string;
  onClose: () => void;
  onAdd: (selections: Selections, quantity: number, notes?: string) => void;
}) {
  return (
    <Modal open={Boolean(product)} onClose={onClose} title={product?.name ?? ""} className="sm:w-[560px]">
      {product && (
        <ItemForm key={product.id} product={product} canOrder={canOrder} closedLabel={closedLabel} onAdd={onAdd} />
      )}
    </Modal>
  );
}

function ItemForm({
  product,
  canOrder,
  closedLabel,
  onAdd,
}: {
  product: Product;
  canOrder: boolean;
  closedLabel: string;
  onAdd: (selections: Selections, quantity: number, notes?: string) => void;
}) {
  // Grupos obrigatórios de uma escolha começam com a primeira opção disponível marcada, se for de graça.
  const [selections, setSelections] = useState<Selections>(() => {
    const initial: Selections = {};
    for (const g of product.optionGroups) {
      const first = g.options.find((o) => o.available);
      if (g.min === 1 && g.max === 1 && first && first.price === 0) initial[g.id] = [first.id];
    }
    return initial;
  });
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const errors = validateSelections(product, selections);
  const total = unitPrice(product, selections) * quantity;

  const toggle = (groupId: string, optionId: string, single: boolean, max: number) => {
    setSelections((s) => {
      const current = s[groupId] ?? [];
      if (single) return { ...s, [groupId]: [optionId] };
      if (current.includes(optionId)) return { ...s, [groupId]: current.filter((id) => id !== optionId) };
      if (current.length >= max) return s;
      return { ...s, [groupId]: [...current, optionId] };
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (Object.keys(errors).length) {
          setShowErrors(true);
          const first = product.optionGroups.find((g) => errors[g.id]);
          if (first) document.getElementById(`grupo-${first.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        onAdd(selections, quantity, notes.trim() || undefined);
      }}
    >
      {product.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.image} alt="" className="-mx-5 mb-4 aspect-[4/3] w-[calc(100%+40px)] max-w-none object-cover" />
      )}
      {product.description && <p className="text-[15px] leading-6 text-muted">{product.description}</p>}
      <p className="num mt-2 text-[15px] font-medium">{formatMoney(product.price)}</p>

      {product.optionGroups.map((g) => {
        const single = g.max === 1;
        const chosen = selections[g.id] ?? [];
        const error = showErrors ? errors[g.id] : undefined;
        return (
          <fieldset key={g.id} id={`grupo-${g.id}`} className="mt-6" aria-describedby={error ? `erro-${g.id}` : undefined}>
            <legend className="flex w-full items-center justify-between gap-3 rounded-card bg-raised px-3 py-2.5">
              <span>
                <span className="block text-[15px] font-medium">{g.name}</span>
                <span className="block text-[13px] text-muted">{groupRule(g)}</span>
              </span>
              {g.min >= 1 && <Pill tone={error ? "negative" : "neutral"}>Obrigatório</Pill>}
            </legend>
            {error && (
              <p id={`erro-${g.id}`} className="mt-2 text-sm text-negative">
                {error}
              </p>
            )}
            <ul className="mt-1">
              {g.options.map((o) => {
                const checked = chosen.includes(o.id);
                const full = !single && !checked && chosen.length >= g.max;
                const disabled = !o.available || full;
                return (
                  <li key={o.id} className="border-b border-rule last:border-b-0">
                    <label
                      className={cn(
                        "flex min-h-12 cursor-pointer items-center gap-3 py-2",
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px]">{o.name}</span>
                        {!o.available && <span className="block text-xs text-muted">Esgotado</span>}
                      </span>
                      {o.price > 0 && <span className="num text-sm text-muted">+ {formatMoney(o.price)}</span>}
                      <input
                        type={single ? "radio" : "checkbox"}
                        name={`g-${g.id}`}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(g.id, o.id, single, g.max)}
                        className="size-5 flex-none accent-[var(--brand)]"
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}

      <div className="mt-6">
        <label htmlFor="obs" className="text-[15px] font-medium">
          Alguma observação?
        </label>
        <textarea
          id="obs"
          rows={2}
          maxLength={140}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ex.: sem cebola, molho à parte"
          className="mt-2 w-full rounded-[10px] border border-line px-3 py-2 text-[15px] outline-none focus:border-ink"
        />
      </div>

      <div className="sticky bottom-0 -mx-5 mt-4 flex items-center gap-3 border-t border-rule bg-surface px-5 pt-3 pb-1">
        <div className="flex items-center rounded-full border border-control">
          <button
            type="button"
            aria-label="Diminuir quantidade"
            disabled={quantity <= 1}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="grid size-11 place-items-center rounded-full disabled:opacity-30"
          >
            <Minus className="size-4" strokeWidth={1.75} />
          </button>
          <span className="num w-6 text-center text-[15px] font-medium" aria-live="polite">
            {quantity}
          </span>
          <button
            type="button"
            aria-label="Aumentar quantidade"
            onClick={() => setQuantity((q) => Math.min(50, q + 1))}
            className="grid size-11 place-items-center rounded-full"
          >
            <Plus className="size-4" strokeWidth={1.75} />
          </button>
        </div>
        <button type="submit" disabled={!canOrder} className={brandButton("flex-1")}>
          {canOrder ? (
            <>
              Adicionar <span className="num">{formatMoney(total)}</span>
            </>
          ) : (
            closedLabel
          )}
        </button>
      </div>
    </form>
  );
}
