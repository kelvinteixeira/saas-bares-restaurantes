"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { OrderMode, PaymentMethod } from "@/lib/types";
import { usePublicStore } from "@/components/cardapio/use-public-store";
import { useCart } from "@/components/cardapio/cart";
import { BrandScope, brandButton } from "@/components/cardapio/brand";
import { CartLines, cartSubtotal } from "@/components/cardapio/cart-panel";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useNow } from "@/lib/hooks";
import { isStoreOpen, storeStatus } from "@/lib/domain/hours";
import { deliveryFee } from "@/lib/domain/pricing";
import { formatMoney, formatPhone, onlyDigits, parseMoney } from "@/lib/format";
import { CheckoutError, placeOrder } from "@/lib/store/actions";
import { checkCoupon } from "@/lib/store/coupons";
import { StorageFullError } from "@/lib/store/db";
import { cn } from "@/lib/cn";

const CUSTOMER_KEY = "comanda:cliente";

interface CustomerForm {
  name: string;
  phone: string;
  regionId: string;
  street: string;
  number: string;
  complement: string;
  reference: string;
}

const EMPTY: CustomerForm = { name: "", phone: "", regionId: "", street: "", number: "", complement: "", reference: "" };

const PAYMENTS: { id: PaymentMethod; label: string; hint: string }[] = [
  { id: "pix", label: "Pix", hint: "Com a chave Pix da loja" },
  { id: "card", label: "Cartão", hint: "Crédito ou débito na maquininha" },
  { id: "cash", label: "Dinheiro", hint: "Diga se precisa de troco" },
];

