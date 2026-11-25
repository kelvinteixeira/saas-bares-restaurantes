-- =====================================================================
-- Comanda · 010 · Pixel da Meta e Google Analytics no cardápio
-- Rode DEPOIS do 009, no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
-- =====================================================================
-- Regras:
--   · dono e gerente informam o ID do Pixel da Meta e o ID de medição do Google Analytics 4;
--   · os códigos entram em <script> no cardápio público, então só valem no formato exato:
--     Pixel = só números (10 a 20), GA4 = "G-" seguido de letras maiúsculas e números;
--   · a coluna fica em stores, que o cardápio já lê (os IDs são públicos por natureza).

alter table public.stores add column if not exists tracking jsonb not null default '{}'::jsonb;

alter table public.stores drop constraint if exists stores_tracking_check;
alter table public.stores add constraint stores_tracking_check check (
  jsonb_typeof(tracking) = 'object'
  and (not (tracking ? 'metaPixelId') or (tracking ->> 'metaPixelId') ~ '^[0-9]{10,20}$')
  and (not (tracking ? 'gaId') or (tracking ->> 'gaId') ~ '^G-[A-Z0-9]{4,16}$')
);
