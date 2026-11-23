"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChefHat,
  ExternalLink,
  House,
  LogOut,
  Menu,
  QrCode,
  ReceiptText,
  Settings,
  Users,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useDb } from "@/lib/store/db";
import { currentAccount, ownerStore } from "@/lib/store/actions";
import { signOut } from "@/lib/store/auth";
import { useNow, playChime } from "@/lib/hooks";
import { formatOrderNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Wordmark } from "@/components/brand/mark";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { PainelContext, usePainel, type PainelValue } from "@/components/painel/painel-context";
import { StoreStatusControl } from "@/components/painel/store-status-control";
import { ROLE_LABEL, canManageStore, canSee, homeFor } from "@/lib/domain/roles";

const NAV = [
  { href: "/painel", label: "Visão geral", icon: House },
  { href: "/painel/pedidos", label: "Pedidos", icon: ReceiptText },
  { href: "/painel/cozinha", label: "Tela de preparo", icon: ChefHat },
  { href: "/painel/cardapio", label: "Cardápio", icon: UtensilsCrossed },
  { href: "/painel/mesas", label: "Mesas", icon: QrCode },
  { href: "/painel/equipe", label: "Equipe", icon: Users },
  { href: "/painel/configuracoes", label: "Configurações", icon: Settings },
] as const;

export function PainelShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ShellInner>{children}</ShellInner>
    </ToastProvider>
  );
}

function useSoundPreference(): [boolean, (v: boolean) => void] {
  // O painel só renderiza no navegador (no servidor fica o esqueleto), então dá para ler direto.
  const [on, setOn] = useState(() => {
    try {
      return typeof window === "undefined" || window.localStorage.getItem("comanda:som") !== "off";
    } catch {
      return true;
    }
  });
  const update = useCallback((v: boolean) => {
    setOn(v);
    try {
      window.localStorage.setItem("comanda:som", v ? "on" : "off");
    } catch {
      // a preferência vale só nesta aba
    }
  }, []);
  return [on, update];
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const db = useDb();
  const router = useRouter();
  const now = useNow(20000);
  const [soundOn, setSoundOn] = useSoundPreference();
  const account = db ? currentAccount(db) : null;
  const store = db && account ? ownerStore(db, account) : null;
  // Com Supabase, espera conferir a sessão antes de decidir que ninguém entrou.
  const authResolved = db?.authResolved !== false;

  useEffect(() => {
    if (db && authResolved && !account) router.replace("/entrar");
  }, [db, authResolved, account, router]);

  const pathname = usePathname();
  // Contas locais (demonstração e simulação) são donas da própria loja.
  const role = account?.role ?? "owner";
  const allowed = canSee(role, pathname);

  // Tela que a função não usa: vai para a tela inicial dela.
  useEffect(() => {
    if (store && !allowed) router.replace(homeFor(role));
  }, [store, allowed, role, router]);

  const value = useMemo<PainelValue | null>(
    () => (db && account && store ? { db, account, store, now, role, soundOn, setSoundOn } : null),
    [db, account, store, now, role, soundOn, setSoundOn],
  );

  if (db && authResolved && account && !store) return <MissingStore />;
  if (!value || !allowed) return <ShellSkeleton />;

  return (
    <PainelContext.Provider value={value}>
      <NewOrderWatcher soundOn={soundOn} />
      {pathname.startsWith("/painel/cozinha") ? (
        // A tela de preparo ocupa a tela toda, sem o menu do painel.
        children
      ) : (
        <Frame soundOn={soundOn} setSoundOn={setSoundOn}>
          {children}
        </Frame>
      )}
    </PainelContext.Provider>
  );
}

