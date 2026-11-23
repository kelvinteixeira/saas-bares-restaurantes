"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePainel } from "@/components/painel/painel-context";
import { SettingsSection } from "@/components/painel/settings/section";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { attempt, useToast } from "@/components/ui/toast";
import { signOut } from "@/lib/store/auth";
import { resetDemoData } from "@/lib/store/db";
import { DEMO_STORE_ID } from "@/lib/seed";
import { fillSampleMenu } from "@/lib/store/actions";
import { supabaseConfigured } from "@/lib/supabase/client";

export function AccountSettings() {
  const { account, store } = usePainel();
  const router = useRouter();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const isDemo = store.id === DEMO_STORE_ID;

  return (
    <div>
      <SettingsSection title="Sua conta" description="Quem entra neste painel.">
        <dl className="grid grid-cols-[96px_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Nome</dt>
          <dd>{account.name}</dd>
          <dt className="text-muted">E-mail</dt>
          <dd>{account.email}</dd>
        </dl>
        <p className="mt-4 text-sm text-muted">
          {isDemo
            ? "A demonstração fica salva só neste navegador. Para usar com clientes, crie a sua conta."
            : supabaseConfigured()
              ? "Sua conta e sua loja ficam salvas no servidor: dá para entrar de qualquer aparelho."
              : "Nesta versão de testes a conta fica salva só neste navegador."}
        </p>
        <div className="mt-5 flex justify-end">
          <Button
            onClick={async () => {
              await signOut();
              router.replace("/entrar");
            }}
          >
            Sair da conta
          </Button>
        </div>
      </SettingsSection>

      {!isDemo && (
        <SettingsSection
          title="Cardápio de exemplo"
          description="Para testar o cardápio público sem cadastrar tudo à mão."
        >
          <p className="text-sm leading-6">
            Acrescenta 5 categorias e 17 itens de um bar de exemplo ao que já existe. Se a entrega ainda não tiver bairros,
            liga também bairros de exemplo e 10 mesas. Dá para editar ou apagar tudo no Cardápio.
          </p>
          <div className="mt-5 flex justify-end">
            <Button
              onClick={async () => {
                const added = await attempt(toast, () => fillSampleMenu(store.id));
                if (added !== undefined) toast(added ? "Cardápio de exemplo adicionado" : "O cardápio de exemplo já está na loja.");
              }}
            >
              Adicionar cardápio de exemplo
            </Button>
          </div>
        </SettingsSection>
      )}

      {isDemo && (
        <SettingsSection
          title="Dados de demonstração"
          description="Volta o Bar do Cais ao estado inicial, com os pedidos de hoje e da última semana gerados de novo para o horário atual."
        >
          <p className="text-sm leading-6">
            Apaga o que você mudou no cardápio, nas configurações e nos pedidos do Bar do Cais. Contas e lojas que você criou
            continuam.
          </p>
          <div className="mt-5 flex justify-end">
            <Button variant="danger" onClick={() => setConfirmReset(true)}>
              Restaurar demonstração
            </Button>
          </div>
        </SettingsSection>
      )}

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Restaurar o Bar do Cais?"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmReset(false)}>Manter como está</Button>
            <Button
              variant="danger"
              onClick={() => {
                resetDemoData();
                setConfirmReset(false);
                toast("Demonstração restaurada");
              }}
            >
              Restaurar
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6">As mudanças feitas no Bar do Cais se perdem. Isso não pode ser desfeito.</p>
      </Modal>
    </div>
  );
}
