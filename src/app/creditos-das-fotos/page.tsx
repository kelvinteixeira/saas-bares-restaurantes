import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand/mark";
import { DEMO_PHOTOS } from "@/lib/demo-photos";

export const metadata: Metadata = {
  title: "Créditos das fotos de exemplo",
};

export default function CreditosDasFotosPage() {
  const photos = Object.values(DEMO_PHOTOS);
  return (
    <div className="min-h-dvh bg-ground">
      <div className="mx-auto max-w-[880px] px-4 py-6 sm:px-6 sm:py-10">
        <Link href="/" className="w-fit">
          <Wordmark />
        </Link>
        <h1 className="mt-8 text-[26px] leading-8 font-semibold tracking-[-0.01em]">Créditos das fotos de exemplo</h1>
        <p className="mt-2 max-w-[62ch] text-[15px] leading-6 text-muted">
          As fotos dos itens de exemplo vêm do Wikimedia Commons e mostram o tipo de prato, não um prato de um restaurante
          de verdade. Cada uma é usada conforme a licença indicada. Os restaurantes trocam por fotos próprias no editor do
          cardápio.
        </p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {photos.map((p) => (
            <li key={p.src} className="flex gap-4 rounded-card border border-line bg-surface p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.src} alt="" width={96} height={96} loading="lazy" className="size-24 flex-none rounded-[8px] object-cover" />
              <div className="min-w-0 text-sm">
                <a href={p.page} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
                  {p.title}
                </a>
                <p className="mt-1 text-muted">por {p.creator}</p>
                <p className="mt-1">
                  {p.licenseUrl ? (
                    <a href={p.licenseUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {p.license}
                    </a>
                  ) : (
                    p.license
                  )}
                  <span className="text-muted"> · via Wikimedia Commons</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
