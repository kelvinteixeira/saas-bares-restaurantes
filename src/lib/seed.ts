// Dados de demonstração. Tudo aqui é inventado: o bar, o cardápio, os bairros e os clientes.
// Substituir por dados reais quando o banco entrar (fase 2).

import type {
  Account,
  Category,
  Db,
  Order,
  OrderItem,
  OrderMode,
  OrderStatus,
  PaymentMethod,
  Product,
  Store,
  Tab,
  WeeklyHours,
} from "@/lib/types";
import { newId, seededRandom } from "@/lib/ids";
import { unitPrice, type Selections } from "@/lib/domain/pricing";
import { isOpenOrder, statusFlow } from "@/lib/domain/orders";
import { attachToTab } from "@/lib/domain/tabs";
import { DEMO_PHOTOS } from "@/lib/demo-photos";

export const DEMO_ACCOUNT_ID = "demo-account";
export const DEMO_STORE_ID = "demo-store";
export const DEMO_SLUG = "bar-do-cais";

const everyDay = (open: string, close: string): WeeklyHours => ({
  0: [{ open, close }],
  1: [{ open, close }],
  2: [{ open, close }],
  3: [{ open, close }],
  4: [{ open, close }],
  5: [{ open, close: "01:00" }],
  6: [{ open, close: "01:00" }],
});

export function demoStore(now: Date): Store {
  return {
    id: DEMO_STORE_ID,
    ownerId: DEMO_ACCOUNT_ID,
    slug: DEMO_SLUG,
    name: "Bar do Cais",
    description: "Petiscos, pratos para dividir e cerveja gelada na beira do rio.",
    phone: "81999990000",
    address: { street: "Rua do Porto", number: "214", district: "Centro", city: "Recife", state: "PE" },
    brandColor: "#b84a00",
    hours: everyDay("11:00", "23:30"),
    manualStatus: "auto",
    delivery: {
      enabled: true,
      minOrder: 3000,
      etaMin: 35,
      etaMax: 50,
      regions: [
        { id: "r-centro", name: "Centro", fee: 500, active: true },
        { id: "r-jardim", name: "Jardim do Rio", fee: 700, active: true },
        { id: "r-vila", name: "Vila Nova", fee: 800, active: true },
        { id: "r-alto", name: "Alto da Serra", fee: 1200, active: true },
        { id: "r-ilha", name: "Ilha Grande", fee: 1500, active: false },
      ],
    },
    pickup: { enabled: true, etaMin: 20, etaMax: 30 },
    table: { enabled: true, count: 12 },
    payment: { pix: true, card: true, cash: true },
    nextOrderNumber: 1,
    createdAt: new Date(now.getTime() - 40 * 86400000).toISOString(),
  };
}

const cat = (id: string, name: string, position: number): Category => ({
  id,
  storeId: DEMO_STORE_ID,
  name,
  position,
  visible: true,
});

export function demoCategories(): Category[] {
  return [
    cat("c-petiscos", "Petiscos", 0),
    cat("c-pratos", "Pratos para dividir", 1),
    cat("c-sanduiches", "Sanduíches", 2),
    cat("c-bebidas", "Bebidas", 3),
    cat("c-sobremesas", "Sobremesas", 4),
  ];
}

let position = 0;
function product(p: Omit<Product, "storeId" | "position" | "available" | "optionGroups"> & Partial<Product>): Product {
  return { storeId: DEMO_STORE_ID, position: position++, available: true, optionGroups: [], ...p };
}

/** Itens de exemplo com a foto ilustrativa do prato, quando houver uma. */
function withDemoPhotos(products: Product[]): Product[] {
  return products.map((p) => (DEMO_PHOTOS[p.id] ? { ...p, image: DEMO_PHOTOS[p.id].src } : p));
}

