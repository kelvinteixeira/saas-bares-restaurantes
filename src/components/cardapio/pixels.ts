"use client";

// Carrega o Pixel da Meta e o Google Analytics 4 da loja no cardápio público e manda os eventos.
// Só os IDs validados por trackingOf chegam aqui (o banco também recusa formato errado).
// Navegar entre cardápio, sacola e acompanhamento não recarrega a página: os dois scripts
// percebem a troca de endereço sozinhos, então o PageView manual é só o da primeira carga.

import { useEffect } from "react";
import type { Store } from "@/lib/types";
import { gaEvent, metaEvent, trackingOf, type TrackEvent } from "@/lib/domain/tracking";

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue: unknown[][]; push: unknown; loaded: boolean; version: string };

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const started = { meta: new Set<string>(), ga: new Set<string>() };

function addScript(src: string) {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function ensureMeta(id: string) {
  if (!window.fbq) {
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    } as Fbq;
    fbq.queue = [];
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    window.fbq = fbq;
    window._fbq = fbq;
    addScript("https://connect.facebook.net/en_US/fbevents.js");
  }
  if (!started.meta.has(id)) {
    started.meta.add(id);
    window.fbq("init", id);
    window.fbq("trackSingle", id, "PageView");
  }
}

function ensureGa(id: string) {
  if (!window.gtag) {
    window.dataLayer = window.dataLayer ?? [];
    // O gtag.js espera o objeto `arguments`, não um array.
    window.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag("js", new Date());
  }
  if (!started.ga.has(id)) {
    started.ga.add(id);
    addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
    window.gtag("config", id);
  }
}

/** Liga os pixels da loja (uma vez por ID). Devolve os IDs ativos. */
export function loadPixels(store: Pick<Store, "tracking">) {
  const t = trackingOf(store);
  if (typeof window === "undefined") return t;
  if (t.metaPixelId) ensureMeta(t.metaPixelId);
  if (t.gaId) ensureGa(t.gaId);
  return t;
}

/** Manda o evento para o Pixel e o Analytics da loja (só os dela, mesmo se outra loja já carregou o seu). */
export function track(store: Pick<Store, "tracking">, event: TrackEvent) {
  try {
    const t = loadPixels(store);
    if (t.metaPixelId && window.fbq) {
      const [name, data, options] = metaEvent(event);
      window.fbq("trackSingle", t.metaPixelId, name, data, options);
    }
    if (t.gaId && window.gtag) {
      const [name, data] = gaEvent(event);
      window.gtag("event", name, { ...data, send_to: t.gaId });
    }
  } catch {
    // medição nunca atrapalha o pedido
  }
}

/** Nas páginas públicas da loja: liga os pixels assim que a loja carrega. */
export function useStorePixels(store: Pick<Store, "tracking"> | null) {
  const meta = store?.tracking?.metaPixelId;
  const ga = store?.tracking?.gaId;
  useEffect(() => {
    if (meta || ga) loadPixels({ tracking: { metaPixelId: meta, gaId: ga } });
  }, [meta, ga]);
}
