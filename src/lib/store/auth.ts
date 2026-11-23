"use client";

// Autenticação SIMULADA da fase 1. Senhas ficam com hash SHA-256 no localStorage só para
// a demonstração funcionar; isto não é segurança real. Na fase 2 o Supabase Auth substitui
// este arquivo inteiro (e-mail e senha, e Google se for decidido).

import type { Account, Store } from "@/lib/types";
import { mutate } from "@/lib/store/db";
import { newId } from "@/lib/ids";
import { slugify } from "@/lib/format";
import { DEMO_ACCOUNT_ID } from "@/lib/seed";

/** Rotas que não podem virar endereço de loja. */
export const RESERVED_SLUGS = new Set(["painel", "entrar", "criar-conta", "api", "sobre", "termos", "privacidade"]);

export class AuthError extends Error {}

async function hashPassword(email: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(`${email.toLowerCase()}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function uniqueSlug(base: string, taken: Set<string>): string {
  const root = slugify(base) || "minha-loja";
  let slug = root;
  let n = 2;
  while (taken.has(slug) || RESERVED_SLUGS.has(slug)) slug = `${root}-${n++}`;
  return slug;
}

export const MIN_PASSWORD = 8;

export async function signUp(input: { name: string; email: string; password: string; storeName: string }) {
  const email = input.email.trim().toLowerCase();
  // Mesmas regras da tela, conferidas de novo aqui.
  if (!input.name.trim() || !input.storeName.trim()) throw new AuthError("Preencha seu nome e o nome da loja.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("Confira o e-mail.");
  if (input.password.length < MIN_PASSWORD) throw new AuthError(`A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`);
  const passwordHash = await hashPassword(email, input.password);
  mutate((db) => {
    if (db.accounts.some((a) => a.email === email)) throw new AuthError("Já existe uma conta com este e-mail.");
    const now = new Date();
    const account: Account = {
      id: newId(),
      name: input.name.trim(),
      email,
      passwordHash,
      createdAt: now.toISOString(),
    };
    const slug = uniqueSlug(input.storeName, new Set(db.stores.map((s) => s.slug)));
    const store: Store = {
      id: newId(),
      ownerId: account.id,
      slug,
      name: input.storeName.trim(),
      description: "",
      phone: "",
      address: { street: "", number: "", district: "", city: "", state: "" },
      brandColor: "#b84a00",
      hours: {
        0: [{ open: "11:00", close: "23:00" }],
        1: [{ open: "11:00", close: "23:00" }],
        2: [{ open: "11:00", close: "23:00" }],
        3: [{ open: "11:00", close: "23:00" }],
        4: [{ open: "11:00", close: "23:00" }],
        5: [{ open: "11:00", close: "23:00" }],
        6: [{ open: "11:00", close: "23:00" }],
      },
      manualStatus: "auto",
      delivery: { enabled: false, minOrder: 0, etaMin: 30, etaMax: 50, regions: [] },
      pickup: { enabled: true, etaMin: 20, etaMax: 30 },
      table: { enabled: false, count: 10 },
      payment: { pix: true, card: true, cash: true },
      nextOrderNumber: 1,
      createdAt: now.toISOString(),
    };
    db.accounts.push(account);
    db.stores.push(store);
    db.session = { accountId: account.id };
  });
}

export async function signIn(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const passwordHash = await hashPassword(email, password);
  mutate((db) => {
    const account = db.accounts.find((a) => a.email === email && a.passwordHash && a.passwordHash === passwordHash);
    if (!account) throw new AuthError("E-mail ou senha incorretos.");
    db.session = { accountId: account.id };
  });
}

export function enterDemo() {
  mutate((db) => {
    db.session = { accountId: DEMO_ACCOUNT_ID };
  });
}

export function signOut() {
  mutate((db) => {
    db.session = null;
  });
}