/** Conta sem loja: o cadastro não chegou a criar a loja no banco (raro). */
function MissingStore() {
  const router = useRouter();
  return (
    <div className="grid min-h-dvh place-items-center bg-ground px-4">
      <div className="max-w-[440px] rounded-card border border-line bg-surface p-6">
        <Wordmark />
        <h1 className="mt-6 text-[20px] font-semibold">Esta conta não está em nenhuma loja</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Se você trabalha num bar ou restaurante, peça ao dono um convite novo e abra o link dele: é por ele que a conta
          entra na equipe. Se você é o dono, a loja não chegou a ser criada; crie a conta de novo com outro e-mail ou fale
          com o suporte.
        </p>
        <button
          type="button"
          onClick={async () => {
            await signOut();
            router.replace("/entrar");
          }}
          className="mt-5 h-9 rounded-control bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Sair da conta
        </button>
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="grid h-dvh bg-ground lg:grid-cols-[228px_1fr] lg:grid-rows-[48px_1fr]">
      <div className="hidden px-4 py-3 lg:row-span-2 lg:block">
        <Wordmark />
      </div>
      <div className="hidden lg:block" />
      <div className="bg-surface lg:mr-2 lg:mb-2 lg:rounded-sheet lg:border lg:border-line" aria-busy="true" />
    </div>
  );
}

/** Toca o aviso e mostra a notificação quando entra um pedido com número maior que o último visto. */
function NewOrderWatcher({ soundOn }: { soundOn: boolean }) {
  const { db, store } = usePainel();
  const toast = useToast();
  const pathname = usePathname();
  const lastSeen = useRef<number | null>(null);
  const orders = db.orders.filter((o) => o.storeId === store.id);
  const latest = orders.reduce((max, o) => Math.max(max, o.number), 0);
  const waiting = orders.filter((o) => o.status === "novo").length;

  useEffect(() => {
    if (lastSeen.current !== null && latest > lastSeen.current) {
      if (soundOn) playChime();
      toast(`Novo pedido ${formatOrderNumber(latest)}`);
    }
    lastSeen.current = latest;
  }, [latest, soundOn, toast]);

  // O Next reescreve o título ao trocar de página; aplicamos o contador logo depois.
  useEffect(() => {
    const base = "Painel · Comanda";
    const id = window.setTimeout(() => {
      document.title = waiting ? `(${waiting}) ${base}` : base;
    }, 60);
    return () => window.clearTimeout(id);
  }, [waiting, pathname]);

  return null;
}

