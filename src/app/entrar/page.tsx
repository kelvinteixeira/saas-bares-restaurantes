"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthFrame } from "@/components/auth/auth-frame";
import { OrderTicketPreview } from "@/components/auth/order-ticket-preview";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useDb } from "@/lib/store/db";
import { currentAccount } from "@/lib/store/actions";
import { AuthError, enterDemo, signIn } from "@/lib/store/auth";

export default function EntrarPage() {
  const router = useRouter();
  const db = useDb();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (db && currentAccount(db)) router.replace("/painel");
  }, [db, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      router.push("/painel");
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Não foi possível entrar. Tente de novo.");
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="Entrar no painel"
      subtitle="Acompanhe os pedidos, edite o cardápio e abra ou feche a loja."
      aside={<OrderTicketPreview />}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="E-mail">
          {(p) => (
            <Input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        <Field label="Senha" error={error ?? undefined}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" disabled={busy || !email || !password}>
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>

      <div className="mt-8 rounded-card bg-surface p-4">
        <p className="text-sm font-medium">Quer ver antes de criar conta?</p>
        <p className="mt-1 text-sm text-muted">Abra o painel do Bar do Cais, um bar de exemplo com pedidos de hoje.</p>
        <Button
          className="mt-3"
          onClick={() => {
            enterDemo();
            router.push("/painel");
          }}
        >
          Abrir demonstração
        </Button>
      </div>

      <p className="mt-6 text-sm text-muted">
        Ainda não tem conta?{" "}
        <Link href="/criar-conta" className="font-medium text-accent hover:underline">
          Criar conta
        </Link>
      </p>
    </AuthFrame>
  );
}
