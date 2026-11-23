"use client";

// Equipe da loja (precisa do Supabase e do SQL 002): convites por link, função de cada pessoa
// e a entrada de quem foi convidado. As regras de quem pode o quê estão no banco (RLS e funções).

import type { StoreRole, TeamInvite, TeamMember } from "@/lib/types";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { friendly, refreshOwner } from "@/lib/store/remote";
import { AuthError, MIN_PASSWORD } from "@/lib/store/auth";
import { mutate } from "@/lib/store/db";

export class TeamError extends Error {}

const SETUP_HINT = "A equipe ainda não está ligada no banco. Rode o arquivo supabase/migrations/002_equipe_cozinha.sql no Supabase.";

function teamError(error: { code?: string; message?: string } | null, fallback: string): TeamError {
  if (!error) return new TeamError(fallback);
  // Tabela ou coluna que não existe: o SQL 002 ainda não rodou.
  if (error.code === "PGRST205" || error.code === "PGRST202" || error.code === "42883" || error.code === "42P01" || error.code === "42703" || error.code === "PGRST204") return new TeamError(SETUP_HINT);
  if (error.code === "23505") return new TeamError("Já existe um convite para este e-mail. Use o link que já está na lista.");
  // Mensagens das funções do banco (accept_invite) já vêm em português.
  if (error.code === "P0001" && error.message) return new TeamError(error.message);
  return new TeamError(friendly(error, fallback).message);
}

export function teamAvailable(): boolean {
  return supabaseConfigured();
}

export function inviteLink(token: string): string {
  return `${window.location.origin}/convite/${token}`;
}

interface MemberRow {
  user_id: string;
  name: string;
  email: string;
  role: StoreRole;
  created_at: string;
}
interface InviteRow {
  id: string;
  email: string;
  role: TeamInvite["role"];
  token: string;
  created_at: string;
  expires_at: string;
}

const toInvite = (r: InviteRow): TeamInvite => ({
  id: r.id,
  email: r.email,
  role: r.role,
  token: r.token,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

export async function loadTeam(storeId: string): Promise<{ members: TeamMember[]; invites: TeamInvite[] }> {
  const sb = getSupabase();
  const [members, invites] = await Promise.all([
    sb.from("store_members").select("user_id, name, email, role, created_at").eq("store_id", storeId).order("created_at"),
    sb.from("store_invites").select("id, email, role, token, created_at, expires_at").eq("store_id", storeId).order("created_at"),
  ]);
  if (members.error) throw teamError(members.error, "Não foi possível carregar a equipe.");
  if (invites.error) throw teamError(invites.error, "Não foi possível carregar os convites.");
  return {
    members: ((members.data ?? []) as MemberRow[]).map((r) => ({
      userId: r.user_id,
      name: r.name,
      email: r.email,
      role: r.role,
      createdAt: r.created_at,
    })),
    invites: ((invites.data ?? []) as InviteRow[]).map(toInvite),
  };
}

export async function createInvite(storeId: string, email: string, role: TeamInvite["role"]): Promise<TeamInvite> {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new TeamError("Confira o e-mail.");
  const sb = getSupabase();
  const { data: auth } = await sb.auth.getUser();
  const { data, error } = await sb
    .from("store_invites")
    .insert({ store_id: storeId, email: clean, role, invited_by: auth.user?.id ?? null })
    .select("id, email, role, token, created_at, expires_at")
    .single<InviteRow>();
  if (error || !data) throw teamError(error, "Não foi possível criar o convite.");
  return toInvite(data);
}

/** Mais 7 dias para um convite (vencido ou não). */
export async function renewInvite(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from("store_invites")
    .update({ expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })
    .eq("id", id);
  if (error) throw teamError(error, "Não foi possível renovar o convite.");
}

export async function cancelInvite(id: string): Promise<void> {
  const { error } = await getSupabase().from("store_invites").delete().eq("id", id);
  if (error) throw teamError(error, "Não foi possível cancelar o convite.");
}

export async function changeRole(storeId: string, userId: string, role: StoreRole): Promise<void> {
  const { data, error } = await getSupabase()
    .from("store_members")
    .update({ role })
    .eq("store_id", storeId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) throw teamError(error, "Não foi possível mudar a função.");
  if (!data?.length) throw new TeamError("Só o dono pode mudar a equipe.");
}

export async function removeMember(storeId: string, userId: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from("store_members")
    .delete()
    .eq("store_id", storeId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) throw teamError(error, "Não foi possível tirar a pessoa da equipe.");
  if (!data?.length) throw new TeamError("Só o dono pode mudar a equipe.");
}

// ---------- página do convite ----------

export interface InviteInfo {
  storeName: string;
  storeSlug: string;
  email: string;
  role: TeamInvite["role"];
  expired: boolean;
}

export async function getInvite(token: string): Promise<InviteInfo | null> {
  const { data, error } = await getSupabase().rpc("get_invite", { p_token: token });
  if (error) throw teamError(error, "Não foi possível abrir o convite.");
  return (data as InviteInfo | null) ?? null;
}

/** E-mail da conta do Supabase logada agora, se houver. */
export async function currentAuthEmail(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.user.email?.toLowerCase() ?? null;
}

async function acceptWithSession(token: string) {
  const sb = getSupabase();
  const { error } = await sb.rpc("accept_invite", { p_token: token });
  if (error) throw teamError(error, "Não foi possível entrar na equipe.");
  const { data } = await sb.auth.getUser();
  if (data.user) await refreshOwner(data.user);
}

/** Aceita com a conta que já está logada. */
export async function acceptInvite(token: string): Promise<void> {
  await acceptWithSession(token);
}

/**
 * Cria o acesso de quem foi convidado e já entra na loja. Devolve needsConfirmation quando o
 * Supabase pede confirmação de e-mail antes do primeiro login.
 */
export async function joinWithNewAccount(input: { token: string; email: string; name: string; password: string }): Promise<{
  needsConfirmation: boolean;
}> {
  if (!input.name.trim()) throw new AuthError("Diga seu nome.");
  if (input.password.length < MIN_PASSWORD) throw new AuthError(`A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`);
  const sb = getSupabase();
  mutate((db) => {
    db.session = null;
  });
  const { data, error } = await sb.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { name: input.name.trim(), kind: "staff" },
      emailRedirectTo: `${window.location.origin}/convite/${input.token}`,
    },
  });
  if (error) {
    if (/already registered|already been registered/i.test(error.message)) throw new TeamError("EXISTE");
    throw new AuthError(error.message || "Não foi possível criar o acesso.");
  }
  if (data.user && data.user.identities?.length === 0) throw new TeamError("EXISTE");
  if (!data.session) return { needsConfirmation: true };
  await acceptWithSession(input.token);
  return { needsConfirmation: false };
}

/** Entra com a senha de uma conta que já existe e aceita o convite. */
export async function joinWithPassword(input: { token: string; email: string; password: string }): Promise<void> {
  const sb = getSupabase();
  mutate((db) => {
    db.session = null;
  });
  const { error } = await sb.auth.signInWithPassword({ email: input.email, password: input.password });
  if (error) {
    throw new AuthError(/invalid login credentials/i.test(error.message) ? "Senha incorreta." : error.message || "Não foi possível entrar.");
  }
  await acceptWithSession(input.token);
}