export function demoProducts(): Product[] {
  position = 0;
  return withDemoPhotos([
    product({
      id: "p-batata",
      categoryId: "c-petiscos",
      name: "Batata frita",
      description: "Batata cortada na casa, frita duas vezes. Acompanha maionese verde.",
      price: 2400,
      optionGroups: [
        {
          id: "g-batata-tam",
          name: "Tamanho",
          min: 1,
          max: 1,
          options: [
            { id: "o-meia", name: "Meia porção", price: 0, available: true },
            { id: "o-inteira", name: "Porção inteira", price: 1400, available: true },
          ],
        },
        {
          id: "g-batata-add",
          name: "Adicionais",
          min: 0,
          max: 3,
          options: [
            { id: "o-cheddar", name: "Cheddar", price: 600, available: true },
            { id: "o-bacon", name: "Bacon", price: 700, available: true },
            { id: "o-calabresa", name: "Calabresa acebolada", price: 800, available: true },
          ],
        },
      ],
    }),
    product({
      id: "p-isca",
      categoryId: "c-petiscos",
      name: "Isca de peixe",
      description: "Tiras de pescada empanadas, limão e molho tártaro.",
      price: 4200,
    }),
    product({
      id: "p-bolinho",
      categoryId: "c-petiscos",
      name: "Bolinho de bacalhau",
      description: "8 unidades.",
      price: 3600,
    }),
    product({
      id: "p-pastel",
      categoryId: "c-petiscos",
      name: "Pastel de feira",
      description: "6 unidades.",
      price: 2600,
      optionGroups: [
        {
          id: "g-pastel-sabor",
          name: "Sabor",
          min: 1,
          max: 2,
          options: [
            { id: "o-queijo", name: "Queijo", price: 0, available: true },
            { id: "o-carne", name: "Carne", price: 0, available: true },
            { id: "o-camarao", name: "Camarão", price: 600, available: true },
          ],
        },
      ],
    }),
    product({
      id: "p-torresmo",
      categoryId: "c-petiscos",
      name: "Torresmo de rolo",
      description: "Pururuca por fora, macio por dentro.",
      price: 3200,
      available: false,
    }),
    product({
      id: "p-moqueca",
      categoryId: "c-pratos",
      name: "Moqueca de peixe",
      description: "Para 2 pessoas. Arroz, pirão e farofa de dendê.",
      price: 11800,
    }),
    product({
      id: "p-baiao",
      categoryId: "c-pratos",
      name: "Baião de dois",
      description: "Arroz, feijão verde, queijo coalho e nata.",
      price: 3900,
      optionGroups: [
        {
          id: "g-baiao-prot",
          name: "Proteína",
          min: 1,
          max: 1,
          options: [
            { id: "o-carnesol", name: "Carne de sol", price: 0, available: true },
            { id: "o-charque", name: "Charque", price: 0, available: true },
            { id: "o-frango", name: "Frango", price: 0, available: true },
          ],
        },
      ],
    }),
    product({
      id: "p-parmegiana",
      categoryId: "c-pratos",
      name: "Filé à parmegiana",
      description: "Serve 1 pessoa bem.",
      price: 5800,
      optionGroups: [
        {
          id: "g-parm-acomp",
          name: "Acompanhamentos",
          min: 1,
          max: 2,
          options: [
            { id: "o-arroz", name: "Arroz", price: 0, available: true },
            { id: "o-fritas", name: "Fritas", price: 0, available: true },
            { id: "o-pure", name: "Purê", price: 0, available: true },
            { id: "o-salada", name: "Salada", price: 0, available: true },
          ],
        },
      ],
    }),
    product({
      id: "p-pernil",
      categoryId: "c-sanduiches",
      name: "Sanduíche de pernil",
      description: "Pernil desfiado, vinagrete e queijo no pão francês.",
      price: 2900,
    }),
    product({
      id: "p-burger",
      categoryId: "c-sanduiches",
      name: "Hambúrguer da casa",
      description: "160 g, queijo prato, cebola na chapa.",
      price: 3400,
      optionGroups: [
        {
          id: "g-burger-ponto",
          name: "Ponto da carne",
          min: 1,
          max: 1,
          options: [
            { id: "o-mal", name: "Ao ponto para mal", price: 0, available: true },
            { id: "o-ponto", name: "Ao ponto", price: 0, available: true },
            { id: "o-bem", name: "Bem passado", price: 0, available: true },
          ],
        },
      ],
    }),
    product({
      id: "p-cerveja",
      prepStation: "none",
      categoryId: "c-bebidas",
      name: "Cerveja long neck",
      description: "355 ml.",
      price: 1100,
      optionGroups: [
        {
          id: "g-cerveja-marca",
          name: "Marca",
          min: 1,
          max: 1,
          options: [
            { id: "o-pilsen", name: "Pilsen da casa", price: 0, available: true },
            { id: "o-heineken", name: "Heineken", price: 200, available: true },
            { id: "o-stella", name: "Stella Artois", price: 200, available: true },
            { id: "o-zero", name: "Sem álcool", price: 100, available: true },
          ],
        },
      ],
    }),
    product({
      id: "p-caipirinha",
      prepStation: "bar",
      categoryId: "c-bebidas",
      name: "Caipirinha",
      description: "Limão, açúcar e gelo.",
      price: 2200,
      optionGroups: [
        {
          id: "g-caipi-base",
          name: "Base",
          min: 1,
          max: 1,
          options: [
            { id: "o-cachaca", name: "Cachaça", price: 0, available: true },
            { id: "o-vodka", name: "Vodka", price: 400, available: true },
            { id: "o-sake", name: "Saquê", price: 500, available: true },
          ],
        },
      ],
    }),
    product({
      id: "p-refri",
      prepStation: "none",
      categoryId: "c-bebidas",
      name: "Refrigerante lata",
      description: "350 ml.",
      price: 600,
    }),
    product({
      id: "p-suco",
      prepStation: "bar",
      categoryId: "c-bebidas",
      name: "Suco natural",
      description: "500 ml.",
      price: 1000,
      optionGroups: [
        {
          id: "g-suco-sabor",
          name: "Sabor",
          min: 1,
          max: 1,
          options: [
            { id: "o-caju", name: "Caju", price: 0, available: true },
            { id: "o-acerola", name: "Acerola", price: 0, available: true },
            { id: "o-maracuja", name: "Maracujá", price: 0, available: true },
          ],
        },
      ],
    }),
    product({ id: "p-agua", prepStation: "none", categoryId: "c-bebidas", name: "Água mineral", description: "500 ml.", price: 500 }),
    product({
      id: "p-pudim",
      categoryId: "c-sobremesas",
      name: "Pudim de leite",
      description: "Fatia generosa.",
      price: 1400,
    }),
    product({
      id: "p-cartola",
      categoryId: "c-sobremesas",
      name: "Cartola",
      description: "Banana, queijo coalho, açúcar e canela.",
      price: 1800,
    }),
  ]);
}

