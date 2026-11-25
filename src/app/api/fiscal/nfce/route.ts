import { emitOrderNfce, emitTabNfce, getProvider, HttpError } from "@/lib/fiscal/server";

// POST /api/fiscal/nfce  { orderId, cpf? } ou { tabId, cpf? }  → a nota (FiscalDocument)
// GET  /api/fiscal/nfce                    → qual emissor está ligado (para o painel avisar "simulador")
// O login vai no cabeçalho Authorization: Bearer <token da sessão do Supabase>.

const bearer = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;

function fail(err: unknown) {
  if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
  console.error("NFC-e:", err);
  return Response.json({ error: "Não foi possível emitir a nota agora. Tente de novo." }, { status: 500 });
}

export async function GET() {
  try {
    const p = getProvider();
    return Response.json({ provider: p.name, production: p.production });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { orderId?: unknown; tabId?: unknown; cpf?: unknown } | null;
    const cpf = typeof body?.cpf === "string" && body.cpf.trim() ? body.cpf.trim() : undefined;
    let doc;
    if (typeof body?.orderId === "string") doc = await emitOrderNfce(bearer(req), { orderId: body.orderId, cpf });
    else if (typeof body?.tabId === "string") doc = await emitTabNfce(bearer(req), { tabId: body.tabId, cpf });
    else return Response.json({ error: "Pedido ou comanda não informados." }, { status: 400 });
    return Response.json({ document: doc });
  } catch (err) {
    return fail(err);
  }
}
