-- =====================================================================
-- Comanda · 002 · Equipe por convite e setor de preparo (tela da cozinha)
-- Rode DEPOIS do 001_inicial.sql, no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Nome e e-mail de cada pessoa da equipe, para o dono ver quem é quem.
-- (O painel não lê auth.users; os dados são copiados aqui ao entrar na loja.)
-- ---------------------------------------------------------------------

alter table public.store_members add column if not exists name text not null default '';
alter table public.store_members add column if not exists email text not null default '';

update public.store_members m
set name = coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(u.email, ''), '@', 1)),
    email = lower(coalesce(u.email, ''))
from auth.users u
where u.id = m.user_id and m.email = '';

-- ---------------------------------------------------------------------
-- Convites: o dono gera um link para um e-mail e uma função.
-- Quem abre o link cria o acesso (ou entra) com esse e-mail e passa a fazer parte da loja.
-- ---------------------------------------------------------------------

create table if not exists public.store_invites (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('manager', 'cashier', 'waiter', 'kitchen')),
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  unique (store_id, email)
);

alter table public.store_invites enable row level security;

grant select, insert, update, delete on public.store_invites to authenticated;

-- Só o dono vê e mexe nos convites da loja. Quem foi convidado lê o convite pela função get_invite.
drop policy if exists "convites: dono vê" on public.store_invites;
create policy "convites: dono vê" on public.store_invites for select
  using (public.has_store_role(store_id, array['owner']));
drop policy if exists "convites: dono cria" on public.store_invites;
create policy "convites: dono cria" on public.store_invites for insert
  with check (public.has_store_role(store_id, array['owner']));
drop policy if exists "convites: dono renova" on public.store_invites;
create policy "convites: dono renova" on public.store_invites for update
  using (public.has_store_role(store_id, array['owner']))
  with check (public.has_store_role(store_id, array['owner']));
drop policy if exists "convites: dono cancela" on public.store_invites;
create policy "convites: dono cancela" on public.store_invites for delete
  using (public.has_store_role(store_id, array['owner']));

-- O que a página do convite mostra antes de a pessoa entrar. Não revela nada sem o token.
create or replace function public.get_invite(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'storeName', s.name,
    'storeSlug', s.slug,
    'email', i.email,
    'role', i.role,
    'expired', i.expires_at < now()
  )
  from public.store_invites i
  join public.stores s on s.id = i.store_id
  where i.token = p_token;
$$;

revoke all on function public.get_invite(text) from public;
grant execute on function public.get_invite(text) to anon, authenticated;

-- Aceita o convite com a conta logada. O e-mail da conta precisa ser o do convite.
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.store_invites%rowtype;
  me auth.users%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para aceitar o convite.';
  end if;

  select * into inv from public.store_invites where token = p_token for update;
  if not found then
    raise exception 'Este convite não existe mais. Peça um novo ao dono da loja.';
  end if;
  if inv.expires_at < now() then
    raise exception 'Este convite venceu. Peça um novo ao dono da loja.';
  end if;

  select * into me from auth.users where id = auth.uid();
  if lower(coalesce(me.email, '')) <> inv.email then
    raise exception 'Este convite é para %. Entre com esse e-mail.', inv.email;
  end if;

  if exists (select 1 from public.store_members where store_id = inv.store_id and user_id = me.id) then
    raise exception 'Você já faz parte desta loja.';
  end if;

  insert into public.store_members (store_id, user_id, role, name, email)
  values (
    inv.store_id,
    me.id,
    inv.role,
    coalesce(nullif(trim(me.raw_user_meta_data ->> 'name'), ''), split_part(inv.email, '@', 1)),
    inv.email
  );
  delete from public.store_invites where id = inv.id;
  return inv.store_id;
end;
$$;

revoke all on function public.accept_invite(text) from public;
grant execute on function public.accept_invite(text) to authenticated;

-- ---------------------------------------------------------------------
-- Cadastro: igual ao 001, agora guardando nome e e-mail do dono na equipe
-- e reservando o endereço /convite.
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved text[] := array['painel', 'entrar', 'criar-conta', 'api', 'sobre', 'termos', 'privacidade',
                           'creditos-das-fotos', 'bar-do-cais', 'convite'];
  base text;
  candidate text;
  n integer := 2;
  new_store_id uuid;
begin
  if coalesce(new.raw_user_meta_data ->> 'kind', '') = 'staff' then
    return new;
  end if;

  base := lower(coalesce(new.raw_user_meta_data ->> 'store_slug', ''));
  base := regexp_replace(base, '[^a-z0-9-]', '-', 'g');
  base := regexp_replace(base, '-{2,}', '-', 'g');
  base := trim(both '-' from left(trim(both '-' from base), 36));
  if length(base) < 3 then
    base := 'minha-loja';
  end if;

  candidate := base;
  while exists (select 1 from public.stores where slug = candidate) or candidate = any (reserved) loop
    candidate := base || '-' || n;
    n := n + 1;
  end loop;

  insert into public.stores (owner_id, slug, name)
  values (new.id, candidate, coalesce(nullif(trim(new.raw_user_meta_data ->> 'store_name'), ''), 'Minha loja'))
  returning id into new_store_id;

  insert into public.store_members (store_id, user_id, role, name, email)
  values (
    new_store_id,
    new.id,
    'owner',
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    lower(coalesce(new.email, ''))
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Setor de preparo de cada item: kitchen (cozinha), bar, ou none (não passa pela tela de preparo,
-- como cerveja e refrigerante).
-- ---------------------------------------------------------------------

alter table public.products add column if not exists prep_station text not null default 'kitchen';
alter table public.products drop constraint if exists products_prep_station_check;
alter table public.products add constraint products_prep_station_check
  check (prep_station in ('kitchen', 'bar', 'none'));
