"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Plus, UtensilsCrossed } from "lucide-react";
import type { Category, Product } from "@/lib/types";
import { usePainel } from "@/components/painel/painel-context";
import { PageHeader } from "@/components/painel/page-header";
import { ProductEditor } from "@/components/painel/product-editor";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { attempt, useToast } from "@/components/ui/toast";
import { useMediaQuery } from "@/lib/hooks";
import { fromPrice, hasVariablePrice } from "@/lib/domain/pricing";
import { formatMoney } from "@/lib/format";
import {
  addCategory,
  fillSampleMenu,
  deleteCategory,
  moveCategory,
  moveProduct,
  newProduct,
  setProductAvailable,
  updateCategory,
} from "@/lib/store/actions";
import { cn } from "@/lib/cn";

const SUGGESTED = ["Petiscos", "Pratos", "Lanches", "Bebidas", "Sobremesas"];

export default function CardapioPage() {
  const { db, store } = usePainel();
  const toast = useToast();
  const wide = useMediaQuery("(min-width: 1280px)");
  const categories = db.categories.filter((c) => c.storeId === store.id).sort((a, b) => a.position - b.position);
  const products = db.products.filter((p) => p.storeId === store.id);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ product: Product; isNew: boolean } | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);

  const current = categories.find((c) => c.id === categoryId) ?? categories[0] ?? null;
  const items = current
    ? products.filter((p) => p.categoryId === current.id).sort((a, b) => a.position - b.position)
    : [];
  const soldOut = products.filter((p) => !p.available).length;

  const create = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      toast("Já existe uma categoria com esse nome.", "negative");
      return;
    }
    const id = await attempt(toast, () => addCategory(store.id, trimmed));
    if (!id) return;
    setCategoryId(id);
    setNewCategory("");
  };

  const startNewItem = () => {
    if (!current) return;
    setEditing({ product: newProduct(store.id, current.id), isNew: true });
  };

  // O editor sempre recebe a versão mais recente do item salvo.
  const editingProduct = editing
    ? editing.isNew
      ? editing.product
      : products.find((p) => p.id === editing.product.id) ?? null
    : null;

  const editor = editing && editingProduct && (
    <ProductEditor
      key={editingProduct.id}
      product={editingProduct}
      categories={categories}
      isNew={editing.isNew}
      onDone={() => setEditing(null)}
      showTitle={wide}
    />
  );

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      <PageHeader
        title="Cardápio"
        subtitle={
          <span className="num">
            {categories.length} {categories.length === 1 ? "categoria" : "categorias"} · {products.length}{" "}
            {products.length === 1 ? "item" : "itens"}
            {soldOut > 0 && ` · ${soldOut} ${soldOut === 1 ? "esgotado" : "esgotados"}`}
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/${store.slug}`} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" strokeWidth={1.5} aria-hidden="true" />
              Ver como cliente
            </ButtonLink>
            <Button variant="primary" onClick={startNewItem} disabled={!current}>
              <Plus className="size-4" strokeWidth={1.5} aria-hidden="true" />
              Novo item
            </Button>
          </>
        }
      />

      {categories.length === 0 ? (
        <>
        <section className="mt-6 max-w-[640px] rounded-card bg-raised p-5">
          <h2 className="text-base font-semibold">Quer ver como fica antes?</h2>
          <p className="mt-1 text-sm text-muted">
            Preenche a loja com um cardápio de bar de exemplo: 5 categorias e 17 itens com tamanhos, sabores e
            adicionais. Se a entrega ainda não estiver configurada, liga também bairros de exemplo e 10 mesas. Dá para
            editar ou apagar tudo depois.
          </p>
          <Button
            variant="primary"
            className="mt-4"
            onClick={async () => {
              const added = await attempt(toast, () => fillSampleMenu(store.id));
              if (added !== undefined) toast(added ? "Cardápio de exemplo adicionado" : "O cardápio de exemplo já está na loja.");
            }}
          >
            Preencher com cardápio de exemplo
          </Button>
        </section>
        <section className="mt-6 max-w-[640px] rounded-card border border-line p-5">
          <h2 className="text-base font-semibold">Comece pelas categorias</h2>
          <p className="mt-1 text-sm text-muted">
            São as seções que o cliente vê no topo do cardápio. Toque numa sugestão ou escreva a sua.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTED.map((s) => (
              <Button key={s} size="sm" onClick={() => create(s)}>
                <Plus className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                {s}
              </Button>
            ))}
          </div>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create(newCategory);
            }}
          >
            <label htmlFor="first-category" className="sr-only">
              Nome da categoria
            </label>
            <Input id="first-category" placeholder="Outra categoria" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
            <Button type="submit">Adicionar</Button>
          </form>
        </section>
        </>
      ) : (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[232px_1fr] xl:grid-cols-[220px_1fr_400px]">
          {/* Categorias */}
          <section aria-label="Categorias" className="rounded-card border border-line">
            <h2 className="px-4 pt-4 pb-2 text-base font-semibold">Categorias</h2>
            <ul className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible">
              {categories.map((c) => {
                const count = products.filter((p) => p.categoryId === c.id).length;
                const on = c.id === current?.id;
                return (
                  <li key={c.id} className="flex-none">
                    <button
                      type="button"
                      aria-current={on ? "true" : undefined}
                      onClick={() => setCategoryId(c.id)}
                      className={cn(
                        "flex h-10 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-sm whitespace-nowrap lg:h-9",
                        on ? "bg-active font-medium" : "hover:bg-raised",
                      )}
                    >
                      <span className={cn("flex-1 truncate", !c.visible && "text-muted")}>{c.name}</span>
                      {!c.visible && <Pill>Oculta</Pill>}
                      <span className="num text-xs text-muted">{count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {current && (
              <div className="border-t border-rule px-4 py-3">
                <CategoryControls
                  key={current.id}
                  category={current}
                  isFirst={categories[0].id === current.id}
                  isLast={categories[categories.length - 1].id === current.id}
                  onDelete={() => setConfirmDelete(current)}
                  storeId={store.id}
                  takenNames={categories.filter((c) => c.id !== current.id).map((c) => c.name.toLowerCase())}
                />
              </div>
            )}
            <form
              className="flex gap-2 border-t border-rule p-3"
              onSubmit={(e) => {
                e.preventDefault();
                create(newCategory);
              }}
            >
              <label htmlFor="new-category" className="sr-only">
                Nova categoria
              </label>
              <Input id="new-category" placeholder="Nova categoria" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="h-9" />
              <Button type="submit" aria-label="Adicionar categoria" disabled={!newCategory.trim()}>
                <Plus className="size-4" strokeWidth={1.5} />
              </Button>
            </form>
          </section>

          {/* Itens da categoria */}
          <section aria-label={`Itens de ${current?.name ?? ""}`} className="min-w-0 rounded-card border border-line">
            <div className="flex min-h-12 items-center justify-between gap-3 px-4 pt-4 pb-2">
              <h2 className="truncate text-base font-semibold">{current?.name}</h2>
              <span className="num text-sm text-muted">
                {items.length} {items.length === 1 ? "item" : "itens"}
              </span>
            </div>
            {items.length === 0 ? (
              <div className="px-4 pb-4">
                <p className="rounded-card border border-dashed border-control px-4 py-3 text-sm text-muted">
                  Nenhum item em {current?.name}.{" "}
                  <button type="button" onClick={startNewItem} className="font-medium text-accent hover:underline">
                    Adicionar o primeiro
                  </button>
                </p>
              </div>
            ) : (
              <ul>
                {items.map((p, i) => (
                  <li
                    key={p.id}
                    className={cn(
                      "relative grid grid-cols-[48px_1fr_auto] items-center gap-3 border-t border-rule px-4 py-3 sm:grid-cols-[48px_1fr_auto_auto_auto]",
                      !p.available && "[&_img]:opacity-60",
                      editingProduct?.id === p.id ? "bg-active" : "hover:bg-raised/60",
                    )}
                  >
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="size-12 rounded-[8px] object-cover" />
                    ) : (
                      <span className="grid size-12 place-items-center rounded-[8px] bg-raised text-muted" aria-hidden="true">
                        <UtensilsCrossed className="size-4" strokeWidth={1.5} />
                      </span>
                    )}
                    <span className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setEditing({ product: p, isNew: false })}
                        className="block max-w-full truncate text-left text-sm font-medium after:absolute after:inset-0 after:content-['']"
                      >
                        {p.name}
                      </button>
                      <span className="block truncate text-[13px] text-muted">
                        {!p.available && <span className="font-medium text-negative">Esgotado · </span>}
                        {p.optionGroups.length > 0 ? `${p.optionGroups.map((g) => g.name).join(", ")} · ` : ""}
                        {p.description || "Sem descrição"}
                      </span>
                    </span>
                    <span className="num text-right text-sm">
                      {hasVariablePrice(p) && <span className="block text-xs text-muted">a partir de</span>}
                      {formatMoney(fromPrice(p))}
                    </span>
                    <span className="relative z-10 col-start-2 flex items-center gap-2 sm:col-start-auto" title={p.available ? "Disponível" : "Esgotado"}>
                      <Switch
                        checked={p.available}
                        onChange={(v) =>
                          void attempt(
                            toast,
                            () => setProductAvailable(p.id, v),
                            v ? `${p.name} voltou ao cardápio` : `${p.name} marcado como esgotado`,
                          )
                        }
                        label={`${p.name} disponível para pedir`}
                      />
                      <span className="text-xs text-muted sm:hidden">{p.available ? "Disponível" : "Esgotado"}</span>
                    </span>
                    <span className="relative z-10 hidden items-center sm:flex">
                      <button
                        type="button"
                        aria-label={`Subir ${p.name}`}
                        disabled={i === 0}
                        onClick={() => void attempt(toast, () => moveProduct(p.categoryId, p.id, -1))}
                        className="grid size-8 place-items-center rounded-control text-muted hover:bg-active hover:text-ink disabled:opacity-30"
                      >
                        <ChevronUp className="size-4" strokeWidth={1.5} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Descer ${p.name}`}
                        disabled={i === items.length - 1}
                        onClick={() => void attempt(toast, () => moveProduct(p.categoryId, p.id, 1))}
                        className="grid size-8 place-items-center rounded-control text-muted hover:bg-active hover:text-ink disabled:opacity-30"
                      >
                        <ChevronDown className="size-4" strokeWidth={1.5} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Editor: coluna fixa no desktop largo, folha por baixo nas telas menores. */}
          {wide && (
            <aside aria-label="Editor do item" className="sticky top-6 max-h-[calc(100dvh-120px)] overflow-y-auto rounded-card border border-line px-5 pt-4">
              {editor ?? (
                <div className="pb-5">
                  <h2 className="text-base font-semibold">Editor</h2>
                  <p className="mt-2 text-sm text-muted">
                    Escolha um item para mudar nome, preço, foto e opções, ou crie um novo em {current?.name}.
                  </p>
                  <Button className="mt-4" onClick={startNewItem}>
                    <Plus className="size-4" strokeWidth={1.5} aria-hidden="true" />
                    Novo item
                  </Button>
                </div>
              )}
            </aside>
          )}
        </div>
      )}

      {!wide && (
        <Modal open={Boolean(editor)} onClose={() => setEditing(null)} title={editing?.isNew ? "Novo item" : editingProduct?.name ?? "Item"}>
          {editor}
        </Modal>
      )}

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title={`Apagar a categoria "${confirmDelete?.name}"?`}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmDelete(null)}>Manter</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirmDelete) return;
                const target = confirmDelete;
                setConfirmDelete(null);
                const done = await attempt(toast, () => deleteCategory(target.id).then(() => true), "Categoria apagada");
                if (!done) return;
                setCategoryId(null);
                setEditing(null);
              }}
            >
              Apagar categoria e itens
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6">
          {(() => {
            const n = confirmDelete ? products.filter((p) => p.categoryId === confirmDelete.id).length : 0;
            return n === 0
              ? "A categoria está vazia."
              : `Os ${n} ${n === 1 ? "item" : "itens"} dela também ${n === 1 ? "será apagado" : "serão apagados"}.`;
          })()}{" "}
          Para esconder sem perder nada, use &quot;Mostrar no cardápio&quot;.
        </p>
      </Modal>
    </div>
  );
}

