export const LOCAL_AI_REGISTRY_STORAGE_KEY = "tesseract-local-ai-registry-v1";

export type LocalAiModel = {
  id: string;
  provider: "Ollama";
  size?: number;
  modifiedAt?: string;
  digest?: string;
  addedAt: string;
};

export type ScannedOllamaModel = Omit<LocalAiModel, "addedAt">;

function nonEmptyText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function finiteSize(value: unknown): number | undefined {
  const size = Number(value);
  return Number.isFinite(size) && size >= 0 ? size : undefined;
}

/** Dữ liệu app-local, không được ghi vào workflow .tess vì mỗi máy cài model khác nhau. */
export function normalizeLocalAiRegistry(value: unknown): LocalAiModel[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, LocalAiModel>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = nonEmptyText(record.id);
    if (!id) continue;
    byId.set(id, {
      id,
      provider: "Ollama",
      size: finiteSize(record.size),
      modifiedAt: nonEmptyText(record.modifiedAt),
      digest: nonEmptyText(record.digest),
      addedAt: nonEmptyText(record.addedAt) ?? new Date(0).toISOString(),
    });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: "base" }));
}

export function mergeScannedOllamaModel(existing: LocalAiModel[], scanned: ScannedOllamaModel, addedAt = new Date().toISOString()): LocalAiModel[] {
  const id = nonEmptyText(scanned.id);
  if (!id) return normalizeLocalAiRegistry(existing);
  const previous = existing.find((model) => model.id === id);
  return normalizeLocalAiRegistry([
    ...existing.filter((model) => model.id !== id),
    {
      id,
      provider: "Ollama",
      size: finiteSize(scanned.size),
      modifiedAt: nonEmptyText(scanned.modifiedAt),
      digest: nonEmptyText(scanned.digest),
      addedAt: previous?.addedAt ?? addedAt,
    },
  ]);
}

export function removeLocalAiModel(existing: LocalAiModel[], id: string): LocalAiModel[] {
  return normalizeLocalAiRegistry(existing.filter((model) => model.id !== id));
}

export function localAiModelIds(models: LocalAiModel[]): string[] {
  return normalizeLocalAiRegistry(models).map((model) => model.id);
}
