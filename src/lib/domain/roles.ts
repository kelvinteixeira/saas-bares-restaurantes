import type { StoreRole } from "@/lib/types";

// O que cada função vê no painel. O banco (RLS) também barra o que cada uma não pode fazer;
// isto aqui só esconde as telas que não servem para ela.

export const ROLE_LABEL: Record<StoreRole, string> = {
  owner: "Dono",
  manager: "Gerente",
  cashier: "Caixa",
  waiter: "Garçom",
  kitchen: "Cozinha",
};

export const ROLE_HINT: Record<StoreRole, string> = {
  owner: "Tudo, inclusive a equipe.",
  manager: "Tudo, menos a equipe.",
  cashier: "Caixa, PDV, pedidos, mesas e a tela de preparo.",
  waiter: "Pedidos e mesas.",
  kitchen: "Só a tela de preparo.",
};

/** Funções que o dono pode dar num convite (dono não se convida). */
export const INVITABLE_ROLES = ["manager", "cashier", "waiter", "kitchen"] as const satisfies readonly StoreRole[];

const PAGES: Record<StoreRole, readonly string[]> = {
  owner: ["/painel", "/painel/pedidos", "/painel/pdv", "/painel/caixa", "/painel/cozinha", "/painel/cardapio", "/painel/mesas", "/painel/cupons", "/painel/relatorios", "/painel/equipe", "/painel/configuracoes"],
  manager: ["/painel", "/painel/pedidos", "/painel/pdv", "/painel/caixa", "/painel/cozinha", "/painel/cardapio", "/painel/mesas", "/painel/cupons", "/painel/relatorios", "/painel/configuracoes"],
  cashier: ["/painel/pedidos", "/painel/pdv", "/painel/caixa", "/painel/cozinha", "/painel/mesas"],
  waiter: ["/painel/pedidos", "/painel/mesas"],
  kitchen: ["/painel/cozinha"],
};

/** Página do menu que corresponde ao caminho (a mais específica). */
export function pageOf(pathname: string): string | null {
  const all = PAGES.owner;
  if (pathname === "/painel") return "/painel";
  return all.filter((p) => p !== "/painel" && (pathname === p || pathname.startsWith(`${p}/`))).sort((a, b) => b.length - a.length)[0] ?? null;
}

export function canSee(role: StoreRole, pathname: string): boolean {
  const page = pageOf(pathname);
  return page !== null && PAGES[role].includes(page);
}

/** Primeira tela de cada função ao entrar. */
export function homeFor(role: StoreRole): string {
  return PAGES[role][0];
}

/** Quem pode abrir e fechar a loja e mudar o cardápio (o banco aplica a mesma regra). */
export function canManageStore(role: StoreRole): boolean {
  return role === "owner" || role === "manager";
}

/** Quem pode lançar pedido direto (simular, PDV, garçom). */
export function canPlaceStaffOrder(role: StoreRole): boolean {
  return role !== "kitchen";
}
