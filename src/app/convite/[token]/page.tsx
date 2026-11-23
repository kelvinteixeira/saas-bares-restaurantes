import type { Metadata } from "next";
import { InviteScreen } from "@/components/auth/invite-screen";

export const metadata: Metadata = {
  title: "Convite para a equipe",
  robots: { index: false },
};

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteScreen token={token} />;
}
