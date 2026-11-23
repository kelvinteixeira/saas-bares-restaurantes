"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthFrame } from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ROLE_HINT, ROLE_LABEL } from "@/lib/domain/roles";
import { MIN_PASSWORD, signOut } from "@/lib/store/auth";
import {
  acceptInvite,
  currentAuthEmail,
  getInvite,
  joinWithNewAccount,
  joinWithPassword,
  teamAvailable,
  TeamError,
  type InviteInfo,
} from "@/lib/store/team";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "missing" }
  | { state: "ready"; invite: InviteInfo; sessionEmail: string | null };

export function InviteScreen({ token }: { token: string }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [mode, setMode] = useState<"new" | "login">("new");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!teamAvailable()) {
      setLoad({ state: "error", message: "Este endereço só funciona com o sistema ligado ao banco de dados." });
      return;
    }
    try {
      const [invite, sessionEmail] = await Promise.all([getInvite(token), currentAuthEmail()]);
      setLoad(invite ? { state: "ready", invite, sessionEmail } : { state: "missing" });
    } catch (err) {
      setLoad({ state: "error", message: err instanceof Error ? err.message : "Não foi possível abrir o convite." });
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial vinda do banco
    void refresh();
  }, [refresh]);

  /** Roda a ação e vai para o painel; se ela devolver false, fica nesta tela. */
  async function run(work: () => Promise<boolean | void>) {
    setError(null);
    setBusy(true);
    try {
      if ((await work()) === false) {
        setBusy(false);
        return;
      }
      router.replace("/painel");
    } catch (err) {
      if (err instanceof TeamError && err.message === "EXISTE") {
        setMode("login");
        setPassword("");
        setError("Este e-mail já tem conta no Comanda. Entre com a senha dela.");
      } else {
        setError(err instanceof Error && err.message ? err.message : "Algo deu errado. Tente de novo.");
      }
      setBusy(false);
    }
  }

  if (load.state === "loading") {
    return (
      <AuthFrame title="Abrindo o convite…" subtitle="Só um instante." aside={<Aside />}>
        <div className="h-40" aria-busy="true" />
      </AuthFrame>
    );
  }

  if (load.state === "error" || load.state === "missing") {
    return (
      <AuthFrame
        title="Convite não encontrado"
        subtitle={
          load.state === "error"
            ? load.message
            : "O link pode ter sido usado, cancelado ou copiado pela metade. Peça um convite novo ao dono da loja."
        }
        aside={<Aside />}
      >
        <Link href="/entrar" className="text-sm font-medium text-accent hover:underline">
          Ir para o login
        </Link>
      </AuthFrame>
    );
  }

  const { invite, sessionEmail } = load;
  const role = ROLE_LABEL[invite.role].toLowerCase();
  const title = `Entrar na equipe do ${invite.storeName}`;

  if (invite.expired) {
    return (
      <AuthFrame title="Este convite venceu" subtitle={`Peça ao dono do ${invite.storeName} para renovar o convite e mandar o link de novo.`} aside={<Aside invite={invite} />}>
        <Link href="/entrar" className="text-sm font-medium text-accent hover:underline">
          Ir para o login
        </Link>
      </AuthFrame>
    );
  }

  if (sentTo) {
    return (
      <AuthFrame title="Confirme seu e-mail" subtitle={`Mandamos um link para ${sentTo}. Depois de confirmar, abra este convite de novo para entrar na equipe.`} aside={<Aside invite={invite} />}>
        <p className="text-sm text-muted">Não chegou? Olhe a caixa de spam.</p>
      </AuthFrame>
    );
  }

  // Já logado com o e-mail do convite: só falta aceitar.
  if (sessionEmail === invite.email) {
    return (
      <AuthFrame title={title} subtitle={`Você vai entrar como ${role}, com a conta ${invite.email}.`} aside={<Aside invite={invite} />}>
        {error && <p className="mb-4 text-sm text-negative">{error}</p>}
        <Button variant="primary" size="lg" className="w-full" disabled={busy} onClick={() => void run(() => acceptInvite(token))}>
          {busy ? "Entrando…" : "Entrar na equipe"}
        </Button>
      </AuthFrame>
    );
  }

  // Logado com outra conta: precisa sair antes.
  if (sessionEmail) {
    return (
      <AuthFrame title={title} subtitle={`Este convite é para ${invite.email}, mas você está com a conta ${sessionEmail} aberta.`} aside={<Aside invite={invite} />}>
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={async () => {
            await signOut();
            await refresh();
          }}
        >
          Sair desta conta e continuar
        </Button>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title={title}
      subtitle={mode === "new" ? `Crie sua senha para entrar como ${role}.` : `Entre com a senha da sua conta para entrar como ${role}.`}
      aside={<Aside invite={invite} />}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (mode === "login") {
              await joinWithPassword({ token, email: invite.email, password });
              return;
            }
            const { needsConfirmation } = await joinWithNewAccount({ token, email: invite.email, name, password });
            if (needsConfirmation) {
              setSentTo(invite.email);
              return false;
            }
          });
        }}
      >
        <Field label="E-mail" hint="O convite vale só para este e-mail.">
          {(p) => <Input {...p} type="email" value={invite.email} readOnly disabled />}
        </Field>
        {mode === "new" && (
          <Field label="Seu nome" hint="Aparece para o dono na lista da equipe.">
            {(p) => <Input {...p} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
        )}
        <Field
          label={mode === "new" ? "Crie uma senha" : "Senha"}
          hint={mode === "new" ? `Pelo menos ${MIN_PASSWORD} caracteres.` : undefined}
          error={error ?? undefined}
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete={mode === "new" ? "new-password" : "current-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" disabled={busy || !password || (mode === "new" && !name.trim())}>
          {busy ? "Entrando…" : mode === "new" ? "Criar acesso e entrar" : "Entrar na equipe"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        {mode === "new" ? "Já tem conta no Comanda com este e-mail? " : "Ainda não tem conta? "}
        <button
          type="button"
          className="font-medium text-accent hover:underline"
          onClick={() => {
            setMode(mode === "new" ? "login" : "new");
            setError(null);
          }}
        >
          {mode === "new" ? "Entrar com a senha" : "Criar acesso"}
        </button>
      </p>
    </AuthFrame>
  );
}

function Aside({ invite }: { invite?: InviteInfo }) {
  return (
    <div className="max-w-[380px]">
      <p className="text-xs font-medium tracking-[0.08em] text-muted uppercase">Convite</p>
      {invite ? (
        <>
          <p className="mt-3 text-[22px] leading-7 font-semibold">{invite.storeName}</p>
          <p className="mt-1 text-[15px]">Função: {ROLE_LABEL[invite.role]}</p>
          <p className="mt-4 text-sm leading-6 text-muted">{ROLE_HINT[invite.role]} O dono pode mudar a sua função ou tirar o acesso quando precisar.</p>
        </>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted">Cada pessoa da equipe entra com o próprio login e vê só o que a função dela precisa.</p>
      )}
    </div>
  );
}
