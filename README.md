# saas-bares-restaurantes

SaaS de cardápio digital e pedidos para bares e restaurantes (nome provisório da marca: **Comanda**).
O dono cria a conta, monta o cardápio e acompanha os pedidos ao vivo; o cliente pede pelo celular
para **entrega**, **retirada** ou **direto da mesa pelo QR code**.

> **Fase 1 (esta versão):** tudo funciona no navegador com dados simulados (`localStorage`).
> Banco de dados, login real e pagamento online entram na fase 2 — veja [`docs/PLANO.md`](docs/PLANO.md).

## Rodando

```bash
npm install
npm run dev
```

Abra http://localhost:3000. Para ver tudo sem criar conta, clique em **Abrir o painel de demonstração**
(loja de exemplo "Bar do Cais", com pedidos de hoje e da última semana gerados para o horário atual).

Para ver o "tempo real": abra o painel numa aba e o cardápio (`/bar-do-cais` ou `/bar-do-cais?mesa=7`)
em outra, no mesmo navegador. O pedido feito no cardápio aparece no painel com aviso sonoro, e o
cliente vê o status mudar quando o balcão avança o pedido.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm run start` | Servidor do build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Checagem de tipos |
| `npm test` | Testes (Vitest) das regras de negócio |

## Áreas e rotas

| Rota | Quem usa | O que tem |
|---|---|---|
| `/` | visitantes | Página do produto |
| `/entrar`, `/criar-conta` | dono | Login, cadastro e acesso à demonstração |
| `/painel` | dono | Visão geral: vendas de hoje vs. mesmo horário da semana passada, fila de pedidos com horário prometido, mais vendidos, primeiros passos |
| `/painel/pedidos` | dono | Fila por status, detalhe da comanda, aceitar → pronto → saiu → entregue, cancelar, imprimir, WhatsApp do cliente, pedido de teste |
| `/painel/cardapio` | dono | Categorias, itens, fotos, preço, esgotado, grupos de opções (tamanho, sabor, adicionais) |
| `/painel/mesas` | dono | QR code por mesa e QR geral, prontos para imprimir |
| `/painel/configuracoes` | dono | Loja (nome, link, logo, cor), horários com turnos, entrega (bairros e taxas, mínimo, tempo), retirada, mesa, pagamento, conta |
| `/[slug]` | cliente | Cardápio público: busca, categorias, itens com opções, sacola; `?mesa=N` marca a mesa |
| `/[slug]/checkout` | cliente | Entrega, retirada ou mesa; endereço por bairro; Pix, cartão ou dinheiro com troco |
| `/[slug]/pedido/[id]` | cliente | Acompanhamento ao vivo do pedido |

## Estrutura

```
src/
├── app/                  # Rotas (App Router do Next 16: params é Promise)
├── components/
│   ├── painel/           # Moldura do painel, telas e configurações
│   ├── cardapio/         # Cardápio público, sacola, checkout, acompanhamento
│   ├── landing/ auth/    # Página inicial e login
│   └── ui/               # Botão, campos, modal, aviso, pílula
└── lib/
    ├── domain/           # Regras puras e testadas: horários, preço, status do pedido, números do painel
    ├── store/            # Fase 1: "banco" no localStorage + ações (trocar pelo Supabase na fase 2)
    ├── seed.ts           # Dados de demonstração (inventados)
    └── types.ts          # Modelo de dados (vira o schema do banco)
```

As telas só falam com `lib/store/actions.ts` e `lib/store/auth.ts`. Na fase 2 essas funções passam a
chamar o backend com as mesmas entradas e saídas, e as telas não precisam mudar.

## Design

Estilo de app "Framed sheet" (skill design-taste-frontend): moldura verde-acinzentada, folha branca de
trabalho, IBM Plex Sans, números de comanda em IBM Plex Mono e a cor só nos dados. O cardápio público
usa a cor da marca de cada restaurante.
