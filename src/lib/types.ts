// Modelo de dados do sistema. Valores em dinheiro são sempre centavos (inteiros).
// Na fase 2 estes tipos viram tabelas no Postgres; os nomes já seguem essa ideia.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = domingo

/** Intervalo de funcionamento em "HH:mm". Se close <= open, o intervalo vira a meia-noite. */
export interface OpeningInterval {
  open: string;
  close: string;
}

export type WeeklyHours = Record<Weekday, OpeningInterval[]>;

/** "auto" segue os horários; "open"/"closed" forçam o status até o dono voltar para "auto". */
export type ManualStatus = "auto" | "open" | "closed";

export interface DeliveryRegion {
  id: string;
  name: string; // bairro ou região
  fee: number; // centavos
  active: boolean;
}

export interface Address {
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
}

export interface Store {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  description: string;
  phone: string; // WhatsApp, só dígitos com DDD
  address: Address;
  brandColor: string; // hex
  logo?: string; // data URL na fase 1
  hours: WeeklyHours;
  manualStatus: ManualStatus;
  delivery: {
    enabled: boolean;
    minOrder: number; // centavos
    etaMin: number; // minutos
    etaMax: number;
    regions: DeliveryRegion[];
  };
  pickup: {
    enabled: boolean;
    etaMin: number;
    etaMax: number;
  };
  table: {
    enabled: boolean;
    count: number;
  };
  payment: {
    pix: boolean;
    card: boolean;
    cash: boolean;
  };
  nextOrderNumber: number;
  createdAt: string; // ISO
}

export interface Category {
  id: string;
  storeId: string;
  name: string;
  position: number;
  visible: boolean;
}

export interface ProductOption {
  id: string;
  name: string;
  price: number; // acréscimo em centavos
  available: boolean;
}

export interface OptionGroup {
  id: string;
  name: string;
  min: number; // 0 = opcional
  max: number; // >= 1
  options: ProductOption[];
}

/** Onde o item é preparado: cozinha, bar, ou nenhum (sai pronto, como cerveja e refrigerante). */
export type PrepStation = "kitchen" | "bar" | "none";

export interface Product {
  id: string;
  storeId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number; // centavos
  image?: string; // data URL na fase 1
  available: boolean;
  position: number;
  optionGroups: OptionGroup[];
  /** Sem valor = cozinha. */
  prepStation?: PrepStation;
}

export type OrderMode = "delivery" | "pickup" | "table";

export type OrderStatus =
  | "novo"
  | "em_preparo"
  | "pronto"
  | "a_caminho"
  | "concluido"
  | "cancelado";

export type PaymentMethod = "pix" | "card" | "cash";

export interface OrderItemOption {
  groupName: string;
  optionName: string;
  price: number;
}

export interface OrderItem {
  productId: string;
  name: string;
  unitPrice: number; // já com os adicionais
  quantity: number;
  options: OrderItemOption[];
  notes?: string;
}

export interface Order {
  id: string;
  storeId: string;
  number: number;
  createdAt: string;
  promisedAt: string;
  status: OrderStatus;
  history: { status: OrderStatus; at: string }[];
  mode: OrderMode;
  customer: { name: string; phone: string };
  delivery?: {
    regionId: string;
    regionName: string;
    street: string;
    number: string;
    complement?: string;
    reference?: string;
  };
  tableNumber?: number;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  payment: { method: PaymentMethod; changeFor?: number };
  notes?: string;
}

/** Função de quem entra no painel: dono, gerente, caixa, garçom ou cozinha. */
export type StoreRole = "owner" | "manager" | "cashier" | "waiter" | "kitchen";

export interface Account {
  id: string;
  name: string;
  email: string;
  passwordHash: string; // só na simulação; na fase 2 o Supabase Auth cuida disso
  createdAt: string;
  /** Loja e função vindas da equipe (store_members). Contas locais são donas da própria loja. */
  storeId?: string;
  role?: StoreRole;
}

/** Pessoa da equipe da loja (store_members). */
export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: StoreRole;
  createdAt: string;
}

/** Convite pendente para entrar na equipe. */
export interface TeamInvite {
  id: string;
  email: string;
  role: Exclude<StoreRole, "owner">;
  token: string;
  createdAt: string;
  expiresAt: string;
}

export interface Db {
  version: 1;
  /** Migrações de dados já aplicadas neste navegador (cada uma roda uma vez só). */
  migrations?: string[];
  /**
   * Só na visão mesclada (não é salvo): false enquanto a sessão do Supabase ainda está sendo
   * conferida, para o painel não mandar para /entrar antes da hora.
   */
  authResolved?: boolean;
  session: { accountId: string } | null;
  accounts: Account[];
  stores: Store[];
  categories: Category[];
  products: Product[];
  orders: Order[];
}