const FIRST_NAMES = [
  "Ana", "Bruno", "Carla", "Diego", "Eduarda", "Felipe", "Gabriela", "Heitor", "Isabela", "João",
  "Larissa", "Marcos", "Natália", "Otávio", "Paula", "Rafael", "Sofia", "Tiago", "Vitória", "Wesley",
];
const LAST_INITIALS = "ABCDFGLMNPRST";

// Pedidos por hora num dia típico (das 11h às 23h); almoço e jantar são os picos.
const HOURLY_WEIGHT: Record<number, number> = {
  11: 2, 12: 5, 13: 5, 14: 2, 15: 1, 16: 1, 17: 2, 18: 3, 19: 5, 20: 6, 21: 5, 22: 3, 23: 1,
};

function pick<T>(rand: () => number, list: T[]): T {
  return list[Math.floor(rand() * list.length)];
}

function randomSelections(rand: () => number, p: Product): Selections {
  const selections: Selections = {};
  for (const g of p.optionGroups) {
    const available = g.options.filter((o) => o.available);
    const count = g.min > 0 ? g.min : rand() < 0.35 ? 1 : 0;
    const chosen = [...available].sort(() => rand() - 0.5).slice(0, Math.min(count, g.max));
    if (chosen.length) selections[g.id] = chosen.map((o) => o.id);
  }
  return selections;
}

export function buildOrderItem(p: Product, selections: Selections, quantity: number): OrderItem {
  return {
    productId: p.id,
    name: p.name,
    unitPrice: unitPrice(p, selections),
    quantity,
    options: p.optionGroups.flatMap((g) =>
      (selections[g.id] ?? []).flatMap((id) => {
        const o = g.options.find((x) => x.id === id);
        return o ? [{ groupName: g.name, optionName: o.name, price: o.price }] : [];
      }),
    ),
  };
}

/** Status de um pedido de hoje conforme a idade, para a demonstração ter uma fila viva. */
function statusForAge(mode: OrderMode, ageMin: number): OrderStatus {
  const flow = statusFlow(mode);
  const steps = mode === "delivery" ? [4, 22, 32, 48] : [4, 18, 28];
  let i = 0;
  while (i < steps.length && ageMin >= steps[i]) i++;
  return flow[Math.min(i, flow.length - 1)];
}

function historyFor(mode: OrderMode, status: OrderStatus, createdAt: Date) {
  const flow = statusFlow(mode);
  const reached: OrderStatus[] =
    status === "cancelado" ? ["novo", "cancelado"] : flow.slice(0, flow.indexOf(status) + 1);
  return reached.map((s, i) => ({
    status: s,
    at: new Date(createdAt.getTime() + i * 9 * 60000).toISOString(),
  }));
}

