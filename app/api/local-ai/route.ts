import { type ScannedOllamaModel } from "../../local-ai-registry";

type OllamaTagResponse = {
  models?: Array<{ name?: unknown; size?: unknown; modified_at?: unknown; digest?: unknown }>;
};

function scanError(error: unknown) {
  const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
  return Response.json({
    error: `Không thể kết nối Ollama tại http://127.0.0.1:11434. Hãy mở Ollama rồi quét lại${detail}.`,
  }, { status: 503 });
}

export async function GET() {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", { cache: "no-store" });
    if (!response.ok) return scanError(new Error(`Ollama trả về mã ${response.status}`));
    const payload = await response.json() as OllamaTagResponse;
    const models: ScannedOllamaModel[] = (payload.models ?? []).flatMap((model) => {
      const id = typeof model.name === "string" ? model.name.trim() : "";
      if (!id) return [];
      const size = Number(model.size);
      return [{
        id,
        provider: "Ollama" as const,
        ...(Number.isFinite(size) && size >= 0 ? { size } : {}),
        ...(typeof model.modified_at === "string" && model.modified_at.trim() ? { modifiedAt: model.modified_at } : {}),
        ...(typeof model.digest === "string" && model.digest.trim() ? { digest: model.digest } : {}),
      }];
    }).sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: "base" }));
    return Response.json({ provider: "Ollama", models, scannedAt: new Date().toISOString() });
  } catch (error) {
    return scanError(error);
  }
}