function Frame({
  children,
  soundOn,
  setSoundOn,
}: {
  children: React.ReactNode;
  soundOn: boolean;
  setSoundOn: (v: boolean) => void;
}) {
  const { db, store, account, now, role } = usePainel();
  const pathname = usePathname();
  const router = useRouter();
  const items = NAV.filter((n) => canSee(role, n.href));
  // O menu guarda em que página foi aberto; ao navegar, deixa de valer e fecha sozinho.
  const [menuOpenedAt, setMenuOpenedAt] = useState<string | null>(null);
  const menuOpen = menuOpenedAt === pathname;
  const setMenuOpen = (open: boolean) => setMenuOpenedAt(open ? pathname : null);

  const waiting = db.orders.filter((o) => o.storeId === store.id && o.status === "novo").length;
  const current = items.find((n) => (n.href === "/painel" ? pathname === "/painel" : pathname.startsWith(n.href)));

  const logout = async () => {
    await signOut();
    router.replace("/entrar");
  };

  const nav = (
    <nav aria-label="Painel" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = item === current;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 items-center gap-2.5 rounded-[8px] px-2.5 text-sm text-[#3f3f46] transition-colors hover:bg-active/70 hover:text-ink lg:h-8",
              active && "bg-active font-medium text-ink",
            )}
          >
            <Icon className="size-4 flex-none" strokeWidth={1.5} aria-hidden="true" />
            <span className="flex-1">{item.label}</span>
            {item.href === "/painel/pedidos" && waiting > 0 && (
              <span className="num rounded-full bg-negative px-1.5 text-xs font-medium leading-5 text-white">
                {waiting}
                <span className="sr-only"> novos</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="flex flex-col gap-1 text-sm">
      <a
        href={`/${store.slug}`}
        target="_blank"
        rel="noreferrer"
        className="flex h-10 items-center gap-2.5 rounded-[8px] px-2.5 text-[#3f3f46] hover:bg-active/70 hover:text-ink lg:h-8"
      >
        <ExternalLink className="size-4" strokeWidth={1.5} aria-hidden="true" />
        Ver cardápio público
      </a>
      <div className="mt-2 flex items-center gap-2 px-2.5">
        <span
          aria-hidden="true"
          className="grid size-7 flex-none place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
        >
          {account.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{account.name}</span>
          <span className="block truncate text-xs text-muted">
            {role === "owner" ? account.email : ROLE_LABEL[role]}
          </span>
        </span>
        <button
          type="button"
          onClick={logout}
          aria-label="Sair da conta"
          className="grid size-8 place-items-center rounded-control text-muted hover:bg-active hover:text-ink"
        >
          <LogOut className="size-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );

  const soundButton = (
    <button
      type="button"
      onClick={() => setSoundOn(!soundOn)}
      aria-pressed={soundOn}
      aria-label="Som de pedido novo"
      title={soundOn ? "Som de pedido novo ligado" : "Som de pedido novo desligado"}
      className="grid size-10 place-items-center rounded-control text-muted hover:bg-active hover:text-ink lg:size-8"
    >
      {soundOn ? <Volume2 className="size-4" strokeWidth={1.5} /> : <VolumeX className="size-4" strokeWidth={1.5} />}
    </button>
  );

  return (
    <div className="min-h-dvh bg-ground lg:grid lg:h-dvh lg:grid-cols-[228px_1fr] lg:grid-rows-[48px_1fr]">
      {/* Barra lateral no mesmo tom da moldura, sem linha divisória. */}
      <aside className="no-print hidden flex-col justify-between px-3 pb-4 lg:row-span-2 lg:flex">
        <div className="flex flex-col gap-5">
          <div className="flex h-12 items-center px-1.5">
            <Wordmark />
          </div>
          <div className="px-2.5">
            <p className="text-xs text-muted">Loja</p>
            <p className="truncate text-sm font-medium">{store.name}</p>
          </div>
          {nav}
        </div>
        {footer}
      </aside>

      <header className="no-print hidden items-center justify-between gap-4 pr-4 lg:flex">
        <StoreStatusControl store={store} now={now} readOnly={!canManageStore(role)} />
        {soundButton}
      </header>

      <header className="no-print sticky top-0 z-30 flex h-12 items-center justify-between gap-2 bg-ground px-2 lg:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menu"
          aria-expanded={menuOpen}
          className="grid size-11 place-items-center rounded-control hover:bg-active"
        >
          <Menu className="size-5" strokeWidth={1.5} />
        </button>
        <span className="truncate text-[15px] font-semibold">{current?.label ?? "Painel"}</span>
        {soundButton}
      </header>

      {menuOpen && (
        <div
          className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-ground px-4 pb-6 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <div className="flex h-12 items-center justify-between">
            <Wordmark />
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Fechar menu"
              className="grid size-11 place-items-center rounded-control hover:bg-active"
            >
              <X className="size-5" strokeWidth={1.5} />
            </button>
          </div>
          <div className="mt-3 rounded-card bg-surface p-3">
            <p className="text-xs text-muted">Loja</p>
            <p className="mb-3 text-sm font-medium">{store.name}</p>
            <StoreStatusControl store={store} now={now} readOnly={!canManageStore(role)} className="justify-between" />
          </div>
          <div className="mt-5 flex-1">{nav}</div>
          <div className="mt-6">{footer}</div>
        </div>
      )}

      <main className="min-w-0 bg-surface lg:mr-2 lg:mb-2 lg:overflow-y-auto lg:rounded-sheet lg:border lg:border-line">
        {children}
      </main>
    </div>
  );
}
