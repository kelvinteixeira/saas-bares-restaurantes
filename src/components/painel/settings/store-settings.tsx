"use client";

import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import type { Store } from "@/lib/types";
import { usePainel } from "@/components/painel/painel-context";
import { SaveBar, SettingsSection } from "@/components/painel/settings/section";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatPhone, onlyDigits } from "@/lib/format";
import { resizeImage } from "@/lib/image";
import { updateStore } from "@/lib/store/actions";
import { RESERVED_SLUGS } from "@/lib/store/auth";
import { StorageFullError } from "@/lib/store/db";
import { readableInk } from "@/lib/color";

/** Limpa o endereço enquanto a pessoa digita, sem apagar o hífen do fim. */
function typingSlug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40);
}

type Form = Pick<Store, "name" | "description" | "phone" | "address" | "slug" | "brandColor" | "logo">;

function pick(s: Store): Form {
  return {
    name: s.name,
    description: s.description,
    phone: s.phone,
    address: { ...s.address },
    slug: s.slug,
    brandColor: s.brandColor,
    logo: s.logo,
  };
}

export function StoreSettings() {
  const { db, store } = usePainel();
  const toast = useToast();
  const [form, setForm] = useState<Form>(() => pick(store));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(pick(store));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setAddress = (key: keyof Store["address"], value: string) =>
    setForm((f) => ({ ...f, address: { ...f.address, [key]: value } }));

  async function save() {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "O nome não pode ficar vazio.";
    const phone = onlyDigits(form.phone);
    if (phone && (phone.length < 10 || phone.length > 11)) next.phone = "Use DDD e número, por exemplo (81) 99999-0000.";
    if (!/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/.test(form.slug)) next.slug = "Use de 3 a 40 letras minúsculas, números ou hífen.";
    else if (RESERVED_SLUGS.has(form.slug)) next.slug = "Este endereço é reservado pelo sistema.";
    else if (db.stores.some((s) => s.slug === form.slug && s.id !== store.id)) next.slug = "Outra loja já usa este endereço.";
    if (!/^#[0-9a-f]{6}$/i.test(form.brandColor)) next.brandColor = "Use uma cor no formato #b84a00.";
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      await updateStore(store.id, (s) => {
        Object.assign(s, { ...form, name: form.name.trim(), phone, description: form.description.trim() });
      });
      toast("Dados da loja salvos");
    } catch (err) {
      toast(err instanceof StorageFullError || err instanceof Error ? err.message : "Não foi possível salvar.", "negative");
    }
  }

  async function pickLogo(file?: File) {
    if (!file) return;
    try {
      set("logo", await resizeImage(file, 320, 0.9));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Não foi possível usar esta imagem.", "negative");
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.host;

  return (
    <div>
      <SettingsSection title="Identidade" description="Como a loja aparece no topo do cardápio e no link que você divulga.">
        <div className="flex flex-col gap-4">
          <Field label="Nome da loja" error={errors.name}>
            {(p) => <Input {...p} value={form.name} onChange={(e) => set("name", e.target.value)} />}
          </Field>
          <Field label="Frase de apresentação" hint="Aparece embaixo do nome. Uma linha basta.">
            {(p) => <Textarea {...p} rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />}
          </Field>
          <Field label="Endereço do cardápio" error={errors.slug} hint={`${origin}/${form.slug}`}>
            {(p) => (
              <div className="flex items-center overflow-hidden rounded-[10px] border border-line bg-surface focus-within:border-accent">
                <span className="flex-none pl-3 text-sm text-muted">{origin}/</span>
                <input
                  {...p}
                  className="h-10 min-w-0 flex-1 bg-transparent pr-3 text-sm outline-none"
                  value={form.slug}
                  onChange={(e) => set("slug", typingSlug(e.target.value))}
                />
              </div>
            )}
          </Field>
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label={form.logo ? "Trocar logo" : "Enviar logo"}
              className="grid size-20 flex-none place-items-center overflow-hidden rounded-full border border-dashed border-control bg-surface text-muted hover:border-ink hover:text-ink"
            >
              {form.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.logo} alt="" className="size-full object-cover" />
              ) : (
                <ImagePlus className="size-5" strokeWidth={1.5} aria-hidden="true" />
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                void pickLogo(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="pt-1 text-sm">
              <p className="font-medium">Logo</p>
              <p className="text-muted">Quadrado, de preferência. Aparece redondo no cardápio.</p>
              {form.logo && (
                <button type="button" onClick={() => set("logo", undefined)} className="mt-1 text-sm font-medium text-negative hover:underline">
                  Remover logo
                </button>
              )}
            </div>
          </div>
          <Field label="Cor da marca" error={errors.brandColor} hint="Usada no topo do cardápio e nos botões do cliente.">
            {(p) => (
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label="Escolher cor"
                  value={/^#[0-9a-f]{6}$/i.test(form.brandColor) ? form.brandColor : "#000000"}
                  onChange={(e) => set("brandColor", e.target.value)}
                  className="h-10 w-12 flex-none cursor-pointer rounded-[10px] border border-line bg-surface p-1"
                />
                <Input {...p} value={form.brandColor} onChange={(e) => set("brandColor", e.target.value)} className="w-32 font-mono" />
                <span
                  className="inline-flex h-10 flex-none items-center rounded-full px-4 text-sm font-medium"
                  style={{ background: form.brandColor, color: readableInk(form.brandColor) }}
                >
                  Adicionar à sacola
                </span>
              </div>
            )}
          </Field>
        </div>
        <SaveBar dirty={dirty} onSave={save} onReset={() => {
          setForm(pick(store));
          setErrors({});
        }} />
      </SettingsSection>

      <SettingsSection title="Contato e endereço" description="O WhatsApp recebe os clientes que querem falar com a loja. O endereço aparece para quem vai retirar.">
        <div className="flex flex-col gap-4">
          <Field label="WhatsApp" error={errors.phone}>
            {(p) => (
              <Input {...p} inputMode="tel" autoComplete="tel" value={formatPhone(form.phone)} onChange={(e) => set("phone", onlyDigits(e.target.value))} />
            )}
          </Field>
          <div className="grid grid-cols-[1fr_96px] gap-3">
            <Field label="Rua">{(p) => <Input {...p} value={form.address.street} onChange={(e) => setAddress("street", e.target.value)} />}</Field>
            <Field label="Número">{(p) => <Input {...p} value={form.address.number} onChange={(e) => setAddress("number", e.target.value)} />}</Field>
          </div>
          <div className="grid grid-cols-[1fr_1fr_72px] gap-3">
            <Field label="Bairro">{(p) => <Input {...p} value={form.address.district} onChange={(e) => setAddress("district", e.target.value)} />}</Field>
            <Field label="Cidade">{(p) => <Input {...p} value={form.address.city} onChange={(e) => setAddress("city", e.target.value)} />}</Field>
            <Field label="UF">
              {(p) => <Input {...p} maxLength={2} value={form.address.state} onChange={(e) => setAddress("state", e.target.value.toUpperCase())} />}
            </Field>
          </div>
        </div>
        <SaveBar dirty={dirty} onSave={save} onReset={() => {
          setForm(pick(store));
          setErrors({});
        }} />
      </SettingsSection>
    </div>
  );
}
