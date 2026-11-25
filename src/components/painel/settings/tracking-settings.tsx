"use client";

import { useState } from "react";
import { GA_ID_PATTERN, META_PIXEL_PATTERN, normalizeGaId, normalizeMetaPixel } from "@/lib/domain/tracking";
import { updateStore } from "@/lib/store/actions";
import { usePainel } from "@/components/painel/painel-context";
import { SaveBar, SettingsSection } from "@/components/painel/settings/section";
import { Field, Input } from "@/components/ui/field";
import { attempt, useToast } from "@/components/ui/toast";

const EVENTS = [
  ["Visita ao cardápio", "PageView", "page_view"],
  ["Abriu um item", "ViewContent", "view_item"],
  ["Pôs na sacola", "AddToCart", "add_to_cart"],
  ["Foi fechar o pedido", "InitiateCheckout", "begin_checkout"],
  ["Fez o pedido (com o valor)", "Purchase", "purchase"],
] as const;

/** Aba Pixel: Meta (Facebook e Instagram) e Google Analytics 4 no cardápio. */
export function TrackingSettings() {
  const { store } = usePainel();
  const toast = useToast();
  const saved = { meta: store.tracking?.metaPixelId ?? "", ga: store.tracking?.gaId ?? "" };
  const [meta, setMeta] = useState(saved.meta);
  const [ga, setGa] = useState(saved.ga);
  const [errors, setErrors] = useState<{ meta?: string; ga?: string }>({});
  const dirty = meta !== saved.meta || ga !== saved.ga;

  async function save() {
    const next = { meta: normalizeMetaPixel(meta), ga: normalizeGaId(ga) };
    const problems = {
      meta: next.meta && !META_PIXEL_PATTERN.test(next.meta) ? "O ID do Pixel tem só números (de 10 a 20)." : undefined,
      ga: next.ga && !GA_ID_PATTERN.test(next.ga) ? 'O ID de medição do GA4 começa com "G-", como G-AB12CD34EF.' : undefined,
    };
    setErrors(problems);
    if (problems.meta || problems.ga) return;
    setMeta(next.meta);
    setGa(next.ga);
    await attempt(
      toast,
      async () => {
        try {
          await updateStore(store.id, (s) => {
            s.tracking = { ...(next.meta ? { metaPixelId: next.meta } : {}), ...(next.ga ? { gaId: next.ga } : {}) };
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "";
          if (/tracking|column|schema cache/i.test(message)) {
            throw new Error("O Pixel ainda não está ligado no banco. Rode o arquivo supabase/migrations/010_pixel.sql no Supabase.");
          }
          throw err;
        }
      },
      next.meta || next.ga ? "Medição salva. Vale no cardápio a partir da próxima visita." : "Medição desligada",
    );
  }

  return (
    <div>
      <SettingsSection
        title="Pixel e Google Analytics"
        description={
          <>
            <p>
              Com o Pixel, os anúncios no Facebook e no Instagram aprendem quem pede e mostram o cardápio para mais gente parecida. Com o
              Google Analytics, você vê de onde vêm as visitas. Os dois só rodam no cardápio público, nunca aqui no painel.
            </p>
            <p className="mt-3">
              O cardápio avisa no rodapé que a loja mede as visitas. Se você usa os dados para anunciar, conte isso também na sua política de
              privacidade.
            </p>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field
            label="ID do Pixel da Meta"
            hint="No Gerenciador de Eventos da Meta: Fontes de dados › seu Pixel. Só números."
            error={errors.meta}
          >
            {(p) => (
              <Input {...p} inputMode="numeric" autoComplete="off" placeholder="123456789012345" value={meta} onChange={(e) => setMeta(e.target.value.slice(0, 30))} />
            )}
          </Field>
          <Field
            label="ID de medição do Google Analytics 4"
            hint="No Google Analytics: Administrador › Fluxos de dados › seu site. Começa com G-."
            error={errors.ga}
          >
            {(p) => (
              <Input
                {...p}
                autoComplete="off"
                className="font-mono uppercase"
                placeholder="G-AB12CD34EF"
                value={ga}
                onChange={(e) => setGa(e.target.value.toUpperCase().slice(0, 20))}
              />
            )}
          </Field>
        </div>
        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => {
            setMeta(saved.meta);
            setGa(saved.ga);
            setErrors({});
          }}
        />
      </SettingsSection>

      <SettingsSection
        title="O que é medido"
        description={<p>Eventos padrão: os anúncios e os relatórios entendem sem configurar nada. Valores em reais.</p>}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-2 font-normal">Quando</th>
              <th className="pb-2 font-normal">Meta</th>
              <th className="pb-2 font-normal">Google</th>
            </tr>
          </thead>
          <tbody>
            {EVENTS.map(([when, metaName, gaName]) => (
              <tr key={metaName} className="border-t border-line">
                <td className="py-2 pr-3">{when}</td>
                <td className="py-2 pr-3 font-mono text-[13px]">{metaName}</td>
                <td className="py-2 font-mono text-[13px]">{gaName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsSection>
    </div>
  );
}
