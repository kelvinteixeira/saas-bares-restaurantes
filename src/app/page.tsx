import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Wordmark } from "@/components/brand/mark";
import { ButtonLink } from "@/components/ui/button";
import { DemoButton } from "@/components/landing/demo-button";
import { EditorFragment, MenuFragment, QueueFragment } from "@/components/landing/fragments";
import { OrderTicketPreview } from "@/components/auth/order-ticket-preview";

export default function Home() {
  return (
    <div className="bg-surface text-ink">
      <header className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-4 sm:px-8">
        <Link href="/" aria-label="Comanda, página inicial">
          <Wordmark />
        </Link>
        <nav aria-label="Principal" className="flex items-center gap-1 sm:gap-2">
          <Link href="/bar-do-cais" className="hidden h-9 items-center px-3 text-sm text-muted hover:text-ink sm:inline-flex">
            Cardápio de exemplo
          </Link>
          <Link href="/entrar" className="inline-flex h-9 items-center px-3 text-sm text-muted hover:text-ink">
            Entrar
          </Link>
          <ButtonLink href="/criar-conta" variant="primary">
            Criar conta
          </ButtonLink>
        </nav>
      </header>

      <main>
        {/* Abertura: a moldura verde-acinzentada do painel, com o cardápio do cliente em destaque. */}
        <section className="bg-ground">
          <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 pt-14 pb-16 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:pt-20 lg:pb-24">
            <div>
              <h1 className="max-w-[16ch] text-[42px] leading-[1.02] font-semibold tracking-[-0.035em] [text-wrap:balance] sm:text-[60px] lg:text-[68px]">
                Cardápio, pedidos e mesas num lugar só
              </h1>
              <p className="mt-8 max-w-[46ch] text-[18px] leading-7 sm:text-[20px] sm:leading-8">
                Para bares e restaurantes. O cliente pede pelo celular, para entrega, retirada ou direto da mesa pelo QR code, e o
                balcão acompanha cada comanda ao vivo.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-3">
                <ButtonLink href="/criar-conta" variant="primary" size="lg">
                  Criar conta
                </ButtonLink>
                <DemoButton />
              </div>
              <p className="mt-4 text-sm text-muted">
                Ou veja{" "}
                <Link href="/bar-do-cais" className="font-medium text-ink underline underline-offset-2">
                  o cardápio do bar de exemplo
                </Link>{" "}
                como o cliente vê.
              </p>
            </div>
            <div className="relative mx-auto w-full max-w-[420px] lg:max-w-none">
              <MenuFragment className="mx-auto w-[300px] sm:w-[320px] lg:mr-0" />
              <OrderTicketCard className="mx-auto mt-6 max-w-[320px] lg:absolute lg:bottom-12 lg:-left-10 lg:mt-0 lg:w-[280px]" />
            </div>
          </div>
        </section>

        {/* Três jeitos de pedir. */}
        <section aria-labelledby="h-modos" className="mx-auto max-w-[1240px] px-4 py-24 sm:px-8 lg:py-32">
          <h2 id="h-modos" className="max-w-[18ch] text-[34px] leading-[1.1] font-semibold tracking-[-0.025em] sm:text-[44px]">
            Três jeitos de pedir, uma fila só
          </h2>
          <div className="mt-14 grid gap-12 lg:grid-cols-3 lg:gap-8">
            <div>
              <h3 className="text-[22px] font-semibold tracking-[-0.01em]">Entrega</h3>
              <p className="mt-3 text-[17px] leading-7">
                Você cadastra os bairros que atende e a taxa de cada um. O cliente escolhe o bairro, vê o total e o pedido mínimo
                antes de enviar.
              </p>
            </div>
            <div>
              <h3 className="text-[22px] font-semibold tracking-[-0.01em]">Retirada no balcão</h3>
              <p className="mt-3 text-[17px] leading-7">
                Sem taxa e sem mínimo. O cliente sabe em quanto tempo fica pronto e recebe o endereço junto com o número do pedido.
              </p>
            </div>
            <div className="flex gap-6">
              <div>
                <h3 className="text-[22px] font-semibold tracking-[-0.01em]">Na mesa</h3>
                <p className="mt-3 text-[17px] leading-7">
                  Cada mesa ganha um QR code. O pedido chega no painel com o número da mesa, sem garçom anotando.
                </p>
              </div>
              <div data-ui className="flex-none rounded-card border border-line p-3 text-center" aria-hidden="true">
                <QRCodeSVG value="https://exemplo.local/bar-do-cais?mesa=7" size={88} marginSize={0} />
                <p className="mt-2 text-xs font-medium">Mesa 7</p>
              </div>
            </div>
          </div>
        </section>

        {/* O balcão. */}
        <section aria-labelledby="h-fila" className="bg-ink text-white">
          <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 py-24 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:py-32">
            <div>
              <h2 id="h-fila" className="max-w-[16ch] text-[34px] leading-[1.1] font-semibold tracking-[-0.025em] sm:text-[44px]">
                O balcão vê o relógio de cada pedido
              </h2>
              <p className="mt-6 max-w-[44ch] text-[17px] leading-7 text-white/80">
                A fila mostra quando cada pedido chegou e o horário prometido ao cliente. O que passou do prazo fica vermelho. Pedido
                novo toca um aviso, e um toque leva ao próximo passo: aceitar, pronto, saiu, entregue.
              </p>
            </div>
            <QueueFragment className="text-ink" />
          </div>
        </section>

        {/* O cardápio. */}
        <section aria-labelledby="h-editor" className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 py-24 sm:px-8 lg:grid-cols-2 lg:py-32">
          <EditorFragment className="order-2 lg:order-1" />
          <div className="order-1 lg:order-2">
            <h2 id="h-editor" className="max-w-[16ch] text-[34px] leading-[1.1] font-semibold tracking-[-0.025em] sm:text-[44px]">
              Esgotou? Um toque resolve
            </h2>
            <p className="mt-6 max-w-[44ch] text-[17px] leading-7">
              Marque esgotado, mude preço, troque a foto ou crie tamanhos e adicionais. O cardápio do cliente muda na hora, e o
              horário de funcionamento abre e fecha a loja sozinho.
            </p>
          </div>
        </section>

        {/* Fechamento. */}
        <section aria-labelledby="h-fim" className="bg-ground">
          <div className="mx-auto flex max-w-[1240px] flex-col items-start gap-8 px-4 py-24 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:py-28">
            <h2 id="h-fim" className="max-w-[18ch] text-[34px] leading-[1.1] font-semibold tracking-[-0.025em] sm:text-[44px]">
              Seu cardápio no ar hoje
            </h2>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/criar-conta" variant="primary" size="lg">
                Criar conta
              </ButtonLink>
              <DemoButton>Ver a demonstração</DemoButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-[1240px] px-4 pt-16 pb-10 sm:px-8">
        <p className="text-[56px] leading-none font-semibold tracking-[-0.04em] text-ink sm:text-[96px]">Comanda</p>
        <div className="mt-8 flex flex-wrap justify-between gap-4 text-sm text-muted">
          <p>Cardápio digital e pedidos para bares e restaurantes.</p>
          <nav aria-label="Rodapé" className="flex gap-5">
            <Link href="/entrar" className="hover:text-ink">
              Entrar
            </Link>
            <Link href="/criar-conta" className="hover:text-ink">
              Criar conta
            </Link>
            <Link href="/bar-do-cais" className="hover:text-ink">
              Cardápio de exemplo
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function OrderTicketCard({ className }: { className?: string }) {
  return (
    <div className={className}>
      {/* A comanda flutua sobre o celular: a única sombra da página. */}
      <div className="rounded-card bg-surface shadow-[0_12px_32px_rgba(19,20,22,0.12)]">
        <OrderTicketPreview compact />
      </div>
    </div>
  );
}
