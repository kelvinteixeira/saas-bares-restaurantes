"use client";

// Camada remota: busca no Supabase e mantém em memória (db.ts › setRemote) o que as telas precisam.
// - initRemote: confere a sessão ao abrir o app e acompanha login/logout.
// - loadOwner: loja do dono, cardápio, pedidos recentes e canal de tempo real dos pedidos.
// - loadPublicStore: cardápio público por endereço (/[slug]).
// - loadPublicOrder: pedido para a página de acompanhamento (RPC get_public_order).

import type { RealtimeChannel, User } from "@supabase/supabase-js";
import type { AbandonedCart, Account, Driver, CashbackEntry, CashMovement, CashSession, Category, Coupon, Order, Payment, Product, Store, StoreRole, Tab } from "@/lib/types";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { emptyRemote, getLocalDb, getRemote, setRemote, type RemoteState } from "@/lib/store/db";
import {
  rowToCategory,
  rowToOrder,
  rowToProduct,
  rowToStore,
  rowToTab,
  rowToCashMovement,
  rowToCoupon,
  rowToCashbackEntry,
  rowToDriver,
  rowToCart,
  type CartRow,
  type DriverRow,
  type CashbackEntryRow,
  type CouponRow,
  rowToCashSession,
  rowToPayment,
  type CashMovementRow,
  type CashSessionRow,
  type PaymentRow,
  type CategoryRow,
  type OrderRow,
  type ProductRow,
  type StoreRow,
  type TabRow,
} from "@/lib/store/mappers";

let booted = false;
let ordersChannel: RealtimeChannel | null = null;
// Carga em andamento por usuário: quem chamar de novo espera a mesma.
const ownerLoads = new Map<string, Promise<void>>();

// ---------- ajudantes de lista ----------

export function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

function replaceForStore<T extends { storeId: string }>(list: T[], storeId: string, items: T[]): T[] {
  return [...list.filter((x) => x.storeId !== storeId), ...items];
}

export function remoteUpsertStore(store: Store) {
  setRemote((r) => ({ ...r, stores: upsertById(r.stores, store) }));
}
export function remoteUpsertCategory(category: Category) {
  setRemote((r) => ({ ...r, categories: upsertById(r.categories, category) }));
}
export function remoteUpsertProduct(product: Product) {
  setRemote((r) => ({ ...r, products: upsertById(r.products, product) }));
}
export function remoteUpsertOrder(order: Order) {
  setRemote((r) => ({
    ...r,
    orders: upsertById(r.orders, order),
    // Pedido cancelado: o banco apaga o cashback que ele usou (trigger do SQL 007). Essa exclusão não
    // chega pelo tempo real com filtro de loja, então a tela tira por conta própria.
    cashbackEntries:
      order.status === "cancelado"
        ? r.cashbackEntries.filter((e) => !(e.orderId === order.id && e.kind === "spend"))
        : r.cashbackEntries,
  }));
}
export function remoteUpsertTab(tab: Tab) {
  setRemote((r) => ({ ...r, tabs: upsertById(r.tabs, tab) }));
}
export function remoteUpsertCoupon(coupon: Coupon) {
  setRemote((r) => ({ ...r, coupons: upsertById(r.coupons, coupon) }));
}
export function remoteUpsertCashbackEntry(entry: CashbackEntry) {
  setRemote((r) => ({ ...r, cashbackEntries: upsertById(r.cashbackEntries, entry) }));
}
export function remoteUpsertCart(cart: AbandonedCart) {
  setRemote((r) => ({ ...r, carts: upsertById(r.carts, cart) }));
}
export function remoteRemoveCart(id: string) {
  setRemote((r) => ({ ...r, carts: r.carts.filter((c) => c.id !== id) }));
}
export function remoteUpsertDriver(driver: Driver) {
  setRemote((r) => ({ ...r, drivers: upsertById(r.drivers, driver) }));
}
export function remoteRemoveDriver(id: string) {
  setRemote((r) => ({ ...r, drivers: r.drivers.filter((d) => d.id !== id) }));
}
export function remoteRemoveCoupon(id: string) {
  setRemote((r) => ({ ...r, coupons: r.coupons.filter((c) => c.id !== id) }));
}
export function remoteUpsertCashSession(session: CashSession) {
  setRemote((r) => ({ ...r, cashSessions: upsertById(r.cashSessions, session) }));
}
export function remoteUpsertPayment(payment: Payment) {
  setRemote((r) => ({ ...r, payments: upsertById(r.payments, payment) }));
}
export function remoteUpsertCashMovement(movement: CashMovement) {
  setRemote((r) => ({ ...r, cashMovements: upsertById(r.cashMovements, movement) }));
}
export function remoteUpsertOrders(orders: Order[]) {
  setRemote((r) => ({ ...r, orders: orders.reduce((list, o) => upsertById(list, o), r.orders) }));
}

