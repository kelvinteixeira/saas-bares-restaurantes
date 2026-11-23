"use client";

import { useRef, useState } from "react";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import type { Category, OptionGroup, Product } from "@/lib/types";
import { groupRule } from "@/lib/domain/pricing";
import { moneyInput, parseMoney } from "@/lib/format";
import { newId } from "@/lib/ids";
import { resizeImage } from "@/lib/image";
import { deleteProduct, saveProduct } from "@/lib/store/actions";
import { StorageFullError } from "@/lib/store/db";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea, inputClass } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

interface DraftOption {
  id: string;
  name: string;
  priceText: string;
  available: boolean;
}
interface DraftGroup {
  id: string;
  name: string;
  minText: string;
  maxText: string;
  options: DraftOption[];
}
interface Draft {
  name: string;
  description: string;
  priceText: string;
  categoryId: string;
  image?: string;
  available: boolean;
  groups: DraftGroup[];
}

function toDraft(p: Product): Draft {
  return {
    name: p.name,
    description: p.description,
    priceText: p.price ? moneyInput(p.price) : "",
    categoryId: p.categoryId,
    image: p.image,
    available: p.available,
    groups: p.optionGroups.map((g) => ({
      id: g.id,
      name: g.name,
      minText: String(g.min),
      maxText: String(g.max),
      options: g.options.map((o) => ({ id: o.id, name: o.name, priceText: o.price ? moneyInput(o.price) : "", available: o.available })),
    })),
  };
}

type Errors = Record<string, string>;

function fromDraft(d: Draft, base: Product): { product?: Product; errors: Errors } {
  const errors: Errors = {};
  if (!d.name.trim()) errors.name = "Dê um nome ao item.";
  const price = d.priceText.trim() === "" ? null : parseMoney(d.priceText);
  if (price === null) errors.price = "Informe o preço, por exemplo 24,90.";
  const groups: OptionGroup[] = d.groups.map((g) => {
    const min = Number(g.minText);
    const max = Number(g.maxText);
    if (!g.name.trim()) errors[`group:${g.id}`] = "Dê um nome ao grupo, por exemplo Tamanho.";
    else if (!g.options.length) errors[`group:${g.id}`] = "Adicione pelo menos uma opção.";
    else if (!Number.isInteger(min) || min < 0) errors[`group:${g.id}`] = "O mínimo precisa ser 0 ou mais.";
    else if (!Number.isInteger(max) || max < 1 || max < min) errors[`group:${g.id}`] = "O máximo precisa ser pelo menos 1 e não menor que o mínimo.";
    else if (min > g.options.length) errors[`group:${g.id}`] = "O mínimo é maior que o número de opções.";
    return {
      id: g.id,
      name: g.name.trim(),
      min,
      max,
      options: g.options.map((o) => {
        const p = o.priceText.trim() === "" ? 0 : parseMoney(o.priceText);
        if (!o.name.trim()) errors[`option:${o.id}`] = "Nome da opção";
        else if (p === null) errors[`option:${o.id}`] = "Preço inválido";
        return { id: o.id, name: o.name.trim(), price: p ?? 0, available: o.available };
      }),
    };
  });
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    product: {
      ...base,
      name: d.name.trim(),
      description: d.description.trim(),
      price: price!,
      categoryId: d.categoryId,
      image: d.image,
      available: d.available,
      optionGroups: groups,
    },
  };
}

