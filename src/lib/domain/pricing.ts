import type { OptionGroup, Product, Store } from "@/lib/types";

/** Opções escolhidas por grupo: { [groupId]: optionId[] } */
export type Selections = Record<string, string[]>;

export function unitPrice(product: Product, selections: Selections): number {
  let total = product.price;
  for (const group of product.optionGroups) {
    for (const optionId of selections[group.id] ?? []) {
      const option = group.options.find((o) => o.id === optionId);
      if (option) total += option.price;
    }
  }
  return total;
}

/** Menor preço possível: base + a opção mais barata de cada grupo obrigatório. */
export function fromPrice(product: Product): number {
  let total = product.price;
  for (const group of product.optionGroups) {
    if (group.min < 1) continue;
    const prices = group.options
      .filter((o) => o.available)
      .map((o) => o.price)
      .sort((a, b) => a - b)
      .slice(0, group.min);
    total += prices.reduce((sum, p) => sum + p, 0);
  }
  return total;
}

/** Verdadeiro quando o preço final depende das escolhas (mostra "a partir de"). */
export function hasVariablePrice(product: Product): boolean {
  return product.optionGroups.some(
    (g) => g.min >= 1 && new Set(g.options.filter((o) => o.available).map((o) => o.price)).size > 1,
  );
}

export function groupRule(group: OptionGroup): string {
  if (group.min >= 1 && group.max === group.min) {
    return group.min === 1 ? "Escolha 1" : `Escolha ${group.min}`;
  }
  if (group.min >= 1) return `Escolha de ${group.min} a ${group.max}`;
  return group.max === 1 ? "Opcional, até 1" : `Opcional, até ${group.max}`;
}

/** Erros por grupo; vazio quando a seleção é válida. */
export function validateSelections(product: Product, selections: Selections): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const group of product.optionGroups) {
    const chosen = (selections[group.id] ?? []).filter((id) =>
      group.options.some((o) => o.id === id && o.available),
    );
    if (chosen.length < group.min) {
      errors[group.id] =
        group.min === 1 ? `Escolha uma opção em ${group.name}` : `Escolha ${group.min} em ${group.name}`;
    } else if (chosen.length > group.max) {
      errors[group.id] = `No máximo ${group.max} em ${group.name}`;
    }
  }
  return errors;
}

export interface CartLine {
  key: string;
  productId: string;
  selections: Selections;
  quantity: number;
  notes?: string;
}

export function lineTotal(product: Product, line: CartLine): number {
  return unitPrice(product, line.selections) * line.quantity;
}

export function deliveryFee(store: Store, regionId: string | undefined): number | null {
  if (!regionId) return null;
  const region = store.delivery.regions.find((r) => r.id === regionId && r.active);
  return region ? region.fee : null;
}

export function lowestDeliveryFee(store: Store): number | null {
  const fees = store.delivery.regions.filter((r) => r.active).map((r) => r.fee);
  return fees.length ? Math.min(...fees) : null;
}