export function randomOrder(
  rand: () => number,
  store: Store,
  products: Product[],
  createdAt: Date,
  number: number,
  status?: OrderStatus,
): Order {
  const roll = rand();
  const regions = store.delivery.regions.filter((r) => r.active);
  const canDeliver = store.delivery.enabled && regions.length > 0;
  const canTable = store.table.enabled && store.table.count > 0;
  let mode: OrderMode = roll < 0.55 ? "delivery" : roll < 0.8 ? "pickup" : "table";
  if (mode === "delivery" && !canDeliver) mode = canTable && roll < 0.3 ? "table" : "pickup";
  if (mode === "table" && !canTable) mode = "pickup";
  const sellable = products.filter((p) => p.available);
  const itemCount = 1 + Math.floor(rand() * 3);
  const items: OrderItem[] = [];
  for (let i = 0; i < itemCount; i++) {
    const p = pick(rand, sellable);
    items.push(buildOrderItem(p, randomSelections(rand, p), 1 + Math.floor(rand() * 2)));
  }
  const subtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
  const region = regions.length ? pick(rand, regions) : null;
  const deliveryFee = mode === "delivery" && region ? region.fee : 0;
  const eta = mode === "delivery" ? store.delivery.etaMax : mode === "pickup" ? store.pickup.etaMax : 25;
  const payment: PaymentMethod = pick(rand, ["pix", "pix", "card", "card", "cash"] as PaymentMethod[]);
  const finalStatus = status ?? "concluido";
  const history = historyFor(mode, finalStatus, createdAt);
  const total = subtotal + deliveryFee;
  return {
    id: `demo-${createdAt.getTime()}-${number}`,
    storeId: store.id,
    number,
    createdAt: createdAt.toISOString(),
    promisedAt: new Date(createdAt.getTime() + eta * 60000).toISOString(),
    status: finalStatus,
    history,
    mode,
    customer: {
      name: `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_INITIALS.split(""))}.`,
      phone: `819${String(Math.floor(rand() * 1e8)).padStart(8, "0")}`,
    },
    delivery:
      mode === "delivery" && region
        ? { regionId: region.id, regionName: region.name, street: "Rua das Flores", number: String(10 + Math.floor(rand() * 900)) }
        : undefined,
    tableNumber: mode === "table" ? 1 + Math.floor(rand() * store.table.count) : undefined,
    items,
    subtotal,
    deliveryFee,
    total,
    payment: payment === "cash" ? { method: "cash", changeFor: Math.ceil(total / 5000) * 5000 } : { method: payment },
  };
}

/** Pedidos dos últimos 7 dias e de hoje até agora. A mesma data gera os mesmos pedidos. */
export function demoOrders(store: Store, products: Product[], now: Date): { orders: Order[]; nextNumber: number } {
  const orders: Order[] = [];
  let number = 1;
  for (let daysAgo = 7; daysAgo >= 0; daysAgo--) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - daysAgo);
    const rand = seededRandom(day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate());
    for (const [hourText, weight] of Object.entries(HOURLY_WEIGHT)) {
      const hour = Number(hourText);
      const count = Math.max(0, Math.round(weight * (0.6 + rand() * 0.8)));
      const minutes = Array.from({ length: count }, () => Math.floor(rand() * 60)).sort((a, b) => a - b);
      for (const minute of minutes) {
        const createdAt = new Date(day);
        createdAt.setHours(hour, minute, Math.floor(rand() * 60), 0);
        if (createdAt > now) continue;
        const ageMin = (now.getTime() - createdAt.getTime()) / 60000;
        const cancelled = rand() < 0.04;
        const order = randomOrder(
          seededRandom(createdAt.getTime() % 2147483647),
          store,
          products,
          createdAt,
          number,
          cancelled ? "cancelado" : "concluido",
        );
        if (daysAgo === 0 && ageMin < 60 && !cancelled) {
          const status = statusForAge(order.mode, ageMin);
          order.status = status;
          order.history = historyFor(order.mode, status, createdAt);
        }
        orders.push(order);
        number++;
      }
    }
  }
  return { orders, nextNumber: number };
}

export function demoAccount(now: Date): Account {
  return {
    id: DEMO_ACCOUNT_ID,
    name: "Conta de demonstração",
    email: "demo@comanda.local",
    passwordHash: "",
    createdAt: new Date(now.getTime() - 40 * 86400000).toISOString(),
  };
}

/** Comandas das mesas que ainda têm pedido em andamento (as servidas ficam sem comanda). */
export function tabsForOpenTableOrders(store: Store, orders: Order[], tabs: Tab[] = []): Tab[] {
  for (const o of [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (o.storeId === store.id && o.mode === "table" && !o.tabId && isOpenOrder(o)) attachToTab(tabs, o, store, newId);
  }
  return tabs;
}

export function buildDemoDb(now: Date): Db {
  const store = demoStore(now);
  const products = demoProducts();
  const { orders, nextNumber } = demoOrders(store, products, now);
  store.nextOrderNumber = nextNumber;
  return {
    version: 1,
    session: null,
    accounts: [demoAccount(now)],
    stores: [store],
    categories: demoCategories(),
    products,
    orders,
    tabs: tabsForOpenTableOrders(store, orders),
  };
}