export function ProductEditor({
  product,
  categories,
  isNew,
  onDone,
}: {
  product: Product;
  categories: Category[];
  isNew: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(product));
  const [errors, setErrors] = useState<Errors>({});
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (change: (d: Draft) => Draft) => {
    setDraft((d) => change(d));
    setDirty(true);
  };
  const updateGroup = (id: string, change: (g: DraftGroup) => DraftGroup) =>
    update((d) => ({ ...d, groups: d.groups.map((g) => (g.id === id ? change(g) : g)) }));

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file);
      update((d) => ({ ...d, image: dataUrl }));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Não foi possível usar esta imagem.", "negative");
    }
  }

  function save() {
    const { product: next, errors: errs } = fromDraft(draft, product);
    setErrors(errs);
    if (!next) {
      toast("Confira os campos marcados.", "negative");
      return;
    }
    try {
      saveProduct(next);
      setDirty(false);
      toast(isNew ? "Item criado" : "Alterações salvas");
      if (isNew) onDone();
    } catch (err) {
      toast(err instanceof StorageFullError ? err.message : "Não foi possível salvar.", "negative");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{isNew ? "Novo item" : "Editar item"}</h2>
        {dirty && <span className="text-xs text-warning">Alterações não salvas</span>}
      </div>

      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group relative grid size-24 flex-none place-items-center overflow-hidden rounded-card border border-dashed border-control bg-raised text-muted hover:border-ink hover:text-ink"
          aria-label={draft.image ? "Trocar foto" : "Enviar foto"}
        >
          {draft.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.image} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-xs">
              <ImagePlus className="size-5" strokeWidth={1.5} aria-hidden="true" />
              Foto
            </span>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            void onPickImage(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <div className="flex flex-1 flex-col gap-1.5 pt-1 text-sm">
          <p className="text-muted">JPG, PNG ou WebP. A foto é reduzida para 800 px antes de salvar.</p>
          {draft.image && (
            <button
              type="button"
              onClick={() => update((d) => ({ ...d, image: undefined }))}
              className="w-fit text-sm font-medium text-negative hover:underline"
            >
              Remover foto
            </button>
          )}
        </div>
      </div>

      <Field label="Nome" error={errors.name}>
        {(p) => <Input {...p} value={draft.name} onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} />}
      </Field>
      <Field label="Descrição" hint="O que vem, quantas pessoas serve, tamanho.">
        {(p) => (
          <Textarea {...p} rows={3} value={draft.description} onChange={(e) => update((d) => ({ ...d, description: e.target.value }))} />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Preço (R$)" error={errors.price}>
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              placeholder="0,00"
              value={draft.priceText}
              onChange={(e) => update((d) => ({ ...d, priceText: e.target.value }))}
            />
          )}
        </Field>
        <Field label="Categoria">
          {(p) => (
            <Select {...p} value={draft.categoryId} onChange={(e) => update((d) => ({ ...d, categoryId: e.target.value }))}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="flex items-center justify-between rounded-card bg-raised px-3 py-2.5">
        <span>
          <span className="block text-sm font-medium">Disponível para pedir</span>
          <span className="block text-xs text-muted">Desligado, aparece como esgotado no cardápio.</span>
        </span>
        <Switch checked={draft.available} onChange={(v) => update((d) => ({ ...d, available: v }))} label="Disponível para pedir" />
      </div>

      <div className="border-t border-rule pt-4">
        <h3 className="text-sm font-semibold">Opções e adicionais</h3>
        <p className="mt-1 text-[13px] text-muted">Tamanhos, sabores, ponto da carne, adicionais pagos.</p>
        <div className="mt-3 flex flex-col gap-3">
          {draft.groups.map((g) => {
            const min = Number(g.minText);
            const max = Number(g.maxText);
            const preview =
              Number.isInteger(min) && Number.isInteger(max) && max >= 1
                ? groupRule({ id: g.id, name: g.name, min, max, options: [] })
                : "—";
            return (
              <fieldset key={g.id} className="rounded-card border border-line p-3">
                <legend className="sr-only">Grupo {g.name || "sem nome"}</legend>
                <div className="flex items-end gap-2">
                  <Field label="Nome do grupo" className="flex-1">
                    {(p) => (
                      <Input
                        {...p}
                        placeholder="Tamanho"
                        value={g.name}
                        onChange={(e) => updateGroup(g.id, (x) => ({ ...x, name: e.target.value }))}
                      />
                    )}
                  </Field>
                  <button
                    type="button"
                    aria-label={`Apagar grupo ${g.name}`}
                    onClick={() => update((d) => ({ ...d, groups: d.groups.filter((x) => x.id !== g.id) }))}
                    className="grid size-10 place-items-center rounded-control text-muted hover:bg-pill-negative-bg hover:text-negative"
                  >
                    <Trash2 className="size-4" strokeWidth={1.5} />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_1fr_1.4fr] items-end gap-2">
                  <Field label="Mínimo">
                    {(p) => (
                      <Input
                        {...p}
                        inputMode="numeric"
                        value={g.minText}
                        onChange={(e) => updateGroup(g.id, (x) => ({ ...x, minText: e.target.value.replace(/\D/g, "") }))}
                      />
                    )}
                  </Field>
                  <Field label="Máximo">
                    {(p) => (
                      <Input
                        {...p}
                        inputMode="numeric"
                        value={g.maxText}
                        onChange={(e) => updateGroup(g.id, (x) => ({ ...x, maxText: e.target.value.replace(/\D/g, "") }))}
                      />
                    )}
                  </Field>
                  <p className="pb-2.5 text-[13px] text-muted">
                    Cliente vê: <span className="font-medium text-ink">{preview}</span>
                  </p>
                </div>
                {errors[`group:${g.id}`] && <p className="mt-2 text-xs text-negative">{errors[`group:${g.id}`]}</p>}

                <div className="mt-3">
                  <div className="grid grid-cols-[1fr_88px_36px_32px] gap-2 pb-1 text-xs text-muted">
                    <span>Opção</span>
                    <span>Acréscimo</span>
                    <span className="sr-only">Disponível</span>
                    <span className="sr-only">Remover</span>
                  </div>
                  {g.options.map((o) => (
                    <div key={o.id} className="grid grid-cols-[1fr_88px_36px_32px] items-center gap-2 py-1">
                      <input
                        aria-label="Nome da opção"
                        aria-invalid={errors[`option:${o.id}`] ? true : undefined}
                        className={cn(inputClass, "h-9")}
                        value={o.name}
                        onChange={(e) =>
                          updateGroup(g.id, (x) => ({
                            ...x,
                            options: x.options.map((y) => (y.id === o.id ? { ...y, name: e.target.value } : y)),
                          }))
                        }
                      />
                      <input
                        aria-label={`Acréscimo de ${o.name || "opção"} em reais`}
                        inputMode="decimal"
                        placeholder="0,00"
                        className={cn(inputClass, "num h-9 text-right")}
                        value={o.priceText}
                        onChange={(e) =>
                          updateGroup(g.id, (x) => ({
                            ...x,
                            options: x.options.map((y) => (y.id === o.id ? { ...y, priceText: e.target.value } : y)),
                          }))
                        }
                      />
                      <Switch
                        checked={o.available}
                        label={`${o.name || "Opção"} disponível`}
                        onChange={(v) =>
                          updateGroup(g.id, (x) => ({
                            ...x,
                            options: x.options.map((y) => (y.id === o.id ? { ...y, available: v } : y)),
                          }))
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Remover opção ${o.name}`}
                        onClick={() => updateGroup(g.id, (x) => ({ ...x, options: x.options.filter((y) => y.id !== o.id) }))}
                        className="grid size-8 place-items-center rounded-control text-muted hover:bg-pill-negative-bg hover:text-negative"
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}
                  {g.options.some((o) => errors[`option:${o.id}`]) && (
                    <p className="mt-1 text-xs text-negative">Toda opção precisa de nome, e o acréscimo precisa ser um valor válido.</p>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      updateGroup(g.id, (x) => ({
                        ...x,
                        options: [...x.options, { id: newId(), name: "", priceText: "", available: true }],
                      }))
                    }
                    className="mt-1 inline-flex h-8 items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                  >
                    <Plus className="size-4" strokeWidth={1.5} aria-hidden="true" />
                    Adicionar opção
                  </button>
                </div>
              </fieldset>
            );
          })}
          <Button
            onClick={() =>
              update((d) => ({
                ...d,
                groups: [
                  ...d.groups,
                  { id: newId(), name: "", minText: "1", maxText: "1", options: [{ id: newId(), name: "", priceText: "", available: true }] },
                ],
              }))
            }
          >
            <Plus className="size-4" strokeWidth={1.5} aria-hidden="true" />
            Adicionar grupo de opções
          </Button>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-5 mt-2 flex items-center gap-2 border-t border-rule bg-surface px-5 py-3">
        <Button variant="primary" onClick={save} className="flex-1">
          {isNew ? "Criar item" : "Salvar alterações"}
        </Button>
        <Button onClick={onDone}>{dirty ? "Descartar" : "Fechar"}</Button>
        {!isNew && (
          <Button variant="danger" onClick={() => setConfirmDelete(true)} aria-label="Apagar item">
            <Trash2 className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </Button>
        )}
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Apagar "${product.name}"?`}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmDelete(false)}>Manter</Button>
            <Button
              variant="danger"
              onClick={() => {
                deleteProduct(product.id);
                setConfirmDelete(false);
                toast("Item apagado");
                onDone();
              }}
            >
              Apagar item
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6">
          O item sai do cardápio na hora. Pedidos antigos continuam com o nome e o preço da época. Para tirar só por hoje,
          desligue &quot;Disponível para pedir&quot;.
        </p>
      </Modal>
    </div>
  );
}
