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
  /** Taxa de serviço das mesas. Sem valor = 10% ligada (padrão do banco). */
  serviceFee?: { enabled: boolean; rate: number };
  /** Cashback pelo WhatsApp. Sem valor = desligado. */
  cashback?: { enabled: boolean; rate: number; validDays: number };
  /** Pedido agendado. Sem valor = desligado. */
  scheduling?: { enabled: boolean; leadMinutes: number; maxDays: number };
  /** Pixel da Meta e Google Analytics no cardápio. Sem valor = nenhum. */
  tracking?: { metaPixelId?: string; gaId?: string };
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
  /** Códigos fiscais próprios do item (senão valem os padrões da loja). SQL 012. */
  fiscal?: ProductFiscal;
}

export interface ProductFiscal {
  ncm?: string;
  cfop?: string;
  /** CSOSN (Simples Nacional) ou CST do ICMS (regime normal). */
  taxCode?: string;
}

export type TaxRegime = "simples" | "simples_excesso" | "normal";
export type FiscalEnvironment = "homologacao" | "producao";

/** Dados fiscais da loja para a NFC-e. Certificado e CSC não ficam aqui: vão direto ao emissor. */
export interface StoreFiscal {
  storeId: string;
  enabled: boolean;
  environment: FiscalEnvironment;
  cnpj: string;
  ie: string;
  legalName: string;
  regime: TaxRegime;
  defaultNcm: string;
  defaultCfop: string;
  defaultTaxCode: string;
  providerCompanyId?: string;
  certificateValidUntil?: string;
  updatedAt: string;
}

/** Nota fiscal de consumidor (NFC-e) de um pedido. Gravada pelo servidor com a resposta do emissor. */
export interface FiscalDocument {
  id: string;
  storeId: string;
  orderId?: string;
  environment: FiscalEnvironment;
  /** "simulador" = sem valor fiscal. */
  provider: string;
  status: "processing" | "authorized" | "rejected" | "cancelled" | "error";
  number?: number;
  series?: number;
  accessKey?: string;
  protocol?: string;
  total: number;
  cpf?: string;
  danfeUrl?: string;
  xmlUrl?: string;
  message?: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
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

/** Como o pedido será pago: "tab" = vai para a conta da mesa (lançado pelo garçom). */
export type OrderPaymentMethod = PaymentMethod | "tab";

/** De onde veio o pedido: cliente (cardápio/QR), garçom ou PDV. */
export type OrderSource = "cliente" | "garcom" | "pdv";

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
  payment: { method: OrderPaymentMethod; changeFor?: number };
  notes?: string;
  /** Comanda da mesa a que o pedido pertence. */
  tabId?: string;
  source?: OrderSource;
  /** Quem da equipe lançou (garçom, PDV). */
  createdBy?: string;
  /** Desconto do cupom (centavos), já abatido do total. */
  discount?: number;
  couponId?: string;
  couponCode?: string;
  /** Saldo de cashback usado (centavos), já abatido do total. */
  cashbackUsed?: number;
  /** Pedido agendado: o horário escolhido pelo cliente (o prazo prometido é o mesmo). */
  scheduledFor?: string;
  /** Entregador escolhido e quanto ele recebe por esta entrega (guardado na hora da escolha). */
  driverId?: string;
  driverPay?: number;
}

/** Sacola de quem chegou a digitar o WhatsApp no fechamento e não fez o pedido (recuperador de vendas). */
export interface AbandonedCart {
  id: string;
  storeId: string;
  phone: string;
  name: string;
  items: { productId: string; name: string; quantity: number; price: number }[];
  subtotal: number;
  mode?: "delivery" | "pickup";
  /** open: ninguém chamou · contacted: a loja chamou no WhatsApp · converted: virou pedido · dismissed: descartada. */
  status: "open" | "contacted" | "converted" | "dismissed";
  contactedAt?: string;
  orderId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Entregador da loja. Recebe a taxa de entrega do pedido ("fee") ou um valor fixo ("fixed"). */
export interface Driver {
  id: string;
  storeId: string;
  name: string;
  phone: string;
  payKind: "fee" | "fixed";
  payAmount: number;
  active: boolean;
  createdAt: string;
}

/** Lançamento de cashback: ganho ao concluir um pedido, ou uso num pedido. */
export interface CashbackEntry {
  id: string;
  storeId: string;
  phone: string;
  orderId?: string;
  kind: "earn" | "spend";
  amount: number;
  createdAt: string;
  /** Só nos ganhos. */
  expiresAt?: string;
}

export type CouponKind = "percent" | "fixed" | "free_delivery";

/** Cupom de desconto do cardápio. value: 1–100 no percent; centavos no fixed; 0 na entrega grátis. */
export interface Coupon {
  id: string;
  storeId: string;
  code: string;
  kind: CouponKind;
  value: number;
  minOrder: number;
  maxUses?: number;
  oncePerCustomer: boolean;
  startsAt?: string;
  endsAt?: string;
  active: boolean;
  createdAt: string;
}

export type TabStatus = "open" | "bill_requested" | "closed";

/** Comanda de mesa: junta os pedidos do garçom, do QR code e do PDV até fechar a conta. */
export interface Tab {
  id: string;
  storeId: string;
  tableNumber: number;
  status: TabStatus;
  openedBy?: string;
  openedAt: string;
  closedBy?: string;
  closedAt?: string;
  /** Percentual da taxa de serviço quando a comanda abriu. */
  serviceFeeRate: number;
  serviceFeeRemoved: boolean;
  notes?: string;
}

/** Forma de um recebimento no caixa (o cartão separa crédito e débito). */
export type PaymentKind = "pix" | "credit" | "debit" | "cash";

/** Turno do caixa: abre com o fundo de troco e fecha com a contagem do dinheiro. */
export interface CashSession {
  id: string;
  storeId: string;
  status: "open" | "closed";
  openedBy?: string;
  openedAt: string;
  openingAmount: number;
  closedBy?: string;
  closedAt?: string;
  countedAmount?: number;
  expectedAmount?: number;
  notes?: string;
}

/** Recebimento da conta de uma mesa (tabId) ou de um pedido fora de mesa (orderId). */
export interface Payment {
  id: string;
  storeId: string;
  cashSessionId: string;
  tabId?: string;
  orderId?: string;
  method: PaymentKind;
  /** Quanto abateu da conta. No dinheiro, o entregue é amount + changeGiven. */
  amount: number;
  changeGiven: number;
  createdBy?: string;
  createdAt: string;
}

/** Sangria (withdrawal) ou suprimento (deposit). */
export interface CashMovement {
  id: string;
  storeId: string;
  cashSessionId: string;
  kind: "withdrawal" | "deposit";
  amount: number;
  reason: string;
  createdBy?: string;
  createdAt: string;
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
  /** Comandas de mesa (documentos antigos da demonstração não têm). */
  tabs?: Tab[];
  cashSessions?: CashSession[];
  payments?: Payment[];
  cashMovements?: CashMovement[];
  coupons?: Coupon[];
  cashbackEntries?: CashbackEntry[];
  drivers?: Driver[];
  carts?: AbandonedCart[];
  storeFiscal?: StoreFiscal[];
  fiscalDocs?: FiscalDocument[];
}