function CategoryControls({
  category,
  isFirst,
  isLast,
  onDelete,
  storeId,
  takenNames,
}: {
  category: Category;
  isFirst: boolean;
  isLast: boolean;
  onDelete: () => void;
  storeId: string;
  takenNames: string[];
}) {
  const [name, setName] = useState(category.name);
  const changed = name.trim() !== category.name && name.trim().length > 0;
  const duplicate = changed && takenNames.includes(name.trim().toLowerCase());
  const toast = useToast();
  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (changed && !duplicate) void attempt(toast, () => updateCategory(category.id, (c) => (c.name = name.trim())));
        }}
      >
        <Field label="Nome da categoria" error={duplicate ? "Já existe uma categoria com esse nome." : undefined}>
          {(p) => (
            <div className="flex gap-2">
              <Input {...p} value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
              {changed && !duplicate && (
                <Button type="submit" size="sm" className="h-9">
                  Salvar
                </Button>
              )}
            </div>
          )}
        </Field>
      </form>
      <div className="flex items-center justify-between">
        <span className="text-sm">Mostrar no cardápio</span>
        <Switch
          checked={category.visible}
          onChange={(v) => void attempt(toast, () => updateCategory(category.id, (c) => (c.visible = v)))}
          label="Mostrar categoria no cardápio"
        />
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" disabled={isFirst} onClick={() => void attempt(toast, () => moveCategory(storeId, category.id, -1))} aria-label="Subir categoria">
          <ChevronUp className="size-4" strokeWidth={1.5} />
        </Button>
        <Button size="sm" disabled={isLast} onClick={() => void attempt(toast, () => moveCategory(storeId, category.id, 1))} aria-label="Descer categoria">
          <ChevronDown className="size-4" strokeWidth={1.5} />
        </Button>
        <Button size="sm" variant="danger" className="ml-auto" onClick={onDelete}>
          Apagar
        </Button>
      </div>
    </div>
  );
}
