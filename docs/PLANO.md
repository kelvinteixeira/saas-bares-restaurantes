# Plano de ação

## Feito — fase 1: produto completo com dados simulados

- Página do produto, cadastro, login e conta de demonstração.
- Painel do dono: visão geral, pedidos ao vivo (aviso sonoro, contador na aba), editor de cardápio,
  mesas com QR code, configurações (loja, horários, entrega e retirada, pagamento, conta).
- Cardápio público com a cor da marca da loja, sacola, checkout por modalidade e acompanhamento ao vivo.
- Regras de negócio em funções puras com testes: horários (inclusive depois da meia-noite), preço com
  opções, fluxo de status por modalidade, números do painel.

Limites conhecidos da fase 1: tudo fica no `localStorage` de um navegador (pedido feito em outro
aparelho não chega ao painel), a senha é só simulada e o pagamento é sempre na entrega, no balcão ou
na mesa.

## Fase 2 — banco de dados

Mesma base do Volpe Barber (`saas-barbearia`): Supabase.

1. **Schema** a partir de `src/lib/types.ts`: `stores`, `store_hours`, `delivery_regions`,
   `categories`, `products`, `option_groups`, `options`, `orders`, `order_items`,
   `order_status_history`, `store_members`. Dinheiro em centavos (`integer`).
2. **RLS**: o dono só lê e escreve a própria loja; o público lê o cardápio de lojas publicadas e cria
   pedidos; o cliente lê só o próprio pedido (por `id` não adivinhável).
3. **Pedido criado no servidor** (Server Action ou RPC): recalcula preços, taxa, mínimo e horário —
   nunca confia no total vindo do navegador. A lógica já existe em `placeOrder` e nas funções de `lib/domain`.
4. **Auth**: Supabase Auth com e-mail e senha (e Google, se decidido), recuperação de senha.
5. **Tempo real**: Supabase Realtime na tabela `orders` para o painel e para o acompanhamento.
6. **Fotos**: Supabase Storage no lugar das data URLs; `next/image`.
7. **Cardápio com renderização no servidor**: `/[slug]` passa a buscar a loja no servidor
   (SEO e carregamento mais rápido) — hoje é renderizado no navegador porque os dados estão no `localStorage`.
8. **Número do pedido** sequencial por loja numa função do banco (sem corrida entre pedidos simultâneos).

## Fase 2 — pagamentos online

1. Provedor a decidir (Asaas já é usado no Volpe Barber; alternativas: Mercado Pago, Pagar.me, Stripe).
2. Pix com QR gerado no checkout e cartão de crédito.
3. **Webhook** de confirmação: rota `app/api/webhooks/<provedor>` que valida a assinatura, é
   idempotente (guarda o id do evento) e muda o pagamento do pedido para pago; o painel mostra "Pago".
4. Estorno ao cancelar pedido pago.
5. Cobrança do próprio SaaS (mensalidade dos restaurantes), se for o modelo escolhido.

## Depois

- Cupons de desconto e pedido agendado.
- Fidelidade / cashback.
- Notificações por WhatsApp (n8n, como no Volpe Barber) e Web Push para o painel.
- Relatórios por período, exportação.
- Mais de um usuário por loja (garçom, cozinha) com permissões.
- Impressão automática da comanda na cozinha.

## Decisões em aberto

- Nome e domínio definitivos da marca ("Comanda" é provisório).
- Provedor de pagamento e modelo de cobrança do SaaS.
- Entregas: só entregador próprio da loja ou integração com apps de entrega.
- Login com Google além de e-mail e senha.