export function isRemoteStore(storeId: string): boolean {
  return getRemote().stores.some((s) => s.id === storeId);
}

/** Erro do Supabase em português para mostrar na tela. */
export function friendly(error: { message?: string; code?: string } | null, fallback: string): Error {
  if (!error) return new Error(fallback);
  if (error.code === "23505") return new Error("Já existe um registro com esses dados.");
  if (error.code === "42501" || /row-level security/i.test(error.message ?? "")) {
    return new Error("Você não tem permissão para mudar isso. Entre de novo na sua conta.");
  }
  if (/fetch|network/i.test(error.message ?? "")) return new Error("Sem conexão com o servidor. Tente de novo.");
  return new Error(error.message || fallback);
}

// ---------- sessão ----------

function toAccount(user: User): Account {
  const meta = (user.user_metadata ?? {}) as { name?: string };
  return {
    id: user.id,
    name: meta.name?.trim() || user.email?.split("@")[0] || "Dono",
    email: user.email ?? "",
    passwordHash: "",
    createdAt: user.created_at,
  };
}

/** Chamado uma vez pelo RemoteBoot no layout raiz. */
export function initRemote() {
  if (booted || !supabaseConfigured()) return;
  booted = true;
  const sb = getSupabase();

  sb.auth
    .getSession()
    .then(async ({ data }) => {
      if (data.session?.user) await loadOwner(data.session.user).catch((e) => console.error("Falha ao carregar a loja", e));
    })
    .finally(() => setRemote((r) => ({ ...r, authResolved: true })));

  sb.auth.onAuthStateChange((event, session) => {
    // Chamadas ao Supabase dentro deste callback podem travar: adia para depois dele.
    window.setTimeout(() => {
      if (event === "SIGNED_OUT") clearOwner();
      else if (event === "SIGNED_IN" && session?.user && getRemote().account?.id !== session.user.id) {
        void loadOwner(session.user).catch((e) => console.error("Falha ao carregar a loja", e));
      }
    }, 0);
  });
}

/** Esquece a conta e tudo que veio dela; as lojas públicas são buscadas de novo quando abertas. */
export function clearOwner() {
  if (ordersChannel) {
    void ordersChannel.unsubscribe();
    ordersChannel = null;
  }
  ownerLoads.clear();
  setRemote(() => emptyRemote(true));
}

/** Busca a loja do dono, o cardápio e os pedidos (últimos 8 dias e os ainda abertos). */
export function loadOwner(user: User): Promise<void> {
  const running = ownerLoads.get(user.id);
  if (running) return running;
  const load = fetchOwner(user).finally(() => ownerLoads.delete(user.id));
  ownerLoads.set(user.id, load);
  return load;
}

/** Busca de novo, depois de qualquer carga em andamento (ex.: logo após entrar numa equipe). */
export async function refreshOwner(user: User): Promise<void> {
  await ownerLoads.get(user.id)?.catch(() => {});
  return loadOwner(user);
}

