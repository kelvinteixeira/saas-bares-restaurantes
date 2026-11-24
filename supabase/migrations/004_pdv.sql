-- =====================================================================
-- Comanda · 004 · PDV: pedido de balcão, telefone e mesa lançado pelo caixa
-- Rode DEPOIS do 003, no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
-- =====================================================================

-- Diferenças para o place_order (cliente):
--   · só dono, gerente e caixa; vale mesmo com a loja fora do horário (pedido por telefone, por exemplo);
--   · nome e telefone são opcionais no balcão; na entrega o telefone é obrigatório;
--   · qualquer forma de pagamento (Pix, cartão, dinheiro); na mesa vai para a conta da mesa;
--   · mesa entra na comanda aberta (ou abre uma) pelo trigger do 003, mesmo com o QR da mesa desligado.
-- payload: {storeId, mode: pickup|delivery|table, lines, customer:{name, phone},
--           delivery:{regionId, street, number, complement, reference}, tableNumber,
--           payment:{method, changeFor}, notes}

create or replace function public.pdv_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.stores%rowtype;
  new_order public.orders%rowtype;
  order_mode text := payload ->> 'mode';
  cust_name text := left(trim(coalesce(payload #>> '{customer,name}', '')), 80);
  cust_phone text := regexp_replace(coalesce(payload #>> '{customer,phone}', ''), '\D', '', 'g');
  pay_method text := coalesce(payload #>> '{payment,method}', '');
  change_for integer;
  table_no integer;
  region jsonb;
  built jsonb;
  subtotal integer;
  fee integer := 0;
  eta integer := 25;
  total integer;
  num integer;
  delivery_out jsonb;
  pay_out jsonb;
begin
  begin
    change_for := (payload #>> '{payment,changeFor}')::integer;
    table_no := (payload ->> 'tableNumber')::integer;
  exception when others then
    raise exception 'Dados do pedido inválidos.';
  end;

  select * into s from public.stores where id::text = payload ->> 'storeId' for update;
  if not found or not public.has_store_role(s.id, array['owner', 'manager', 'cashier']) then
    raise exception 'Só o caixa, o gerente ou o dono lançam pelo PDV.';
  end if;
  if order_mode is null or order_mode not in ('delivery', 'pickup', 'table') then
    raise exception 'Escolha balcão, entrega ou mesa.';
  end if;
  if cust_phone <> '' and length(cust_phone) not between 10 and 11 then
    raise exception 'Telefone com DDD, ou deixe em branco.';
  end if;

  built := public.build_order_items(s.id, payload -> 'lines');
  subtotal := (built ->> 'subtotal')::integer;

  if order_mode = 'delivery' then
    if cust_phone = '' then
      raise exception 'Na entrega, informe o telefone do cliente.';
    end if;
    select r into region
    from jsonb_array_elements(coalesce(s.delivery -> 'regions', '[]'::jsonb)) r
    where r ->> 'id' = payload #>> '{delivery,regionId}' and coalesce((r ->> 'active')::boolean, false);
    if region is null then
      raise exception 'Escolha um bairro atendido.';
    end if;
    if trim(coalesce(payload #>> '{delivery,street}', '')) = '' or trim(coalesce(payload #>> '{delivery,number}', '')) = '' then
      raise exception 'Informe rua e número.';
    end if;
    fee := coalesce((region ->> 'fee')::integer, 0);
    eta := coalesce((s.delivery ->> 'etaMax')::integer, 50);
    delivery_out := jsonb_strip_nulls(jsonb_build_object(
      'regionId', region ->> 'id',
      'regionName', region ->> 'name',
      'street', left(trim(payload #>> '{delivery,street}'), 120),
      'number', left(trim(payload #>> '{delivery,number}'), 20),
      'complement', nullif(left(trim(coalesce(payload #>> '{delivery,complement}', '')), 120), ''),
      'reference', nullif(left(trim(coalesce(payload #>> '{delivery,reference}', '')), 120), '')));
    if cust_name = '' then
      raise exception 'Na entrega, informe o nome do cliente.';
    end if;
  elsif order_mode = 'pickup' then
    eta := coalesce((s.pickup ->> 'etaMax')::integer, 30);
    if cust_name = '' then
      cust_name := 'Balcão';
    end if;
  else
    if table_no is null or table_no < 1 or table_no > coalesce((s.table_service ->> 'count')::integer, 0) then
      raise exception 'Mesa % não existe.', coalesce(table_no::text, '');
    end if;
    cust_name := 'Mesa ' || table_no;
  end if;

  total := subtotal + fee;
  if order_mode = 'table' then
    pay_out := jsonb_build_object('method', 'tab');
  else
    if pay_method not in ('pix', 'card', 'cash') then
      raise exception 'Escolha a forma de pagamento.';
    end if;
    if pay_method = 'cash' and change_for is not null and change_for < total then
      raise exception 'O valor para troco precisa ser maior ou igual ao total.';
    end if;
    pay_out := case when pay_method = 'cash' and change_for is not null
                    then jsonb_build_object('method', 'cash', 'changeFor', change_for)
                    else jsonb_build_object('method', pay_method) end;
  end if;

  num := s.next_order_number;
  update public.stores set next_order_number = next_order_number + 1 where id = s.id;

  insert into public.orders (store_id, number, promised_at, status, history, mode, customer, delivery,
                             table_number, items, subtotal, delivery_fee, total, payment, notes, source, created_by)
  values (
    s.id, num, now() + make_interval(mins => eta), 'novo',
    jsonb_build_array(jsonb_build_object('status', 'novo', 'at', now())),
    order_mode,
    jsonb_build_object('name', cust_name, 'phone', cust_phone),
    delivery_out,
    case when order_mode = 'table' then table_no end,
    built -> 'items', subtotal, fee, total, pay_out,
    nullif(left(trim(coalesce(payload ->> 'notes', '')), 200), ''),
    'pdv', auth.uid()
  )
  returning * into new_order;

  return to_jsonb(new_order);
end;
$$;

revoke all on function public.pdv_order(jsonb) from public;
grant execute on function public.pdv_order(jsonb) to authenticated;
