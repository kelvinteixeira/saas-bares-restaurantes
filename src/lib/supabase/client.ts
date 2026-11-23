"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// As NEXT_PUBLIC_ entram no código no build: depois de mudar o .env.local, reinicie o `npm run dev`.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

/** Sem as variáveis, o app roda 100% local (demonstração e testes). */
export function supabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) throw new Error("Supabase não configurado: preencha o .env.local.");
  if (!client) client = createBrowserClient(url, anonKey);
  return client;
}
