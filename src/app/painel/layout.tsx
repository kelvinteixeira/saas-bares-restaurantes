import type { Metadata } from "next";
import { PainelShell } from "@/components/painel/shell";

export const metadata: Metadata = {
  title: "Painel",
  robots: { index: false },
};

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return <PainelShell>{children}</PainelShell>;
}
