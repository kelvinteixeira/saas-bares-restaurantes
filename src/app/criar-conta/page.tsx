"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthFrame } from "@/components/auth/auth-frame";
import { OrderTicketPreview } from "@/components/auth/order-ticket-preview";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { AuthError, signUp } from "@/lib/store/auth";

type Errors = Partial<Record<"name" | "storeName" | "email" | "password" | "form", string>>;

export default function CriarContaPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", storeName: "", email: "", password: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function validate(): Errors {
    const next: Errors = {};
    if (!form.name.trim()) next.name = "Diga como podemos te chamar.";
    if (!form.storeName.trim()) next.storeName = "Coloque o nome que o cliente vê na fachada.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "Confira o e-mail.";
    if (form.password.length < 8) next.password = "A senha precisa de pelo menos 8 caracteres.";
    return next;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await signUp(form);
      router.push("/painel");
    } catch (err) {
      setErrors({ email: err instanceof AuthError ? err.message : "Não foi possível criar a conta." });
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="Criar conta"
      subtitle="Em poucos minutos seu cardápio fica no ar com um link próprio e QR code para as mesas."
      aside={<OrderTicketPreview />}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Seu nome" error={errors.name}>
          {(p) => <Input {...p} autoComplete="name" value={form.name} onChange={set("name")} />}
        </Field>
        <Field label="Nome do bar ou restaurante" error={errors.storeName}>
          {(p) => <Input {...p} autoComplete="organization" value={form.storeName} onChange={set("storeName")} />}
        </Field>
        <Field label="E-mail" error={errors.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={set("email")} />}
        </Field>
        <Field label="Senha" hint="Pelo menos 8 caracteres." error={errors.password}>
          {(p) => (
            <Input {...p} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {busy ? "Criando…" : "Criar conta"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Já tem conta?{" "}
        <Link href="/entrar" className="font-medium text-accent hover:underline">
          Entrar
        </Link>
      </p>
    </AuthFrame>
  );
}
