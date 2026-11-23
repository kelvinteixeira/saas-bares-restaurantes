"use client";

import { useRouter } from "next/navigation";
import { enterDemo } from "@/lib/store/auth";
import { buttonClass } from "@/components/ui/button";

export function DemoButton({ className, children = "Abrir o painel de demonstração" }: { className?: string; children?: React.ReactNode }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={buttonClass("secondary", "lg", className)}
      onClick={async () => {
        await enterDemo();
        router.push("/painel");
      }}
    >
      {children}
    </button>
  );
}
