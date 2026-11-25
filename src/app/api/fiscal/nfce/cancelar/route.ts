import { cancelNfce, HttpError } from "@/lib/fiscal/server";

// POST /api/fiscal/nfce/cancelar  { documentId, reason }  → a nota cancelada

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { documentId?: unknown; reason?: unknown } | null;
    if (!body || typeof body.documentId !== "string" || typeof body.reason !== "string") {
      return Response.json({ error: "Nota ou motivo não informados." }, { status: 400 });
    }
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    const doc = await cancelNfce(token, { documentId: body.documentId, reason: body.reason });
    return Response.json({ document: doc });
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    console.error("NFC-e cancelar:", err);
    return Response.json({ error: "Não foi possível cancelar agora. Tente de novo." }, { status: 500 });
  }
}
