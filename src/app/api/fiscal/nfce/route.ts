import { emitOrderNfce, getProvider, HttpError } from "@/lib/fiscal/server";

// POST /api/fiscal/nfce  { orderId, cpf? }  → a nota (FiscalDocument)
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
    const body = (await req.json().catch(() => null)) as { orderId?: unknown; cpf?: unknown } | null;
    if (!body || typeof body.orderId !== "string") return Response.json({ error: "Pedido não informado." }, { status: 400 });
    const cpf = typeof body.cpf === "string" && body.cpf.trim() ? body.cpf.trim() : undefined;
    const doc = await emitOrderNfce(bearer(req), { orderId: body.orderId, cpf });
    return Response.json({ document: doc });
  } catch (err) {
    return fail(err);
  }
}
