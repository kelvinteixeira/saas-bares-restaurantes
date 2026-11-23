"use client";

// Login do dono.
// - Com Supabase configurado: Supabase Auth (e-mail e senha). A loja é criada no banco pelo
//   trigger handle_new_user a partir dos dados enviados no cadastro.
// - Sem Supabase (testes, ou app rodando só com a demonstração): simulação local, com hash
//   SHA-256 no localStorage. Isto não é segurança de verdade; serve só para a demonstração.
// A conta de demonstração (Bar do Cais) é sempre local.

import type { Account, Store } from "@/lib/types";
import { mutate } from "@/lib/store/db";
import { newId } from "@/lib/ids";
import { slugify } from "@/lib/format";
import { DEMO_ACCOUNT_ID } from "@/lib/seed";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { clearOwner, loadOwner } from "@/lib/store/remote";

/** Rotas que não podem virar endereço de loja (a mesma lista está no SQL do cadastro). */
export const RESERVED_SLUGS = new Set([
  "painel",
  "entrar",
  "criar-conta",
  "api",
  "sobre",
  "termos",
  "privacidade",
  "creditos-das-fotos",
  "bar-do-cais",
]);

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

/** Mensagens do Supabase Auth em português. */
function authMessage(message: string | undefined, fallback: string): string {
  const m = message ?? "";
  if (/invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(m)) return "Confirme seu e-mail antes de entrar. O link chegou na sua caixa de entrada.";
  if (/already registered|already been registered/i.test(m)) return "Já existe uma conta com este e-mail.";
  if (/password should be at least/i.test(m)) return `A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`;
  if (/rate limit|too many/i.test(m)) return "Muitas tentativas seguidas. Espere um pouco e tente de novo.";
  if (/invalid.*email|email.*invalid/i.test(m)) return "Confira o e-mail.";
  if (/fetch|network/i.test(m)) return "Sem conexão com o servidor. Tente de novo.";
  return m || fallback;
}

/**
 * Cria a conta e a loja. Com a confirmação de e-mail ligada no Supabase, a sessão só existe depois
 * que a pessoa clica no link: nesse caso devolve needsConfirmation = true.
 */
export async function signUp(input: { name: string; email: string; password: string; storeName: string }): Promise<{
  needsConfirmation: boolean;
}> {
  const email = input.email.trim().toLowerCase();
  // Mesmas regras da tela, conferidas de novo aqui.
  if (!input.name.trim() || !input.storeName.trim()) throw new AuthError("Preencha seu nome e o nome da loja.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("Confira o e-mail.");
  if (input.password.length < MIN_PASSWORD) throw new AuthError(`A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`);

  if (supabaseConfigured()) {
    const sb = getSupabase();
    // Sai da demonstração local, se estiver nela, para a conta nova valer.
    mutate((db) => {
      db.session = null;
    });
    const { data, error } = await sb.auth.signUp({
      email,
      password: input.password,
      options: {
        data: { name: input.name.trim(), store_name: input.storeName.trim(), store_slug: slugify(input.storeName) },
        emailRedirectTo: `${window.location.origin}/entrar`,
      },
    });
    if (error) throw new AuthError(authMessage(error.message, "Não foi possível criar a conta."));
    // Com confirmação ligada, um e-mail já cadastrado volta sem erro e sem identidades.
    if (data.user && data.user.identities?.length === 0) throw new AuthError("Já existe uma conta com este e-mail.");
    if (!data.session || !data.user) return { needsConfirmation: true };
    await loadOwner(data.user);
    return { needsConfirmation: false };
  }

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
  return { needsConfirmation: false };
}

export async function signIn(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();

  if (supabaseConfigured()) {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new AuthError(authMessage(error?.message, "Não foi possível entrar."));
    mutate((db) => {
      db.session = null;
    });
    await loadOwner(data.user);
    return;
  }

  const passwordHash = await hashPassword(email, password);
  mutate((db) => {
    const account = db.accounts.find((a) => a.email === email && a.passwordHash && a.passwordHash === passwordHash);
    if (!account) throw new AuthError("E-mail ou senha incorretos.");
    db.session = { accountId: account.id };
  });
}

/** Abre o painel do Bar do Cais (sempre local). Sai antes da conta do Supabase, se houver. */
export async function enterDemo() {
  if (supabaseConfigured()) {
    await getSupabase().auth.signOut().catch(() => undefined);
    clearOwner();
  }
  mutate((db) => {
    db.session = { accountId: DEMO_ACCOUNT_ID };
  });
}

export async function signOut() {
  if (supabaseConfigured()) {
    await getSupabase().auth.signOut().catch(() => undefined);
    clearOwner();
  }
  mutate((db) => {
    db.session = null;
  });
}