export function Checkout({ slug }: { slug: string }) {
  const data = usePublicStore(slug);
  const cart = useCart();
  const router = useRouter();
  const now = useNow(30000);
  const [chosenMode, setChosenMode] = useState<OrderMode | null>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY);
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [changeText, setChangeText] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponText, setCouponText] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discount: number; key: string } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // Preenche com os dados do último pedido feito neste aparelho.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CUSTOMER_KEY);
      if (raw) setForm({ ...EMPTY, ...(JSON.parse(raw) as Partial<CustomerForm>) });
    } catch {
      // primeiro pedido
    }
  }, []);

  if (data.state === "loading" || !cart.loaded) return <div className="min-h-dvh" aria-busy="true" />;
  if (data.state === "missing") {
    return (
      <main className="mx-auto max-w-[480px] px-4 py-16">
        <h1 className="text-[24px] font-semibold">Cardápio não encontrado</h1>
      </main>
    );
  }

  const { store, products } = data;
  // Volta ao cardápio sem perder a mesa de quem veio pelo QR code.
  const menuHref = cart.table !== null ? `/${slug}?mesa=${cart.table}` : `/${slug}`;
  const tableMode = cart.table !== null && store.table.enabled;
  const modes: OrderMode[] = tableMode
    ? ["table"]
    : ([store.delivery.enabled && "delivery", store.pickup.enabled && "pickup"].filter(Boolean) as OrderMode[]);
  const mode = chosenMode && modes.includes(chosenMode) ? chosenMode : modes[0] ?? null;
  const payments = PAYMENTS.filter((p) => store.payment[p.id]);
  const subtotal = cartSubtotal(cart.lines, products);
  const fee = mode === "delivery" ? deliveryFee(store, form.regionId) : 0;
  // O desconto foi conferido para esta sacola, modalidade e bairro; se algo mudar, confere de novo.
  const couponKey = `${subtotal}|${fee ?? 0}|${mode}|${onlyDigits(form.phone)}`;
  const discount = coupon && coupon.key === couponKey ? coupon.discount : 0;
  const total = subtotal + (fee ?? 0) - discount;
  const open = isStoreOpen(store, now);
  const belowMinimum = mode === "delivery" && subtotal < store.delivery.minOrder;
  // Item que esgotou ou saiu do cardápio depois de ir para a sacola.
  const unavailable = cart.lines.some((l) => !products.find((p) => p.id === l.productId)?.available);
  const set = (key: keyof CustomerForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: key === "phone" ? onlyDigits(e.target.value) : e.target.value }));

  async function applyCoupon(code: string) {
    if (!mode) return;
    setChecking(true);
    setCouponError(null);
    try {
      const result = await checkCoupon(store.id, code, { subtotal, fee: fee ?? 0, mode, phone: onlyDigits(form.phone) });
      setCoupon({ ...result, key: couponKey });
      setCouponText(result.code);
    } catch (err) {
      setCoupon(null);
      setCouponError(err instanceof Error && err.message ? err.message : "Não foi possível conferir o cupom.");
    }
    setChecking(false);
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Como a loja vai te chamar?";
    if (mode !== "table") {
      const d = onlyDigits(form.phone);
      if (d.length < 10 || d.length > 11) next.phone = "WhatsApp com DDD, para a loja falar com você.";
    }
    if (mode === "delivery") {
      if (!form.regionId || deliveryFee(store, form.regionId) === null) next.regionId = "Escolha o bairro.";
      if (!form.street.trim()) next.street = "Informe a rua.";
      if (!form.number.trim()) next.number = "Informe o número.";
    }
    if (!payment) next.payment = "Escolha como vai pagar.";
    if (payment === "cash" && changeText.trim()) {
      const v = parseMoney(changeText);
      if (v === null || v < total) next.change = `O troco precisa ser para ${formatMoney(total)} ou mais.`;
    }
    return next;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) {
      const first = Object.keys(next)[0];
      const target = document.getElementById(`f-${first}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      // Leva o cursor ao primeiro campo com erro (teclado e leitor de tela).
      target?.querySelector<HTMLElement>("input, select, [role=radio]")?.focus({ preventScroll: true });
      return;
    }
    if (!mode || !payment) return;
    setBusy(true);
    try {
      const order = await placeOrder({
        storeId: store.id,
        mode,
        lines: cart.lines,
        customer: { name: form.name.trim(), phone: onlyDigits(form.phone) },
        delivery:
          mode === "delivery"
            ? {
                regionId: form.regionId,
                street: form.street.trim(),
                number: form.number.trim(),
                complement: form.complement.trim() || undefined,
                reference: form.reference.trim() || undefined,
              }
            : undefined,
        tableNumber: mode === "table" ? cart.table ?? undefined : undefined,
        payment: payment === "cash" && changeText.trim() ? { method: "cash", changeFor: parseMoney(changeText)! } : { method: payment },
        notes: notes.trim() || undefined,
        couponCode: coupon?.code,
      });
      try {
        window.localStorage.setItem(CUSTOMER_KEY, JSON.stringify(form));
      } catch {
        // não lembra os dados, sem problema
      }
      cart.clear();
      router.replace(`/${slug}/pedido/${order.id}`);
    } catch (err) {
      setBusy(false);
      setSubmitError(
        err instanceof CheckoutError || err instanceof StorageFullError ? err.message : "Não foi possível enviar o pedido. Tente de novo.",
      );
    }
  }

  return (
    <BrandScope store={store}>
      <div className="mx-auto max-w-[1040px] px-4 py-4 sm:px-6 sm:py-6">
        <Link href={menuHref} className="inline-flex h-10 items-center gap-2 text-sm text-muted hover:text-ink">
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden="true" />
          Voltar ao cardápio
        </Link>
        <h1 className="mt-2 text-[26px] leading-8 font-semibold tracking-[-0.02em]">Finalizar pedido</h1>
        <p className="mt-1 text-[15px] text-muted">{store.name}</p>

        {cart.lines.length === 0 && busy ? (
          <p className="mt-8 text-[15px]" role="status">
            Pedido enviado. Abrindo o acompanhamento…
          </p>
        ) : cart.lines.length === 0 ? (
          <div className="mt-8 rounded-card bg-raised p-5">
            <p className="text-[15px]">Sua sacola está vazia.</p>
            <Link href={menuHref} className={brandButton("mt-4")}>
              Escolher itens
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex flex-col gap-8">
              {!open && (
                <p className="rounded-card bg-pill-negative-bg px-4 py-3 text-[15px] text-pill-negative-ink">
                  {storeStatus(store, now).label}. O pedido só pode ser enviado com a loja aberta.
                </p>
              )}

              <section aria-labelledby="h-modo">
                <h2 id="h-modo" className="text-[18px] font-semibold">
                  Como você quer receber?
                </h2>
                {mode === "table" ? (
                  <p className="mt-3 rounded-card bg-raised px-4 py-3 text-[15px]">
                    Na <span className="font-semibold">Mesa {cart.table}</span>. A loja leva até você.
                  </p>
                ) : modes.length === 0 ? (
                  <p className="mt-3 text-[15px] text-muted">A loja não está recebendo pedidos agora.</p>
                ) : (
                  <div role="radiogroup" aria-label="Forma de receber" className="mt-3 grid grid-cols-2 gap-2">
                    {modes.map((m) => {
                      const on = m === mode;
                      const eta = m === "delivery" ? store.delivery : store.pickup;
                      return (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setChosenMode(m)}
                          className={cn(
                            "flex flex-col items-start rounded-card border px-4 py-3 text-left",
                            on ? "border-2 border-[var(--brand)] px-[15px] py-[11px]" : "border-line hover:border-control",
                          )}
                        >
                          <span className="text-[15px] font-medium">{m === "delivery" ? "Entrega" : "Retirar na loja"}</span>
                          <span className="text-[13px] text-muted">
                            {eta.etaMin}–{eta.etaMax} min
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {mode === "pickup" && store.address.street && (
                  <p className="mt-3 text-sm text-muted">
                    Retire em {store.address.street}, {store.address.number} · {store.address.district}
                  </p>
                )}
              </section>

              <section aria-labelledby="h-dados" className="flex flex-col gap-4">
                <h2 id="h-dados" className="text-[18px] font-semibold">
                  Seus dados
                </h2>
                <div id="f-name">
                  <Field label="Nome" error={errors.name}>
                    {(p) => <Input {...p} autoComplete="name" value={form.name} onChange={set("name")} className="h-12 text-[15px]" />}
                  </Field>
                </div>
                {mode !== "table" && (
                  <div id="f-phone">
                    <Field label="WhatsApp" error={errors.phone} hint="A loja usa para avisar sobre o pedido.">
                      {(p) => (
                        <Input
                          {...p}
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel-national"
                          value={formatPhone(form.phone)}
                          onChange={set("phone")}
                          className="h-12 text-[15px]"
                        />
                      )}
                    </Field>
                  </div>
                )}
              </section>

              {mode === "delivery" && (
                <section aria-labelledby="h-endereco" className="flex flex-col gap-4">
                  <h2 id="h-endereco" className="text-[18px] font-semibold">
                    Endereço de entrega
                  </h2>
                  <div id="f-regionId">
                    <Field label="Bairro" error={errors.regionId}>
                      {(p) => (
                        <Select {...p} value={form.regionId} onChange={set("regionId")} className="h-12 text-[15px]">
                          <option value="">Escolha o bairro</option>
                          {store.delivery.regions
                            .filter((r) => r.active)
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name} · entrega {formatMoney(r.fee)}
                              </option>
                            ))}
                        </Select>
                      )}
                    </Field>
                  </div>
                  <div className="grid grid-cols-[1fr_104px] gap-3">
                    <div id="f-street">
                      <Field label="Rua" error={errors.street}>
                        {(p) => (
                          <Input {...p} autoComplete="address-line1" value={form.street} onChange={set("street")} className="h-12 text-[15px]" />
                        )}
                      </Field>
                    </div>
                    <div id="f-number">
                      <Field label="Número" error={errors.number}>
                        {(p) => <Input {...p} inputMode="numeric" value={form.number} onChange={set("number")} className="h-12 text-[15px]" />}
                      </Field>
                    </div>
                  </div>
                  <Field label="Complemento" hint="Apartamento, bloco, casa dos fundos.">
                    {(p) => <Input {...p} autoComplete="address-line2" value={form.complement} onChange={set("complement")} className="h-12 text-[15px]" />}
                  </Field>
                  <Field label="Ponto de referência">
                    {(p) => <Input {...p} value={form.reference} onChange={set("reference")} className="h-12 text-[15px]" />}
                  </Field>
                </section>
              )}

              <section aria-labelledby="h-pagamento" id="f-payment">
                <h2 id="h-pagamento" className="text-[18px] font-semibold">
                  Pagamento
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {mode === "delivery" ? "Você paga na entrega." : mode === "pickup" ? "Você paga ao retirar." : "Você paga na mesa."}
                </p>
                <div role="radiogroup" aria-label="Forma de pagamento" className="mt-3 flex flex-col gap-2">
                  {payments.map((p) => {
                    const on = payment === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`${p.label}: ${p.hint}`}
                        onClick={() => setPayment(p.id)}
                        className={cn(
                          "flex items-center gap-3 rounded-card border px-4 py-3 text-left",
                          on ? "border-2 border-[var(--brand)] px-[15px] py-[11px]" : "border-line hover:border-control",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn("grid size-5 flex-none place-items-center rounded-full border-2", on ? "border-[var(--brand)]" : "border-control")}
                        >
                          {on && <span className="size-2.5 rounded-full bg-[var(--brand)]" />}
                        </span>
                        <span>
                          <span className="block text-[15px] font-medium">{p.label}</span>
                          <span className="block text-[13px] text-muted">{p.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {errors.payment && <p className="mt-2 text-sm text-negative">{errors.payment}</p>}
                {payment === "cash" && (
                  <div id="f-change" className="mt-4 max-w-[280px]">
                    <Field label="Troco para quanto?" hint="Deixe vazio se não precisar de troco." error={errors.change}>
                      {(p) => (
                        <Input
                          {...p}
                          inputMode="decimal"
                          placeholder="R$ 0,00"
                          value={changeText}
                          onChange={(e) => setChangeText(e.target.value)}
                          className="h-12 text-[15px]"
                        />
                      )}
                    </Field>
                  </div>
                )}
              </section>

              <section aria-labelledby="h-obs">
                <h2 id="h-obs" className="text-[18px] font-semibold">
                  Observação para a loja
                </h2>
                <Textarea
                  aria-labelledby="h-obs"
                  rows={2}
                  maxLength={200}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex.: interfone quebrado, ligar quando chegar"
                  className="mt-3 text-[15px]"
                />
              </section>
            </div>

            <aside aria-labelledby="h-resumo" className="rounded-card border border-line p-5 lg:sticky lg:top-6">
              <h2 id="h-resumo" className="text-[18px] font-semibold">
                Resumo
              </h2>
              <div className="mt-2">
                <CartLines products={products} />
              </div>
              <dl className="mt-3 border-t border-rule pt-3 text-[15px]">
                <div className="flex justify-between py-0.5">
                  <dt className="text-muted">Subtotal</dt>
                  <dd className="num">{formatMoney(subtotal)}</dd>
                </div>
                {mode === "delivery" && (
                  <div className="flex justify-between py-0.5">
                    <dt className="text-muted">Entrega</dt>
                    <dd className="num">{fee === null ? "escolha o bairro" : formatMoney(fee)}</dd>
                  </div>
                )}
                {coupon && discount > 0 && (
                  <div className="flex justify-between py-0.5 text-positive">
                    <dt>Cupom {coupon.code}</dt>
                    <dd className="num">−{formatMoney(discount)}</dd>
                  </div>
                )}
                <div className="flex justify-between pt-2 text-[17px] font-semibold">
                  <dt>Total</dt>
                  <dd className="num">{formatMoney(total)}</dd>
                </div>
              </dl>
              <div className="mt-3 border-t border-rule pt-3">
                {/* Cupom aplicado e a sacola mudou: confere de novo com os valores novos. */}
                {coupon && coupon.key !== couponKey && !checking && <Recheck run={() => void applyCoupon(coupon.code)} />}
                {coupon ? (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      Cupom <strong>{coupon.code}</strong> aplicado
                    </span>
                    <button
                      type="button"
                      className="text-muted underline hover:text-ink"
                      onClick={() => {
                        setCoupon(null);
                        setCouponText("");
                      }}
                    >
                      Remover
                    </button>
                  </div>
                ) : couponOpen ? (
                  <div>
                    <label htmlFor="cupom" className="text-sm font-medium">
                      Cupom de desconto
                    </label>
                    <div className="mt-2 flex gap-2">
                      <Input
                        id="cupom"
                        autoFocus
                        autoCapitalize="characters"
                        autoComplete="off"
                        maxLength={20}
                        value={couponText}
                        aria-invalid={couponError ? true : undefined}
                        onChange={(e) => {
                          setCouponText(e.target.value.toUpperCase().replace(/\s/g, ""));
                          setCouponError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (couponText.trim()) void applyCoupon(couponText);
                          }
                        }}
                        className="h-11 uppercase"
                      />
                      <button
                        type="button"
                        disabled={!couponText.trim() || checking || !mode}
                        onClick={() => void applyCoupon(couponText)}
                        className="h-11 flex-none rounded-control border border-control px-4 text-sm font-medium hover:bg-raised disabled:opacity-50"
                      >
                        {checking ? "Conferindo…" : "Aplicar"}
                      </button>
                    </div>
                    {couponError && <p className="mt-2 text-sm text-negative">{couponError}</p>}
                  </div>
                ) : (
                  <button type="button" onClick={() => setCouponOpen(true)} className="text-sm font-medium text-[var(--brand)] hover:underline">
                    Tem cupom de desconto?
                  </button>
                )}
              </div>
              {belowMinimum && (
                <p className="mt-3 text-sm text-negative">
                  Faltam {formatMoney(store.delivery.minOrder - subtotal)} para o pedido mínimo de entrega.
                  {store.pickup.enabled && " Retirando na loja não tem mínimo."}
                </p>
              )}
              {unavailable && (
                <p className="mt-3 text-sm text-negative">Tem item esgotado na sacola. Remova para continuar.</p>
              )}
              {submitError && (
                <p role="alert" className="mt-3 rounded-card bg-pill-negative-bg px-3 py-2 text-sm text-pill-negative-ink">
                  {submitError}
                </p>
              )}
              <button type="submit" disabled={busy || !open || !mode || belowMinimum || unavailable} className={brandButton("mt-4 w-full")}>
                {busy ? "Enviando…" : (
                  <>
                    Fazer pedido <span className="num">· {formatMoney(total)}</span>
                  </>
                )}
              </button>
            </aside>
          </form>
        )}
      </div>
    </BrandScope>
  );
}

/** Roda a nova conferência do cupom depois de desenhar (efeito, não durante o render). */
function Recheck({ run }: { run: () => void }) {
  useEffect(() => {
    run();
    // Só uma vez por montagem: o pai desmonta este componente quando a conferência começa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