async function fetchOwner(user: User) {
  {
    const sb = getSupabase();
    const account = toAccount(user);
    // A loja vem da equipe: quem é dono de alguma loja entra nela; senão, na primeira em que trabalha.
    const { data: memberships, error: memberError } = await sb
      .from("store_members")
      .select("store_id, role, created_at")
      .eq("user_id", user.id)
      .order("created_at");
    if (memberError) throw friendly(memberError, "Não foi possível carregar a sua loja.");
    const list = (memberships ?? []) as { store_id: string; role: StoreRole }[];
    const membership = list.find((m) => m.role === "owner") ?? list[0];
    if (!membership) {
      setRemote((r) => ({ ...r, account }));
      return;
    }
    const { data: storeRow, error } = await sb.from("stores").select("*").eq("id", membership.store_id).maybeSingle<StoreRow>();
    if (error) throw friendly(error, "Não foi possível carregar a sua loja.");
    if (!storeRow) {
      setRemote((r) => ({ ...r, account }));
      return;
    }
    const store = rowToStore(storeRow);
    account.storeId = store.id;
    account.role = membership.role;
    const since = new Date(Date.now() - 8 * 86400000).toISOString();
    const [cats, prods, recent, open] = await Promise.all([
      sb.from("categories").select("*").eq("store_id", store.id),
      sb.from("products").select("*").eq("store_id", store.id),
      sb.from("orders").select("*").eq("store_id", store.id).gte("created_at", since),
      sb.from("orders").select("*").eq("store_id", store.id).not("status", "in", "(concluido,cancelado)"),
    ]);
    for (const res of [cats, prods, recent, open]) if (res.error) throw friendly(res.error, "Não foi possível carregar a sua loja.");
    const orders = new Map<string, Order>();
    for (const row of [...(recent.data ?? []), ...(open.data ?? [])] as OrderRow[]) orders.set(row.id, rowToOrder(row));
    // Comandas abertas e as fechadas nos últimos dias. Antes do SQL 003 a tabela não existe: segue sem.
    const tabsRes = await sb.from("tabs").select("*").eq("store_id", store.id).or(`status.neq.closed,opened_at.gte.${since}`);
    const tabs = tabsRes.error ? [] : ((tabsRes.data ?? []) as TabRow[]).map(rowToTab);
    // Caixa (SQL 005): turnos dos últimos dias, pagamentos e movimentos. Garçom e cozinha recebem vazio (RLS).
    const [sessionsRes, paymentsRes, movesRes] = await Promise.all([
      sb.from("cash_sessions").select("*").eq("store_id", store.id).or(`status.eq.open,opened_at.gte.${since}`),
      sb.from("payments").select("*").eq("store_id", store.id).gte("created_at", since),
      sb.from("cash_movements").select("*").eq("store_id", store.id).gte("created_at", since),
    ]);
    const hasCash = !sessionsRes.error;
    const cashSessions = hasCash ? ((sessionsRes.data ?? []) as CashSessionRow[]).map(rowToCashSession) : [];
    const payments = paymentsRes.error ? [] : ((paymentsRes.data ?? []) as PaymentRow[]).map(rowToPayment);
    const cashMovements = movesRes.error ? [] : ((movesRes.data ?? []) as CashMovementRow[]).map(rowToCashMovement);
    // Cupons (SQL 006): só dono e gerente leem; os outros recebem vazio.
    const couponsRes = await sb.from("coupons").select("*").eq("store_id", store.id).order("created_at", { ascending: false });
    const coupons = couponsRes.error ? [] : ((couponsRes.data ?? []) as CouponRow[]).map(rowToCoupon);
    // Cashback (SQL 007): todo o histórico (o saldo depende dele); só dono e gerente leem.
    const cashbackRes = await sb.from("cashback_entries").select("*").eq("store_id", store.id).order("created_at").limit(5000);
    const cashbackEntries = cashbackRes.error ? [] : ((cashbackRes.data ?? []) as CashbackEntryRow[]).map(rowToCashbackEntry);
    // Entregadores (SQL 009): a equipe toda lê.
    const driversRes = await sb.from("drivers").select("*").eq("store_id", store.id).order("name");
    const drivers = driversRes.error ? [] : ((driversRes.data ?? []) as DriverRow[]).map(rowToDriver);
    // Sacolas abandonadas (SQL 011): só dono e gerente leem; dos últimos 30 dias.
    const cartsRes = await sb.from("abandoned_carts").select("*").eq("store_id", store.id).order("updated_at", { ascending: false }).limit(1000);
    const carts = cartsRes.error ? [] : ((cartsRes.data ?? []) as CartRow[]).map(rowToCart);

    setRemote((r) => ({
      ...r,
      account,
      stores: upsertById(r.stores, store),
      categories: replaceForStore(r.categories, store.id, ((cats.data ?? []) as CategoryRow[]).map(rowToCategory)),
      products: replaceForStore(r.products, store.id, ((prods.data ?? []) as ProductRow[]).map(rowToProduct)),
      orders: replaceForStore(r.orders, store.id, [...orders.values()]),
      tabs: replaceForStore(r.tabs, store.id, tabs),
      cashSessions: replaceForStore(r.cashSessions, store.id, cashSessions),
      payments: replaceForStore(r.payments, store.id, payments),
      cashMovements: replaceForStore(r.cashMovements, store.id, cashMovements),
      coupons: replaceForStore(r.coupons, store.id, coupons),
      cashbackEntries: replaceForStore(r.cashbackEntries, store.id, cashbackEntries),
      drivers: replaceForStore(r.drivers, store.id, drivers),
      carts: replaceForStore(r.carts, store.id, carts),
      slugState: { ...r.slugState, [store.slug]: "done" },
    }));
    subscribeOrders(store.id, !tabsRes.error, hasCash, !cashbackRes.error, !cartsRes.error && (membership.role === "owner" || membership.role === "manager"));
  }
}

