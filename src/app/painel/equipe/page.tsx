"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, MessageCircle, RotateCw, Trash2, UserPlus } from "lucide-react";
import type { StoreRole, TeamInvite, TeamMember } from "@/lib/types";
import { INVITABLE_ROLES, ROLE_HINT, ROLE_LABEL } from "@/lib/domain/roles";
import { isRemoteStore } from "@/lib/store/remote";
import {
  cancelInvite,
  changeRole,
  createInvite,
  inviteLink,
  loadTeam,
  removeMember,
  renewInvite,
} from "@/lib/store/team";
import { usePainel } from "@/components/painel/painel-context";
import { Card, PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { attempt, useToast } from "@/components/ui/toast";

type Team = { members: TeamMember[]; invites: TeamInvite[] };

function inviteMessage(storeName: string, inv: TeamInvite) {
  return `Oi! Você foi convidado para a equipe do ${storeName} no Comanda, como ${ROLE_LABEL[inv.role].toLowerCase()}. Crie seu acesso por este link: ${inviteLink(inv.token)}`;
}

function whatsappHref(storeName: string, inv: TeamInvite) {
  return `https://wa.me/?text=${encodeURIComponent(inviteMessage(storeName, inv))}`;
}

const linkButton =
  "inline-flex h-8 items-center gap-2 rounded-control border border-control bg-surface px-3 text-[13px] font-medium hover:bg-raised";

export default function EquipePage() {
  const { store, account, now } = usePainel();
  const toast = useToast();
  const remote = isRemoteStore(store.id);
  const [team, setTeam] = useState<Team | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  const reload = useCallback(async () => {
    try {
      setTeam(await loadTeam(store.id));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Não foi possível carregar a equipe.");
    }
  }, [store.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial vinda do banco
    if (remote) void reload();
  }, [remote, reload]);

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      toast("Link do convite copiado");
    } catch {
      toast("Não foi possível copiar. Selecione o link e copie.", "negative");
    }
  }

  if (!remote) {
    return (
      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <PageHeader title="Equipe" subtitle="Cada pessoa entra com o próprio login e vê só o que a função dela precisa." />
        <p className="mt-6 max-w-[640px] rounded-card bg-pill-warning-bg px-4 py-3 text-sm leading-6 text-pill-warning-ink">
          A demonstração não tem equipe. Crie uma conta de verdade para convidar garçons, caixa e cozinha.
        </p>
        <RoleGuide />
      </div>
    );
  }

  const owners = team?.members.filter((m) => m.role === "owner").length ?? 0;

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      <PageHeader
        title="Equipe"
        subtitle="Cada pessoa entra com o próprio login e vê só o que a função dela precisa."
        actions={
          <Button variant="primary" onClick={() => setInviting(true)} disabled={!team}>
            <UserPlus className="size-4" strokeWidth={1.5} aria-hidden="true" />
            Convidar pessoa
          </Button>
        }
      />

      {loadError && (
        <div className="mt-6 flex max-w-[720px] flex-col items-start gap-3 rounded-card bg-pill-negative-bg px-4 py-3 text-sm text-pill-negative-ink">
          <p>{loadError}</p>
          <Button size="sm" onClick={() => void reload()}>
            Tentar de novo
          </Button>
        </div>
      )}

      {!team && !loadError && <p className="mt-6 text-sm text-muted">Carregando a equipe…</p>}

      {team && (
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card title="Quem já está na equipe" aside={`${team.members.length} ${team.members.length === 1 ? "pessoa" : "pessoas"}`} bodyClassName="px-0 pb-1">
              <ul className="divide-y divide-line">
                {team.members.map((m) => {
                  const me = m.userId === account.id;
                  const lastOwner = m.role === "owner" && owners <= 1;
                  return (
                    <li key={m.userId} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
                      <span
                        aria-hidden="true"
                        className="hidden size-9 flex-none place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent sm:grid"
                      >
                        {(m.name || m.email).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {m.name || m.email.split("@")[0]}
                          {me && <span className="font-normal text-muted"> (você)</span>}
                        </span>
                        <span className="block truncate text-[13px] text-muted">{m.email}</span>
                      </span>
                      <div className="flex items-center gap-2">
                        {m.role === "owner" ? (
                          <Pill tone="accent">Dono</Pill>
                        ) : (
                          <Select
                            aria-label={`Função de ${m.name || m.email}`}
                            className="h-9 w-[140px]"
                            value={m.role}
                            onChange={(e) =>
                              void attempt(
                                toast,
                                async () => {
                                  await changeRole(store.id, m.userId, e.target.value as StoreRole);
                                  await reload();
                                },
                                "Função alterada",
                              )
                            }
                          >
                            {INVITABLE_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </Select>
                        )}
                        {!me && !lastOwner && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-9 px-0 text-muted hover:text-negative"
                            aria-label={`Tirar ${m.name || m.email} da equipe`}
                            onClick={() => setRemoving(m)}
                          >
                            <Trash2 className="size-4" strokeWidth={1.5} />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card
              title="Convites esperando"
              aside={team.invites.length ? `${team.invites.length}` : undefined}
              bodyClassName={team.invites.length ? "px-0 pb-1" : undefined}
            >
              {team.invites.length === 0 ? (
                <p className="text-sm leading-6 text-muted">
                  Nenhum convite aberto. Ao convidar, você recebe um link para mandar pelo WhatsApp ou e-mail. A pessoa cria a
                  senha dela e já entra na loja.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {team.invites.map((inv) => {
                    const expired = new Date(inv.expiresAt).getTime() < now.getTime();
                    return (
                      <li key={inv.id} className="flex flex-col gap-3 px-5 py-3 lg:flex-row lg:items-center">
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{inv.email}</span>
                            <Pill>{ROLE_LABEL[inv.role]}</Pill>
                            {expired && <Pill tone="negative">Venceu</Pill>}
                          </span>
                          <span className="mt-0.5 block text-[13px] text-muted">
                            {expired
                              ? "O link não funciona mais. Renove para mandar de novo."
                              : `Vale até ${new Date(inv.expiresAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}.`}
                          </span>
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          {expired ? (
                            <Button size="sm" onClick={() => void attempt(toast, async () => { await renewInvite(inv.id); await reload(); }, "Convite renovado por mais 7 dias")}>
                              <RotateCw className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                              Renovar
                            </Button>
                          ) : (
                            <>
                              <Button size="sm" onClick={() => void copy(inv.token)}>
                                <Copy className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                                Copiar link
                              </Button>
                              <a href={whatsappHref(store.name, inv)} target="_blank" rel="noreferrer" className={linkButton}>
                                <MessageCircle className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                                WhatsApp
                              </a>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted hover:text-negative"
                            onClick={() => void attempt(toast, async () => { await cancelInvite(inv.id); await reload(); }, "Convite cancelado")}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <RoleGuide />
        </div>
      )}

      {inviting && (
        <InviteModal
          storeId={store.id}
          storeName={store.name}
          onClose={() => setInviting(false)}
          onCreated={reload}
          onCopy={copy}
        />
      )}

      {removing && (
        <Modal open title="Tirar da equipe" onClose={() => setRemoving(null)}>
          <p className="text-sm leading-6">
            <strong>{removing.name || removing.email}</strong> perde o acesso ao painel do {store.name} na hora. A conta da
            pessoa continua existindo; para voltar, mande um convite novo.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setRemoving(null)}>Voltar</Button>
            <Button
              variant="danger"
              onClick={() =>
                void attempt(
                  toast,
                  async () => {
                    await removeMember(store.id, removing.userId);
                    setRemoving(null);
                    await reload();
                  },
                  "Pessoa tirada da equipe",
                )
              }
            >
              Tirar da equipe
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RoleGuide() {
  return (
    <Card title="O que cada função vê" className="h-fit xl:sticky xl:top-6">
      <dl className="flex flex-col gap-3 text-sm">
        {(["owner", ...INVITABLE_ROLES] as StoreRole[]).map((r) => (
          <div key={r}>
            <dt className="font-medium">{ROLE_LABEL[r]}</dt>
            <dd className="text-muted">{ROLE_HINT[r]}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function InviteModal({
  storeId,
  storeName,
  onClose,
  onCreated,
  onCopy,
}: {
  storeId: string;
  storeName: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
  onCopy: (token: string) => Promise<void>;
}) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamInvite["role"]>("waiter");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<TeamInvite | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const invite = await attempt(toast, () => createInvite(storeId, email, role));
    setSaving(false);
    if (!invite) return;
    setCreated(invite);
    void onCreated();
  }

  // Convite criado: mostra o link para mandar. (Copiar sozinho falha em vários navegadores.)
  if (created) {
    return (
      <Modal open title="Convite criado" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-6 text-muted">
            Mande este link para <strong className="text-ink">{created.email}</strong>. Ele vale 7 dias e só funciona com esse
            e-mail.
          </p>
          <Input
            aria-label="Link do convite"
            readOnly
            value={inviteLink(created.token)}
            onFocus={(e) => e.currentTarget.select()}
            className="text-[13px]"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={onClose}>Fechar</Button>
            <a href={whatsappHref(storeName, created)} target="_blank" rel="noreferrer" className={`${linkButton} h-9 px-3.5 text-sm`}>
              <MessageCircle className="size-4" strokeWidth={1.5} aria-hidden="true" />
              Mandar pelo WhatsApp
            </a>
            <Button variant="primary" onClick={() => void onCopy(created.token)}>
              <Copy className="size-4" strokeWidth={1.5} aria-hidden="true" />
              Copiar link
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open title="Convidar para a equipe" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm leading-6 text-muted">
          Você recebe um link para mandar à pessoa. Com ele, ela cria a senha e entra no {storeName}. O link vale 7 dias e
          só funciona com este e-mail.
        </p>
        <Field label="E-mail da pessoa">
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="off"
              required
              autoFocus
              placeholder="nome@exemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Função" hint={ROLE_HINT[role]}>
          {(p) => (
            <Select {...p} value={role} onChange={(e) => setRole(e.target.value as TeamInvite["role"])}>
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Voltar</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Criando…" : "Criar convite"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
