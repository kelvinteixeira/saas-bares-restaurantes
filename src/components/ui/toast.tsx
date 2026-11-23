"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/cn";

type Toast = { id: number; text: string; tone: "neutral" | "negative" };

const ToastContext = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((text: string, tone: Toast["tone"] = "neutral") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* No celular os avisos ficam no topo, para não cobrir a barra da sacola nem os botões de baixo. */}
      <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 top-14 z-50 flex flex-col items-center gap-2 px-4 lg:top-auto lg:bottom-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-card px-4 py-2.5 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.16)]",
              t.tone === "negative" ? "bg-negative text-white" : "bg-ink text-white",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