/** Pedidos novos e mudanças de status chegam na hora (Realtime respeita as regras de acesso). */
function subscribeOrders(storeId: string, withTabs: boolean, withCash: boolean, withCashback: boolean, withCarts: boolean) {
  const sb = getSupabase();
  if (ordersChannel) void ordersChannel.unsubscribe();
  const channel = sb
    .channel(`pedidos-${storeId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${storeId}` },
      (payload) => {
        if (payload.eventType === "DELETE") {
          const id = (payload.old as { id?: string }).id;
          if (id) setRemote((r) => ({ ...r, orders: r.orders.filter((o) => o.id !== id) }));
          return;
        }
        remoteUpsertOrder(rowToOrder(payload.new as OrderRow));
      },
    );
  // Só escuta as comandas se a tabela existe (SQL 003); senão o canal inteiro falharia.
  if (withTabs) {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tabs", filter: `store_id=eq.${storeId}` },
      (payload) => {
        if (payload.eventType === "DELETE") return;
        remoteUpsertTab(rowToTab(payload.new as TabRow));
      },
    );
  }
  // Caixa só se as tabelas existem (SQL 005).
  if (withCash) {
    channel
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_sessions", filter: `store_id=eq.${storeId}` }, (payload) => {
        if (payload.eventType !== "DELETE") remoteUpsertCashSession(rowToCashSession(payload.new as CashSessionRow));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "payments", filter: `store_id=eq.${storeId}` }, (payload) => {
        remoteUpsertPayment(rowToPayment(payload.new as PaymentRow));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cash_movements", filter: `store_id=eq.${storeId}` }, (payload) => {
        remoteUpsertCashMovement(rowToCashMovement(payload.new as CashMovementRow));
      });
  }
  if (withCashback) {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "cashback_entries", filter: `store_id=eq.${storeId}` }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as { id?: string }).id;
        if (id) setRemote((r) => ({ ...r, cashbackEntries: r.cashbackEntries.filter((e) => e.id !== id) }));
        return;
      }
      remoteUpsertCashbackEntry(rowToCashbackEntry(payload.new as CashbackEntryRow));
    });
  }
  // Recuperador (SQL 011): sacolas novas e convertidas aparecem sozinhas.
  if (withCarts) {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "abandoned_carts", filter: `store_id=eq.${storeId}` }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as { id?: string }).id;
        if (id) remoteRemoveCart(id);
        return;
      }
      remoteUpsertCart(rowToCart(payload.new as CartRow));
    });
  }
  ordersChannel = channel.subscribe();
}

