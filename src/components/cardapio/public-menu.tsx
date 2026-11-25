"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MapPin, MessageCircle, Search, ShoppingBag, X } from "lucide-react";
import type { Product } from "@/lib/types";
import { usePublicStore } from "@/components/cardapio/use-public-store";
import { useCart } from "@/components/cardapio/cart";
import { BrandScope, StoreLogo, brandButton } from "@/components/cardapio/brand";
import { ItemSheet } from "@/components/cardapio/item-sheet";
import { CartSummary, cartSubtotal } from "@/components/cardapio/cart-panel";
import { Modal } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { useNow } from "@/lib/hooks";
import { storeStatus } from "@/lib/domain/hours";
import { canSchedule } from "@/lib/domain/schedule";
import { fromPrice, hasVariablePrice, lowestDeliveryFee } from "@/lib/domain/pricing";
import { formatMoney, formatPhone, onlyDigits } from "@/lib/format";
import { cn } from "@/lib/cn";
import { DEMO_PHOTO_PREFIX } from "@/lib/demo-photos";

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function PublicMenu({ slug, mesa }: { slug: string; mesa: number | null }) {
  const data = usePublicStore(slug);
  const cart = useCart();
  const toast = useToast();
  const now = useNow(30000);
  const [query, setQuery] = useState("");
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  const store = data.state === "ready" ? data.store : null;
  const { setTable } = cart;

  // A mesa vem só do endereço (QR code com ?mesa=N). Abrir o link normal do cardápio limpa a mesa,
  // para quem abriu o QR antes não continuar "na mesa" depois.
  useEffect(() => {
    if (!store || !cart.loaded) return;
    const valid = mesa !== null && store.table.enabled && mesa >= 1 && mesa <= store.table.count;
    setTable(valid ? mesa : null);
  }, [store, mesa, cart.loaded, setTable]);

  // Destaca a categoria visível enquanto a pessoa rola.
  const categoryIds = data.state === "ready" ? data.categories.map((c) => c.id).join(",") : "";
  useEffect(() => {
    if (!categoryIds) return;
    const sections = categoryIds.split(",").map((id) => document.getElementById(`cat-${id}`)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveCat(visible[0].target.id.replace("cat-", ""));
      },
      { rootMargin: "-96px 0px -65% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [categoryIds, query]);

  useEffect(() => {
    if (!activeCat) return;
    navRef.current?.querySelector(`[data-cat="${activeCat}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeCat]);

  const filtered = useMemo(() => {
    if (data.state !== "ready") return [];
    const q = normalize(query.trim());
    return data.categories
      .map((c) => ({
        category: c,
        items: data.products.filter(
          (p) => p.categoryId === c.id && (!q || normalize(`${p.name} ${p.description}`).includes(q)),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [data, query]);

  if (data.state === "loading") {
    return <div className="min-h-dvh bg-surface" aria-busy="true" />;
  }
  if (data.state === "missing") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center px-4">
        <h1 className="text-[24px] leading-8 font-semibold">Cardápio não encontrado</h1>
        <p className="mt-2 text-[15px] text-muted">
          O endereço /{slug} não corresponde a nenhuma loja. Confira o link ou o QR code com o estabelecimento.
        </p>
        <Link href="/" className="mt-6 text-sm font-medium text-accent hover:underline">
          Ir para a página inicial
        </Link>
      </main>
    );
  }

  const { store: s, products } = data;
  const status = storeStatus(s, now);
  const tableMode = cart.table !== null && s.table.enabled;
  const anyMode = tableMode || s.delivery.enabled || s.pickup.enabled;
  // Fechada agora, mas aceita agendar (não vale para a mesa): dá para montar a sacola e agendar.
  const schedulable = canSchedule(s, tableMode ? "table" : null);
  const canOrder = (status.open || schedulable) && anyMode;
  const closedLabel = !status.open ? "Loja fechada agora" : "Pedidos indisponíveis";
  const lowestFee = lowestDeliveryFee(s);
  const subtotal = cartSubtotal(cart.lines, products);
  const currentCat = activeCat ?? data.categories[0]?.id ?? null;

  return (
    <BrandScope store={s} className={cn(cart.count > 0 && "pb-24 lg:pb-0")}>
      {/* Faixa da marca: a cor do restaurante, cheia. */}
      <div className="h-28 bg-[var(--brand)] sm:h-36" />

      <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
        <header className="-mt-10 flex flex-col gap-3 sm:-mt-12">
          <StoreLogo store={s} size={88} className="sm:size-24" />
          <div>
            <h1 className="text-[26px] leading-8 font-semibold tracking-[-0.02em] sm:text-[32px] sm:leading-10">{s.name}</h1>
            {s.description && <p className="mt-1 max-w-[60ch] text-[15px] leading-6 text-muted">{s.description}</p>}
          </div>
          <p className="flex items-center gap-2 text-[15px]">
            <span aria-hidden="true" className={cn("size-2 rounded-full", status.open ? "bg-positive" : "bg-negative")} />
            <span className={cn("font-medium", status.open ? "text-positive" : "text-ink")}>{status.label}</span>
          </p>
          <ul className={cn("flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted", tableMode && "hidden")}>
            {s.delivery.enabled && lowestFee !== null && (
              <li>
                Entrega {s.delivery.etaMin}–{s.delivery.etaMax} min · a partir de {formatMoney(lowestFee)}
              </li>
            )}
            {s.delivery.enabled && s.delivery.minOrder > 0 && <li>Pedido mínimo {formatMoney(s.delivery.minOrder)}</li>}
            {s.pickup.enabled && (
              <li>
                Retirada {s.pickup.etaMin}–{s.pickup.etaMax} min
              </li>
            )}
          </ul>
          {tableMode && (
            <div className="flex items-center justify-between gap-3 rounded-card bg-raised px-4 py-3">
              <p className="text-[15px]">
                Você está na <span className="font-semibold">Mesa {cart.table}</span>. O pedido vai direto para a cozinha.
              </p>
              <button type="button" onClick={() => setTable(null)} className="flex-none text-sm font-medium text-muted hover:text-ink">
                Não estou na mesa
              </button>
            </div>
          )}
          {!status.open && (
            <p className="rounded-card bg-raised px-4 py-3 text-[15px]">
              {schedulable
                ? "Fechado agora, mas dá para agendar: monte a sacola e escolha o horário no fechamento do pedido."
                : "Pode olhar o cardápio à vontade. Os pedidos abrem junto com a loja."}
            </p>
          )}
        </header>

        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <main className="min-w-0">
            {/* Navegação das categorias e busca, presas no topo ao rolar. */}
            <div className="sticky top-0 z-20 -mx-4 bg-surface px-4 pt-2 sm:-mx-6 sm:px-6">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" strokeWidth={1.5} aria-hidden="true" />
                <label htmlFor="busca" className="sr-only">
                  Buscar no cardápio
                </label>
                <input
                  id="busca"
                  type="search"
                  placeholder="Buscar no cardápio"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-11 w-full rounded-full border border-line bg-raised pr-10 pl-9 text-[15px] outline-none focus:border-ink focus:bg-surface"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Limpar busca"
                    onClick={() => setQuery("")}
                    className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-ink"
                  >
                    <X className="size-4" strokeWidth={1.5} />
                  </button>
                )}
              </div>
              {!query && (
                <nav
                  aria-label="Categorias"
                  ref={navRef}
                  className="-mx-1 mt-1 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]"
                >
                  {data.categories.map((c) => (
                    <a
                      key={c.id}
                      data-cat={c.id}
                      href={`#cat-${c.id}`}
                      aria-current={currentCat === c.id ? "true" : undefined}
                      className={cn(
                        "relative flex h-11 flex-none items-center px-3 text-[15px] whitespace-nowrap",
                        currentCat === c.id ? "font-semibold text-ink" : "text-muted hover:text-ink",
                      )}
                    >
                      {c.name}
                      {currentCat === c.id && <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 bg-[var(--brand)]" />}
                    </a>
                  ))}
                </nav>
              )}
            </div>

            {filtered.length === 0 && (
              <p className="mt-8 text-[15px] text-muted">
                {query ? `Nada encontrado para "${query}".` : "O cardápio ainda está sendo montado."}
              </p>
            )}

            {filtered.map(({ category, items }) => (
              <section key={category.id} id={`cat-${category.id}`} className="scroll-mt-28 pt-8" aria-labelledby={`h-${category.id}`}>
                <h2 id={`h-${category.id}`} className="text-[20px] leading-7 font-semibold tracking-[-0.01em]">
                  {category.name}
                </h2>
                <ul className="mt-2">
                  {items.map((p) => (
                    <li key={p.id} className="border-b border-rule last:border-b-0">
                      <button
                        type="button"
                        disabled={!p.available}
                        onClick={() => setOpenProduct(p)}
                        className="flex w-full items-start gap-4 py-4 text-left disabled:cursor-not-allowed"
                      >
                        <span className={cn("min-w-0 flex-1", !p.available && "opacity-55")}>
                          <span className="block text-[16px] leading-6 font-medium">{p.name}</span>
                          {p.description && (
                            <span className="mt-0.5 line-clamp-2 block text-sm leading-5 text-muted">{p.description}</span>
                          )}
                          <span className="mt-2 flex items-center gap-2">
                            {p.available ? (
                              <span className="num text-[15px]">
                                {hasVariablePrice(p) && <span className="text-[13px] text-muted">a partir de </span>}
                                {formatMoney(fromPrice(p))}
                              </span>
                            ) : (
                              <Pill>Esgotado</Pill>
                            )}
                          </span>
                        </span>
                        {p.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.image}
                            alt=""
                            className={cn("size-24 flex-none rounded-[8px] object-cover sm:size-28", !p.available && "opacity-55 grayscale")}
                          />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <footer className="mt-14 border-t border-line py-8 text-sm text-muted">
              <p className="text-[15px] font-medium text-ink">{s.name}</p>
              {s.address.street && (
                <p className="mt-2 flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 flex-none" strokeWidth={1.5} aria-hidden="true" />
                  {s.address.street}, {s.address.number} · {s.address.district} · {s.address.city}/{s.address.state}
                </p>
              )}
              {s.phone && (
                <a
                  href={`https://wa.me/55${onlyDigits(s.phone)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 flex items-center gap-2 font-medium text-ink hover:underline"
                >
                  <MessageCircle className="size-4" strokeWidth={1.5} aria-hidden="true" />
                  {formatPhone(s.phone)}
                </a>
              )}
              {products.some((p) => p.image?.startsWith(DEMO_PHOTO_PREFIX)) && (
                <p className="mt-6 text-xs">
                  Fotos ilustrativas do Wikimedia Commons ·{" "}
                  <Link href="/creditos-das-fotos" className="font-medium hover:underline">
                    créditos
                  </Link>
                </p>
              )}
              <p className="mt-2 text-xs">
                Cardápio digital por{" "}
                <Link href="/" className="font-medium hover:underline">
                  Comanda
                </Link>
              </p>
            </footer>
          </main>

          <aside aria-label="Sua sacola" className="hidden lg:block">
            <div className="sticky top-4 rounded-card border border-line p-5">
              <h2 className="text-[17px] font-semibold">Sua sacola</h2>
              <CartSummary store={s} products={products} canOrder={canOrder} />
            </div>
          </aside>
        </div>
      </div>

      {cart.count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface p-3 lg:hidden">
          <button type="button" onClick={() => setCartOpen(true)} className={brandButton("w-full justify-between px-5")}>
            <span className="flex items-center gap-2">
              <ShoppingBag className="size-5" strokeWidth={1.5} aria-hidden="true" />
              Ver sacola
              <span className="num text-sm opacity-90">
                · {cart.count} {cart.count === 1 ? "item" : "itens"}
              </span>
            </span>
            <span className="num">{formatMoney(subtotal)}</span>
          </button>
        </div>
      )}

      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="Sua sacola">
        <CartSummary store={s} products={products} canOrder={canOrder} />
      </Modal>

      <ItemSheet
        product={openProduct}
        canOrder={canOrder}
        closedLabel={closedLabel}
        onClose={() => setOpenProduct(null)}
        onAdd={(selections, quantity, notes) => {
          if (!openProduct) return;
          cart.add(openProduct.id, selections, quantity, notes);
          toast(`${quantity}× ${openProduct.name} na sacola`);
          setOpenProduct(null);
        }}
      />
    </BrandScope>
  );
}