// ---------- público ----------

/** Busca a loja pelo endereço, se não for a demonstração local nem já estiver carregada. */
export async function loadPublicStore(slug: string) {
  if (!supabaseConfigured()) return;
  if (getLocalDb().stores.some((s) => s.slug === slug)) return;
  const state = getRemote();
  if (state.slugState[slug] || state.stores.some((s) => s.slug === slug)) return;
  setRemote((r) => ({ ...r, slugState: { ...r.slugState, [slug]: "loading" } }));
  try {
    const sb = getSupabase();
    const { data: storeRow, error } = await sb.from("stores").select("*").eq("slug", slug).maybeSingle<StoreRow>();
    if (error) throw error;
    if (storeRow) {
      const store = rowToStore(storeRow);
      const [cats, prods] = await Promise.all([
        sb.from("categories").select("*").eq("store_id", store.id),
        sb.from("products").select("*").eq("store_id", store.id),
      ]);
      if (cats.error) throw cats.error;
      if (prods.error) throw prods.error;
      setRemote((r) => ({
        ...r,
        stores: upsertById(r.stores, store),
        categories: replaceForStore(r.categories, store.id, ((cats.data ?? []) as CategoryRow[]).map(rowToCategory)),
        products: replaceForStore(r.products, store.id, ((prods.data ?? []) as ProductRow[]).map(rowToProduct)),
      }));
    }
  } catch (e) {
    console.error("Falha ao buscar o cardápio", e);
  } finally {
    setRemote((r) => ({ ...r, slugState: { ...r.slugState, [slug]: "done" } }));
  }
}

/** Busca (ou atualiza) um pedido para a página de acompanhamento. */
export async function loadPublicOrder(orderId: string) {
  if (!supabaseConfigured()) return;
  if (getLocalDb().orders.some((o) => o.id === orderId)) return;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
    setRemote((r) => ({ ...r, orderState: { ...r.orderState, [orderId]: "done" } }));
    return;
  }
  if (!getRemote().orderState[orderId]) {
    setRemote((r) => ({ ...r, orderState: { ...r.orderState, [orderId]: "loading" } }));
  }
  try {
    const { data, error } = await getSupabase().rpc("get_public_order", { order_id: orderId });
    if (error) throw error;
    if (data) remoteUpsertOrder(rowToOrder(data as OrderRow));
  } catch (e) {
    console.error("Falha ao buscar o pedido", e);
  } finally {
    setRemote((r) => (r.orderState[orderId] === "done" ? r : { ...r, orderState: { ...r.orderState, [orderId]: "done" } }));
  }
}

/** Para a tela saber se ainda vale esperar a busca remota antes de dizer "não encontrado". */
export function remotePending(state: RemoteState, kind: "slug" | "order", key: string): boolean {
  if (!supabaseConfigured()) return false;
  const value = kind === "slug" ? state.slugState[key] : state.orderState[key];
  return value !== "done";
}

// ---------- fotos ----------

/** Envia uma foto em data URL para fotos/{storeId}/... e devolve a URL pública. */
export async function uploadDataUrl(storeId: string, prefix: string, dataUrl: string): Promise<string> {
  const sb = getSupabase();
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${storeId}/${prefix}-${Date.now()}.jpg`;
  const { error } = await sb.storage.from("fotos").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (error) throw friendly(error, "Não foi possível enviar a foto.");
  return sb.storage.from("fotos").getPublicUrl(path).data.publicUrl;
}
