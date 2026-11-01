import { executionUnavailableReason } from "./node-execution.ts";
import { portTypesCompatible } from "./node-contracts.ts";
import { openAiImageCapability } from "./ai-model-capabilities.ts";
import { aiExecutionProfile, aiReport, artifactTypeForPortType, taskSpec, type TaskSpec } from "./data-contracts.ts";

type FieldValue = string | number | boolean;
type StoredFileReference = { filePath: string; name: string; type: string; size: number; storedAt?: string };

type PortLike = { id: string; type: string };
type BasicStepLike = {
  kind: string;
  label: string;
  operation?: string;
  category: string;
  inputs: PortLike[];
  outputs: PortLike[];
  config: Record<string, FieldValue>;
};
type WorkflowNodeLike = {
  id: string;
  data: {
    label: string;
    family?: string;
    category: string;
    kind: string;
    inputs: PortLike[];
    outputs: PortLike[];
    config: Record<string, FieldValue>;
    storedFiles?: StoredFileReference[];
    basicMode?: "pipeline" | "choice";
    basicNodeLabels?: string[];
    basicSteps?: BasicStepLike[];
  };
};

export type WorkflowEdgeLike = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type WorkflowDocumentLike = {
  workflowId?: string;
  nodes: WorkflowNodeLike[];
  edges: WorkflowEdgeLike[];
};

export type WorkflowCallRuntime = {
  /** Cổng gọi lồng nhau do Desktop/UI giải quyết vì chỉ lớp đó được phép đọc .tess. */
  callWorkflow?: (node: WorkflowNodeLike, inputs: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export type RuntimeFileStore = Map<string, File[]>;
export type ExecutionProgress = {
  current?: number;
  total?: number;
  message: string;
  detail?: string;
};
type ProgressReporter = (progress: ExecutionProgress) => void;
type ExecutionDiagnostic = Record<string, unknown>;
type DiagnosableExecutionError = Error & { executionDiagnostic?: ExecutionDiagnostic };

function diagnosticFor(error: unknown, context: ExecutionDiagnostic): ExecutionDiagnostic {
  const runtimeError = error instanceof Error ? error : new Error(String(error));
  return {
    ...context,
    exception: {
      name: runtimeError.name,
      message: runtimeError.message,
      stack: runtimeError.stack ?? "(không có stack)",
    },
  };
}

type AiMaterialCacheRecord = {
  cacheKey: string;
  values: unknown[];
  manifest: string;
  createdAt: string;
  expiresAt: number;
};

// Sổ token được giữ theo từng lần chạy workflow trong trình duyệt. API trả về
// số dùng thực tế; phần dự trữ giúp chặn lượt gọi mới trước khi vượt ngân sách.
let sessionAiTokenUsage = { input: 0, output: 0, reservedInput: 0 };
// Cache này tồn tại theo phiên app và giữ lại reference RuntimeFileStore, không
// sao chép video/ảnh nặng vào localStorage. Nhờ vậy retry và node AI phía sau
// có thể dùng lại đúng tư liệu đã chọn mà không đọc/upload lại từ đầu.
const aiMaterialCache = new Map<string, AiMaterialCacheRecord>();
// AIModel cần chuyển qua node sau, nhưng không được đưa API key vào output
// hiển thị trên canvas. Cache khóa bí mật này chỉ sống trong phiên app.
const aiModelSecrets = new Map<string, string>();

function aiProfileSecretRef(node: WorkflowNodeLike): string {
  return `ai-profile:${node.id}`;
}

function rememberAiProfileSecret(secretRef: string | undefined, apiKey: unknown): void {
  const key = String(apiKey ?? "").trim();
  if (secretRef && key) aiModelSecrets.set(secretRef, key);
}

function profileSecret(profile: Record<string, unknown>): string {
  const secretRef = String(profile.secretRef ?? profile.cacheKey ?? "").trim();
  return String(profile.apiKey ?? aiModelSecrets.get(secretRef) ?? "").trim();
}

export function resetAiTokenUsage() {
  sessionAiTokenUsage = { input: 0, output: 0, reservedInput: 0 };
}

function cacheDurationMs(value: unknown): number {
  if (value === "30 phút") return 30 * 60_000;
  if (value === "24 giờ") return 24 * 60 * 60_000;
  return 2 * 60 * 60_000;
}

function materialFingerprint(value: unknown): string {
  let text: string;
  try { text = JSON.stringify(value); } catch { text = String(value); }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cacheManifest(values: unknown[]): string {
  const assets: Array<{ name?: unknown; type?: unknown; size?: unknown; localPath?: unknown }> = [];
  const visit = (value: unknown, seen = new WeakSet<object>()): void => {
    if (!value || typeof value !== "object") return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) { value.forEach((item) => visit(item, seen)); return; }
    const item = value as Record<string, unknown>;
    if (typeof item.runtimeKey === "string") assets.push({ name: item.name, type: item.type, size: item.size, localPath: item.localPath });
    Object.values(item).forEach((child) => visit(child, seen));
  };
  values.forEach((value) => visit(value));
  const text = values.map((value) => promptDataText(value)).join("\n\n").slice(0, 5_000);
  const fileLines = assets.slice(0, 24).map((asset) => `- ${String(asset.name ?? "file")} | ${String(asset.type ?? "unknown")} | ${Number(asset.size ?? 0).toLocaleString("vi-VN")} bytes`).join("\n");
  return ["TÓM TẮT TƯ LIỆU ĐÃ CACHE", fileLines ? `Tệp media:\n${fileLines}` : "Không có tệp media.", `Nội dung/metadata:\n${text}`].join("\n\n");
}

function saveCacheIndex(record: AiMaterialCacheRecord) {
  if (typeof sessionStorage === "undefined") return;
  try {
    const key = "content-flow-ai-material-cache-index";
    const current = JSON.parse(sessionStorage.getItem(key) ?? "[]") as Array<Record<string, unknown>>;
    const next = [{ cacheKey: record.cacheKey, createdAt: record.createdAt, expiresAt: record.expiresAt }, ...current.filter((item) => item.cacheKey !== record.cacheKey && Number(item.expiresAt ?? 0) > Date.now())].slice(0, 30);
    sessionStorage.setItem(key, JSON.stringify(next));
  } catch { /* Cache metadata is an optimization; never block the workflow. */ }
}

function cacheHandle(record: AiMaterialCacheRecord) {
  return {
    cacheKey: record.cacheKey,
    createdAt: record.createdAt,
    expiresAt: new Date(record.expiresAt).toISOString(),
    manifest: record.manifest,
    itemCount: record.values.length,
    storage: "Bộ nhớ phiên app; media giữ reference cục bộ, không sao chép file nặng",
  };
}

function materialValuesForNode(node: WorkflowNodeLike, inputs: Record<string, unknown>): unknown[] {
  return node.data.inputs
    .filter((port) => !/^(AIModel|AIProvider|APIKey|CachedData)$/i.test(port.type))
    // Giữ cả vị trí đầu vào chưa nối để cache vẫn khớp hợp đồng cổng khi node
    // sau đọc lại: Video, HighlightPlan, TimedTranscript, AttentionRegion.
    .map((port) => inputs[port.id]);
}

function cacheValues(node: WorkflowNodeLike, values: unknown[]) {
  if (!values.length) throw new Error("Cache kết quả chưa nhận được tư liệu cần lưu.");
  const config = node.data.config ?? {};
  const configuredKey = String(config.cacheKey ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 96);
  const cacheKey = configuredKey || `ai-material-${materialFingerprint(values)}`;
  const createdAt = new Date().toISOString();
  const record: AiMaterialCacheRecord = { cacheKey, values, manifest: cacheManifest(values), createdAt, expiresAt: Date.now() + cacheDurationMs(config.retention) };
  aiMaterialCache.set(cacheKey, record);
  saveCacheIndex(record);
  return record;
}

function cacheMaterials(node: WorkflowNodeLike, inputs: Record<string, unknown>) {
  return cacheHandle(cacheValues(node, materialValuesForNode(node, inputs)));
}

function cachedMaterialsFromInputs(inputs: Record<string, unknown>): AiMaterialCacheRecord | undefined {
  for (const value of Object.values(inputs)) {
    const candidate = record(value);
    const cacheKey = String(candidate.cacheKey ?? "");
    if (!cacheKey) continue;
    const found = aiMaterialCache.get(cacheKey);
    if (!found) continue;
    if (found.expiresAt <= Date.now()) { aiMaterialCache.delete(cacheKey); continue; }
    return found;
  }
  return undefined;
}

function preferredAiMaterials(node: WorkflowNodeLike, inputs: Record<string, unknown>): { record: AiMaterialCacheRecord; source: "cache" | "direct" } {
  const cached = cachedMaterialsFromInputs(inputs);
  if (cached) return { record: cached, source: "cache" };
  return { record: cacheValues(node, materialValuesForNode(node, inputs)), source: "direct" };
}

function cachedText(record: AiMaterialCacheRecord): string {
  const text = record.values.find((value) => typeof value === "string");
  return promptDataText(text ?? record.values[0]);
}

function materialValue(node: WorkflowNodeLike, inputs: Record<string, unknown>, materials: { record: AiMaterialCacheRecord; source: "cache" | "direct" }, type: string): unknown {
  if (materials.source === "direct") return input(node, inputs, type);
  const ports = node.data.inputs.filter((port) => !/^(AIModel|AIProvider|APIKey|CachedData)$/i.test(port.type));
  const index = ports.findIndex((port) => port.type.replace(/\[\]$/, "").toLowerCase() === type.replace(/\[\]$/, "").toLowerCase());
  return index >= 0 ? materials.record.values[index] : undefined;
}

function withAiInputCache(node: WorkflowNodeLike, resultType: string, result: unknown, materials: { record: AiMaterialCacheRecord; source: "cache" | "direct" }) {
  const value = result && typeof result === "object" && !Array.isArray(result)
    ? { ...(result as Record<string, unknown>), cacheSource: materials.source }
    : result;
  return outputs(node, { [resultType]: value, CachedData: cacheHandle(materials.record) });
}

type Source = {
  id?: string;
  title?: string;
  url?: string;
  domain?: string;
  author?: string;
  publishedAt?: string;
  content?: string;
  wordCount?: number;
  [key: string]: unknown;
};

const STOP_WORDS = new Set(
  "và là của có cho trong một những được với khi từ này đó các về theo để không trên tại hoặc như đã sẽ đang người nội dung nguồn the and for with from that this are was were have has".split(" "),
);

function output(node: WorkflowNodeLike, value: unknown): Record<string, unknown> {
  const port = node.data.outputs[0];
  return port ? { [port.id]: value } : { log: value };
}

// Một vài node tạo nhiều loại dữ liệu.  Không được dồn tất cả vào cổng đầu
// tiên: tên/type của từng cổng là hợp đồng dữ liệu mà node sau dùng để quyết
// định cách hiển thị và thực thi.
function outputs(node: WorkflowNodeLike, values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const port of node.data.outputs) {
    const value = values[port.type] ?? values[port.type.replace(/\[\]$/, "")];
    if (value !== undefined) result[port.id] = value;
  }
  return Object.keys(result).length ? result : { log: values };
}

function input(node: WorkflowNodeLike, inputs: Record<string, unknown>, type: string): unknown {
  const wanted = type.replace(/\[\]$/, "").toLowerCase();
  const port = node.data.inputs.find((item) => item.type.replace(/\[\]$/, "").toLowerCase() === wanted);
  return port ? inputs[port.id] : undefined;
}

function hasIncomingFileStorageData(node: WorkflowNodeLike, inputs: Record<string, unknown>): boolean {
  return node.data.inputs.some((port) => port.type !== "Folder" && inputs[port.id] !== undefined);
}

const INPUT_SOURCE_METADATA_KEY = "__contentFlowInputSources";

function inputSourceName(node: WorkflowNodeLike, inputs: Record<string, unknown>, type: string): string | undefined {
  const wanted = type.replace(/\[\]$/, "").toLowerCase();
  const port = node.data.inputs.find((item) => item.type.replace(/\[\]$/, "").toLowerCase() === wanted);
  if (!port) return undefined;
  const sources = record(inputs[INPUT_SOURCE_METADATA_KEY]);
  const source = record(sources[port.id]);
  const outputName = String(source.outputName ?? "").trim().replace(/\[\]$/, "");
  return outputName || undefined;
}

function isFrameIndexSource(sourcePortName: string | undefined): boolean {
  return String(sourcePortName ?? "").trim().replace(/\[\]$/, "").toLowerCase() === "frameindex";
}

function compatiblePortTypes(sourceType: string, targetType: string): boolean {
  return portTypesCompatible(sourceType, targetType);
}

/**
 * Một cổng Free có thể tương thích về mặt hợp đồng với rất nhiều kiểu. Khi
 * chạy node Cơ bản có nhiều đầu vào, luôn ưu tiên đúng kiểu cổng trước; nếu
 * không, một mảng frame (Free) có thể bị đưa nhầm vào cổng Folder.
 */
function exactPortTypeMatch(sourceType: string, targetType: string): boolean {
  const normalize = (value: string) => value.replace(/\[\]$/, "").trim().toLowerCase();
  const source = normalize(sourceType);
  return targetType.split(/\s+hoặc\s+/i).some((candidate) => normalize(candidate) === source);
}

function list<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === undefined || value === null || value === "") return [];
  return [value as T];
}

function lines(value: FieldValue | undefined): string[] {
  return String(value ?? "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

const DURATION_UNIT_SECONDS: Record<string, number> = {
  y: 365 * 24 * 60 * 60,
  M: 30 * 24 * 60 * 60,
  d: 24 * 60 * 60,
  h: 60 * 60,
  m: 60,
  s: 1,
};

export function parseDurationInput(raw: string): number {
  const value = raw.trim();
  if (!value) throw new Error("Hãy nhập thời gian hoặc tổng số giây");
  if (/^\d+$/.test(value)) return Number(value);
  const matcher = /(\d+)([yMdhms])/g;
  let seconds = 0;
  let consumed = "";
  for (const match of value.matchAll(matcher)) {
    consumed += match[0];
    seconds += Number(match[1]) * DURATION_UNIT_SECONDS[match[2]];
  }
  if (!consumed || consumed !== value || !Number.isSafeInteger(seconds)) {
    throw new Error("Định dạng thời gian không hợp lệ. Ví dụ hợp lệ: 3d120m, 1h30m hoặc 3600");
  }
  return seconds;
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 35 && item.length <= 500);
}

function words(text: string): string[] {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9À-ỹ]+/gi)?.map((item) => item.toLowerCase()).filter((item) => item.length > 2 && !STOP_WORDS.has(item)) ?? [];
}

function overlap(a: string, b: string): number {
  const left = new Set(words(a));
  const right = new Set(words(b));
  if (!left.size || !right.size) return 0;
  const common = [...left].filter((item) => right.has(item)).length;
  return common / Math.min(left.size, right.size);
}

function topSentences(sources: Source[], count: number): Array<{ text: string; sourceId?: string; title?: string; url?: string }> {
  const frequency = new Map<string, number>();
  sources.forEach((source) => words(String(source.content ?? "")).forEach((word) => frequency.set(word, (frequency.get(word) ?? 0) + 1)));
  const candidates = sources.flatMap((source) => sentences(String(source.content ?? "")).map((text, position) => ({
    text, sourceId: source.id, title: source.title, url: source.url,
    score: words(text).reduce((total, word) => total + (frequency.get(word) ?? 0), 0) / Math.sqrt(words(text).length || 1) - position * 0.02,
  })));
  const selected: typeof candidates = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (selected.every((item) => overlap(item.text, candidate.text) < 0.72)) selected.push(candidate);
    if (selected.length >= count) break;
  }
  return selected.map(({ score: _score, ...item }) => item);
}

function rankSource(source: Source) {
  let score = 35;
  const reasons: string[] = [];
  if (source.url?.startsWith("https://")) { score += 8; reasons.push("Kết nối HTTPS"); }
  if (source.author) { score += 10; reasons.push("Có tác giả"); }
  if (source.publishedAt) { score += 10; reasons.push("Có ngày xuất bản"); }
  const count = Number(source.wordCount ?? words(String(source.content ?? "")).length);
  if (count >= 800) { score += 12; reasons.push("Nội dung đủ chi tiết"); }
  else if (count >= 300) { score += 7; reasons.push("Nội dung có độ dài phù hợp"); }
  const domain = String(source.domain ?? "").toLowerCase();
  if (/\.(gov|edu)(\.|$)/.test(domain)) { score += 20; reasons.push("Tên miền cơ quan hoặc giáo dục"); }
  else if (/wikipedia\.org$/.test(domain)) { score += 8; reasons.push("Nguồn bách khoa có dẫn nguồn"); }
  if (!source.url && source.content) { score += 5; reasons.push("Tài liệu người dùng cung cấp"); }
  if (count < 80) { score -= 20; reasons.push("Nội dung quá ngắn"); }
  return { ...source, reliabilityScore: Math.max(0, Math.min(100, score)), reliabilityReasons: reasons };
}

async function apiJson(body: Record<string, unknown>) {
  const response = await fetch("/api/research", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { error?: string; [key: string]: unknown };
  if (!response.ok) throw new Error(payload.error || `API nghiên cứu trả về lỗi ${response.status}`);
  return payload;
}

async function uploadFiles(action: string, files: File[], fields: Record<string, FieldValue> = {}) {
  const pathOnly = files.find((file) => Boolean((file as File & { contentFlowPathOnly?: boolean }).contentFlowPathOnly));
  if (pathOnly) throw new Error(`${pathOnly.name} đang được giữ theo đường dẫn cục bộ vì tệp lớn. Hãy dùng node xử lý media cục bộ (trích frame, cắt, render hoặc phiên âm) thay vì upload trực tiếp.`);
  const form = new FormData();
  form.set("action", action);
  Object.entries(fields).forEach(([key, value]) => form.set(key, String(value)));
  files.forEach((file) => form.append("files", file, file.name));
  const response = await fetch("/api/research", { method: "POST", body: form });
  const payload = await response.json() as { error?: string; [key: string]: unknown };
  if (!response.ok) throw new Error(payload.error || `Upload nghiên cứu trả về lỗi ${response.status}`);
  return payload;
}

const LOCAL_MEDIA_SERVICE = "http://127.0.0.1:4317";
let activeLocalMediaRunId: string | undefined;
let activeLocalMediaAbort: AbortController | undefined;

export function beginLocalMediaWorkflowRun(runId: string) {
  activeLocalMediaAbort?.abort();
  activeLocalMediaRunId = runId;
  activeLocalMediaAbort = new AbortController();
}

export function endLocalMediaWorkflowRun(runId?: string) {
  if (runId && activeLocalMediaRunId !== runId) return;
  activeLocalMediaRunId = undefined;
  activeLocalMediaAbort = undefined;
}

function localMediaHeaders(headers?: HeadersInit) {
  const result = new Headers(headers);
  if (activeLocalMediaRunId) result.set("x-content-flow-run-id", activeLocalMediaRunId);
  return result;
}

function localMediaFetch(pathname: string, init: RequestInit = {}) {
  return fetch(new URL(pathname, LOCAL_MEDIA_SERVICE), {
    ...init,
    headers: localMediaHeaders(init.headers),
    signal: init.signal ?? activeLocalMediaAbort?.signal,
  });
}

export async function controlLocalMediaWorkflow(action: "pause" | "resume" | "stop", runId = activeLocalMediaRunId) {
  if (!runId) return { active: false };
  try {
    const response = await fetch(new URL("/workflow-control", LOCAL_MEDIA_SERVICE), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, action }),
    });
    const payload = await response.json() as { active?: boolean; error?: string };
    if (!response.ok) throw new Error(payload.error || "Không thể điều khiển bộ xử lý cục bộ.");
    if (action === "stop") activeLocalMediaAbort?.abort();
    return payload;
  } catch (error) {
    if (action === "stop") activeLocalMediaAbort?.abort();
    // Dịch vụ cục bộ có thể không chạy nếu workflow không dùng media. Lệnh điều
    // khiển workflow vẫn cần tiếp tục tác dụng lên các node còn lại.
    return { active: false, error: error instanceof Error ? error.message : "Không liên lạc được dịch vụ media cục bộ." };
  }
}

async function transcribeVideoFiles(files: File[], fields: Record<string, FieldValue>) {
  const transcripts: unknown[] = [];
  for (const file of files) {
    const localPath = (file as File & { contentFlowPath?: string }).contentFlowPath;
    const endpoint = new URL(localPath ? "/transcribe-path" : "/transcribe", LOCAL_MEDIA_SERVICE);
    Object.entries(fields).forEach(([key, value]) => endpoint.searchParams.set(key, String(value)));
    endpoint.searchParams.set("fileName", file.name);
    let response: Response;
    try {
      response = await localMediaFetch(endpoint.pathname + endpoint.search, {
        method: "POST",
        headers: { "content-type": localPath ? "application/json" : (file.type || "application/octet-stream") },
        body: localPath ? JSON.stringify({ filePath: localPath, apiKey: String(fields.apiKey ?? "") }) : file,
      });
    } catch {
      throw new Error("Dịch vụ xử lý video cục bộ chưa chạy. Hãy mở app bằng Run_App.bat rồi thử lại.");
    }
    const payload = await response.json() as { error?: string; transcript?: unknown; diagnostic?: ExecutionDiagnostic };
    if (!response.ok) {
      const error = new Error(payload.error || `Dịch vụ video trả về lỗi ${response.status}`) as DiagnosableExecutionError;
      if (payload.diagnostic) error.executionDiagnostic = payload.diagnostic;
      throw error;
    }
    transcripts.push(payload.transcript);
  }
  return { transcripts };
}

/**
 * Nhánh video AI không phụ thuộc vào lựa chọn Transcript của node chuẩn bị.
 * Khi TimedTranscript không được nối, nó chỉ tạo bản lời nói tạm từ Audio để
 * đối chiếu với frame trong đúng lần chạy hiện tại.
 */
async function transcribeAudioForVideoAnalysis(files: File[], apiKey: string, language: FieldValue | undefined) {
  return transcribeVideoFiles(files, {
    transcriptMode: "Transcript bằng API",
    apiKey,
    enhanceSpeech: false,
    language: language ?? "auto",
    knownTerms: "",
    speakerDiarization: false,
    chunkMinutes: 10,
  });
}

function sourcePrompt(sources: Source[]): string {
  return sources.slice(0, 12).map((source, index) =>
    `[Nguồn ${index + 1}] ${source.title || "Không tên"}\nURL: ${source.url || "Tài liệu tải lên"}\n${String(source.content ?? "").slice(0, 8_000)}`,
  ).join("\n\n");
}

function directNodeApiKey(node: WorkflowNodeLike, inputs: Record<string, unknown>): string {
  return String(input(node, inputs, "APIKey") ?? (node.data.config ?? {}).apiKey ?? "").trim();
}

async function maybeAi(node: WorkflowNodeLike, inputs: Record<string, unknown>, task: string, sources: Source[], fallback: () => unknown) {
  if (!(node.data.config ?? {}).useAI) return fallback();
  const apiKey = directNodeApiKey(node, inputs);
  if (!apiKey) throw new Error(`${node.data.label} cần API key được nhập trực tiếp hoặc nối qua cổng APIKey.`);
  const payload = await apiJson({
    action: "ai",
    apiKey,
    model: (node.data.config ?? {}).model,
    system: "Bạn là trợ lý nghiên cứu. Chỉ dùng dữ liệu nguồn được cung cấp, không tự bịa. Trả về JSON hợp lệ và giữ URL nguồn trong các kết luận quan trọng.",
    prompt: `${task}\n\n${sourcePrompt(sources)}\n\nYêu cầu bổ sung: ${String((node.data.config ?? {}).instructions ?? "Không có")}`,
  });
  return payload.result;
}

function assetFiles(value: unknown, store: RuntimeFileStore): File[] {
  const found: File[] = [];
  const includedKeys = new Set<string>();
  for (const asset of list<{ runtimeKey?: string; fileIndex?: number }>(value)) {
    if (!asset.runtimeKey) continue;
    const files = store.get(asset.runtimeKey) ?? [];
    if (Number.isInteger(asset.fileIndex)) {
      const file = files[Number(asset.fileIndex)];
      if (file) found.push(file);
    } else if (!includedKeys.has(asset.runtimeKey)) {
      found.push(...files);
      includedKeys.add(asset.runtimeKey);
    }
  }
  return found;
}

function isFrameIndexEntry(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, "timestamp")
    || Object.prototype.hasOwnProperty.call(value, "timecode")
    || Object.prototype.hasOwnProperty.call(value, "changeScore");
}

/**
 * FrameIndex trực tiếp là mảng metadata. Sau khi qua Lưu file, cùng dữ liệu
 * trở thành frameindex.json và được truyền dưới dạng asset. Chuẩn hóa hai dạng
 * về cùng timeline để node AI không nhầm một file JSON là một frame duy nhất.
 */
async function frameIndexEntries(value: unknown, store: RuntimeFileStore): Promise<Array<Record<string, unknown>>> {
  const direct = list<Record<string, unknown>>(value);
  const directEntries = direct.filter(isFrameIndexEntry);
  if (directEntries.length) return directEntries;

  const timeline: Array<Record<string, unknown>> = [];
  for (const file of assetFiles(value, store)) {
    if (!/\.json$/i.test(file.name) && file.type !== "application/json") continue;
    try {
      const parsed = JSON.parse(await file.text());
      const payload = Array.isArray(parsed) ? parsed : record(parsed).frames ?? record(parsed).items ?? parsed;
      timeline.push(...list<Record<string, unknown>>(payload).filter(isFrameIndexEntry));
    } catch {
      // File không phải FrameIndex JSON hợp lệ sẽ được báo bằng lỗi rõ ràng ở
      // node AI phía dưới, không làm dừng việc đọc các file còn lại.
    }
  }
  return timeline;
}

async function transcriptionKnownTerms(node: WorkflowNodeLike, inputs: Record<string, unknown>, store: RuntimeFileStore): Promise<string> {
  const supplied = input(node, inputs, "Thuật ngữ");
  if (supplied === undefined || supplied === null || supplied === "") return String((node.data.config ?? {}).knownTerms ?? "").trim();

  const directText = list<unknown>(supplied).filter((item): item is string => typeof item === "string").join("\n").trim();
  if (directText) return directText.slice(0, 30_000);

  const files = assetFiles(supplied, store);
  if (!files.length) throw new Error("Cổng Thuật ngữ chưa nhận được file hoặc văn bản có thể đọc.");
  const payload = await uploadFiles("read-document", files);
  const text = list<Record<string, unknown>>(payload.sources)
    .map((source) => String(source.content ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 30_000);
  if (!text) throw new Error("File nối vào cổng Thuật ngữ không có nội dung văn bản để dùng.");
  return text;
}

function runtimeAssets(runtimeKey: string, files: File[]) {
  return files.map((file, fileIndex) => ({
    localPath: (file as File & { contentFlowPath?: string }).contentFlowPath,
    runtimeKey,
    fileIndex,
    name: file.name,
    size: (file as File & { contentFlowSize?: number }).contentFlowSize ?? file.size,
    type: file.type,
    pathOnly: Boolean((file as File & { contentFlowPathOnly?: boolean }).contentFlowPathOnly),
    // URL này chỉ nằm trong phiên chạy hiện tại, dùng để node xem dữ liệu hiển thị
    // media ngay trên canvas; workflow được lưu vẫn chỉ giữ metadata an toàn.
    // File từ output cục bộ chỉ giữ metadata và đường dẫn để không nạp lại media
    // lớn vào RAM. Không được tạo object URL từ File rỗng: nó sẽ phát thành 0:00.
    previewUrl: /^(image|audio|video)\//.test(file.type)
      ? (file as File & { contentFlowPath?: string }).contentFlowPath
        ? `${LOCAL_MEDIA_SERVICE}/preview-media?filePath=${encodeURIComponent((file as File & { contentFlowPath: string }).contentFlowPath)}`
        : URL.createObjectURL(file)
      : undefined,
  }));
}

function transcriptLanguage(value: unknown): "auto" | "vi" | "en" | "ja" | "ko" | "zh" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "auto" || normalized.includes("tự động")) return "auto";
  if (normalized === "vi" || normalized.includes("việt")) return "vi";
  if (normalized === "en" || normalized.includes("english")) return "en";
  if (normalized === "ja" || normalized.includes("日本")) return "ja";
  if (normalized === "ko" || normalized.includes("한국")) return "ko";
  if (normalized === "zh" || normalized.includes("中文") || normalized.includes("trung")) return "zh";
  return "auto";
}

export function frameImageAssets(frames: Array<Record<string, unknown>>, store: RuntimeFileStore) {
  return frames.flatMap((frame) => {
    const runtimeKey = String(frame.runtimeKey ?? "");
    const fileIndex = Number(frame.fileIndex);
    const files = store.get(runtimeKey) ?? [];
    const file = files[fileIndex];
    if (!runtimeKey || !Number.isInteger(fileIndex) || !file) return [];
    // runtimeAssets cần nhận toàn bộ mảng để fileIndex giữ đúng vị trí gốc.
    // Nếu truyền [file], mọi frame đều thành index 0 và Lưu file chỉ còn lại
    // frame đầu tiên sau khi khử trùng.
    const asset = runtimeAssets(runtimeKey, files)[fileIndex];
    if (!asset) return [];
    return [{
      ...asset,
      timestamp: Number(frame.timestamp ?? 0),
      timecode: String(frame.timecode ?? "00:00"),
      reason: String(frame.reason ?? "periodic"),
      changeScore: Number(frame.changeScore ?? 0),
      videoFileName: frame.videoFileName,
      videoDuration: frame.videoDuration,
    }];
  });
}

function localPathFiles(value: unknown, store: RuntimeFileStore) {
  const direct = assetFiles(value, store);
  const nested = record(value);
  for (const key of ["asset", "file", "video", "timeline"]) {
    if (nested[key] !== undefined) direct.push(...assetFiles(nested[key], store));
  }
  return direct.filter((file): file is File & { contentFlowPath: string } => Boolean((file as File & { contentFlowPath?: string }).contentFlowPath));
}

type NamedLocalFile = {
  file: File & { contentFlowPath?: string };
  namingPattern?: string;
};

type InlineStorageFile = {
  inlineContent: string;
  namingPattern?: string;
  sourceName: string;
  sourceExtension: string;
};

function jsonForStoredData(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, current) => {
    if (!current || typeof current !== "object") return current;
    if (seen.has(current)) return "[Circular]";
    seen.add(current);
    if (current instanceof File) {
      const file = current as File & { contentFlowPath?: string; contentFlowSize?: number };
      return {
        name: file.name,
        type: file.type,
        size: file.contentFlowSize ?? file.size,
        localPath: file.contentFlowPath,
      };
    }
    return current;
  }, 2);
}

function inlineStorageFiles(value: unknown, namingPattern = "#file-name#", fallbackSourceName = "undefine"): InlineStorageFile[] {
  const found: InlineStorageFile[] = [];
  for (const item of list<Record<string, unknown>>(value)) {
    const current = record(item);
    if (typeof current.inlineContent === "string") {
      found.push({
        inlineContent: current.inlineContent,
        namingPattern: typeof current.namingPattern === "string" ? current.namingPattern : namingPattern,
        sourceName: String(current.sourceName ?? fallbackSourceName).trim() || fallbackSourceName,
        sourceExtension: String(current.sourceExtension ?? ".json").trim() || ".json",
      });
      continue;
    }
    const cacheKey = String(current.cacheKey ?? "");
    const cached = cacheKey ? aiMaterialCache.get(cacheKey) : undefined;
    const content = cached
      ? {
        cacheKey: cached.cacheKey,
        createdAt: cached.createdAt,
        expiresAt: new Date(cached.expiresAt).toISOString(),
        manifest: cached.manifest,
        values: cached.values,
      }
      : item;
    if (content === undefined || content === null || content === "") continue;
    found.push({
      inlineContent: jsonForStoredData(content),
      namingPattern: typeof current.namingPattern === "string" ? current.namingPattern : namingPattern,
      sourceName: fallbackSourceName,
      sourceExtension: ".json",
    });
  }
  return found;
}

function frameIndexStorageFile(value: unknown, namingPattern = "#file-name#"): InlineStorageFile[] {
  const items = list<Record<string, unknown>>(value);
  // Sau bước Đặt tên, timeline đã nằm trong một NamedFile duy nhất. Giữ nguyên
  // payload đó thay vì bọc JSON thêm một lần nữa.
  if (items.length === 1 && typeof items[0].inlineContent === "string") {
    return inlineStorageFiles(value, namingPattern, "frameindex").slice(0, 1);
  }
  return [{ inlineContent: jsonForStoredData(value), namingPattern, sourceName: "frameindex", sourceExtension: ".json" }];
}

function localNamedFiles(value: unknown, store: RuntimeFileStore): NamedLocalFile[] {
  const found: NamedLocalFile[] = [];
  const seen = new Set<string>();
  const visit = (candidate: unknown, inheritedPattern?: string) => {
    for (const item of list<Record<string, unknown>>(candidate)) {
      const current = record(item);
      const namingPattern = typeof current.namingPattern === "string" ? current.namingPattern : inheritedPattern;
      const runtimeKey = typeof current.runtimeKey === "string" ? current.runtimeKey : "";
      if (runtimeKey) {
        const files = store.get(runtimeKey) ?? [];
        const indexes = Number.isInteger(current.fileIndex) ? [Number(current.fileIndex)] : files.map((_, index) => index);
        for (const index of indexes) {
          const file = files[index] as (File & { contentFlowPath?: string }) | undefined;
          if (!file) continue;
          // Frame ảnh lấy từ video nằm trong RuntimeFileStore dưới dạng File
          // (JPG bytes), không có đường dẫn trên đĩa. Vẫn phải giữ chúng để
          // Lưu file gửi binary JPEG đến dịch vụ local, thay vì tuần tự hóa cả
          // metadata thành JSON.
          const key = `${file.contentFlowPath ?? `${runtimeKey}:${index}:${file.name}`}\u0000${namingPattern ?? ""}`;
          if (!seen.has(key)) {
            seen.add(key);
            found.push({ file: file as File & { contentFlowPath: string }, namingPattern });
          }
        }
      }
      for (const key of ["asset", "file", "video", "timeline"]) {
        if (current[key] !== undefined) visit(current[key], namingPattern);
      }
    }
  };
  visit(value);
  return found;
}

function storageExtensionForFile(file: File): string {
  const fromName = /\.[a-z0-9]+$/i.exec(file.name)?.[0];
  if (fromName) return fromName;
  if (file.type === "image/jpeg") return ".jpg";
  if (file.type === "image/png") return ".png";
  if (file.type === "audio/mpeg") return ".mp3";
  if (file.type === "video/mp4") return ".mp4";
  return ".bin";
}

async function base64ForStorage(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + chunkSize)));
  }
  return btoa(binary);
}

async function localStorageRequestFile(entry: NamedLocalFile, index: number, sourcePortName: string) {
  const filePath = entry.file.contentFlowPath;
  if (filePath) {
    return {
      filePath,
      sourcePortName,
      namingPattern: entry.namingPattern || "#file-name#",
      stt: index + 1,
    };
  }
  const extension = storageExtensionForFile(entry.file);
  const sourceName = entry.file.name.replace(new RegExp(`${extension.replace(".", "\\.")}$`, "i"), "") || "undefine";
  return {
    inlineBase64: await base64ForStorage(entry.file),
    sourceName,
    sourceExtension: extension,
    sourcePortName,
    namingPattern: entry.namingPattern || "#file-name#",
    stt: index + 1,
  };
}

function localOutputFile(filePath: string) {
  const name = filePath.split(/[\\/]/).pop() || "output.mp4";
  const type = /\.png$/i.test(name) ? "image/png"
    : /\.jpe?g$/i.test(name) ? "image/jpeg"
      : /\.webp$/i.test(name) ? "image/webp"
        : /\.bmp$/i.test(name) ? "image/bmp"
          : /\.srt$/i.test(name) ? "application/x-subrip"
            : /\.vtt$/i.test(name) ? "text/vtt"
              : /\.mp3$/i.test(name) ? "audio/mpeg"
                : /\.wav$/i.test(name) ? "audio/wav"
                  : /\.m4a$/i.test(name) ? "audio/mp4"
                    : "video/mp4";
  const file = new File([""], name, { type }) as File & { contentFlowPath?: string };
  file.contentFlowPath = filePath;
  return file;
}

async function renderLocalVideo(operation: string, payload: Record<string, unknown>) {
  const response = await localMediaFetch("/render-video", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, ...payload }),
  });
  const result = await response.json() as { error?: string; filePath?: string; fileName?: string; bytes?: number; operation?: string };
  if (!response.ok || !result.filePath) throw new Error(result.error || "Dịch vụ dựng video không trả về file đầu ra");
  return result as { filePath: string; fileName: string; bytes: number; operation: string };
}

async function localMediaJson<T extends Record<string, unknown>>(endpoint: string, payload: Record<string, unknown>, fallback: string): Promise<T> {
  let response: Response;
  try {
    response = await localMediaFetch(endpoint, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Dịch vụ xử lý video cục bộ chưa chạy. Hãy mở app bằng Run_App.bat rồi thử lại.");
  }
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || fallback);
  return result;
}

function subtitleTimestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")},${String(milliseconds % 1000).padStart(3, "0")}`;
}

function subtitleLines(text: string, maxCharsPerLine: number, maxLines: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > maxCharsPerLine && lines.length < maxLines - 1) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines.join("\n");
  return `${lines.slice(0, Math.max(1, maxLines)).join("\n").slice(0, Math.max(1, maxCharsPerLine * maxLines - 1)).trim()}…`;
}

function subtitleCues(transcript: Record<string, unknown>, maxCharsPerLine: number, maxLines: number) {
  const segments = arrayFrom(transcript.segments ?? transcript.items ?? transcript.chunks, ["segments", "items", "chunks"]).map(record);
  return segments.map((segment) => ({
    start: Math.max(0, Number(segment.start ?? segment.startSeconds ?? 0)),
    end: Math.max(0, Number(segment.end ?? segment.endSeconds ?? 0)),
    text: subtitleLines(String(segment.text ?? segment.content ?? ""), maxCharsPerLine, maxLines),
  })).filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.text.trim());
}

function normalizeProfile(value: unknown) {
  const profile = String(value ?? "1080p · 30 FPS · H.264");
  if (profile.startsWith("1080p · 60")) return { maxWidth: 1920, maxHeight: 1080, fps: 60, label: profile };
  if (profile.startsWith("720p")) return { maxWidth: 1280, maxHeight: 720, fps: 30, label: profile };
  if (profile.startsWith("Giữ kích thước")) return { maxWidth: 0, maxHeight: 0, fps: 30, label: profile };
  return { maxWidth: 1920, maxHeight: 1080, fps: 30, label: profile };
}

async function renderThumbnail(payload: Record<string, unknown>) {
  const response = await localMediaFetch("/render-thumbnail", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const result = await response.json() as { error?: string; filePath?: string; fileName?: string; bytes?: number };
  if (!response.ok || !result.filePath) throw new Error(result.error || "Dịch vụ tạo thumbnail không trả về file đầu ra");
  return result as { filePath: string; fileName: string; bytes: number };
}

type LocalImageDescriptor = { filePath: string; fileName: string; bytes: number; type?: string };

async function listLocalImageLibrary(folderPath: string, includeSubfolders: boolean, maxImages: number): Promise<LocalImageDescriptor[]> {
  const response = await localMediaFetch("/list-images", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderPath, includeSubfolders, maxImages }),
  });
  const payload = await response.json() as { error?: string; images?: LocalImageDescriptor[] };
  if (!response.ok || !Array.isArray(payload.images)) throw new Error(payload.error || "Dịch vụ media không trả về kho ảnh");
  return payload.images;
}

async function readLocalImagesForAi(files: File[]): Promise<File[]> {
  const paths = files.map((file) => (file as File & { contentFlowPath?: string }).contentFlowPath).filter((path): path is string => Boolean(path));
  if (!paths.length) return files;
  const response = await localMediaFetch("/read-images", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ imagePaths: paths }),
  });
  const payload = await response.json() as { error?: string; images?: Array<{ filePath?: string; fileName?: string; type?: string; base64?: string }> };
  if (!response.ok || !Array.isArray(payload.images)) throw new Error(payload.error || "Không thể đọc ảnh cục bộ để gửi AI");
  return payload.images.map((image) => {
    const file = base64File(String(image.base64 ?? ""), String(image.fileName ?? "image.jpg"));
    return new File([file], file.name, { type: String(image.type ?? file.type) });
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const item = record(value);
  for (const key of ["body", "content", "text", "article", "rewrittenContent", "expandedContent", "shortenedContent"]) {
    if (typeof item[key] === "string") return String(item[key]).trim();
  }
  return "";
}

function topicText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const item = record(value);
  return String(item.topic ?? item.title ?? item.subject ?? "").trim();
}

function arrayFrom(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const item = record(value);
  for (const key of keys) if (Array.isArray(item[key])) return item[key] as unknown[];
  return Object.keys(item).length ? [item] : [];
}

function normalizedContent(value: unknown, fallbackTitle: string, operation: string) {
  const item = record(value);
  const nested = item.content && typeof item.content === "object" ? record(item.content) : item;
  const body = contentText(nested) || contentText(value);
  if (!body) throw new Error("AI không trả về phần nội dung có thể sử dụng");
  return {
    ...nested,
    title: String(nested.title ?? fallbackTitle),
    body,
    wordCount: body.split(/\s+/).filter(Boolean).length,
    operation,
    generatedAt: new Date().toISOString(),
  };
}

async function contentAi(node: WorkflowNodeLike, inputs: Record<string, unknown>, task: string, context: unknown) {
  const apiKey = directNodeApiKey(node, inputs);
  if (!apiKey) throw new Error(`${node.data.label} cần API key được nhập trực tiếp hoặc nối qua cổng APIKey.`);
  const payload = await apiJson({
    action: "ai",
    apiKey,
    model: (node.data.config ?? {}).model,
    system: "Bạn là biên tập viên nội dung tiếng Việt. Bám sát dữ liệu đầu vào, không bịa dữ kiện hoặc nguồn. Trả về JSON hợp lệ, không dùng markdown bao quanh JSON. Nội dung phải hữu ích, cụ thể và phù hợp mục tiêu được cung cấp.",
    prompt: `${task}\n\nCấu hình node:\n${JSON.stringify(node.data.config)}\n\nDữ liệu đầu vào:\n${JSON.stringify(context).slice(0, 100_000)}`,
  });
  return payload.result;
}

function selectBestItem(value: unknown): Record<string, unknown> {
  const items = list<unknown>(value).map(record);
  return items.sort((left, right) => Number(right.totalScore ?? right.score ?? 0) - Number(left.totalScore ?? left.score ?? 0))[0] ?? {};
}

function shortenWithoutAi(text: string, targetWords: number, preserve: string[]) {
  const ranked = sentences(text).map((sentence, index) => ({
    sentence,
    index,
    score: words(sentence).length + preserve.filter((term) => sentence.toLowerCase().includes(term.toLowerCase())).length * 20,
  })).sort((left, right) => right.score - left.score);
  const selected: typeof ranked = [];
  let count = 0;
  for (const item of ranked) {
    const length = item.sentence.split(/\s+/).length;
    if (count + length > targetWords && selected.length) continue;
    selected.push(item);
    count += length;
    if (count >= targetWords) break;
  }
  return selected.sort((left, right) => left.index - right.index).map((item) => item.sentence).join(" ");
}

function shingleSimilarity(leftText: string, rightText: string): number {
  const make = (text: string) => {
    const tokens = words(text);
    const values = new Set<string>();
    for (let index = 0; index <= tokens.length - 5; index += 1) values.add(tokens.slice(index, index + 5).join(" "));
    return values;
  };
  const left = make(leftText);
  const right = make(rightText);
  if (!left.size || !right.size) return 0;
  return [...left].filter((item) => right.has(item)).length / Math.min(left.size, right.size);
}

async function executeContentNode(node: WorkflowNodeLike, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = node.data.config;

  if (node.data.label === "Tạo ý tưởng") {
    const topicValue = input(node, inputs, "Topic");
    const topic = topicText(topicValue);
    if (!topic) throw new Error("Tạo ý tưởng chưa nhận được chủ đề");
    const result = await contentAi(node, inputs,
      `Tạo ${Number(config.ideaCount) || 5} ý tưởng. Trả về {"ideas":[{"title":"","premise":"","format":"","audience":"","whyItWorks":""}]}.`,
      { topic: topicValue, researchBrief: input(node, inputs, "ResearchBrief") },
    );
    const ideas = arrayFrom(result, ["ideas", "items"]).map((idea, index) => ({ id: `idea-${index + 1}`, ...record(idea) }));
    if (!ideas.length) throw new Error("AI không tạo được danh sách ý tưởng");
    return output(node, ideas);
  }

  if (node.data.label === "Chấm điểm ý tưởng") {
    const ideas = list<unknown>(input(node, inputs, "Idea[]"));
    if (!ideas.length) throw new Error("Chấm điểm ý tưởng chưa nhận được Idea[]");
    let scored;
    if (config.useAI) {
      const result = await contentAi(node, inputs,
        "Chấm từng ý tưởng theo các tiêu chí đã chọn trên thang 100. Trả về {\"scoredIdeas\":[{\"title\":\"\",\"totalScore\":0,\"criterionScores\":{},\"strengths\":[],\"risks\":[],\"recommendation\":\"\"}]}",
        { ideas },
      );
      scored = arrayFrom(result, ["scoredIdeas", "ideas", "items"]);
    } else {
      scored = ideas.map((raw) => {
        const idea = record(raw);
        const title = String(idea.title ?? idea.name ?? "Ý tưởng");
        const premise = String(idea.premise ?? idea.description ?? "");
        const completeness = Math.min(25, Object.values(idea).filter(Boolean).length * 5);
        const clarity = Math.min(25, Math.round((title.length + premise.length) / 12));
        const specificity = /\d|cách|bước|sai lầm|bí quyết|case|hướng dẫn/i.test(`${title} ${premise}`) ? 25 : 15;
        const feasibility = premise.length >= 40 ? 20 : 12;
        return { ...idea, totalScore: Math.min(100, 20 + completeness + clarity + specificity + feasibility), scoringMethod: "rule-based" };
      });
    }
    return output(node, scored.map(record).sort((a, b) => Number(b.totalScore ?? b.score ?? 0) - Number(a.totalScore ?? a.score ?? 0)).map((idea, index) => ({ ...idea, rank: index + 1, passed: Number(idea.totalScore ?? idea.score ?? 0) >= (Number(config.minimumScore) || 0) })));
  }

  if (["Xác định khán giả", "Xác định đối tượng xem"].includes(node.data.label)) {
    const topicValue = input(node, inputs, "Topic");
    if (!topicText(topicValue)) throw new Error("Xác định khán giả chưa nhận được Topic");
    const result = await contentAi(node, inputs,
      "Xây dựng AudienceProfile. Trả về {\"summary\":\"\",\"demographics\":{},\"needs\":[],\"painPoints\":[],\"questions\":[],\"objections\":[],\"contentPreferences\":[],\"recommendedTone\":\"\"}.",
      { topic: topicValue, channelData: input(node, inputs, "dữ liệu kênh") },
    );
    return output(node, record(result).audienceProfile ?? result);
  }

  if (node.data.label === "Tạo góc tiếp cận") {
    const idea = selectBestItem(input(node, inputs, "Idea"));
    const audience = input(node, inputs, "AudienceProfile");
    if (!Object.keys(idea).length || !audience) throw new Error("Tạo góc tiếp cận cần Idea và AudienceProfile");
    const result = await contentAi(node, inputs,
      `Tạo ${Number(config.angleCount) || 3} góc tiếp cận. Trả về {"angles":[{"title":"","hook":"","promise":"","narrative":"","reason":""}]}.`,
      { idea, audience },
    );
    const angles = arrayFrom(result, ["angles", "items"]).map((angle, index) => ({ id: `angle-${index + 1}`, ...record(angle) }));
    if (!angles.length) throw new Error("AI không tạo được góc tiếp cận");
    return output(node, angles);
  }

  if (node.data.label === "Tạo dàn ý") {
    const angle = selectBestItem(input(node, inputs, "Angle"));
    if (!Object.keys(angle).length) throw new Error("Tạo dàn ý chưa nhận được Angle");
    const result = await contentAi(node, inputs,
      `Tạo dàn ý ${Number(config.sectionCount) || 6} phần. Trả về {"title":"","objective":"","sections":[{"heading":"","purpose":"","keyPoints":[],"evidence":[],"estimatedWords":0}],"cta":""}.`,
      { angle, sources: list<Source>(input(node, inputs, "Source[]")).map((source) => ({ title: source.title, url: source.url, content: String(source.content ?? "").slice(0, 5000) })) },
    );
    return output(node, record(result).outline ?? result);
  }

  if (node.data.label === "Viết nội dung") {
    const outline = input(node, inputs, "Outline");
    if (!outline) throw new Error("Viết nội dung chưa nhận được Outline");
    const sources = list<Source>(input(node, inputs, "Source[]"));
    const result = await contentAi(node, inputs,
      "Viết nội dung hoàn chỉnh theo dàn ý. Chỉ dùng dữ kiện có trong nguồn, giữ URL làm citations. Trả về {\"title\":\"\",\"body\":\"\",\"summary\":\"\",\"cta\":\"\",\"citations\":[{\"title\":\"\",\"url\":\"\"}]}",
      { outline, brandProfile: input(node, inputs, "BrandProfile"), sources: sources.map((source) => ({ title: source.title, url: source.url, content: String(source.content ?? "").slice(0, 8000) })) },
    );
    return output(node, normalizedContent(result, String(record(outline).title ?? "Nội dung mới"), "write"));
  }

  if (["Viết lại", "Viết lại nội dung", "Mở rộng", "Mở rộng nội dung", "Thay đổi giọng văn"].includes(node.data.label)) {
    const current = input(node, inputs, "Content");
    const text = contentText(current);
    if (!text) throw new Error(`${node.data.label} chưa nhận được Content`);
    const instruction = ["Viết lại", "Viết lại nội dung"].includes(node.data.label)
      ? "Viết lại nội dung theo yêu cầu, giữ nguyên các dữ kiện và citations."
      : ["Mở rộng", "Mở rộng nội dung"].includes(node.data.label)
        ? "Mở rộng nội dung có chiều sâu, không bịa thêm dữ kiện."
        : "Thay đổi giọng văn nhưng giữ nguyên ý nghĩa, dữ kiện và cấu trúc quan trọng.";
    const result = await contentAi(node, inputs, `${instruction} Trả về {"title":"","body":"","changeSummary":""}.`, {
      content: current,
      request: config.rewriteRequest || config.focus || config.instructions,
      sources: input(node, inputs, "Source[]"),
      brandProfile: input(node, inputs, "BrandProfile"),
    });
    return output(node, normalizedContent(result, String(record(current).title ?? node.data.label), node.data.label));
  }

  if (["Rút gọn", "Rút gọn nội dung"].includes(node.data.label)) {
    const current = input(node, inputs, "Content");
    const text = contentText(current);
    if (!text) throw new Error("Rút gọn nội dung chưa nhận được Content");
    const target = Math.max(30, Number(config.targetLength) || 300);
    if (config.useAI) {
      const result = await contentAi(node, inputs, `Rút gọn còn khoảng ${target} từ, giữ các nội dung bắt buộc. Trả về {"title":"","body":"","removedPoints":[]}.`, { content: current, preserve: lines(config.preserve) });
      return output(node, normalizedContent(result, String(record(current).title ?? "Nội dung rút gọn"), "shorten-ai"));
    }
    const body = shortenWithoutAi(text, target, lines(config.preserve));
    return output(node, { ...record(current), body, wordCount: body.split(/\s+/).filter(Boolean).length, operation: "shorten-no-ai", generatedAt: new Date().toISOString() });
  }

  if (node.data.label === "Kiểm tra nội dung") {
    const current = input(node, inputs, "Content");
    const text = contentText(current);
    if (!text) throw new Error("Kiểm tra nội dung chưa nhận được Content");
    if (config.useAI) {
      const result = await contentAi(node, inputs, "Đánh giá nội dung theo tiêu chí. Trả về {\"score\":0,\"summary\":\"\",\"strengths\":[],\"issues\":[{\"severity\":\"\",\"excerpt\":\"\",\"suggestion\":\"\"}],\"revisedExcerpt\":\"\"}", { content: current });
      return output(node, result);
    }
    const sentenceList = sentences(text);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const averageSentenceWords = Math.round(wordCount / Math.max(1, sentenceList.length));
    const issues = [
      ...(averageSentenceWords > 28 ? [{ severity: "warning", issue: "Câu trung bình quá dài", suggestion: "Chia câu để tăng khả năng đọc." }] : []),
      ...(!/[.!?…]$/.test(text) ? [{ severity: "info", issue: "Đoạn kết chưa có dấu câu", suggestion: "Hoàn thiện câu cuối." }] : []),
      ...(!/(hãy|đăng ký|liên hệ|bình luận|chia sẻ|tìm hiểu|thử ngay)/i.test(text) ? [{ severity: "info", issue: "Chưa nhận diện được CTA", suggestion: "Bổ sung hành động mong muốn từ người đọc." }] : []),
    ];
    return output(node, { score: Math.max(0, 100 - issues.length * 12), wordCount, sentenceCount: sentenceList.length, averageSentenceWords, issues, method: "rule-based" });
  }

  if (["Kiểm tra trùng lặp", "Kiểm tra nội dung trùng lặp"].includes(node.data.label)) {
    const current = input(node, inputs, "Content");
    const text = contentText(current);
    if (!text) throw new Error("Kiểm tra trùng lặp chưa nhận được Content");
    const comparisons = [
      ...list<unknown>(input(node, inputs, "nguồn")).map((item) => ({ title: String(record(item).title ?? "Nguồn nối vào"), text: contentText(item) || String(record(item).content ?? "") })),
      ...(String(config.comparisonText ?? "").trim() ? [{ title: "Văn bản đối chiếu thủ công", text: String(config.comparisonText) }] : []),
    ].filter((item) => item.text);
    const results = comparisons.map((item) => ({ title: item.title, similarity: Math.round(shingleSimilarity(text, item.text) * 100) })).sort((a, b) => b.similarity - a.similarity);
    const highest = results[0]?.similarity ?? 0;
    return output(node, { highestSimilarity: highest, threshold: Number(config.threshold) || 60, duplicated: highest >= (Number(config.threshold) || 60), comparisons: results, method: "five-word-shingles" });
  }

  if (node.data.label === "Kiểm tra chính sách") {
    const current = input(node, inputs, "Content");
    const text = contentText(current);
    if (!text) throw new Error("Kiểm tra chính sách chưa nhận được Content");
    if (config.useAI) {
      const result = await contentAi(node, inputs, "Kiểm tra rủi ro chính sách theo nền tảng đã chọn. Không kết luận pháp lý. Trả về {\"riskLevel\":\"\",\"issues\":[{\"category\":\"\",\"excerpt\":\"\",\"reason\":\"\",\"suggestion\":\"\"}],\"requiresHumanReview\":true}", { content: current });
      return output(node, result);
    }
    const ruleGroups = [
      { category: "Cam kết tuyệt đối", pattern: /\b(100%|chắc chắn|đảm bảo tuyệt đối|cam kết khỏi|không bao giờ thất bại)\b/gi },
      { category: "Kêu gọi khẩn cấp", pattern: /\b(chỉ hôm nay|cơ hội cuối cùng|phải mua ngay|không thể bỏ lỡ)\b/gi },
      { category: "Nội dung nhạy cảm", pattern: /\b(tự tử|bạo lực|ma túy|vũ khí)\b/gi },
    ];
    const issues = ruleGroups.flatMap((rule) => [...text.matchAll(rule.pattern)].map((match) => ({ category: rule.category, excerpt: match[0], suggestion: "Xem lại ngữ cảnh và diễn đạt thận trọng hơn." })));
    for (const customRule of lines(config.customRules)) if (text.toLowerCase().includes(customRule.toLowerCase())) issues.push({ category: "Quy tắc tùy chỉnh", excerpt: customRule, suggestion: "Nội dung khớp quy tắc do người dùng đặt." });
    return output(node, { platform: config.platform, riskLevel: issues.length >= 3 ? "high" : issues.length ? "medium" : "low", issues, requiresHumanReview: issues.length > 0, method: "rule-based-keywords" });
  }

  if (["Duyệt nội dung", "Duyệt nội dung thủ công"].includes(node.data.label)) {
    const current = input(node, inputs, "Content");
    const original = contentText(current);
    if (!original) throw new Error("Duyệt nội dung chưa nhận được Content");
    const finalBody = String(config.editedContent ?? "").trim() || original;
    const content = { ...record(current), body: finalBody, wordCount: finalBody.split(/\s+/).filter(Boolean).length, approvedAt: new Date().toISOString() };
    const approval = { decision: config.decision, approved: config.decision === "Đã duyệt", note: config.approvalNote || "", reviewResult: input(node, inputs, "ReviewResult"), decidedAt: new Date().toISOString() };
    const [approvalPort, contentPort] = node.data.outputs;
    return { ...(approvalPort ? { [approvalPort.id]: approval } : {}), ...(contentPort ? { [contentPort.id]: content } : {}) };
  }

  throw new Error(`Node Phát triển nội dung “${node.data.label}” chưa có bộ thực thi`);
}

type IndexedFrame = {
  timestamp: number;
  timecode: string;
  reason: "periodic" | "visual-change";
  changeScore: number;
  runtimeKey: string;
  fileIndex: number;
  fileName: string;
};

function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":")
    : [minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
}

function waitForVideo(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`Không thể đọc video (${eventName})`)), 20_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, done);
      video.removeEventListener("error", failed);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Trình duyệt không giải mã được video này")); };
    video.addEventListener(eventName, done, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
}

async function seekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
  const target = Math.min(Math.max(0, seconds), Math.max(0, video.duration - 0.05));
  if (Math.abs(video.currentTime - target) < 0.03) return;
  const ready = waitForVideo(video, "seeked");
  video.currentTime = target;
  await ready;
}

function focusRect(width: number, height: number, preset: string) {
  if (preset === "Trung tâm/bàn chơi") return { x: width * 0.12, y: height * 0.12, width: width * 0.76, height: height * 0.76 };
  if (preset === "Nửa trên") return { x: 0, y: 0, width, height: height * 0.55 };
  if (preset === "Nửa dưới") return { x: 0, y: height * 0.45, width, height: height * 0.55 };
  if (preset === "Bảng điểm góc trên") return { x: 0, y: 0, width: width * 0.5, height: height * 0.4 };
  return { x: 0, y: 0, width, height };
}

function frameSignature(video: HTMLVideoElement, canvas: HTMLCanvasElement, preset: string): Uint8Array {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Trình duyệt không hỗ trợ đọc frame video");
  const region = focusRect(video.videoWidth, video.videoHeight, preset);
  context.drawImage(video, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const signature = new Uint8Array(canvas.width * canvas.height);
  for (let pixel = 0, outputIndex = 0; pixel < pixels.length; pixel += 4, outputIndex += 1) {
    signature[outputIndex] = Math.round(pixels[pixel] * 0.299 + pixels[pixel + 1] * 0.587 + pixels[pixel + 2] * 0.114);
  }
  return signature;
}

function signatureDifference(previous: Uint8Array | undefined, current: Uint8Array): number {
  if (!previous || previous.length !== current.length) return 100;
  let total = 0;
  for (let index = 0; index < current.length; index += 1) total += Math.abs(current[index] - previous[index]);
  return Number(((total / current.length / 255) * 100).toFixed(2));
}

async function canvasFile(canvas: HTMLCanvasElement, name: string, quality = 0.76): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không thể tạo ảnh từ frame")), "image/jpeg", quality));
  return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
}

async function captureVideoFrame(video: HTMLVideoElement, timestamp: number, fileName: string): Promise<File> {
  await seekVideo(video, timestamp);
  const canvas = document.createElement("canvas");
  const width = Math.min(960, video.videoWidth || 960);
  canvas.width = width;
  canvas.height = Math.max(1, Math.round(width * (video.videoHeight || 540) / (video.videoWidth || 960)));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Trình duyệt không hỗ trợ trích frame video");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvasFile(canvas, fileName);
}

function base64File(base64: string, name: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type: "image/jpeg", lastModified: Date.now() });
}

async function buildLocalVideoIndex(node: WorkflowNodeLike, videoFile: File & { contentFlowPath?: string }, store: RuntimeFileStore) {
  const response = await localMediaFetch("/index-path", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filePath: videoFile.contentFlowPath, heartbeatSeconds: (node.data.config ?? {}).heartbeatSeconds, maxFrames: (node.data.config ?? {}).maxFrames }),
  });
  const payload = await response.json() as { error?: string; index?: { duration?: number; width?: number; height?: number; frames?: Array<{ timestamp?: number; name?: string; base64?: string }> } };
  if (!response.ok || !payload.index) throw new Error(payload.error || "Dịch vụ video không trả về frame cục bộ");
  const runtimeKey = `${node.id}:indexed-frames:${encodeURIComponent(videoFile.name)}`;
  const files = (payload.index.frames ?? []).map((frame, index) => base64File(String(frame.base64 ?? ""), String(frame.name || `frame-${index + 1}.jpg`)));
  if (!files.length) throw new Error("Dịch vụ video không trích được frame nào");
  store.set(runtimeKey, files);
  const frames: IndexedFrame[] = files.map((file, index) => {
    const timestamp = Number(payload.index?.frames?.[index]?.timestamp ?? 0);
    return { timestamp, timecode: formatTimecode(timestamp), reason: "periodic", changeScore: 0, runtimeKey, fileIndex: index, fileName: file.name };
  });
  return {
    fileName: videoFile.name, duration: Number(payload.index.duration ?? 0), width: Number(payload.index.width ?? 0), height: Number(payload.index.height ?? 0),
    videoType: (node.data.config ?? {}).videoType, frames,
    sampling: { heartbeatSeconds: Number((node.data.config ?? {}).heartbeatSeconds) || 15, scanIntervalSeconds: null, threshold: null, scannedFrames: frames.length, selectedFrames: frames.length },
    createdAt: new Date().toISOString(), localPathProcessing: true,
  };
}

function normalizedAttentionRegion(value: unknown) {
  const attention = record(value);
  const rawRegions = list<Record<string, unknown>>(attention.regions).map(record);
  // Hỗ trợ workflow cũ chỉ có một vùng x/y/width/height, nhưng output mới luôn
  // là danh sách để mọi AI node có thể nhận tối đa ba vùng độc lập.
  const candidates = rawRegions.length ? rawRegions : (attention.width !== undefined || attention.height !== undefined ? [attention] : []);
  const regions = candidates.slice(0, 3).map((region, index) => {
    const x = Math.max(0, Math.min(0.95, Number(region.x ?? 0)));
    const y = Math.max(0, Math.min(0.95, Number(region.y ?? 0)));
    const width = Math.max(0.01, Math.min(1 - x, Number(region.width ?? 1)));
    const height = Math.max(0.01, Math.min(1 - y, Number(region.height ?? 1)));
    return { x, y, width, height, label: String(region.label ?? `Vùng ${index + 1}`) };
  });
  return { mode: String(attention.mode ?? "exact"), regions, coordinateSystem: "normalized-0-to-1" };
}

function simpleAttentionRegions(value: unknown) {
  const cells = String(value ?? "").split(",").map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item < 9).slice(0, 3);
  return cells.map((cell, index) => ({
    x: (cell % 3) / 3,
    y: Math.floor(cell / 3) / 3,
    width: 1 / 3,
    height: 1 / 3,
    label: `Ô 3×3 số ${cell + 1}`,
    index,
  }));
}

function exactAttentionRegions(value: unknown) {
  try {
    return normalizedAttentionRegion({ regions: JSON.parse(String(value ?? "[]")) }).regions;
  } catch {
    return [];
  }
}

function attentionPrompt(value: unknown) {
  const attention = normalizedAttentionRegion(value);
  if (!attention.regions.length) return "Không có vùng chú ý riêng; xem xét toàn bộ khung hình.";
  return `Vùng chú ý người dùng chọn (tọa độ tỷ lệ 0–1 theo toàn khung, không phải crop độc lập): ${JSON.stringify(attention.regions)}. Nếu ảnh đi qua node “Tối ưu input ảnh”, các vùng này được vẽ bằng viền kép: đen bên ngoài, trắng bên trong. Hãy đánh giá toàn cảnh trước, sau đó ưu tiên quan sát kỹ các vùng này và nêu rõ bằng chứng trong vùng khi có.`;
}

async function extractLocalDetailFrames(
  node: WorkflowNodeLike,
  videoFile: File & { contentFlowPath: string },
  timestamps: number[],
  attentionRegion: unknown,
  round: number,
  store: RuntimeFileStore,
) {
  const response = await localMediaFetch("/extract-frames-path", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filePath: videoFile.contentFlowPath, timestamps, attentionRegions: normalizedAttentionRegion(attentionRegion).regions, longSide: 960 }),
  });
  const payload = await response.json() as { error?: string; frames?: Array<{ timestamp?: number; kind?: string; name?: string; base64?: string }> };
  if (!response.ok || !payload.frames?.length) throw new Error(payload.error || "Dịch vụ media không trích được frame chi tiết");
  const runtimeKey = `${node.id}:detail-frames:r${round}`;
  const files = payload.frames.map((frame, index) => base64File(String(frame.base64 ?? ""), String(frame.name ?? `detail-${round}-${index + 1}.jpg`)));
  store.set(runtimeKey, files);
  return files.map((file, index) => ({
    runtimeKey,
    fileIndex: index,
    name: file.name,
    type: file.type,
    size: file.size,
    previewUrl: URL.createObjectURL(file),
    timestamp: Number(payload.frames?.[index]?.timestamp ?? 0),
    timecode: formatTimecode(Number(payload.frames?.[index]?.timestamp ?? 0)),
    kind: String(payload.frames?.[index]?.kind ?? "frame"),
    round,
  }));
}

function detailFrameTimestamps(plan: unknown, intervalSeconds: number, limit: number) {
  const interval = Math.max(1, Number(intervalSeconds) || 1);
  const segments = list<Record<string, unknown>>(record(plan).segments).map(record);
  const values: number[] = [];
  for (const segment of segments) {
    const start = Math.max(0, Number(segment.start ?? segment.startSeconds ?? 0));
    const end = Math.max(start, Number(segment.end ?? segment.endSeconds ?? start));
    for (let second = start; second <= end && values.length < limit; second += interval) values.push(Number(second.toFixed(3)));
    if (values.length < limit && end > start) values.push(Number(end.toFixed(3)));
    if (values.length >= limit) break;
  }
  return [...new Set(values)].slice(0, limit);
}

async function buildVideoIndex(node: WorkflowNodeLike, videoFile: File, store: RuntimeFileStore) {
  if ((videoFile as File & { contentFlowPath?: string }).contentFlowPath) return buildLocalVideoIndex(node, videoFile as File & { contentFlowPath?: string }, store);
  if (typeof document === "undefined") throw new Error("Lập chỉ mục video cần chạy trong trình duyệt");
  const objectUrl = URL.createObjectURL(videoFile);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  const metadataReady = waitForVideo(video, "loadedmetadata");
  video.src = objectUrl;
  await metadataReady;

  try {
    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Video không có thời lượng hợp lệ");
    const heartbeat = Math.max(5, Number((node.data.config ?? {}).heartbeatSeconds) || 15);
    const requestedScan = Math.max(0.5, Number((node.data.config ?? {}).scanIntervalSeconds) || 2);
    const scanInterval = Math.max(requestedScan, duration / 600);
    const threshold = Math.max(1, Number((node.data.config ?? {}).changeSensitivity) || 12);
    const maxFrames = Math.max(12, Math.min(600, Number((node.data.config ?? {}).maxFrames) || 120));
    const signatureCanvas = document.createElement("canvas");
    signatureCanvas.width = 48;
    signatureCanvas.height = 27;
    const candidates: Array<{ timestamp: number; reason: "periodic" | "visual-change"; changeScore: number }> = [];
    let previous: Uint8Array | undefined;

    for (let timestamp = 0; timestamp < duration; timestamp += scanInterval) {
      await seekVideo(video, timestamp);
      const signature = frameSignature(video, signatureCanvas, focus);
      const changeScore = signatureDifference(previous, signature);
      previous = signature;
      const periodic = timestamp === 0 || Math.abs(timestamp / heartbeat - Math.round(timestamp / heartbeat)) <= scanInterval / heartbeat / 2;
      if (periodic || changeScore >= threshold) candidates.push({ timestamp, reason: periodic ? "periodic" : "visual-change", changeScore });
    }

    const periodic = candidates.filter((item) => item.reason === "periodic");
    const changes = candidates.filter((item) => item.reason === "visual-change").sort((left, right) => right.changeScore - left.changeScore);
    const periodicBudget = Math.min(periodic.length, Math.ceil(maxFrames * 0.6));
    const selected = [
      ...periodic.filter((_, index) => index % Math.max(1, Math.ceil(periodic.length / Math.max(1, periodicBudget))) === 0).slice(0, periodicBudget),
      ...changes.slice(0, Math.max(0, maxFrames - periodicBudget)),
    ].sort((left, right) => left.timestamp - right.timestamp)
      .filter((item, index, items) => index === 0 || Math.abs(item.timestamp - items[index - 1].timestamp) >= 0.4)
      .slice(0, maxFrames);

    const runtimeKey = `${node.id}:indexed-frames:${encodeURIComponent(videoFile.name)}`;
    const files: File[] = [];
    const frames: IndexedFrame[] = [];
    for (const item of selected) {
      const frameName = `${videoFile.name.replace(/\.[^.]+$/, "")}-${String(files.length + 1).padStart(4, "0")}-${formatTimecode(item.timestamp).replace(/:/g, "-")}.jpg`;
      const file = await captureVideoFrame(video, item.timestamp, frameName);
      files.push(file);
      frames.push({ ...item, timecode: formatTimecode(item.timestamp), runtimeKey, fileIndex: files.length - 1, fileName: frameName });
    }
    store.set(runtimeKey, files);
    return {
      fileName: videoFile.name,
      duration,
      width: video.videoWidth,
      height: video.videoHeight,
      videoType: (node.data.config ?? {}).videoType,
      frames,
      sampling: { heartbeatSeconds: heartbeat, scanIntervalSeconds: Number(scanInterval.toFixed(2)), threshold, scannedFrames: Math.ceil(duration / scanInterval), selectedFrames: frames.length },
      createdAt: new Date().toISOString(),
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadImageFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Không đọc được frame ${file.name}`));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function buildStoryboards(node: WorkflowNodeLike, videoIndex: Record<string, unknown>, store: RuntimeFileStore) {
  if (typeof document === "undefined") throw new Error("Tạo storyboard cần chạy trong trình duyệt");
  const frames = list<IndexedFrame>(videoIndex.frames);
  if (!frames.length) throw new Error("VideoIndex không có frame để tạo storyboard");
  const frameFiles = assetFiles(frames, store);
  const framesPerBoard = Math.max(4, Math.min(16, Number((node.data.config ?? {}).framesPerBoard) || 12));
  const columns = Math.max(2, Math.min(4, Number((node.data.config ?? {}).columns) || 4));
  const boardWidth = Math.max(640, Number((node.data.config ?? {}).boardWidth) || 1280);
  const tileWidth = Math.floor(boardWidth / columns);
  const runtimeKey = `${node.id}:storyboards`;
  const files: File[] = [];
  const storyboards: Array<Record<string, unknown>> = [];

  for (let offset = 0; offset < frames.length; offset += framesPerBoard) {
    const group = frames.slice(offset, offset + framesPerBoard);
    const firstFile = frameFiles[offset];
    if (!firstFile) continue;
    const firstImage = await loadImageFile(firstFile);
    const imageHeight = Math.max(120, Math.round(tileWidth * firstImage.height / firstImage.width));
    const labelHeight = 28;
    const rows = Math.ceil(group.length / columns);
    const canvas = document.createElement("canvas");
    canvas.width = boardWidth;
    canvas.height = rows * (imageHeight + labelHeight);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Trình duyệt không hỗ trợ tạo storyboard");
    context.fillStyle = "#070b12";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < group.length; index += 1) {
      const image = index === 0 ? firstImage : await loadImageFile(frameFiles[offset + index]);
      const x = (index % columns) * tileWidth;
      const y = Math.floor(index / columns) * (imageHeight + labelHeight);
      context.drawImage(image, x, y, tileWidth, imageHeight);
      context.fillStyle = "rgba(7, 11, 18, .92)";
      context.fillRect(x, y + imageHeight, tileWidth, labelHeight);
      context.fillStyle = "#f8fafc";
      context.font = "bold 16px Arial";
      context.fillText(`${group[index].timecode} · ${group[index].reason === "visual-change" ? "thay đổi" : "định kỳ"}`, x + 10, y + imageHeight + 19);
    }
    const fileName = `storyboard-${String(files.length + 1).padStart(3, "0")}.jpg`;
    files.push(await canvasFile(canvas, fileName, 0.8));
    storyboards.push({
      runtimeKey,
      fileIndex: files.length - 1,
      fileName,
      start: group[0].timestamp,
      end: group[group.length - 1].timestamp,
      startTimecode: group[0].timecode,
      endTimecode: group[group.length - 1].timecode,
      frameCount: group.length,
    });
  }
  store.set(runtimeKey, files);
  return storyboards;
}

function transcriptTextForRange(transcript: Record<string, unknown>, start: number, end: number): string {
  const segments = list<Record<string, unknown>>(transcript.segments);
  // Giữ phần transcript mỗi lượt nhỏ để workflow mặc định vẫn nằm trong trần 40k input tokens.
  if (!segments.length) return String(transcript.text ?? "").slice(0, 6_000);
  return segments
    .filter((segment) => Number(segment.end ?? 0) >= start && Number(segment.start ?? 0) <= end)
    .map((segment) => `[${formatTimecode(Number(segment.start ?? 0))}] ${String(segment.text ?? "")}`)
    .join("\n")
    .slice(0, 6_000);
}

async function executeAttentionRegionNode(node: WorkflowNodeLike, inputs: Record<string, unknown>, store: RuntimeFileStore): Promise<Record<string, unknown>> {
  const config = node.data.config;
  const images = localPathFiles(input(node, inputs, "Image[]"), store);
  const videos = localPathFiles(input(node, inputs, "Video"), store);
  if (!images.length && !videos.length) throw new Error("Node vùng chú ý cần nhận Image[] hoặc Video cục bộ từ cổng vào.");
  if (images.length && videos.length) throw new Error("Node vùng chú ý chỉ nhận một nguồn tại một thời điểm: Image[] hoặc Video.");
  const mode = String(config.selectionMode ?? "Đơn giản (lưới 3×3)").startsWith("Đơn giản") ? "simple-3x3" : "exact";
  const regions = mode === "simple-3x3" ? simpleAttentionRegions(config.simpleCells) : exactAttentionRegions(config.exactRegions);
  if (!regions.length) throw new Error(mode === "simple-3x3" ? "Hãy chọn ít nhất một ô trong lưới 3×3." : "Hãy mở trình chọn chính xác và quét ít nhất một vùng.");
  const totalArea = regions.reduce((total, region) => total + region.width * region.height, 0);
  if (regions.length > 3 || totalArea > (1 / 3) + 0.0001) throw new Error("Vùng chú ý chỉ được có tối đa 3 vùng, tổng diện tích không quá 1/3 khung.");
  for (let index = 0; index < regions.length; index += 1) {
    for (let other = index + 1; other < regions.length; other += 1) {
      const left = regions[index]; const right = regions[other];
      if (left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y) throw new Error("Các vùng chú ý không được chồng lên nhau.");
    }
  }
  const reference = [...images, ...videos][0];
  const attention = {
    mode,
    regions,
    totalArea: Number(totalArea.toFixed(4)),
    coordinateSystem: "normalized-0-to-1",
    reference: { name: reference.name, type: reference.type, size: (reference as File & { contentFlowSize?: number }).contentFlowSize ?? reference.size },
    instruction: attentionPrompt({ mode, regions }),
  };
  if (!images.length) return outputs(node, { AttentionRegion: attention });

  const rendered = await localMediaJson<{ files?: Array<{ filePath?: string; bytes?: number }> }>("/optimize-image-inputs", {
    imagePaths: images.map((file) => file.contentFlowPath), regions,
  }, "Dịch vụ media không trả về ảnh đã vẽ vùng chú ý.");
  if (!rendered.files?.length || rendered.files.some((item) => !item.filePath)) throw new Error("Dịch vụ media không trả về đường dẫn ảnh đã vẽ vùng chú ý.");
  const runtimeKey = `${node.id}:attention-marked-images`;
  const files = rendered.files.map((item) => {
    const file = localOutputFile(String(item.filePath)) as File & { contentFlowSize?: number; contentFlowPathOnly?: boolean };
    file.contentFlowSize = Number(item.bytes) || file.size;
    file.contentFlowPathOnly = true;
    return file;
  });
  store.set(runtimeKey, files);
  return outputs(node, {
    "Image[]": runtimeAssets(runtimeKey, files).map((asset) => ({ ...asset, attentionRegion: { regions, outline: "black-outer-white-inner" } })),
    AttentionRegion: attention,
  });
}

type ImageSearchRaster = { width: number; height: number; data: Uint8ClampedArray };
type ImageSearchRegion = { x: number; y: number; width: number; height: number };

async function imageSearchBlob(file: File): Promise<Blob> {
  const localPath = (file as File & { contentFlowPath?: string }).contentFlowPath;
  if (!localPath) return file;
  const response = await localMediaFetch(`/preview-media?filePath=${encodeURIComponent(localPath)}`);
  if (!response.ok) throw new Error(`Không thể đọc ảnh cục bộ ${file.name} để tìm tương đồng.`);
  return response.blob();
}

async function imageSearchRaster(file: File): Promise<ImageSearchRaster> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    throw new Error("Tìm ảnh tương đồng cần chạy trong ứng dụng Content Flow trên máy.");
  }
  const bitmap = await createImageBitmap(await imageSearchBlob(file));
  try {
    const scale = Math.min(1, 480 / Math.max(1, bitmap.width));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Không khởi tạo được vùng đọc ảnh để tìm tương đồng.");
    context.drawImage(bitmap, 0, 0, width, height);
    return { width, height, data: context.getImageData(0, 0, width, height).data };
  } finally {
    bitmap.close();
  }
}

function cropImageSearchRaster(source: ImageSearchRaster, region: ImageSearchRegion): ImageSearchRaster {
  const x = Math.max(0, Math.min(source.width - 1, Math.round(region.x * source.width)));
  const y = Math.max(0, Math.min(source.height - 1, Math.round(region.y * source.height)));
  const width = Math.max(1, Math.min(source.width - x, Math.round(region.width * source.width)));
  const height = Math.max(1, Math.min(source.height - y, Math.round(region.height * source.height)));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * source.width + x) * 4;
    data.set(source.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data };
}

function imageSearchScore(template: ImageSearchRaster, frame: ImageSearchRaster, left: number, top: number): number {
  const sampleX = Math.max(1, Math.ceil(template.width / 36));
  const sampleY = Math.max(1, Math.ceil(template.height / 24));
  let difference = 0;
  let samples = 0;
  for (let y = 0; y < template.height; y += sampleY) {
    for (let x = 0; x < template.width; x += sampleX) {
      const templateIndex = (y * template.width + x) * 4;
      const frameIndex = ((top + y) * frame.width + left + x) * 4;
      difference += Math.abs(template.data[templateIndex] - frame.data[frameIndex]);
      difference += Math.abs(template.data[templateIndex + 1] - frame.data[frameIndex + 1]);
      difference += Math.abs(template.data[templateIndex + 2] - frame.data[frameIndex + 2]);
      samples += 3;
    }
  }
  return 1 - difference / Math.max(1, samples * 255);
}

function locateSimilarImage(template: ImageSearchRaster, frame: ImageSearchRaster) {
  if (template.width > frame.width || template.height > frame.height) return { score: 0, left: 0, top: 0 };
  const stride = Math.max(2, Math.round(Math.min(template.width, template.height) / 18));
  let best = { score: -1, left: 0, top: 0 };
  const maxTop = frame.height - template.height;
  const maxLeft = frame.width - template.width;
  // Lượt đầu quét thưa để giữ tốc độ khi quét cả folder lớn.
  for (let top = 0; top <= maxTop; top += stride) {
    for (let left = 0; left <= maxLeft; left += stride) {
      const score = imageSearchScore(template, frame, left, top);
      if (score > best.score) best = { score, left, top };
    }
  }
  // Rà chính xác quanh điểm tốt nhất. Lượt này loại sai số do bước quét thưa
  // mà không biến mỗi frame thành một phép so sánh toàn ảnh rất chậm.
  const leftStart = Math.max(0, best.left - stride);
  const leftEnd = Math.min(maxLeft, best.left + stride);
  const topStart = Math.max(0, best.top - stride);
  const topEnd = Math.min(maxTop, best.top + stride);
  for (let top = topStart; top <= topEnd; top += 1) {
    for (let left = leftStart; left <= leftEnd; left += 1) {
      const score = imageSearchScore(template, frame, left, top);
      if (score > best.score) best = { score, left, top };
    }
  }
  return best;
}

async function imageSearchTemplateFile(template: ImageSearchRaster, originalName: string): Promise<File> {
  if (typeof document === "undefined") throw new Error("Không thể lưu ảnh mẫu ngoài giao diện ứng dụng.");
  const canvas = document.createElement("canvas");
  canvas.width = template.width;
  canvas.height = template.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Không khởi tạo được ảnh mẫu đã cắt.");
  context.putImageData(new ImageData(template.data, template.width, template.height), 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không tạo được ảnh mẫu đã cắt.")), "image/png"));
  const baseName = originalName.replace(/\.[^.]+$/, "").trim() || "image-template";
  return new File([blob], `${baseName}-template.png`, { type: "image/png" });
}

async function executeImageSearchNode(
  node: WorkflowNodeLike,
  inputs: Record<string, unknown>,
  store: RuntimeFileStore,
  reportProgress?: ProgressReporter,
): Promise<Record<string, unknown>> {
  const config = node.data.config ?? {};
  const fromPort = (type: string, legacyType?: string) => assetFiles(input(node, inputs, type) ?? (legacyType ? input(node, inputs, legacyType) : undefined), store)
    .filter((file) => file.type.startsWith("image/"));
  const connectedTemplate = fromPort("ImageSample", "Mẫu ảnh");
  const directTemplate = (store.get(`${node.id}:templateImages`) ?? []).filter((file) => file.type.startsWith("image/"));
  if (connectedTemplate.length && directTemplate.length) throw new Error("Ảnh mẫu chỉ dùng một nguồn: tháo dây image-sample hoặc bỏ ảnh mẫu đã chọn trực tiếp.");
  const templateSource = (connectedTemplate[0] ?? directTemplate[0]);
  if (!templateSource) throw new Error("Tìm ảnh tương đồng cần nối một ảnh vào cổng image-sample hoặc chọn ảnh mẫu trực tiếp trong node.");

  const oneSearchImage = fromPort("ImageSearch");
  const searchImageList = fromPort("ImageSearchList", "Kho ảnh");
  const directModeIsFolder = String(config.searchSourceMode ?? "Chọn ảnh") === "Chọn folder ảnh";
  const directFrames = directModeIsFolder ? [] : (store.get(`${node.id}:searchImages`) ?? []).filter((file) => file.type.startsWith("image/"));
  const connectedFolder = input(node, inputs, "SearchFolder");
  const folderSource = typeof connectedFolder === "string" ? connectedFolder.trim() : "";
  const directFolder = directModeIsFolder ? String(config.searchFolder ?? "").trim() : "";
  const sources = [
    oneSearchImage.length ? { kind: "one-image", files: oneSearchImage } : null,
    searchImageList.length ? { kind: "image-list", files: searchImageList } : null,
    folderSource ? { kind: "folder", folderPath: folderSource } : null,
    directFrames.length ? { kind: "direct-images", files: directFrames } : null,
    directFolder ? { kind: "folder", folderPath: directFolder } : null,
  ].filter((source): source is { kind: string; files?: File[]; folderPath?: string } => Boolean(source));
  if (!sources.length) throw new Error("Hãy nối image-search, image-search-list hoặc search-folder; hoặc chọn ảnh/folder trực tiếp trong node.");
  if (sources.length > 1) throw new Error("Ảnh để tìm chỉ dùng một nguồn: image-search, image-search-list, search-folder hoặc lựa chọn trực tiếp.");
  const searchSource = sources[0];
  let frames: File[];
  if (searchSource.kind === "folder") {
    const folderPath = searchSource.folderPath!;
    reportProgress?.({ current: 0, total: 1, message: "Đọc folder ảnh", detail: folderPath });
    const images = await listLocalImageLibrary(folderPath, Boolean(config.includeSubfolders), Math.max(1, Math.min(1000, Number(config.maxFolderImages) || 500)));
    if (!images.length) throw new Error("Folder đã chọn không có JPG, PNG, WEBP hoặc BMP phù hợp.");
    frames = images.map((image) => {
      const file = localOutputFile(image.filePath) as File & { contentFlowPathOnly?: boolean; contentFlowSize?: number };
      file.contentFlowPathOnly = true;
      file.contentFlowSize = image.bytes;
      return file;
    });
  } else {
    frames = searchSource.files ?? [];
  }
  // Chỉ một ảnh bất kể được nạp qua image-search, image-search-list hay chọn
  // trực tiếp đều là câu hỏi đúng/sai. Folder luôn là truy vấn danh sách.
  const singleImageSearch = searchSource.kind !== "folder" && frames.length === 1;
  const selectedRegion = String(config.selectionMode ?? "Cắt vùng chính xác") === "Cắt vùng chính xác"
    ? exactAttentionRegions(config.exactRegions)[0]
    : undefined;
  if (String(config.selectionMode ?? "Cắt vùng chính xác") === "Cắt vùng chính xác" && !selectedRegion) {
    throw new Error("Hãy bấm “Mở trình chọn chính xác…” và cắt một vùng đặc trưng từ ảnh mẫu trước khi tìm.");
  }

  reportProgress?.({ current: 0, total: frames.length, message: "Chuẩn bị ảnh mẫu", detail: `Đang cắt ${templateSource.name} làm ảnh tìm kiếm.` });
  const templateRaster = cropImageSearchRaster(await imageSearchRaster(templateSource), selectedRegion ?? { x: 0, y: 0, width: 1, height: 1 });
  const templateFile = await imageSearchTemplateFile(templateRaster, templateSource.name);
  const templateRuntimeKey = `${node.id}:image-search-template`;
  store.set(templateRuntimeKey, [templateFile]);

  const timeline = await frameIndexEntries(input(node, inputs, "FrameIndex"), store);
  const hasFrameIndex = timeline.length > 0;
  const frameTimes = new Map(timeline.map((item) => [String(item.fileName ?? item.name ?? ""), item]));
  const threshold = Math.max(0.5, Math.min(0.99, Number(config.similarityThreshold ?? 85) / 100));
  const results: Array<Record<string, unknown>> = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    reportProgress?.({ current: index + 1, total: frames.length, message: `Tìm ảnh trong frame ${index + 1}/${frames.length}`, detail: frame.name });
    const raster = await imageSearchRaster(frame);
    const found = locateSimilarImage(templateRaster, raster);
    if (found.score < threshold) continue;
    const timelineItem = frameTimes.get(frame.name);
    const localPath = (frame as File & { contentFlowPath?: string }).contentFlowPath;
    results.push({
      name: frame.name,
      type: frame.type || "image/png",
      runtimeKey: `${node.id}:image-search-frames`,
      fileIndex: index,
      localPath,
      previewUrl: localPath ? `${LOCAL_MEDIA_SERVICE}/preview-media?filePath=${encodeURIComponent(localPath)}` : URL.createObjectURL(frame),
      score: Number((found.score * 100).toFixed(1)),
      ...(hasFrameIndex && timelineItem ? {
        timestamp: Number(timelineItem.timestamp ?? 0),
        timecode: String(timelineItem.timecode ?? formatTimecode(Number(timelineItem.timestamp ?? 0))),
      } : {}),
      matchRegion: {
        x: Number((found.left / raster.width).toFixed(4)), y: Number((found.top / raster.height).toFixed(4)),
        width: Number((templateRaster.width / raster.width).toFixed(4)), height: Number((templateRaster.height / raster.height).toFixed(4)),
      },
    });
  }
  store.set(`${node.id}:image-search-frames`, frames);
  const maxMatches = Math.max(1, Math.min(100, Math.round(Number(config.maxMatches ?? 20) || 20)));
  const matches = results.sort((left, right) => Number(right.score) - Number(left.score)).slice(0, maxMatches);
  // Một ảnh là câu hỏi đúng/sai. Nhiều ảnh hoặc folder là truy vấn danh sách:
  // nếu có FrameIndex thì mỗi kết quả có timecode, còn không thì giữ tên ảnh.
  return outputs(node, {
    ImageSample: runtimeAssets(templateRuntimeKey, [templateFile]),
    ...(singleImageSearch ? { Condition: matches.length > 0 } : { "ImageMatch[]": matches }),
  });
}

function conditionValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return /^(true|đúng|yes|có|1|pass|đạt)$/i.test(value.trim());
  const item = record(value);
  if (typeof item.condition === "boolean") return item.condition;
  if (typeof item.matched === "boolean") return item.matched;
  if (typeof item.status === "string") return /^(đạt|pass|true)$/i.test(item.status.trim());
  return Boolean(value);
}

function switchComparable(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const item = record(value);
  return String(item.value ?? item.condition ?? item.status ?? "").trim();
}

function executeRoutingNode(node: WorkflowNodeLike, inputs: Record<string, unknown>): Record<string, unknown> {
  const payload = input(node, inputs, "Dữ liệu bất kỳ");
  if (payload === undefined) throw new Error(`${node.data.label} cần nhận Dữ liệu bất kỳ để chuyển sang nhánh đã chọn.`);
  const conditionInput = input(node, inputs, "Condition");
  if (node.data.label === "If/Else") {
    const selected = conditionInput === undefined
      ? String((node.data.config ?? {}).fallbackCondition ?? "Đúng") === "Đúng"
      : conditionValue(conditionInput);
    return outputs(node, selected ? { "Nhánh đúng": payload } : { "Nhánh sai": payload });
  }
  const config = node.data.config ?? {};
  if (conditionInput === undefined) throw new Error("Switch cần nhận giá trị từ cổng Condition.");
  const actual = switchComparable(conditionInput);
  const normalize = (value: unknown) => String(value ?? "").trim();
  const same = (expected: unknown) => Boolean(config.ignoreCase ?? true)
    ? actual.toLocaleLowerCase() === normalize(expected).toLocaleLowerCase()
    : actual === normalize(expected);
  if (same(config.case1 ?? "true")) return outputs(node, { "Nhánh 1": payload });
  if (same(config.case2 ?? "false")) return outputs(node, { "Nhánh 2": payload });
  return outputs(node, { "Mặc định": payload });
}

async function executeImageResizeNode(node: WorkflowNodeLike, inputs: Record<string, unknown>, store: RuntimeFileStore): Promise<Record<string, unknown>> {
  const images = localPathFiles(input(node, inputs, "Image[]"), store);
  if (!images.length) throw new Error("Giảm độ phân giải ảnh cần Image[] cục bộ từ node đầu vào.");
  const targetShortSide = String((node.data.config ?? {}).targetResolution ?? "480 (cạnh ngắn)").startsWith("720") ? 720 : 480;
  const rendered = await localMediaJson<{ files?: Array<{ filePath?: string; bytes?: number }> }>("/optimize-image-inputs", {
    imagePaths: images.map((file) => file.contentFlowPath),
    targetShortSide,
  }, "Dịch vụ media không trả về ảnh đã giảm độ phân giải.");
  if (!rendered.files?.length || rendered.files.some((item) => !item.filePath)) throw new Error("Dịch vụ media không trả về đường dẫn ảnh đã giảm độ phân giải.");
  const runtimeKey = `${node.id}:resized-images`;
  const files = rendered.files.map((item) => {
    const file = localOutputFile(String(item.filePath)) as File & { contentFlowSize?: number; contentFlowPathOnly?: boolean };
    file.contentFlowSize = Number(item.bytes) || file.size;
    file.contentFlowPathOnly = true;
    return file;
  });
  store.set(runtimeKey, files);
  return outputs(node, {
    "Image[]": runtimeAssets(runtimeKey, files).map((asset) => ({
      ...asset,
      resizedForAi: true,
      targetShortSide,
    })),
  });
}

async function executeVideoAnalysisNode(node: WorkflowNodeLike, inputs: Record<string, unknown>, store: RuntimeFileStore): Promise<Record<string, unknown>> {
  // Node cũ có thể được lưu trước khi config được thêm vào. Dùng cấu hình
  // rỗng để nó trả lỗi thiếu Video/thiết lập cụ thể thay vì lỗi JavaScript.
  const config = node.data.config ?? {};
  if (node.data.label === "Lập chỉ mục video theo thời gian") {
    const files = assetFiles(input(node, inputs, "Video"), store);
    if (!files.length) throw new Error("Lập chỉ mục video theo thời gian chưa nhận được file Video");
    const indexes = [];
    for (const file of files) indexes.push(await buildVideoIndex(node, file, store));
    return output(node, indexes.length === 1 ? indexes[0] : indexes);
  }

  if (node.data.label === "Trích frame từ video") {
    const files = assetFiles(input(node, inputs, "Video"), store);
    if (!files.length) throw new Error("Trích frame từ video chưa nhận được file Video");
    const frames: Array<Record<string, unknown>> = [];
    for (const file of files) {
      const index = await buildVideoIndex(node, file, store);
      frames.push(...index.frames.map((frame) => ({ ...frame, videoFileName: index.fileName, videoDuration: index.duration })));
    }
    if (!frames.length) throw new Error("Không trích được frame nào từ Video");
    const imageAssets = frameImageAssets(frames, store);
    if (!imageAssets.length) throw new Error("Trích frame không tạo được dữ liệu ảnh để dùng ở cổng Image[]");
    return outputs(node, { "Image[]": imageAssets, FrameIndex: frames });
  }

  if (node.data.label === "Tách âm thanh từ video") {
    const files = localPathFiles(input(node, inputs, "Video"), store);
    if (!files.length) throw new Error("Tách âm thanh từ video chưa nhận được file Video");
    const format = String(config.audioFormat ?? "MP3").toUpperCase() === "WAV" ? "wav" : "mp3";
    const rendered = await renderLocalVideo("extract-audio", {
      videoPaths: [files[0].contentFlowPath],
      audioFormat: format,
      audioBitrate: Math.max(64, Math.min(320, Number(config.audioBitrate) || 128)),
      outputName: `${String(files[0].name ?? "video").replace(/\.[^.]+$/, "")}-audio`,
    });
    const runtimeKey = `${node.id}:extracted-audio`;
    const file = localOutputFile(rendered.filePath) as File & { contentFlowPathOnly?: boolean; contentFlowSize?: number };
    file.contentFlowPathOnly = true;
    file.contentFlowSize = rendered.bytes || file.size;
    store.set(runtimeKey, [file]);
    return outputs(node, { Audio: runtimeAssets(runtimeKey, [file])[0] });
  }

  if (node.data.label === "Tạo transcript video theo thời gian") {
    const files = assetFiles(input(node, inputs, "Video"), store);
    if (!files.length) throw new Error("Phiên âm video chưa nhận được file Video");
    const transcriptMode = String(config.transcriptMode ?? "");
    if (!["Transcript cục bộ", "Transcript bằng API"].includes(transcriptMode)) {
      throw new Error("Hãy chọn cách xử lý transcript: Transcript cục bộ hoặc Transcript bằng API.");
    }
    const apiKey = directNodeApiKey(node, inputs);
    if (transcriptMode === "Transcript bằng API" && !apiKey) {
      throw new Error("Transcript bằng API cần API key được nhập trực tiếp hoặc nối qua cổng APIKey.");
    }
    const knownTerms = await transcriptionKnownTerms(node, inputs, store);
    const payload = await transcribeVideoFiles(files, {
      transcriptMode,
      localTranscriptModel: config.localTranscriptModel,
      enhanceSpeech: Boolean(config.enhanceSpeech),
      language: transcriptLanguage(config.language),
      knownTerms,
      speakerDiarization: Boolean(config.speakerDiarization),
      chunkMinutes: config.chunkMinutes,
      apiKey,
    });
    const transcripts = list<Record<string, unknown>>(payload.transcripts);
    return output(node, transcripts.length === 1 ? transcripts[0] : { items: transcripts, text: transcripts.map((item) => String(item.text ?? "")).join("\n\n") });
  }

  if (node.data.label === "Tạo storyboard từ video") {
    const indexes = list<Record<string, unknown>>(input(node, inputs, "VideoIndex"));
    if (!indexes.length) throw new Error("Tạo storyboard chưa nhận được VideoIndex");
    const boards = [];
    for (const index of indexes) boards.push(...await buildStoryboards(node, index, store));
    return output(node, boards);
  }

  if (["Phân tích video theo từng đoạn", "Phân tích từng đoạn video"].includes(node.data.label)) {
    const materials = preferredAiMaterials(node, inputs);
    const boards = list<Record<string, unknown>>(materialValue(node, inputs, materials, "Storyboard[]"));
    const transcript = record(materialValue(node, inputs, materials, "TimedTranscript"));
    if (!boards.length) throw new Error("Phân tích từng đoạn chưa nhận được Storyboard[]");
    const settings = aiCallSettings(node, inputs);
    if (settings.provider !== "OpenAI") throw new Error(`Phân tích từng đoạn video hiện hỗ trợ OpenAI; node đang chọn ${settings.provider}.`);
    const batchSize = Math.max(1, Math.min(8, Number(config.boardsPerRequest) || 4));
    const scenes: unknown[] = [];
    for (let offset = 0; offset < boards.length; offset += batchSize) {
      const batch = boards.slice(offset, offset + batchSize);
      const files = assetFiles(batch, store);
      const start = Number(batch[0]?.start ?? 0);
      const end = Number(batch[batch.length - 1]?.end ?? start);
      const rangeTranscript = transcriptTextForRange(transcript, start, end);
      const reserve = estimatedAiInputTokens(`${String(config.analysisGoal ?? "Tóm tắt nội dung")}\n${String(config.instructions ?? "")}\n${JSON.stringify(batch)}\n${rangeTranscript}`, files.length);
      const payload = await uploadFiles("analyze-video-frames", files, {
        apiKey: settings.apiKey, model: settings.model || String(config.model ?? ""), maxOutputTokens: aiBudget(settings, reserve),
        detail: config.imageDetail,
        goal: config.analysisGoal,
        instructions: config.instructions,
        timeline: JSON.stringify(batch.map((item) => ({ start: item.start, end: item.end, startTimecode: item.startTimecode, endTimecode: item.endTimecode }))),
        transcript: rangeTranscript,
        promptCacheKey: materials.record.cacheKey,
      });
      attachAiUsage({}, payload.usage, settings, reserve);
      scenes.push(...arrayFrom(payload.result, ["scenes", "segments", "items"]));
    }
    if (!scenes.length) throw new Error("AI không trả về phân tích cảnh có thể sử dụng");
    return withAiInputCache(node, "SceneAnalysis[]", scenes, materials);
  }

  if (node.data.label === "Rà soát đoạn video chưa chắc chắn") {
    const scenes = arrayFrom(input(node, inputs, "SceneAnalysis[]"), ["scenes", "segments", "items"]).map(record);
    if (!scenes.length) throw new Error("Kiểm tra độ tin cậy chưa nhận được SceneAnalysis[]");
    const threshold = Math.max(0.3, Math.min(0.95, (Number(config.minimumConfidence) || 70) / 100));
    const padding = Math.max(0, Number(config.paddingSeconds) || 8);
    const intervals = scenes.flatMap((scene, index) => {
      const confidenceValue = Number(scene.confidence ?? scene.score ?? 0.5);
      const confidence = confidenceValue > 1 ? confidenceValue / 100 : confidenceValue;
      const uncertainties = list(scene.uncertainties ?? scene.issues);
      if (confidence >= threshold && !uncertainties.length) return [];
      const start = Math.max(0, Number(scene.start ?? scene.startSeconds ?? 0) - padding);
      const end = Math.max(start, Number(scene.end ?? scene.endSeconds ?? start) + padding);
      return [{ id: `review-${index + 1}`, start, end, startTimecode: formatTimecode(start), endTimecode: formatTimecode(end), confidence: Number(confidence.toFixed(2)), reasons: uncertainties.length ? uncertainties : ["Độ tin cậy thấp"], requiresHumanReview: Boolean(config.manualReview) }];
    });
    return output(node, intervals);
  }

  if (node.data.label === "Tổng hợp nội dung video") {
    const materials = preferredAiMaterials(node, inputs);
    const scenes = arrayFrom(materialValue(node, inputs, materials, "SceneAnalysis[]"), ["scenes", "segments", "items"]);
    const transcript = record(materialValue(node, inputs, materials, "TimedTranscript"));
    const reviewIntervals = list(materialValue(node, inputs, materials, "ReviewInterval[]"));
    if (!scenes.length && !String(transcript.text ?? "").trim()) throw new Error("Tổng hợp nội dung video chưa nhận được SceneAnalysis[] hoặc TimedTranscript");
    const settings = aiCallSettings(node, inputs);
    if (settings.provider !== "OpenAI") throw new Error(`Tổng hợp nội dung video hiện hỗ trợ OpenAI; node đang chọn ${settings.provider}.`);
    // Cắt có chủ đích theo ngân sách workflow: báo cáo vẫn có timecode nhưng không nuốt toàn bộ 40k token chỉ ở một node.
    const summaryPrompt = `Tạo báo cáo ${String(config.reportType ?? "Timeline chi tiết")} ở mức ${String(config.reportDetail ?? "Cân bằng")}. Trả về {summary, chapters, keyEvents, charactersOrParticipants, topics, highlights, issues, suggestions, uncertainIntervals}.\n\nSCENE ANALYSIS:\n${JSON.stringify(scenes).slice(0, 40_000)}\n\nTRANSCRIPT:\n${JSON.stringify(transcript).slice(0, 12_000)}\n\nREVIEW INTERVALS:\n${JSON.stringify(reviewIntervals).slice(0, 8_000)}`;
    const reserve = estimatedAiInputTokens(`Bạn là biên tập viên phân tích video. Chỉ sử dụng timeline, transcript và bằng chứng được cung cấp.\n${summaryPrompt}`);
    const payload = await apiJson({
      action: "ai",
      apiKey: settings.apiKey, model: settings.model || String(config.model ?? ""), maxOutputTokens: aiBudget(settings, reserve),
      system: "Bạn là biên tập viên phân tích video. Chỉ sử dụng timeline, transcript và bằng chứng được cung cấp. Không tự bịa chi tiết bị thiếu. Mọi nhận xét quan trọng phải giữ timecode; đoạn chưa chắc chắn phải được ghi rõ. Trả về JSON hợp lệ.",
      prompt: summaryPrompt,
      promptCacheKey: materials.record.cacheKey,
    });
    return withAiInputCache(node, "VideoAnalysis", { ...attachAiUsage(record(payload.result), payload.usage, settings, reserve), reviewIntervals, generatedAt: new Date().toISOString(), protocol: scenes.length ? "adaptive-frames+timed-transcript+hierarchical-summary" : "timed-transcript-summary; không suy luận nội dung hình ảnh" }, materials);
  }

  throw new Error(`Node phân tích video “${node.data.label}” chưa có bộ thực thi`);
}

function normalizeHighlightSegments(value: unknown, maxDurationSeconds: number, maxClipSeconds: number) {
  const raw = arrayFrom(record(value).segments ?? value, ["segments", "highlights", "items"]).map(record).map((item) => ({ start: Math.max(0, Number(item.start ?? item.startSeconds ?? 0)), end: Math.max(0, Number(item.end ?? item.endSeconds ?? 0)), reason: String(item.reason ?? item.summary ?? ""), score: Number(item.score ?? item.confidence ?? 0) })).filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start).map((item) => ({ ...item, end: Math.min(item.end, item.start + maxClipSeconds) })).sort((left, right) => left.start - right.start);
  const selected: typeof raw = [];
  let totalDurationSeconds = 0;
  for (const item of raw) {
    const previous = selected[selected.length - 1];
    const start = previous ? Math.max(item.start, previous.end) : item.start;
    const end = Math.min(item.end, start + maxDurationSeconds - totalDurationSeconds);
    if (end - start < 1) continue;
    selected.push({ ...item, start: Number(start.toFixed(2)), end: Number(end.toFixed(2)) });
    totalDurationSeconds += end - start;
    if (totalDurationSeconds >= maxDurationSeconds - 0.01) break;
  }
  if (!selected.length) throw new Error("AI không chọn được đoạn highlight có timecode hợp lệ.");
  return { segments: selected, totalDurationSeconds: Number(totalDurationSeconds.toFixed(2)), maxDurationSeconds };
}

async function executeIterativeHighlightNode(node: WorkflowNodeLike, inputs: Record<string, unknown>, store: RuntimeFileStore): Promise<Record<string, unknown>> {
  const config = node.data.config;
  const materials = preferredAiMaterials(node, inputs);
  const settings = aiCallSettings(node, inputs);
  if (settings.provider !== "OpenAI") throw new Error(`Làm rõ highlight lặp hiện hỗ trợ OpenAI; node đang chọn ${settings.provider}.`);
  if (!settings.apiKey) throw new Error("Làm rõ highlight lặp cần API key từ Thiết lập AI.");
  const videos = localPathFiles(materialValue(node, inputs, materials, "Video"), store);
  if (!videos.length) throw new Error("Làm rõ highlight lặp cần video gốc cục bộ để trích frame theo timecode.");
  const transcript = record(materialValue(node, inputs, materials, "TimedTranscript"));
  const attention = materialValue(node, inputs, materials, "AttentionRegion");
  const focusMode = String(config.focusMode ?? "Tập trung hình ảnh (80/20)");
  const maxRounds = Math.max(1, Math.min(3, Number(config.maxRounds) || 3));
  const frameIntervalSeconds = Math.max(1, Number(config.frameIntervalSeconds) || 1);
  const maxFramesPerRound = Math.max(4, Math.min(24, Number(config.maxFramesPerRound) || 12));
  const minimumConfidence = Math.max(0.4, Math.min(0.95, (Number(config.minimumConfidence) || 70) / 100));
  let plan = record(materialValue(node, inputs, materials, "HighlightPlan"));
  if (!list(plan.segments).length) throw new Error("Làm rõ highlight lặp chưa nhận được HighlightPlan có các đoạn đề xuất.");
  const rounds: Array<Record<string, unknown>> = [];
  const allScenes: Array<Record<string, unknown>> = [];

  for (let round = 1; round <= maxRounds; round += 1) {
    const timestamps = detailFrameTimestamps(plan, frameIntervalSeconds, maxFramesPerRound);
    if (!timestamps.length) throw new Error("Đề xuất highlight không có timecode hợp lệ để trích frame.");
    const frameAssets = await extractLocalDetailFrames(node, videos[0], timestamps, attention, round, store);
    const files = assetFiles(frameAssets, store);
    const visualWeight = focusMode.startsWith("Tập trung hình ảnh") ? 80 : focusMode.startsWith("Tập trung âm thanh") ? 20 : 50;
    const audioWeight = 100 - visualWeight;
    const prompt = `Đây là vòng xác nhận highlight ${round}/${maxRounds}. Hình ảnh chiếm ${visualWeight}% và âm thanh/transcript chiếm ${audioWeight}% trong quyết định. Chỉ giữ đoạn đúng yêu cầu, có bằng chứng timecode và confidence từ ${Math.round(minimumConfidence * 100)} trở lên. Không yêu cầu trích dày hơn 1 frame/giây. ${attentionPrompt(attention)}. Yêu cầu: ${String(config.instructions ?? "Không có")}.

Kế hoạch từ vòng trước:
${JSON.stringify(plan).slice(0, 12_000)}

Transcript:
${JSON.stringify(transcript).slice(0, 10_000)}

Frame gửi kèm có timecode trong tên file. Trả về JSON: {"segments":[{"start":0,"end":0,"reason":"","score":0,"confidence":0}],"confirmed":false,"needsAnotherRound":true,"notes":""}.`;
    const reserve = estimatedAiInputTokens(prompt, files.length);
    const payload = await uploadFiles("analyze-video-frames", files, {
      apiKey: settings.apiKey,
      model: settings.model,
      maxOutputTokens: aiBudget(settings, reserve),
      detail: String(config.imageDetail ?? "low"),
      goal: "Xác nhận và làm rõ highlight video theo vòng lặp",
      instructions: String(config.instructions ?? ""),
      prompt,
      promptCacheKey: materials.record.cacheKey,
    });
    const result = record(payload.result);
    const normalizedPlan = normalizeHighlightSegments(result, Math.max(30, Number(plan.maxDurationSeconds) || 420), 120);
    const confirmedSegments = normalizedPlan.segments;
    plan = { ...plan, ...normalizedPlan, editorialSummary: String(result.notes ?? result.editorialSummary ?? ""), confirmed: Boolean(result.confirmed), round, focusMode, attentionRegion: normalizedAttentionRegion(attention) };
    const scene = { round, timestamps, frameCount: frameAssets.length, visualWeight, audioWeight, result: attachAiUsage({}, payload.usage, settings, reserve), plan };
    rounds.push(scene);
    allScenes.push(...confirmedSegments.map((segment) => ({ ...segment, round, source: "iterative-highlight-confirmation" })));
    if (plan.confirmed || result.needsAnotherRound === false) break;
  }

  const nextCache = cacheValues(node, [
    materialValue(node, inputs, materials, "Video"),
    plan,
    materialValue(node, inputs, materials, "TimedTranscript"),
    attention,
  ]);
  return outputs(node, {
    HighlightPlan: { ...plan, rounds, maxRounds, frameIntervalSeconds, maxFramesPerRound, cacheSource: materials.source },
    "SceneAnalysis[]": allScenes,
    CachedData: cacheHandle(nextCache),
  });
}

async function executeHighlightNode(node: WorkflowNodeLike, inputs: Record<string, unknown>, store: RuntimeFileStore): Promise<Record<string, unknown>> {
  const config = node.data.config;
  if (node.data.label === "Chọn highlight bằng AI") {
    const materials = preferredAiMaterials(node, inputs);
    const settings = aiCallSettings(node, inputs);
    if (settings.provider !== "OpenAI") throw new Error(`Chọn highlight bằng AI hiện hỗ trợ OpenAI; node đang chọn ${settings.provider}.`);
    if (!settings.apiKey) throw new Error("Chọn highlight bằng AI cần API key từ Thiết lập AI.");
    const analysis = record(materialValue(node, inputs, materials, "VideoAnalysis") ?? Object.values(inputs)[0]);
    if (!Object.keys(analysis).length) throw new Error("Chọn highlight bằng AI chưa nhận được VideoAnalysis.");
    const maxDurationSeconds = Math.max(30, Math.min(420, Number(config.maxDurationSeconds) || 420));
    const maxClipSeconds = Math.max(10, Math.min(120, Number(config.maxClipSeconds) || 75));
    const prompt = `Chọn các đoạn video tốt nhất để dựng highlight theo thứ tự thời gian. Mục tiêu: ${String(config.highlightGoal ?? "Khoảnh khắc hấp dẫn nhất")}. Tổng độ dài tất cả đoạn không quá ${maxDurationSeconds} giây. Mỗi đoạn không quá ${maxClipSeconds} giây. Không chọn đoạn có độ tin cậy thấp hoặc timecode thiếu. Tiêu chí bổ sung: ${String(config.instructions ?? "Không có")}.\n\nBáo cáo video có timecode:\n${JSON.stringify(analysis).slice(0, 20_000)}\n\nTrả về {"segments":[{"start":0,"end":0,"reason":"","score":0}],"editorialSummary":""}.`;
    const reserve = estimatedAiInputTokens(`Bạn là dựng phim video. Chỉ chọn timecode có bằng chứng trong báo cáo. Trả về JSON hợp lệ.\n${prompt}`);
    const payload = await apiJson({ action: "ai", apiKey: settings.apiKey, model: settings.model, maxOutputTokens: aiBudget(settings, reserve), json: true, system: "Bạn là dựng phim video. Chỉ chọn timecode có bằng chứng trong báo cáo. Trả về JSON hợp lệ.", prompt, promptCacheKey: materials.record.cacheKey });
    const plan = normalizeHighlightSegments(payload.result, maxDurationSeconds, maxClipSeconds);
    return withAiInputCache(node, "HighlightPlan", attachAiUsage({ ...plan, editorialSummary: String(record(payload.result).editorialSummary ?? "") }, payload.usage, settings, reserve), materials);
  }
  const videos = localPathFiles(input(node, inputs, "Video") ?? Object.values(inputs)[0], store);
  if (!videos.length) throw new Error("Dựng video highlight chưa nhận được video gốc cục bộ.");
  const plan = record(input(node, inputs, "HighlightPlan") ?? Object.values(inputs)[1]);
  const maxDurationSeconds = Math.max(30, Math.min(420, Number(config.maxDurationSeconds ?? plan.maxDurationSeconds) || 420));
  const normalized = normalizeHighlightSegments(plan, maxDurationSeconds, 120);
  const rendered = await renderLocalVideo("highlight", { videoPaths: [videos[0].contentFlowPath], segments: normalized.segments, maxDurationSeconds, outputName: config.outputName, outputFolder: config.localFolder });
  const runtimeKey = `${node.id}:highlight`;
  const file = localOutputFile(rendered.filePath);
  store.set(runtimeKey, [file]);
  return output(node, { ...rendered, duration: normalized.totalDurationSeconds, highlightPlan: normalized, asset: runtimeAssets(runtimeKey, [file])[0], renderedAt: new Date().toISOString() });
}

async function executeVideoFinishingNode(node: WorkflowNodeLike, inputs: Record<string, unknown>, store: RuntimeFileStore): Promise<Record<string, unknown>> {
  const config = node.data.config;
  if (node.data.label === "Chuẩn hóa video nguồn") {
    const videos = localPathFiles(input(node, inputs, "Video") ?? Object.values(inputs)[0], store);
    if (!videos.length) throw new Error("Chuẩn hóa video nguồn cần một Video cục bộ.");
    const profile = normalizeProfile(config.targetProfile);
    const rendered = await renderLocalVideo("normalize", {
      videoPaths: [videos[0].contentFlowPath], ...profile, outputName: config.outputName, outputFolder: config.localFolder,
    });
    const metadata = await localMediaJson<Record<string, unknown>>("/probe-video", { filePath: rendered.filePath }, "Không đọc được metadata video đã chuẩn hóa.");
    const runtimeKey = `${node.id}:normalized-video`;
    const file = localOutputFile(rendered.filePath);
    store.set(runtimeKey, [file]);
    return outputs(node, { Video: runtimeAssets(runtimeKey, [file])[0], VideoMetadata: { ...metadata, profile: profile.label, normalizedAt: new Date().toISOString() } });
  }

  if (node.data.label === "Tạo subtitle") {
    const transcript = record(input(node, inputs, "TimedTranscript") ?? Object.values(inputs)[0]);
    const maxCharsPerLine = Math.max(12, Math.min(60, Number(config.maxCharsPerLine) || 34));
    const maxLines = Math.max(1, Math.min(2, Number(config.maxLines) || 2));
    const cues = subtitleCues(transcript, maxCharsPerLine, maxLines);
    if (!cues.length) throw new Error("Tạo subtitle cần TimedTranscript có các đoạn text, start và end.");
    const written = await localMediaJson<{ filePath?: string; fileName?: string; bytes?: number }>("/write-subtitles", {
      cues, outputName: config.outputName, outputFolder: config.localFolder,
    }, "Dịch vụ media không tạo được file subtitle.");
    if (!written.filePath) throw new Error("Dịch vụ media không trả về đường dẫn file subtitle.");
    const runtimeKey = `${node.id}:subtitle`;
    const file = localOutputFile(written.filePath);
    store.set(runtimeKey, [file]);
    return output(node, { ...written, format: "srt", cueCount: cues.length, asset: runtimeAssets(runtimeKey, [file])[0], createdAt: new Date().toISOString() });
  }

  if (node.data.label === "Chèn subtitle") {
    const videos = localPathFiles(input(node, inputs, "Video") ?? Object.values(inputs)[0], store);
    const subtitles = localPathFiles(input(node, inputs, "Subtitle") ?? Object.values(inputs)[1], store);
    if (!videos.length) throw new Error("Chèn subtitle cần Video cục bộ.");
    if (!subtitles.length) throw new Error("Chèn subtitle cần file Subtitle từ node Tạo subtitle.");
    const rendered = await renderLocalVideo("burn-subtitles", {
      videoPaths: [videos[0].contentFlowPath], subtitlePath: subtitles[0].contentFlowPath, style: config.style,
      fontSize: Number(config.fontSize) || 30, position: config.position, outputName: config.outputName, outputFolder: config.localFolder,
    });
    const runtimeKey = `${node.id}:video-subtitle`;
    const file = localOutputFile(rendered.filePath);
    store.set(runtimeKey, [file]);
    return output(node, { ...rendered, subtitleFileName: subtitles[0].name, asset: runtimeAssets(runtimeKey, [file])[0], renderedAt: new Date().toISOString() });
  }

  const videos = localPathFiles(input(node, inputs, "Video") ?? Object.values(inputs)[0], store);
  if (!videos.length) throw new Error("Kiểm tra kỹ thuật cần Video cục bộ.");
  const metadata = await localMediaJson<Record<string, unknown>>("/probe-video", { filePath: videos[0].contentFlowPath }, "Không đọc được metadata video.");
  const profile = String(config.targetProfile ?? "YouTube 1080p · H.264 · AAC");
  const video = record(metadata.video);
  const audio = record(metadata.audio);
  const width = Number(video.width ?? 0);
  const height = Number(video.height ?? 0);
  const bitrateMbps = Number(metadata.bitRate ?? 0) / 1_000_000;
  const issues: QualityIssue[] = [];
  if (profile.startsWith("YouTube") && (width < 1280 || height < 720)) issues.push(qualityIssue("error", "video.resolution", "Toàn bộ video", "Độ phân giải thấp hơn 1280×720 cho YouTube.", "Render lại tối thiểu 1280×720 trước khi xuất."));
  if (profile.startsWith("Shorts") && height <= width) issues.push(qualityIssue("error", "video.orientation", "Toàn bộ video", "Shorts/Reels cần khung dọc (chiều cao lớn hơn chiều rộng).", "Crop hoặc render lại video theo tỷ lệ dọc 9:16."));
  if (!String(video.codec ?? "").toLowerCase().includes("h264")) issues.push(qualityIssue("warning", "video.codec", "Codec video", "Video không phải H.264.", "Chạy Chuẩn hóa video nguồn trước khi xuất."));
  if (Object.keys(audio).length && !String(audio.codec ?? "").toLowerCase().includes("aac")) issues.push(qualityIssue("warning", "audio.codec", "Codec âm thanh", "Audio không phải AAC.", "Xuất lại audio AAC để tránh nền tảng chuyển mã lại."));
  const minimumBitrate = Math.max(0, Number(config.minimumBitrateMbps) || 0);
  if (minimumBitrate && bitrateMbps && bitrateMbps < minimumBitrate) issues.push(qualityIssue("warning", "video.bitrate", "Toàn bộ video", `Bitrate ${bitrateMbps.toFixed(2)} Mbps thấp hơn mức ${minimumBitrate.toFixed(2)} Mbps.`, "Render lại với bitrate cao hơn hoặc giảm mức tối thiểu nếu phù hợp nền tảng."));
  return output(node, qualityReport(issues, {
    ...metadata,
    profile,
    method: "local-media-metadata",
    metrics: { width, height, fps: Number(video.fps ?? 0), bitrateMbps: Number(bitrateMbps.toFixed(2)) },
  }));
}

type QualityIssue = {
  id: string;
  severity: "error" | "warning" | "info";
  code: string;
  location: string;
  reason: string;
  fix: string;
};

function qualityIssue(severity: QualityIssue["severity"], code: string, location: string, reason: string, fix: string): QualityIssue {
  return { id: `${code}-${Math.random().toString(36).slice(2, 8)}`, severity, code, location, reason, fix };
}

function qualityStatus(issues: QualityIssue[], cannotCheck = false) {
  if (cannotCheck) return "Không thể kiểm tra";
  if (issues.some((issue) => issue.severity === "error")) return "Không đạt";
  if (issues.some((issue) => issue.severity === "warning")) return "Cần sửa";
  return "Đạt";
}

function qualityReport(issues: QualityIssue[], extra: Record<string, unknown> = {}, cannotCheck = false) {
  const status = qualityStatus(issues, cannotCheck);
  return {
    ...extra,
    status,
    passed: status === "Đạt",
    needsFix: status === "Cần sửa" || status === "Không đạt",
    summary: status === "Đạt" ? "Đạt tất cả điều kiện đã kiểm tra." : status === "Không thể kiểm tra" ? "Thiếu dữ liệu hoặc kết quả không đủ để kiểm tra." : `${issues.length} điểm cần xử lý trước khi xuất bản.`,
    issues,
    repairItems: issues.filter((issue) => issue.severity !== "info").map((issue) => ({ location: issue.location, reason: issue.reason, fix: issue.fix, severity: issue.severity })),
    checkedAt: new Date().toISOString(),
  };
}

function qualityInputText(node: WorkflowNodeLike, inputs: Record<string, unknown>) {
  const values = node.data.inputs.map((port) => inputs[port.id]).filter((value) => value !== undefined);
  for (const value of values) {
    const text = contentText(value);
    if (text) return text;
  }
  const direct = Object.values(inputs).find((value) => contentText(value));
  return contentText(direct);
}

function normalizedQualityStatus(value: unknown, issues: QualityIssue[]) {
  const text = String(value ?? "").trim().toLowerCase();
  if (/không đạt|fail|reject/.test(text)) return "Không đạt";
  if (/cần sửa|warning|needs?.?fix/.test(text)) return "Cần sửa";
  if (/đạt|pass|approved/.test(text)) return "Đạt";
  return qualityStatus(issues);
}

function normalizeAiIssues(value: unknown): QualityIssue[] {
  return list<unknown>(value).map((item, index) => {
    const issue = record(item);
    const severity: QualityIssue["severity"] = /error|fail|critical|không đạt/i.test(String(issue.severity ?? issue.level ?? "")) ? "error" : /info/i.test(String(issue.severity ?? issue.level ?? "")) ? "info" : "warning";
    return qualityIssue(
      severity,
      String(issue.code ?? `ai.issue.${index + 1}`),
      String(issue.location ?? issue.where ?? "Không xác định"),
      String(issue.reason ?? issue.message ?? issue.issue ?? "AI không nêu rõ lý do."),
      String(issue.fix ?? issue.suggestion ?? issue.recommendation ?? "Xem lại và chỉnh sửa phần được nêu."),
    );
  });
}

function qualityReports(value: unknown): Array<Record<string, unknown>> {
  const candidates = Array.isArray(value) ? value : [value];
  return candidates.flatMap((item) => {
    const report = record(item);
    if (Array.isArray(report.reports)) return qualityReports(report.reports);
    return Object.keys(report).length ? [report] : [];
  });
}

async function executeQualityNode(node: WorkflowNodeLike, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = node.data.config;
  if (node.data.label === "Kiểm tra yêu cầu và cấu trúc") {
    const text = qualityInputText(node, inputs);
    if (!text) return output(node, qualityReport([], { method: "local-rule", metrics: { wordCount: 0 } }, true));
    const words = text.split(/\s+/).filter(Boolean).length;
    const requirements = lines(config.requirements);
    const issues: QualityIssue[] = [];
    for (const requirement of requirements) {
      if (!text.toLocaleLowerCase("vi").includes(requirement.toLocaleLowerCase("vi"))) {
        issues.push(qualityIssue("error", "content.required-phrase", "Toàn bộ nội dung", `Thiếu yêu cầu bắt buộc: “${requirement}”.`, `Bổ sung đúng cụm “${requirement}” hoặc sửa checklist nếu yêu cầu đã thay đổi.`));
      }
    }
    const minWords = Math.max(0, Number(config.minWords) || 0);
    const maxWords = Math.max(0, Number(config.maxWords) || 0);
    if (minWords && words < minWords) issues.push(qualityIssue("warning", "content.min-words", "Toàn bộ nội dung", `Nội dung có ${words} từ, thấp hơn mức tối thiểu ${minWords} từ.`, "Bổ sung chi tiết hoặc giảm mức số từ tối thiểu."));
    if (maxWords && words > maxWords) issues.push(qualityIssue("warning", "content.max-words", "Toàn bộ nội dung", `Nội dung có ${words} từ, vượt mức tối đa ${maxWords} từ.`, "Rút gọn nội dung hoặc tăng mức số từ tối đa."));
    return output(node, qualityReport(issues, { method: "local-rule", metrics: { wordCount: words, requiredCount: requirements.length } }));
  }
  if (node.data.label === "Chuẩn bị kiểm tra AI") {
    const text = qualityInputText(node, inputs);
    const checklist = lines(config.requirements);
    const prompt = `Bạn là kiểm định viên chất lượng. Chỉ đánh giá từ tư liệu nhận được, không tự bịa. Mục tiêu: ${String(config.checkGoal ?? "Kiểm tra chất lượng sản phẩm")}. Checklist: ${checklist.length ? checklist.map((item, index) => `${index + 1}. ${item}`).join(" ") : "Không có checklist bổ sung."}\n\nTư liệu:\n${text || JSON.stringify(Object.values(inputs)).slice(0, 50000)}\n\nChỉ trả JSON: {"status":"Đạt|Cần sửa|Không đạt","summary":"","issues":[{"severity":"warning|error","location":"","reason":"","fix":""}]}. Tối đa 3 issues; mỗi summary, reason và fix không quá 160 ký tự.`;
    return output(node, prompt);
  }
  if (node.data.label === "Đọc kết quả AI kiểm tra") {
    const raw = input(node, inputs, "AIJson") ?? Object.values(inputs).find((value) => record(value).issues !== undefined || record(value).status !== undefined);
    const source = record(raw);
    let parsed = source;
    if (typeof source.text === "string") {
      try { parsed = record(JSON.parse(source.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""))); }
      catch {
        const incomplete = qualityReport([], { method: "ai-result", aiSummary: "AI trả về JSON không hoàn chỉnh hoặc không hợp lệ." }, true);
        return output(node, { ...incomplete, summary: "Không thể đọc kết quả AI vì JSON không hoàn chỉnh hoặc không hợp lệ." });
      }
    }
    if (parsed.status === undefined && parsed.issues === undefined) {
      const incomplete = qualityReport([], { method: "ai-result", aiSummary: "AI không trả cấu trúc status hoặc issues." }, true);
      return output(node, { ...incomplete, summary: "Không thể đọc kết quả AI vì thiếu status và issues." });
    }
    const issues = normalizeAiIssues(parsed.issues);
    const status = normalizedQualityStatus(parsed.status, issues);
    const report = qualityReport(issues, { method: "ai-result", aiSummary: String(parsed.summary ?? "") });
    return output(node, { ...report, status, passed: status === "Đạt", needsFix: status === "Cần sửa" || status === "Không đạt", summary: String(parsed.summary ?? report.summary) });
  }
  if (node.data.label === "Tổng hợp báo cáo kiểm tra") {
    const reports = qualityReports(input(node, inputs, "QAReport") ?? Object.values(inputs)[0]);
    if (!reports.length) return output(node, qualityReport([], { method: "aggregate", reports: [] }, true));
    const issues = reports.flatMap((report) => normalizeAiIssues(report.issues));
    const cannotCheck = reports.some((report) => report.status === "Không thể kiểm tra");
    if (cannotCheck && Boolean(config.cannotCheckIsFail)) {
      issues.push(qualityIssue("error", "quality.cannot-check", "Báo cáo kiểm tra", "Có hạng mục không thể kiểm tra nên chưa đủ cơ sở để duyệt.", "Bổ sung tư liệu hoặc chạy lại hạng mục chưa kiểm tra được."));
    }
    return output(node, qualityReport(issues, { method: "aggregate", reports, reportCount: reports.length }, cannotCheck && !Boolean(config.cannotCheckIsFail)));
  }
  if (node.data.label === "Chấm điểm thành phẩm") {
    const reports = qualityReports(input(node, inputs, "QAReport") ?? Object.values(inputs)[0]);
    if (!reports.length) return output(node, qualityReport([], { method: "score" }, true));
    const issues = reports.flatMap((report) => normalizeAiIssues(report.issues));
    const cannotCheck = reports.some((report) => report.status === "Không thể kiểm tra");
    const warningDeduction = Math.max(1, Number(config.warningDeduction) || 10);
    const failDeduction = Math.max(1, Number(config.failDeduction) || 30);
    const score = Math.max(0, 100 - issues.reduce((total, issue) => total + (issue.severity === "error" ? failDeduction : issue.severity === "warning" ? warningDeduction : 0), 0));
    return output(node, qualityReport(issues, { method: "score", score, reports }, cannotCheck));
  }
  const report = record(input(node, inputs, "QAReport") ?? Object.values(inputs)[0]);
  const status = String(report.status ?? "Không thể kiểm tra");
  const decision = String(config.decision ?? "Theo kết quả kiểm tra");
  const approved = decision === "Đã duyệt" || (decision === "Theo kết quả kiểm tra" && status === "Đạt");
  const finalDecision = decision === "Theo kết quả kiểm tra" ? (status === "Đạt" ? "Đã duyệt" : status === "Cần sửa" ? "Yêu cầu sửa" : "Từ chối") : decision;
  return output(node, { decision: finalDecision, approved, status, note: String(config.note ?? ""), report, repairItems: list<unknown>(report.repairItems) });
}

async function executeInput(node: WorkflowNodeLike, store: RuntimeFileStore): Promise<Record<string, unknown>> {
  const config = node.data.config;
  if (node.data.label === "Nhập đề tài") return output(node, { topic: config.topic, goal: config.goal, audience: config.audience, targetLength: config.length });
  if (node.data.label === "Nhập văn bản") return output(node, String(config.content ?? ""));
  if (node.data.label === "Nhập URL") return output(node, lines(config.urls));
  if (node.data.label === "Nhập ngày giờ") {
    const date = String(config.date ?? "");
    const time = String(config.time ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("Hãy nhập ngày và giờ hợp lệ");
    return output(node, { value: `${date}T${time}`, timezone: String(config.timezone ?? "Asia/Bangkok (UTC+7)") });
  }
  if (node.data.label === "Nhập thời gian") return output(node, String(parseDurationInput(String(config.durationText ?? ""))));
  if (node.data.label === "Nhập Boolean") return output(node, String(config.booleanValue ?? "true") === "true");
  if (node.data.label === "Nhập biến") {
    const type = String(config.variableType ?? "String");
    const rawValue = String(config.variableValue ?? "");
    let value: unknown = rawValue;
    if (type === "Number") value = Number(rawValue);
    if (type === "Boolean") value = rawValue.trim().toLowerCase() === "true";
    if (type === "JSON") {
      try { value = JSON.parse(rawValue); } catch { throw new Error("Giá trị của biến phải là JSON hợp lệ"); }
    }
    return output(node, { name: String(config.variableName ?? ""), value, type });
  }
  if (node.data.label === "Cấu hình API key") return output(node, String(config.apiKey ?? ""));
  if (node.data.label === "Tải tài liệu từ máy") {
    const runtimeKey = `${node.id}:documents`;
    return output(node, runtimeAssets(runtimeKey, store.get(runtimeKey) ?? []));
  }
  if (node.data.label === "Tải file không rõ kiểu") {
    const runtimeKey = `${node.id}:genericFiles`;
    return output(node, runtimeAssets(runtimeKey, store.get(runtimeKey) ?? []));
  }
  if (["Tải ảnh từ máy", "Tải ảnh lên"].includes(node.data.label)) {
    const runtimeKey = `${node.id}:images`;
    return output(node, runtimeAssets(runtimeKey, store.get(runtimeKey) ?? []));
  }
  if (node.data.label === "Tải kho ảnh từ thư mục") {
    const folderPath = String(config.localFolder ?? "").trim();
    if (!folderPath) throw new Error("Tải kho ảnh từ thư mục chưa chọn thư mục ảnh.");
    const images = await listLocalImageLibrary(folderPath, Boolean(config.includeSubfolders), Math.max(1, Math.min(500, Number(config.maxImages) || 120)));
    if (!images.length) throw new Error("Thư mục ảnh không có JPG, PNG, WEBP hoặc BMP phù hợp.");
    const files = images.map((image) => {
      const file = localOutputFile(image.filePath) as File & { contentFlowPathOnly?: boolean; contentFlowSize?: number };
      file.contentFlowPathOnly = true;
      file.contentFlowSize = image.bytes;
      return file;
    });
    const runtimeKey = `${node.id}:image-library`;
    store.set(runtimeKey, files);
    return output(node, runtimeAssets(runtimeKey, files));
  }
  if (node.data.label === "Chọn thư mục trên máy") return output(node, String(config.localFolder ?? ""));
  if (node.data.label === "Tải video gốc từ máy") {
    const runtimeKey = `${node.id}:videos`;
    return output(node, runtimeAssets(runtimeKey, store.get(runtimeKey) ?? []));
  }
  if (node.data.label === "Tải âm thanh từ máy") {
    const runtimeKey = `${node.id}:audioFiles`;
    return output(node, runtimeAssets(runtimeKey, store.get(runtimeKey) ?? []));
  }
  return output(node, { ...config });
}

function promptDataText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "(Chưa có dữ liệu đầu vào)";
  if (typeof value === "string") return value.trim() || "(Chưa có dữ liệu đầu vào)";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function executeAiPromptNode(node: WorkflowNodeLike, inputs: Record<string, unknown>): Record<string, unknown> {
  const config = node.data.config;
  if (node.data.label === "Soạn system prompt") {
    const role = String(config.role === "Khác" ? config.customRole || "trợ lý AI" : config.role || "trợ lý AI");
    const rules = String(config.rules ?? "").trim();
    const responseFormat = String(config.responseFormat ?? "Văn bản tự do");
    const context = input(node, inputs, "Văn bản") ?? input(node, inputs, "Text");
    const systemPrompt = [
      `Bạn là ${role}.`,
      rules ? `Quy tắc và điều cần tránh:\n${rules}` : "",
      `Định dạng đầu ra: ${responseFormat}.`,
      context === undefined ? "" : `Ngữ cảnh bổ sung:\n${promptDataText(context)}`,
    ].filter(Boolean).join("\n\n");
    return output(node, systemPrompt);
  }

  const rawData = input(node, inputs, "Dữ liệu") ?? input(node, inputs, "Data") ?? Object.values(inputs)[0];
  const data = promptDataText(rawData);
  const instructions = String(config.instructions ?? "").trim();
  const template = String(config.template ?? "Tóm tắt dữ liệu");
  const customTemplate = String(config.customTemplate ?? "").trim();
  const task = template === "Khác" && customTemplate
    ? customTemplate.replaceAll("{{data}}", data)
    : ({
      "Tóm tắt dữ liệu": "Hãy tóm tắt dữ liệu sau. Chỉ nêu các thông tin có trong dữ liệu.",
      "Viết nội dung từ dữ liệu": "Hãy viết nội dung rõ ràng, mạch lạc từ dữ liệu sau. Không tự bịa dữ kiện.",
      "Phân tích và đề xuất": "Hãy phân tích dữ liệu sau và đề xuất các bước thực tế dựa trên dữ liệu.",
      "Trích xuất dữ kiện": "Hãy trích xuất các dữ kiện quan trọng từ dữ liệu sau theo dạng danh sách.",
    }[template] ?? "Hãy xử lý dữ liệu sau theo yêu cầu.");
  const prompt = [
    task,
    template === "Khác" && customTemplate.includes("{{data}}") ? "" : `Dữ liệu đầu vào:\n${data}`,
    instructions ? `Yêu cầu bổ sung:\n${instructions}` : "",
  ].filter(Boolean).join("\n\n");
  return output(node, prompt);
}

function executeAiConfigurationNode(node: WorkflowNodeLike, inputs: Record<string, unknown>): Record<string, unknown> {
  const config = node.data.config;
  const upstream = record(input(node, inputs, "AIProvider"));
  const directApiKey = input(node, inputs, "APIKey") ?? config.apiKey;
  const secretRef = String(upstream.secretRef ?? aiProfileSecretRef(node)).trim();
  const provider = String(upstream.provider ?? config.provider ?? "OpenAI");
  const model = String(config.customModel || config.model || upstream.model || "Tự động (khuyến nghị)");
  const profile = aiExecutionProfile({
    provider,
    model,
    localEndpoint: String(upstream.endpoint ?? upstream.localEndpoint ?? config.localEndpoint ?? ""),
    secretRef,
    temperature: config.temperature === "Tùy chỉnh" ? config.customTemperature : (config.temperature ?? 0.7),
    maxOutputTokens: config.maxOutputTokens,
    maxInputTokens: upstream.maxInputTokens ?? upstream.maxWorkflowTokens ?? config.maxInputTokens ?? config.maxWorkflowTokens,
    maxOutputWorkflowTokens: upstream.maxOutputWorkflowTokens ?? config.maxOutputWorkflowTokens,
  });
  // Bí mật chỉ được giữ trong bộ nhớ phiên. Output và Artifact chỉ có secretRef.
  rememberAiProfileSecret(secretRef, directApiKey ?? profileSecret(upstream));
  if (node.data.label === "Chọn nhà cung cấp AI") {
    return output(node, {
      ...profile,
      region: String(config.region ?? "Tự động (khuyến nghị)"),
      customProvider: String(config.customProvider ?? ""),
    });
  }
  return output(node, profile);
}

function selectionMaxOutputTokens(value: unknown): number {
  return Number(String(value ?? "256").replace(/[^0-9]/g, "")) || 256;
}

async function executeAiModelSelectionNode(node: WorkflowNodeLike, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const provider = record(input(node, inputs, "AIProvider"));
  const providerName = String(provider.provider ?? "OpenAI");
  const apiKey = profileSecret(provider);
  if (providerName !== "OpenAI") throw new Error(`Lựa chọn model AI hiện chạy đánh giá trực tiếp bằng OpenAI; provider đang chọn là ${providerName}.`);
  if (!apiKey) throw new Error("Lựa chọn model AI chưa nhận được API key từ AIProvider.");
  const materials = preferredAiMaterials(node, inputs);
  const cached = materials.record;
  const settings = {
    provider: providerName,
    model: "",
    apiKey,
    maxOutputTokens: selectionMaxOutputTokens((node.data.config ?? {}).maxSelectionTokens),
    maxInputTokens: Math.max(1_000, Math.min(40_000, Number(provider.maxInputTokens ?? 40_000) || 40_000)),
    maxOutputWorkflowTokens: Math.max(500, Math.min(20_000, Number(provider.maxOutputWorkflowTokens ?? 20_000) || 20_000)),
  };
  const preference = String((node.data.config ?? {}).preference ?? "Trung bình");
  const reserve = estimatedAiInputTokens(cached.manifest);
  const payload = await apiJson({
    action: "select-ai-model",
    provider: providerName,
    apiKey,
    localEndpoint: String(provider.localEndpoint ?? ""),
    preference,
    taskManifest: cached.manifest,
    promptCacheKey: cached.cacheKey,
    maxOutputTokens: aiBudget(settings, reserve),
  });
  const selected = record(payload.result);
  const model = String(selected.model ?? "").trim();
  if (!model) throw new Error("AI đánh giá không trả về model hợp lệ.");
  const secretRef = aiProfileSecretRef(node);
  aiModelSecrets.set(secretRef, apiKey);
  return withAiInputCache(node, "AIModel", attachAiUsage({
    ...aiExecutionProfile({
      provider: providerName,
      model,
      temperature: 0.7,
      maxOutputTokens: 2_000,
      maxInputTokens: settings.maxInputTokens,
      maxOutputWorkflowTokens: settings.maxOutputWorkflowTokens,
      localEndpoint: String(provider.endpoint ?? provider.localEndpoint ?? ""),
      secretRef,
    }),
    cacheKey: cached.cacheKey,
    selection: { preference, evaluatedBy: selected.evaluatedBy, candidates: selected.candidates, reason: selected.reason, manifestCachedAt: cached.createdAt },
  }, payload.usage, settings, reserve), materials);
}

function aiCallSettings(node: WorkflowNodeLike, inputs: Record<string, unknown>) {
  const model = record(input(node, inputs, "AIModel"));
  // Workflow cũ có thể chưa có object config. Không được để việc đọc cấu hình
  // làm hỏng cả node AI trước khi nó kịp báo thiếu dữ liệu nghiệp vụ.
  const config = node.data.config ?? {};
  const usesConnectedAiModelOnly = ["Thực thi tác vụ AI", "Phân tích hình ảnh bằng AI", "Phân tích âm thanh bằng AI", "Phân tích video bằng AI"].includes(node.data.label);
  const configuredModel = String(model.model ?? (usesConnectedAiModelOnly ? "" : config.model) ?? "").trim();
  const cacheKey = String(model.cacheKey ?? "").trim();
  const temperatureLabel = String(model.temperature ?? config.temperature ?? "Cân bằng (0.7)");
  const numericTemperature = Number(model.customTemperature ?? config.customTemperature);
  const labelledTemperature = Number(temperatureLabel.match(/\(([0-9.]+)\)/)?.[1]);
  const profile = aiExecutionProfile({
    provider: model.provider ?? (usesConnectedAiModelOnly ? "" : config.provider) ?? "OpenAI",
    model: configuredModel === "Tự động (khuyến nghị)" ? "" : configuredModel,
    localEndpoint: model.endpoint ?? model.localEndpoint ?? config.localEndpoint,
    secretRef: model.secretRef ?? model.cacheKey,
    temperature: Number.isFinite(numericTemperature) && temperatureLabel === "Tùy chỉnh" ? numericTemperature : Number.isFinite(labelledTemperature) ? labelledTemperature : 0.7,
    maxOutputTokens: model.maxOutputTokens ?? config.maxOutputTokens,
    maxInputTokens: model.maxInputTokens ?? model.maxWorkflowTokens ?? config.maxInputTokens ?? config.maxWorkflowTokens,
    maxOutputWorkflowTokens: model.maxOutputWorkflowTokens ?? config.maxOutputWorkflowTokens,
  });
  return {
    provider: profile.provider,
    model: profile.model,
    apiKey: profileSecret(model) || (usesConnectedAiModelOnly ? "" : String(config.apiKey ?? "").trim()),
    maxOutputTokens: profile.maxOutputTokens,
    maxInputTokens: profile.maxInputTokens,
    maxOutputWorkflowTokens: profile.maxOutputWorkflowTokens,
    temperature: profile.temperature,
    endpoint: profile.endpoint,
    cacheKey,
  };
}

function taskInputText(node: WorkflowNodeLike, inputs: Record<string, unknown>, materials: { record: AiMaterialCacheRecord; source: "cache" | "direct" }): string {
  if (materials.source === "cache") return cachedText(materials.record);
  const prompt = input(node, inputs, "Prompt");
  const data = input(node, inputs, "Dữ liệu") ?? input(node, inputs, "Data");
  if (prompt !== undefined && data !== undefined) return `${promptDataText(prompt)}\n\nDỮ LIỆU BỔ SUNG:\n${promptDataText(data)}`;
  return promptDataText(prompt ?? data);
}

async function executeAiTaskNode(node: WorkflowNodeLike, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = node.data.config ?? {};
  const settings = aiCallSettings(node, inputs);
  if (!settings.provider || !settings.model || (settings.provider !== "Ollama" && !settings.apiKey)) {
    throw new Error("Thực thi tác vụ AI cần nối cổng AIModel từ node Thiết lập AI có provider, model và API key hợp lệ (Ollama không cần API key).");
  }
  if (!["OpenAI", "Ollama"].includes(settings.provider)) throw new Error(`Thực thi tác vụ AI hiện hỗ trợ OpenAI và Ollama; profile đang chọn ${settings.provider}.`);
  const instructions = String(config.instructions ?? "").trim();
  if (!instructions) throw new Error("Thực thi tác vụ AI cần Chỉ dẫn tác vụ.");
  const materials = preferredAiMaterials(node, inputs);
  const taskInput = taskInputText(node, inputs, materials);
  if (taskInput === "(Chưa có dữ liệu đầu vào)") throw new Error("Thực thi tác vụ AI cần nối Dữ liệu hoặc Prompt.");
  const taskType = String(config.taskType ?? "Tạo nội dung");
  const json = String(config.outputFormat ?? "Văn bản") === "JSON";
  const systemPrompt = promptDataText(input(node, inputs, "SystemPrompt"));
  const prompt = [
    `Tác vụ: ${taskType}.`,
    `Chỉ dẫn: ${instructions}`,
    "Chỉ sử dụng dữ liệu đầu vào làm bằng chứng. Nếu thiếu dữ liệu, nêu rõ phần chưa đủ thay vì suy đoán.",
    `DỮ LIỆU ĐẦU VÀO:\n${taskInput}`,
  ].join("\n\n");
  const criteria = lines(config.successCriteria);
  const task = taskSpec({
    nodeId: node.id,
    goal: `${taskType}: ${instructions}`,
    expectedOutput: json ? "Record" : "Text",
    inputTypes: node.data.inputs
      .filter((port) => !/^(AIModel|AIProvider|APIKey|CachedData|SystemPrompt)$/i.test(port.type))
      .map((port) => artifactTypeForPortType(port.type)),
    instructions,
    successCriteria: criteria.length ? criteria : ["Kết luận chỉ dựa trên bằng chứng đầu vào.", "Nêu rõ phần chưa đủ bằng chứng để kết luận."],
  });
  const reserve = estimatedAiInputTokens(`${systemPrompt}\n${prompt}`);
  const payload = await apiJson({
    action: "ai",
    provider: settings.provider,
    apiKey: settings.apiKey,
    model: settings.model,
    temperature: settings.temperature,
    maxOutputTokens: aiBudget(settings, reserve),
    system: `${systemPrompt}\n${json ? "Chỉ trả JSON hợp lệ, không dùng markdown." : ""}`.trim(),
    prompt,
    json,
    promptCacheKey: materials.record.cacheKey,
  });
  const result = withAiTaskReport(attachAiUsage(payload.result, payload.usage, settings, reserve), task, [{ kind: "task-input", source: materials.source, characters: taskInput.length }]);
  return outputs(node, {
    AIResult: { ...result, cacheSource: materials.source },
    Report: result.report,
    CachedData: cacheHandle(materials.record),
  });
}

function estimatedAiInputTokens(text: string, imageCount = 0) {
  // Dự trữ bảo thủ: văn bản tiếng Việt khoảng 3 ký tự/token và tối đa 1.000
  // token cho mỗi ảnh. API vẫn trả usage thật để sổ token hiển thị chính xác.
  return Math.max(200, Math.ceil(text.length / 3) + imageCount * 1_000);
}

function aiBudget(settings: ReturnType<typeof aiCallSettings>, estimatedInput: number) {
  const inputRemaining = Math.max(0, settings.maxInputTokens - sessionAiTokenUsage.input - sessionAiTokenUsage.reservedInput);
  if (estimatedInput > inputRemaining) throw new Error(`Ngân sách token đầu vào còn ${inputRemaining.toLocaleString("vi-VN")}, không đủ cho lượt gọi AI kế tiếp (ước tính ${estimatedInput.toLocaleString("vi-VN")}).`);
  const outputRemaining = Math.max(0, settings.maxOutputWorkflowTokens - sessionAiTokenUsage.output);
  if (!outputRemaining) throw new Error(`Đã dùng hết giới hạn ${settings.maxOutputWorkflowTokens.toLocaleString("vi-VN")} token đầu ra của workflow.`);
  sessionAiTokenUsage.reservedInput += estimatedInput;
  return Math.min(settings.maxOutputTokens, outputRemaining, 50_000);
}

function attachAiUsage(result: unknown, rawUsage: unknown, settings: ReturnType<typeof aiCallSettings>, reservedInput = 0) {
  const usage = record(rawUsage);
  const inputTokens = Math.max(0, Number(usage.inputTokens ?? 0));
  const outputTokens = Math.max(0, Number(usage.outputTokens ?? 0));
  sessionAiTokenUsage.reservedInput = Math.max(0, sessionAiTokenUsage.reservedInput - reservedInput);
  sessionAiTokenUsage.input += inputTokens;
  sessionAiTokenUsage.output += outputTokens;
  const inputRemaining = Math.max(0, settings.maxInputTokens - sessionAiTokenUsage.input - sessionAiTokenUsage.reservedInput);
  const outputRemaining = Math.max(0, settings.maxOutputWorkflowTokens - sessionAiTokenUsage.output);
  const usageWithBudget = {
    ...usage,
    workflowInputTokens: sessionAiTokenUsage.input,
    workflowInputTokenLimit: settings.maxInputTokens,
    workflowInputRemainingTokens: inputRemaining,
    workflowOutputTokens: sessionAiTokenUsage.output,
    workflowOutputTokenLimit: settings.maxOutputWorkflowTokens,
    workflowOutputRemainingTokens: outputRemaining,
    warning: sessionAiTokenUsage.input >= settings.maxInputTokens * 0.8 || sessionAiTokenUsage.output >= settings.maxOutputWorkflowTokens * 0.8
      ? `Đã dùng đầu vào ${sessionAiTokenUsage.input.toLocaleString("vi-VN")}/${settings.maxInputTokens.toLocaleString("vi-VN")}, đầu ra ${sessionAiTokenUsage.output.toLocaleString("vi-VN")}/${settings.maxOutputWorkflowTokens.toLocaleString("vi-VN")} token.`
      : undefined,
  };
  if (!inputRemaining || !outputRemaining) usageWithBudget.warning = "Đã chạm giới hạn token workflow. Lần gọi AI tiếp theo sẽ bị chặn.";
  return { ...record(result), usage: usageWithBudget };
}

function aiTaskSpecForNode(node: WorkflowNodeLike, goal: string, expectedOutput: string): TaskSpec {
  const config = node.data.config ?? {};
  const instructions = String(config.instructions ?? "").trim();
  return taskSpec({
    nodeId: node.id,
    goal,
    expectedOutput: artifactTypeForPortType(expectedOutput),
    inputTypes: node.data.inputs
      .filter((port) => !/^(AIModel|AIProvider|APIKey|CachedData)$/i.test(port.type))
      .map((port) => artifactTypeForPortType(port.type)),
    ...(instructions ? { instructions } : {}),
    successCriteria: [
      "Kết luận chỉ dựa trên bằng chứng đầu vào.",
      "Nêu rõ phần chưa đủ bằng chứng để kết luận.",
    ],
  });
}

/** Bọc kết quả AI trong Report thống nhất nhưng vẫn giữ trường output cũ cho workflow hiện hữu. */
function withAiTaskReport(result: unknown, task: TaskSpec, evidence: unknown[] = []): Record<string, unknown> {
  const value = record(result);
  const explicitEvidence = Array.isArray(value.evidence) ? value.evidence : evidence;
  const confidenceValue = Number(value.confidence);
  const passed = typeof value.passed === "boolean" ? value.passed : undefined;
  const needsFix = value.needsFix === true || value.status === "Cần sửa" || value.status === "Không đạt";
  const conclusion = String(value.summary ?? value.conclusion ?? value.text ?? value.output ?? "AI đã hoàn thành tác vụ; hãy xem bằng chứng trước khi dùng kết quả.").trim();
  const repairItems = Array.isArray(value.repairItems)
    ? value.repairItems.filter((item): item is { location?: string; reason: string; fix?: string } => Boolean(item) && typeof item === "object" && typeof (item as { reason?: unknown }).reason === "string")
    : [];
  return {
    ...value,
    taskSpec: task,
    report: aiReport({
      status: needsFix ? "needs-fix" : passed === true ? "completed" : "needs-review",
      conclusion,
      evidence: explicitEvidence,
      ...(Number.isFinite(confidenceValue) ? { confidence: confidenceValue } : {}),
      ...(passed === undefined ? {} : { passed }),
      needsFix,
      repairItems,
      task,
    }),
  };
}

async function executeAiRuntimeNode(node: WorkflowNodeLike, inputs: Record<string, unknown>, store: RuntimeFileStore): Promise<Record<string, unknown>> {
  const config = node.data.config ?? {};
  const settings = aiCallSettings(node, inputs);
  const usesConnectedAiModelOnly = ["Phân tích hình ảnh bằng AI", "Phân tích âm thanh bằng AI", "Phân tích video bằng AI"].includes(node.data.label);
  if (usesConnectedAiModelOnly && (!settings.provider || !settings.model || (settings.provider !== "Ollama" && !settings.apiKey))) {
    throw new Error(`${node.data.label} cần nối cổng AIModel từ node Thiết lập AI có nhà cung cấp, model${settings.provider === "Ollama" ? "" : " và API key"} hợp lệ.`);
  }
  if (!["OpenAI", "Ollama"].includes(settings.provider)) throw new Error(`Bộ thực thi trực tiếp hiện hỗ trợ OpenAI và Ollama; node đang chọn ${settings.provider}.`);
  if (settings.provider !== "Ollama" && !settings.apiKey) throw new Error("Chưa nhận được API key từ Thiết lập AI. Hãy nhập key hoặc nối cổng APIKey.");
  const materials = preferredAiMaterials(node, inputs);
  const cached = materials.record;
  const prompt = materials.source === "cache" ? cachedText(cached) : promptDataText(input(node, inputs, "Prompt") ?? cached.values[0]);
  const systemPrompt = promptDataText(input(node, inputs, "SystemPrompt"));
  const goal = String(config.analysisGoal === "Khác" ? config.customAnalysisGoal || "Phân tích nội dung" : config.analysisGoal || "");
  const requestText = `${systemPrompt}\n${goal}\n${prompt}`;

  if (node.data.label === "Gọi AI tạo văn bản" || node.data.label === "Gọi AI trả JSON") {
    if (prompt === "(Chưa có dữ liệu đầu vào)") throw new Error("Gọi AI cần Prompt.");
    const json = node.data.label === "Gọi AI trả JSON";
    const inputReserve = estimatedAiInputTokens(requestText);
    const maxOutputTokens = aiBudget(settings, inputReserve);
    const payload = await apiJson({ action: "ai", provider: settings.provider, apiKey: settings.apiKey, model: settings.model, temperature: settings.temperature, maxOutputTokens, system: `${systemPrompt}\n${json ? "Chỉ trả JSON hợp lệ, không dùng markdown." : ""}`, prompt, json, promptCacheKey: materials.record.cacheKey });
    const outputType = json ? "AIJson" : "AIText";
    const task = aiTaskSpecForNode(node, goal || (json ? "Tạo JSON từ prompt" : "Tạo văn bản từ prompt"), outputType);
    return withAiInputCache(node, outputType, withAiTaskReport(attachAiUsage(payload.result, payload.usage, settings, inputReserve), task), materials);
  }

  if (settings.provider === "Ollama") {
    throw new Error(`${node.data.label} hiện cần OpenAI vì tác vụ này gửi media trực tiếp. Ollama đã dùng được cho node Xử lý văn bản bằng AI (văn bản/JSON).`);
  }

  if (node.data.label === "Phân tích hình ảnh bằng AI") {
    if (openAiImageCapability(settings.model) === "unsupported") {
      throw new Error(`Model “${settings.model}” không hỗ trợ phân tích ảnh. Hãy chọn model có mục “Phân tích ảnh: Dùng được” trong Thiết lập AI.`);
    }
    const directFiles = assetFiles(input(node, inputs, "Image[]"), store);
    const files = materials.source === "cache" ? assetFiles(cached.values, store) : directFiles;
    if (!files.length) throw new Error("Phân tích hình ảnh bằng AI chưa nhận được Image[].");
    const aiFiles = await readLocalImagesForAi(files.slice(0, 12));
    const attention = materialValue(node, inputs, materials, "AttentionRegion");
    const visionPrompt = `${prompt}\n\n${attentionPrompt(attention)}`;
    const visionReserve = estimatedAiInputTokens(`${systemPrompt}\n${goal}\n${visionPrompt}`, aiFiles.length);
    const payload = await uploadFiles("analyze-images", aiFiles, { apiKey: settings.apiKey, model: settings.model, maxOutputTokens: aiBudget(settings, visionReserve), goal, detail: String(config.detail ?? "Cân bằng"), prompt: visionPrompt, system: systemPrompt, promptCacheKey: materials.record.cacheKey });
    const task = aiTaskSpecForNode(node, goal || "Phân tích hình ảnh", "AIAnalysis");
    return withAiInputCache(node, "AIAnalysis", withAiTaskReport(attachAiUsage(payload.result, payload.usage, settings, visionReserve), task, files.map((file) => ({ name: file.name, type: file.type }))), materials);
  }

  if (node.data.label === "Phân tích âm thanh bằng AI") {
    const directFiles = assetFiles(input(node, inputs, "Audio"), store);
    const files = materials.source === "cache" ? assetFiles(cached.values, store) : directFiles;
    if (!files.length) throw new Error("Phân tích âm thanh bằng AI chưa nhận được Audio.");
    const transcriptPayload = await uploadFiles("transcribe-media", files, { apiKey: settings.apiKey });
    const transcript = list<Record<string, unknown>>(transcriptPayload.transcripts).map((item) => String(item.text ?? "")).join("\n\n");
    const audioPrompt = `Mục tiêu: ${goal}\nYêu cầu: ${prompt}\n\nTRANSCRIPT ÂM THANH:\n${transcript.slice(0, 100000)}`;
    const audioReserve = estimatedAiInputTokens(`${systemPrompt}\n${audioPrompt}`);
    const payload = await apiJson({ action: "ai", apiKey: settings.apiKey, model: settings.model, maxOutputTokens: aiBudget(settings, audioReserve), json: true, system: `${systemPrompt}\nBạn là chuyên gia phân tích âm thanh. Chỉ kết luận từ transcript được cung cấp; không suy đoán hình ảnh hoặc chuyển động.`, prompt: audioPrompt, promptCacheKey: materials.record.cacheKey });
    const task = aiTaskSpecForNode(node, goal || "Phân tích âm thanh", "AIAnalysis");
    return withAiInputCache(node, "AIAnalysis", withAiTaskReport({ ...attachAiUsage(payload.result, payload.usage, settings, audioReserve), transcript, method: "audio-transcript+AI" }, task, [{ kind: "audio-transcript", characters: transcript.length }]), materials);
  }

  if (node.data.label === "Phân tích video bằng AI") {
    if (openAiImageCapability(settings.model) === "unsupported") {
      throw new Error(`Model “${settings.model}” không hỗ trợ phân tích frame. Hãy chọn model có mục “Phân tích ảnh: Dùng được” trong Thiết lập AI.`);
    }
    const frames = assetFiles(materialValue(node, inputs, materials, "Image[]"), store);
    const frameIndex = await frameIndexEntries(materialValue(node, inputs, materials, "FrameIndex"), store);
    const audioFiles = assetFiles(materialValue(node, inputs, materials, "Audio"), store);
    const timedTranscript = record(materialValue(node, inputs, materials, "TimedTranscript"));
    if (!frames.length) throw new Error("Phân tích video bằng AI cần Image[] (frame từ video).");
    if (!frameIndex.length) throw new Error("Phân tích video bằng AI cần FrameIndex chứa timeline JSON hợp lệ để gắn mỗi frame với timecode video.");
    if (!audioFiles.length) throw new Error("Phân tích video bằng AI cần Audio đã tách từ video.");
    // Nếu node chuẩn bị đã tạo transcript thì tái sử dụng nó, không gọi API
    // lần nữa. Trường hợp người dùng chọn Không transcript, phân tích video
    // vẫn có thể phiên âm Audio bằng API của node phân tích này.
    const hasTimedTranscript = Object.keys(timedTranscript).length > 0;
    const suppliedScriptText = hasTimedTranscript
      ? transcriptTextForRange(timedTranscript, 0, Number.MAX_SAFE_INTEGER)
      : "";
    if (hasTimedTranscript && !suppliedScriptText) throw new Error("TimedTranscript không có nội dung để phân tích.");
    const audioPayload = hasTimedTranscript ? null : await transcribeAudioForVideoAnalysis(audioFiles, settings.apiKey, config.language);
    const audioText = audioPayload
      ? list<Record<string, unknown>>(audioPayload.transcripts)
        .map((transcript) => String(transcript.text ?? "").trim())
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 12_000)
      : "";
    if (!hasTimedTranscript && !audioText) throw new Error("Không nhận được nội dung từ Audio để phân tích video.");
    const scriptText = suppliedScriptText || audioText;
    // API phân tích tối đa tám ảnh mỗi lượt. FrameIndex giữ thứ tự và timecode
    // tương ứng để AI không nhầm cảnh đang nhìn với mốc lời thoại.
    const aiFrames = await readLocalImagesForAi(frames.slice(0, 8));
    const frameTimeline = frameIndex.slice(0, aiFrames.length).map((frame, index) => ({
      frame: index + 1,
      fileName: String(frame.fileName ?? aiFrames[index]?.name ?? `frame-${index + 1}`),
      timestamp: Number(frame.timestamp ?? 0),
      timecode: String(frame.timecode ?? formatTimecode(Number(frame.timestamp ?? 0))),
      reason: String(frame.reason ?? "periodic"),
      changeScore: Number(frame.changeScore ?? 0),
    }));
    if (frameTimeline.length !== aiFrames.length) throw new Error("FrameIndex không khớp với số frame gửi phân tích.");
    const combinedTranscript = hasTimedTranscript
      ? `[TRANSCRIPT THEO TIMECODE]\n${scriptText}`
      : `[PHIÊN ÂM TỪ AUDIO ĐẦU VÀO]\n${audioText}`;
    const videoPrompt = hasTimedTranscript
      ? `${prompt}\n\nMỗi frame gửi kèm có timecode chính xác trong FrameIndex. Phải đối chiếu frame với transcript theo timecode. Nếu bằng chứng mâu thuẫn, nêu rõ mâu thuẫn thay vì tự suy đoán.`
      : `${prompt}\n\nMỗi frame gửi kèm có timecode chính xác trong FrameIndex. Phải đối chiếu frame với phần phiên âm từ audio. Nêu rõ các timecode chỉ là ước lượng khi transcript không được chuẩn bị sẵn.`;
    const timeline = { frames: frameTimeline, transcriptSegments: list<Record<string, unknown>>(timedTranscript.segments) };
    const videoReserve = estimatedAiInputTokens(`${systemPrompt}\n${goal}\n${videoPrompt}\n${JSON.stringify(timeline)}\n${combinedTranscript}`, aiFrames.length);
    const payload = await uploadFiles("analyze-video-frames", aiFrames, {
      apiKey: settings.apiKey,
      model: settings.model,
      maxOutputTokens: aiBudget(settings, videoReserve),
      detail: String(config.detail ?? "low"),
      goal,
      instructions: videoPrompt,
       timeline: JSON.stringify(timeline),
      transcript: combinedTranscript,
      promptCacheKey: materials.record.cacheKey,
    });
    const analysis = attachAiUsage(payload.result, payload.usage, settings, videoReserve);
    const task = aiTaskSpecForNode(node, goal || "Phân tích video", "AIAnalysis");
    return withAiInputCache(node, "AIAnalysis", withAiTaskReport({
      ...analysis,
       method: hasTimedTranscript ? "frames + supplied-timed-transcript" : "frames + audio-transcript",
      evidence: {
        frameCount: aiFrames.length,
         frameIndexEntries: frameTimeline.length,
        audioFileCount: audioFiles.length,
         timedTranscriptSegments: list<Record<string, unknown>>(timedTranscript.segments).length,
        audioTranscriptCharacters: audioText.length,
      },
    }, task, frameTimeline), materials);
  }
  throw new Error(`Node AI “${node.data.label}” chưa có bộ thực thi`);
}

function executeAiReviewNode(node: WorkflowNodeLike, inputs: Record<string, unknown>): Record<string, unknown> {
  const config = node.data.config;
  const outputInput = node.data.inputs.find((port) => /AIText|AIJson|AIAnalysis/.test(port.type));
  const value = outputInput ? inputs[outputInput.id] : undefined;
  if (value === undefined || value === null || value === "") throw new Error(`${node.data.label} chưa nhận được đầu ra AI để đánh giá.`);

  if (node.data.label === "Chấm điểm đầu ra AI") {
    const content = promptDataText(value);
    const criteria = lines(config.criteria).length ? lines(config.criteria) : ["Đúng yêu cầu", "Tính chính xác", "Rõ ràng"];
    const objectBonus = value && typeof value === "object" ? 18 : 0;
    const score = Math.min(100, Math.round(45 + Math.min(35, content.length / 80) + objectBonus));
    const minimumScore = Number(config.minimumScore ?? 70);
    return output(node, {
      score,
      minimumScore,
      passed: score >= minimumScore,
      criteria,
      feedback: score >= minimumScore ? "Đầu ra có đủ thông tin cơ bản theo các tiêu chí đã chọn." : "Đầu ra cần bổ sung chi tiết hoặc làm rõ trước khi duyệt.",
      evaluatedType: String(outputInput?.type ?? "AI output"),
    });
  }

  const score = record(input(node, inputs, "AIScore"));
  const minimumScore = Number(config.minimumScore ?? score.minimumScore ?? 70);
  const approved = config.approvalMode === "Luôn từ chối để chỉnh sửa" ? false
    : config.approvalMode === "Luôn cần duyệt thủ công" ? false
      : Number(score.score ?? 0) >= minimumScore;
  return output(node, {
    approved,
    requiresManualReview: config.approvalMode === "Luôn cần duyệt thủ công",
    score: Number(score.score ?? 0),
    minimumScore,
    approvalNote: String(config.approvalNote ?? ""),
    result: value,
  });
}

function executeCanvasDataViewer(node: WorkflowNodeLike, inputs: Record<string, unknown>): Record<string, unknown> {
  const value = Object.values(inputs)[0];
  if (value === undefined || value === null || value === "") {
    throw new Error("Xem dữ liệu trên canvas chưa nhận được dữ liệu đầu vào.");
  }
  return { viewed: value, viewedAt: new Date().toISOString(), nodeId: node.id };
}

async function executeFileNamingNode(
  node: WorkflowNodeLike,
  inputs: Record<string, unknown>,
  store: RuntimeFileStore,
): Promise<Record<string, unknown>> {
  const value = input(node, inputs, "Dữ liệu") ?? Object.values(inputs)[0];
  const namingPattern = String((node.data.config ?? {}).namingPattern ?? "#file-name#");
  const sourcePortName = inputSourceName(node, inputs, "Dữ liệu");
  // Bản ghi FrameIndex cố ý tham chiếu runtimeKey/fileIndex của ảnh để AI đối
  // chiếu timecode. Đó là metadata, không phải tín hiệu phải lưu các JPG đó.
  const entries = isFrameIndexSource(sourcePortName) ? [] : localNamedFiles(value, store);
  if (!entries.length) {
    // FrameIndex là một timeline duy nhất gồm nhiều frame, không phải nhiều
    // file độc lập. Lưu nó thành một frameindex.json để tái dùng chính xác.
    const inlineEntries = isFrameIndexSource(sourcePortName)
      ? frameIndexStorageFile(value, namingPattern)
      : inlineStorageFiles(value, namingPattern, sourcePortName ?? "undefine");
    if (!inlineEntries.length) throw new Error("Đặt tên cần nhận Dữ liệu hoặc file cục bộ.");
    return output(node, inlineEntries);
  }
  const runtimeKey = `${node.id}:named-files`;
  const files = entries.map((entry) => entry.file);
  store.set(runtimeKey, files);
  return output(node, runtimeAssets(runtimeKey, files).map((asset) => ({ ...asset, namingPattern })));
}

async function executeFileStorageNode(
  node: WorkflowNodeLike,
  inputs: Record<string, unknown>,
  store: RuntimeFileStore,
): Promise<Record<string, unknown>> {
  const persistedStoredFiles = Array.isArray(node.data.storedFiles)
    ? node.data.storedFiles.filter((item) => item && typeof item.filePath === "string" && item.filePath)
    : [];
  const storedRuntimeKey = `${node.id}:stored-files`;
  const dataPort = node.data.inputs.find((port) => port.type !== "Folder");
  const fileInput = input(node, inputs, "NamedFile hoặc Dữ liệu")
    ?? (dataPort ? inputs[dataPort.id] : undefined);
  const sourcePortName = inputSourceName(node, inputs, "NamedFile hoặc Dữ liệu")
    ?? (dataPort ? inputSourceName(node, inputs, dataPort.type) : undefined)
    ?? "data";
  const hasIncomingData = fileInput !== undefined;

  // Không có dữ liệu mới + còn Stored file: Lưu file chính là node đầu vào,
  // chỉ trả lại những file đã liên kết, không chạy đặt tên hay ghi đè lần nữa.
  if (!hasIncomingData && persistedStoredFiles.length) {
    const runtimeFiles = store.get(storedRuntimeKey) ?? [];
    if (runtimeFiles.length) return output(node, runtimeAssets(storedRuntimeKey, runtimeFiles));
    return output(node, persistedStoredFiles.map((item, fileIndex) => ({
      localPath: item.filePath,
      runtimeKey: storedRuntimeKey,
      fileIndex,
      name: item.name,
      size: item.size,
      type: item.type,
      pathOnly: true,
    })));
  }
  const entries = isFrameIndexSource(sourcePortName) ? [] : localNamedFiles(fileInput, store);
  const inlineEntries = entries.length ? [] : isFrameIndexSource(sourcePortName)
    ? frameIndexStorageFile(fileInput)
    : inlineStorageFiles(fileInput, "#file-name#", sourcePortName);
  if (!entries.length && !inlineEntries.length) throw new Error("Lưu file cần nhận Dữ liệu hoặc file cục bộ từ cổng NamedFile.");
  const folderValue = input(node, inputs, "Folder");
  if (folderValue !== undefined && typeof folderValue !== "string") {
    throw new Error("Cổng Folder của Lưu file phải nhận một đường dẫn thư mục từ node Nguồn folder.");
  }
  const folderFromPort = (folderValue ?? "").trim();
  const folderFromNode = String((node.data.config ?? {}).localFolder ?? "").trim();
  if (folderFromPort && folderFromNode) throw new Error("Lưu file chỉ nhận một vị trí lưu: chọn trong node hoặc nối cổng Folder.");
  const outputFolder = folderFromPort || folderFromNode;
  if (!outputFolder) throw new Error("Lưu file cần chọn thư mục trong node hoặc nối cổng Folder.");
  // Cổng ra giữ vai trò nhận diện lô khi lưu nhiều file. Tên file thật vẫn
  // được dùng cho mẫu tên của từng file, nhưng không còn làm nhầm tên folder.
  const localEntries = await Promise.all(entries.map((entry, index) => localStorageRequestFile(entry, index, sourcePortName)));
  const saved = await localMediaJson<{ files?: Array<{ filePath?: string; bytes?: number; fileName?: string; sourcePath?: string }> }>("/store-files", {
    outputFolder,
    duplicateMode: (node.data.config ?? {}).duplicateMode === "Ghi đè" ? "overwrite" : "new",
    files: [
      ...localEntries,
      ...inlineEntries.map((entry, index) => ({
        inlineContent: entry.inlineContent,
        sourceName: entry.sourceName,
        sourceExtension: entry.sourceExtension,
        sourcePortName,
        namingPattern: entry.namingPattern || "#file-name#",
        stt: entries.length + index + 1,
      })),
    ],
  }, "Dịch vụ media không lưu được file.");
  if (!saved.files?.length || saved.files.some((item) => !item.filePath)) throw new Error("Dịch vụ media không trả về file đã lưu.");
  const runtimeKey = `${node.id}:stored-files`;
  const savedFiles = saved.files.map((item) => {
    const file = localOutputFile(String(item.filePath)) as File & { contentFlowSize?: number; contentFlowPathOnly?: boolean };
    file.contentFlowSize = Number(item.bytes) || file.size;
    file.contentFlowPathOnly = true;
    return file;
  });
  // Dữ liệu mới không thay thế Stored file cũ. Gộp theo đường dẫn để có thể
  // chạy nhiều lượt lưu mà không nhân bản những file đã liên kết trước đó.
  const previousFiles = store.get(storedRuntimeKey) ?? persistedStoredFiles.map((item) => {
    const file = localOutputFile(item.filePath) as File & { contentFlowSize?: number; contentFlowPathOnly?: boolean };
    file.contentFlowSize = item.size;
    file.contentFlowPathOnly = true;
    return file;
  });
  const files = [...previousFiles, ...savedFiles].filter((file, index, all) => {
    const identity = file.contentFlowPath ?? `${file.name}:${file.size}`;
    return all.findIndex((candidate) => (candidate.contentFlowPath ?? `${candidate.name}:${candidate.size}`) === identity) === index;
  });
  store.set(runtimeKey, files);
  return output(node, runtimeAssets(runtimeKey, files));
}

// Các thao tác dựng dưới đây chỉ nhận file đã chọn từ máy. Đường dẫn được giữ
// trong RuntimeFileStore, không đưa video/nhạc lên dịch vụ AI hay dùng output giả.
async function executeLocalMediaNode(
  node: WorkflowNodeLike,
  inputs: Record<string, unknown>,
  store: RuntimeFileStore,
): Promise<Record<string, unknown>> {
  const config = node.data.config;
  const firstInput = Object.values(inputs)[0];
  const videos = localPathFiles(
    input(node, inputs, "Video") ?? input(node, inputs, "Video[]") ?? input(node, inputs, "Timeline") ?? firstInput,
    store,
  );
  if (!videos.length) throw new Error(`${node.data.label} cần video cục bộ được chọn từ node đầu vào.`);

  let rendered: { filePath: string; fileName: string; bytes: number; operation: string };
  if (node.data.label === "Cắt video") {
    rendered = await renderLocalVideo("trim", {
      videoPaths: [videos[0].contentFlowPath],
      startSeconds: Number(config.startSeconds ?? 0),
      endSeconds: Number(config.endSeconds ?? 0),
      outputName: config.outputName,
      outputFolder: config.localFolder,
    });
  } else if (["Nối video", "Ghép các cảnh"].includes(node.data.label)) {
    rendered = await renderLocalVideo("concat", {
      videoPaths: videos.map((file) => file.contentFlowPath), outputName: config.outputName, outputFolder: config.localFolder,
    });
  } else if (node.data.label === "Thêm nhạc nền") {
    const audio = localPathFiles(input(node, inputs, "Audio") ?? Object.values(inputs)[1], store);
    if (!audio.length) throw new Error("Thêm nhạc nền cần một file âm thanh cục bộ từ node đầu vào.");
    rendered = await renderLocalVideo("mix-audio", {
      videoPaths: [videos[0].contentFlowPath], audioPaths: audio.map((file) => file.contentFlowPath),
      volumePercent: Number(config.volumePercent ?? 30), outputName: config.outputName, outputFolder: config.localFolder,
    });
  } else {
    rendered = await renderLocalVideo("save", {
      videoPaths: [videos[0].contentFlowPath], outputName: config.outputName, outputFolder: config.localFolder,
    });
  }

  const runtimeKey = `${node.id}:rendered`;
  const file = localOutputFile(rendered.filePath);
  store.set(runtimeKey, [file]);
  const asset = runtimeAssets(runtimeKey, [file]);
  return output(node, { ...rendered, asset: asset[0], renderedAt: new Date().toISOString() });
}

function thumbnailTitle(value: unknown): string {
  const candidates = arrayFrom(value, ["titles", "items", "suggestions"]);
  for (const candidate of candidates) {
    const item = record(candidate);
    const title = String(item.title ?? item.text ?? candidate ?? "").trim();
    if (title) return title;
  }
  const item = record(value);
  return String(item.title ?? item.text ?? "").trim();
}

function thumbnailResult(value: unknown): Record<string, unknown> {
  const source = record(value);
  if (typeof source.text !== "string") return source;
  try {
    const parsed = JSON.parse(source.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
    return record(parsed);
  } catch {
    return source;
  }
}

async function executeThumbnailNode(
  node: WorkflowNodeLike,
  inputs: Record<string, unknown>,
  store: RuntimeFileStore,
): Promise<Record<string, unknown>> {
  const config = node.data.config;
  const settings = aiCallSettings(node, inputs);
  if (node.data.label === "Tạo tiêu đề") {
    const materials = preferredAiMaterials(node, inputs);
    if (settings.provider !== "OpenAI") throw new Error(`Tạo tiêu đề hiện hỗ trợ OpenAI; node đang chọn ${settings.provider}.`);
    if (!settings.apiKey) throw new Error("Tạo tiêu đề cần API key từ Thiết lập AI.");
    const source = contentText(materialValue(node, inputs, materials, "Script") ?? materialValue(node, inputs, materials, "Text") ?? cachedText(materials.record));
    if (!source) throw new Error("Tạo tiêu đề cần bản tóm tắt hoặc Script đầu vào.");
    const titlePrompt = `Tạo ${Math.max(1, Number(config.suggestionCount) || 5)} tiêu đề YouTube, mỗi tiêu đề không quá ${Math.max(20, Number(config.maxTitleLength) || 80)} ký tự. Từ khóa bắt buộc: ${String(config.keywords ?? "không có")}. Yêu cầu: ${String(config.instructions ?? "rõ ràng, hấp dẫn vừa phải")}.\n\nBản tóm tắt:\n${source}\n\nTrả về {"titles":[{"title":"","reason":""}]}.`;
    const titleReserve = estimatedAiInputTokens(`Bạn là biên tập viên YouTube Việt Nam. Chỉ dùng dữ liệu được cung cấp, không hứa hẹn sai sự thật.\n${titlePrompt}`);
    const payload = await apiJson({
      action: "ai", apiKey: settings.apiKey, model: settings.model, maxOutputTokens: aiBudget(settings, titleReserve), json: true,
      system: "Bạn là biên tập viên YouTube Việt Nam. Chỉ dùng dữ liệu được cung cấp, không hứa hẹn sai sự thật.",
      prompt: titlePrompt,
      promptCacheKey: materials.record.cacheKey,
    });
    const raw = thumbnailResult(payload.result);
    const titles = arrayFrom(raw.titles ?? payload.result, ["titles", "items", "suggestions"])
      .map((item) => ({ title: thumbnailTitle(item), reason: String(record(item).reason ?? "") })).filter((item) => item.title);
    if (!titles.length) throw new Error("AI không trả về tiêu đề hợp lệ.");
    return withAiInputCache(node, "Title[]", attachAiUsage({ titles, selectedTitle: titles[0].title }, payload.usage, settings, titleReserve), materials);
  }

  if (node.data.label === "Chọn ảnh thumbnail bằng AI") {
    const materials = preferredAiMaterials(node, inputs);
    if (settings.provider !== "OpenAI") throw new Error(`Chọn ảnh thumbnail bằng AI hiện hỗ trợ OpenAI; node đang chọn ${settings.provider}.`);
    if (!settings.apiKey) throw new Error("Chọn ảnh thumbnail bằng AI cần API key từ Thiết lập AI.");
    const imageInput = materialValue(node, inputs, materials, "Image[]");
    const sourceImages = assetFiles(imageInput, store);
    if (!sourceImages.length) throw new Error("Chọn ảnh thumbnail bằng AI chưa nhận được kho Image[].");
    const analysis = promptDataText(materialValue(node, inputs, materials, "VideoAnalysis") ?? cachedText(materials.record));
    const terms = analysis.toLocaleLowerCase("vi-VN").split(/[^\\p{L}\\p{N}]+/u).filter((term) => term.length >= 4).slice(0, 160);
    const maxCandidates = Math.max(1, Math.min(12, Number(config.maxCandidates) || 4));
    const candidates = [...sourceImages].sort((left, right) => {
      const score = (file: File) => terms.reduce((total, term) => total + (file.name.toLocaleLowerCase("vi-VN").includes(term) ? 1 : 0), 0);
      return score(right) - score(left) || left.name.localeCompare(right.name, "vi");
    }).slice(0, maxCandidates);
    const aiImages = await readLocalImagesForAi(candidates);
    const candidateNames = candidates.map((file, index) => `${index + 1}. ${file.name}`).join("\n");
    const selectionPrompt = `Tóm tắt video:\n${analysis.slice(0, 12_000)}\n\nCác ảnh ứng viên theo đúng thứ tự gửi AI:\n${candidateNames}\n\nChọn đúng MỘT fileName trong danh sách. Ưu tiên ảnh có chủ thể rõ, đúng khoảnh khắc/nội dung, còn vùng đặt chữ và không gây hiểu sai. Yêu cầu thêm: ${String(config.instructions ?? "Không có")}. Trả về {"fileName":"","reason":"","suggestedText":""}.`;
    const reserve = estimatedAiInputTokens(`Bạn là biên tập viên thumbnail YouTube. Chỉ được chọn một ảnh trong danh sách tên được cung cấp. Trả về JSON hợp lệ.\n${selectionPrompt}`, aiImages.length);
    const payload = await uploadFiles("analyze-images", aiImages, {
      apiKey: settings.apiKey, model: settings.model, maxOutputTokens: aiBudget(settings, reserve), detail: String(config.detail ?? "low"),
      system: "Bạn là biên tập viên thumbnail YouTube. Chỉ được chọn một ảnh trong danh sách tên được cung cấp. Trả về JSON hợp lệ.", goal: "Chọn ảnh thumbnail", prompt: selectionPrompt,
      promptCacheKey: materials.record.cacheKey,
    });
    const selection = thumbnailResult(payload.result);
    const requestedName = String(selection.fileName ?? selection.name ?? "").trim().toLocaleLowerCase("vi-VN");
    const selectedIndex = candidates.findIndex((file) => file.name.toLocaleLowerCase("vi-VN") === requestedName);
    if (selectedIndex < 0) throw new Error("AI không trả về fileName trùng một ảnh ứng viên; không tự chọn ảnh thay thế để tránh tạo thumbnail sai.");
    const selectedFile = candidates[selectedIndex];
    const runtimeKey = `${node.id}:selected-thumbnail-image`;
    store.set(runtimeKey, [selectedFile]);
    const [asset] = runtimeAssets(runtimeKey, [selectedFile]);
    const usage = attachAiUsage({ selectedFileName: selectedFile.name, reason: String(selection.reason ?? ""), suggestedText: String(selection.suggestedText ?? "") }, payload.usage, settings, reserve);
    return withAiInputCache(node, "Image[]", [{ ...asset, selection: usage }], materials);
  }

  if (node.data.label === "Bố cục thumbnail bằng AI") {
    const materials = preferredAiMaterials(node, inputs);
    if (settings.provider !== "OpenAI") throw new Error(`Bố cục thumbnail hiện hỗ trợ OpenAI; node đang chọn ${settings.provider}.`);
    if (!settings.apiKey) throw new Error("Bố cục thumbnail cần API key từ Thiết lập AI.");
    const imageInput = materialValue(node, inputs, materials, "Image[]");
    const images = assetFiles(imageInput, store);
    const selectedImage = list<Record<string, unknown>>(imageInput)[0];
    const chosenTitle = String(record(selectedImage?.selection).suggestedText ?? "").trim();
    const title = thumbnailTitle(materialValue(node, inputs, materials, "Title[]") ?? materialValue(node, inputs, materials, "Text")) || chosenTitle;
    if (!images.length) throw new Error("Bố cục thumbnail cần ít nhất một ảnh đầu vào.");
    if (!title) throw new Error("Bố cục thumbnail cần Title[] từ node Tạo tiêu đề, hoặc suggestedText từ node Chọn ảnh thumbnail bằng AI.");
    const layoutPrompt = `Tiêu đề cần đặt: ${title}\nPhong cách: ${String(config.style ?? "Nổi bật YouTube")}\nYêu cầu thêm: ${String(config.instructions ?? "không che chủ thể chính")}\nTrả về {"position":"top-left|top-center|top-right|center-left|center|center-right|bottom-left|bottom-center|bottom-right","fontSize":72,"textColor":"#FFFFFF","boxColor":"#000000","boxOpacity":0.65,"alignment":"left|center|right","title":"${title}"}.`;
    const aiImages = await readLocalImagesForAi(images.slice(0, 1));
    const layoutReserve = estimatedAiInputTokens(`Bạn là nhà thiết kế thumbnail YouTube. Chỉ chọn bố cục dựa trên ảnh thật. Trả về JSON hợp lệ.\n${layoutPrompt}`, aiImages.length);
    const payload = await uploadFiles("analyze-images", aiImages, {
      apiKey: settings.apiKey, model: settings.model, maxOutputTokens: aiBudget(settings, layoutReserve), detail: String(config.detail ?? "auto"),
      system: "Bạn là nhà thiết kế thumbnail YouTube. Chỉ chọn bố cục dựa trên ảnh thật. Trả về JSON hợp lệ.",
      goal: "Đề xuất bố cục chữ thumbnail",
      prompt: layoutPrompt,
      promptCacheKey: materials.record.cacheKey,
    });
    const parsedLayout = thumbnailResult(payload.result);
    const layout = Array.isArray(payload.result) ? record(payload.result[0]) : parsedLayout;
    const rawPosition = layout.position;
    const coordinate = record(rawPosition);
    const normalizedFromCoordinates = Object.keys(coordinate).length
      ? `${Number(coordinate.y ?? 50) < 34 ? "top" : Number(coordinate.y ?? 50) > 66 ? "bottom" : "center"}-${Number(coordinate.x ?? 50) < 34 ? "left" : Number(coordinate.x ?? 50) > 66 ? "right" : "center"}`.replace("center-center", "center")
      : "";
    const position = /^(top|center|bottom)-(left|center|right)$|^center$/.test(String(rawPosition ?? "")) ? String(rawPosition) : normalizedFromCoordinates || "bottom-left";
    return withAiInputCache(node, "ThumbnailLayout", attachAiUsage({ ...layout, position, originalPosition: rawPosition, title: String(layout.title ?? title), generatedFrom: images[0].name }, payload.usage, settings, layoutReserve), materials);
  }

  const images = localPathFiles(input(node, inputs, "Image[]"), store);
  const layout = record(input(node, inputs, "ThumbnailLayout") ?? Object.values(inputs)[1]);
  if (!images.length) throw new Error("Ghép chữ lên thumbnail cần ảnh cục bộ từ node đầu vào.");
  const title = String(layout.title ?? "").trim();
  if (!title) throw new Error("Ghép chữ lên thumbnail cần ThumbnailLayout chứa tiêu đề.");
  const rendered = await renderThumbnail({ imagePath: images[0].contentFlowPath, layout, title, outputName: config.outputName, outputFolder: config.localFolder });
  const runtimeKey = `${node.id}:thumbnail`;
  const file = localOutputFile(rendered.filePath);
  store.set(runtimeKey, [file]);
  return output(node, { ...rendered, asset: runtimeAssets(runtimeKey, [file])[0], layout, renderedAt: new Date().toISOString() });
}

function basicStepProgressDetail(label: string, config: Record<string, FieldValue> = {}): string {
  if (label === "Trích frame từ video") return "Đang đọc video và trích các frame theo khoảng thời gian đã chọn.";
  if (label === "Tách âm thanh từ video") return "Đang dùng FFmpeg tách audio từ video trên máy.";
  if (label === "Tạo transcript video theo thời gian") {
    return config.transcriptMode === "Transcript cục bộ"
      ? "Đang chuẩn hóa audio và chạy Whisper cục bộ; lần đầu có thể tải model vào cache."
      : "Đang chuẩn hóa audio và gửi yêu cầu transcript bằng API.";
  }
  return `Đang xử lý ${label} trên máy.`;
}

async function executeBasicWorkflowNode(
  node: WorkflowNodeLike,
  inputs: Record<string, unknown>,
  store: RuntimeFileStore,
  reportProgress?: ProgressReporter,
): Promise<Record<string, unknown>> {
  const allSteps = node.data.basicSteps ?? [];
  // Workflow cũ có thể chưa lưu trường config. Luôn dùng một cấu hình rỗng
  // thay vì để node Cơ bản lỗi nội bộ trước khi kịp báo thiếu dữ liệu thực tế.
  const nodeConfig = node.data.config ?? {};
  const operation = String(nodeConfig.basicOperation ?? node.data.basicNodeLabels?.[0] ?? "");
  const selectedTranscriptMode = String(nodeConfig.transcriptMode ?? "");
  if (node.data.basicPresetId === "prepare-video-analysis" && !["Không transcript", "Transcript cục bộ", "Transcript bằng API"].includes(selectedTranscriptMode)) {
    throw new Error("Hãy chọn Transcript: Không transcript, Transcript cục bộ hoặc Transcript bằng API.");
  }
  const selectedSteps = node.data.basicMode === "choice"
    ? allSteps.filter((step) => (step.operation ?? step.label) === operation || step.label === operation).slice(0, 1)
    : allSteps;
  const steps = node.data.basicPresetId === "prepare-video-analysis" && selectedTranscriptMode === "Không transcript"
    ? selectedSteps.filter((step) => step.label !== "Tạo transcript video theo thời gian")
    : selectedSteps;
  if (!steps.length) throw new Error(`Khối cơ bản “${node.data.label}” chưa có thao tác để chạy`);

  const pool: Array<{ type: string; value: unknown; sourceName?: string }> = node.data.inputs.flatMap((port) => (
    inputs[port.id] === undefined ? [] : [{ type: port.type, value: inputs[port.id], sourceName: inputSourceName(node, inputs, port.type) }]
  ));

  let lastStepResult: Record<string, unknown> = {};
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    reportProgress?.({
      current: index + 1,
      total: steps.length,
      message: `Bước ${index + 1}/${steps.length}: ${step.label}`,
      detail: basicStepProgressDetail(step.label, nodeConfig),
    });
    const stepInputs: Record<string, unknown> = {};
    const stepInputSources: Record<string, { outputName: string }> = {};
    for (const port of step.inputs) {
      const candidates = [...pool].reverse();
      const match = candidates.find((item) => exactPortTypeMatch(item.type, port.type))
        ?? candidates.find((item) => compatiblePortTypes(item.type, port.type));
      if (match) {
        stepInputs[port.id] = match.value;
        if (match.sourceName) stepInputSources[port.id] = { outputName: match.sourceName };
      }
    }
    if (Object.keys(stepInputSources).length) stepInputs[INPUT_SOURCE_METADATA_KEY] = stepInputSources;
    const virtualNode: WorkflowNodeLike = {
      id: `${node.id}::${index + 1}`,
      data: {
        kind: step.kind,
        label: step.label,
        category: step.category,
        inputs: step.inputs,
        outputs: step.outputs,
        config: { ...step.config, ...nodeConfig },
        // Lưu file Cơ bản chạy qua virtual step. Mang Stored file của node cha
        // xuống bước này để nó có thể hoặc tái dùng, hoặc cộng dồn file mới.
        ...(step.label === "Lưu file" ? { storedFiles: node.data.storedFiles } : {}),
      },
    };
    for (const [runtimeKey, files] of [...store.entries()]) {
      if (runtimeKey.startsWith(`${node.id}:`) && !runtimeKey.startsWith(`${node.id}::`)) {
        store.set(`${virtualNode.id}:${runtimeKey.slice(node.id.length + 1)}`, files);
      }
    }
    let result: Record<string, unknown>;
    try {
      result = await executeWorkflowNode(virtualNode, stepInputs, store, reportProgress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const inner = error as DiagnosableExecutionError;
      const wrapped = new Error(`Bước ${index + 1}/${steps.length} “${step.label}”: ${message}`) as DiagnosableExecutionError;
      wrapped.executionDiagnostic = inner.executionDiagnostic ?? diagnosticFor(error, {
        executor: "Khối cơ bản",
        workflowNodeId: node.id,
        workflowNodeFamily: node.data.family ?? node.data.label,
        step: index + 1,
        stepLabel: step.label,
        stepKind: step.kind,
        outerConfigKeys: Object.keys(nodeConfig),
        stepConfigKeys: Object.keys(step.config ?? {}),
        virtualConfigKeys: Object.keys(virtualNode.data.config ?? {}),
        receivedInputs: node.data.inputs.map((port) => ({ type: port.type, received: inputs[port.id] !== undefined })),
      });
      throw wrapped;
    }
    lastStepResult = result;
    // Đặt tên chỉ bổ sung metadata tên, không tạo một nguồn dữ liệu mới. Giữ
    // nhãn cổng ban đầu để Lưu file còn đặt đúng tên folder của lô (image,
    // frameindex, audio...), thay vì rơi về giá trị dự phòng "data".
    const passthroughSourceName = step.label === "Đặt tên"
      ? Object.values(stepInputSources)[0]?.outputName
      : undefined;
    for (const port of step.outputs) {
      if (result[port.id] !== undefined) {
        pool.push({ type: port.type, value: result[port.id], sourceName: passthroughSourceName });
      }
    }
    reportProgress?.({
      current: index + 1,
      total: steps.length,
      message: `Đã xong bước ${index + 1}/${steps.length}: ${step.label}`,
      detail: index + 1 < steps.length ? "Đang chuẩn bị bước tiếp theo..." : "Đang tổng hợp đầu ra của node.",
    });
  }

  const result: Record<string, unknown> = {};
  for (const port of node.data.outputs) {
    // Lưu file luôn phải trả lại file vừa được lưu. Nếu chỉ dò hợp đồng cổng
    // (ví dụ Audio), pool còn chứa cả audio gốc và UI sẽ nhầm nó là file mới.
    if (node.data.basicPresetId === "data-save-file") {
      const saved = Object.values(lastStepResult)[0];
      if (saved !== undefined) result[port.id] = saved;
      continue;
    }
    const match = [...pool].reverse().find((item) => compatiblePortTypes(item.type, port.type));
    if (match) {
      result[port.id] = match.value;
      continue;
    }
  }
  // Node đầu cuối không có cổng ra; vẫn trả lại kết quả của bước cuối để canvas
  // có thể render preview, thay vì coi đó là lỗi không có output.
  if (!node.data.outputs.length) return lastStepResult;
  if (!Object.keys(result).length) throw new Error(`Khối cơ bản “${node.data.label}” không tạo được đầu ra phù hợp`);
  return result;
}

/**
 * Chạy một workflow đã được gọi như một node. Runner không cập nhật React state;
 * workflow cha chịu trách nhiệm hiển thị tiến trình/cảnh báo, còn runner giữ dữ
 * liệu thuần để workflow con có thể được tái sử dụng ở nhiều canvas.
 */
export async function executeCalledWorkflow(
  workflow: WorkflowDocumentLike,
  callerInputs: Record<string, unknown>,
  store: RuntimeFileStore,
  runtime: WorkflowCallRuntime = {},
  reportProgress?: ProgressReporter,
): Promise<Record<string, unknown>> {
  if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges)) throw new Error("Workflow cần gọi không có cấu trúc node/dây hợp lệ.");
  const activeNodes = workflow.nodes;
  const remaining = new Set(activeNodes.map((node) => node.id));
  const completed = new Set<string>();
  const outputsByNode = new Map<string, Record<string, unknown>>();
  const inputsByNode = new Map<string, Record<string, unknown>>();
  const familyOf = (node: WorkflowNodeLike) => node.data.family || node.data.label;

  while (remaining.size) {
    const ready = activeNodes.find((node) => remaining.has(node.id) && workflow.edges
      .filter((edge) => edge.target === node.id)
      .every((edge) => completed.has(edge.source)));
    if (!ready) throw new Error("Workflow cần gọi có vòng lặp hoặc phụ thuộc dữ liệu không thể hoàn tất.");

    const nodeInputs: Record<string, unknown> = {};
    // Cổng vào không có dây vào trong workflow con: caller cấp thẳng dữ liệu
    // bằng cùng ID cổng ổn định mà node Gọi workflow công bố.
    if (familyOf(ready) === "Cổng vào") Object.assign(nodeInputs, callerInputs);
    for (const edge of workflow.edges.filter((item) => item.target === ready.id)) {
      if (!edge.targetHandle || !edge.sourceHandle) continue;
      const sourceOutput = outputsByNode.get(edge.source);
      if (sourceOutput && Object.prototype.hasOwnProperty.call(sourceOutput, edge.sourceHandle)) {
        nodeInputs[edge.targetHandle] = sourceOutput[edge.sourceHandle];
      }
    }
    const missing = ready.data.inputs.filter((port) => port.required && nodeInputs[port.id] === undefined);
    if (missing.length) throw new Error(`Workflow cần gọi: node “${ready.data.label}” thiếu đầu vào bắt buộc: ${missing.map((port) => port.type).join(", ")}.`);

    reportProgress?.({
      current: completed.size + 1,
      total: activeNodes.length,
      message: `Đang chạy workflow con: ${ready.data.label}`,
      detail: `Hoàn tất ${completed.size}/${activeNodes.length} node trong workflow được gọi.`,
    });
    const output = familyOf(ready) === "Gọi workflow"
      ? runtime.callWorkflow
        ? await runtime.callWorkflow(ready, nodeInputs)
        : (() => { throw new Error("Workflow cần gọi lồng một workflow khác nhưng runner chưa có bộ phân giải workflow."); })()
      : await executeWorkflowNode(ready, nodeInputs, store, reportProgress);
    inputsByNode.set(ready.id, nodeInputs);
    outputsByNode.set(ready.id, output);
    completed.add(ready.id);
    remaining.delete(ready.id);
  }

  const result: Record<string, unknown> = {};
  for (const outputGateway of activeNodes.filter((node) => familyOf(node) === "Cổng ra")) {
    const gatewayInputs = inputsByNode.get(outputGateway.id) ?? {};
    for (const port of outputGateway.data.inputs) {
      if (gatewayInputs[port.id] !== undefined) result[port.id] = gatewayInputs[port.id];
    }
  }
  return result;
}

export async function executeWorkflowNode(
  node: WorkflowNodeLike,
  inputs: Record<string, unknown>,
  store: RuntimeFileStore,
  reportProgress?: ProgressReporter,
): Promise<Record<string, unknown>> {
  // Đây là cổng chuẩn hóa chung cho toàn bộ executor. Workflow tạo từ các bản
  // cũ có thể không có object config; từ đây trở xuống, không node nào được
  // phép vỡ vì đọc một trường cấu hình (như transcriptMode) trên undefined.
  if (!node.data.config) {
    return executeWorkflowNode({ ...node, data: { ...node.data, config: {} } }, inputs, store, reportProgress);
  }
  // Tên trên canvas là do người dùng đặt. Bộ thực thi chỉ nhận diện Họ bất biến,
  // nhờ đó đổi tên không thể làm node chạy nhầm hoặc mất executor.
  if (node.data.family && node.data.family !== node.data.label) {
    return executeWorkflowNode({ ...node, data: { ...node.data, label: node.data.family } }, inputs, store, reportProgress);
  }
  if (node.data.basicSteps?.length) {
    // Khi không có data mới, node Lưu file Cơ bản là node đầu vào thuần: trả
    // Stored file, không chạy chuỗi Đặt tên → Lưu file vốn cần đầu vào mới.
    if (node.data.label === "Lưu file" && node.data.storedFiles?.length && !hasIncomingFileStorageData(node, inputs)) {
      return executeFileStorageNode(node, inputs, store);
    }
    return executeBasicWorkflowNode(node, inputs, store, reportProgress);
  }
  if (node.data.category === "Đầu vào") return await executeInput(node, store);
  // Gateway không xử lý dữ liệu mới: Cổng vào phát lại các giá trị caller đã
  // bơm theo ID cổng; Cổng ra giữ gói giá trị để executor workflow cha thu lại.
  if (node.data.label === "Cổng vào") {
    return Object.fromEntries(node.data.outputs.flatMap((port) => inputs[port.id] === undefined ? [] : [[port.id, inputs[port.id]]]));
  }
  if (node.data.label === "Cổng ra") return { workflowOutputs: inputs };
  if (["Chọn nhà cung cấp AI", "Chọn mô hình AI"].includes(node.data.label)) return executeAiConfigurationNode(node, inputs);
  if (node.data.label === "Cache kết quả") return output(node, cacheMaterials(node, inputs));
  if (node.data.label === "Lựa chọn model AI") return executeAiModelSelectionNode(node, inputs);
  if (["Lấy vùng chú ý", "Thiết lập vùng chú ý video"].includes(node.data.label)) return executeAttentionRegionNode(node, inputs, store);
  if (node.data.label === "Giảm độ phân giải ảnh") return executeImageResizeNode(node, inputs, store);
  if (node.data.label === "Tìm ảnh tương đồng") return executeImageSearchNode(node, inputs, store, reportProgress);
  if (["If/Else", "Switch"].includes(node.data.label)) return executeRoutingNode(node, inputs);
  if (["Soạn system prompt", "Tạo prompt từ dữ liệu"].includes(node.data.label)) return executeAiPromptNode(node, inputs);
  if (node.data.label === "Thực thi tác vụ AI") return executeAiTaskNode(node, inputs);
  if (["Gọi AI tạo văn bản", "Gọi AI trả JSON", "Phân tích hình ảnh bằng AI", "Phân tích âm thanh bằng AI", "Phân tích video bằng AI"].includes(node.data.label)) return executeAiRuntimeNode(node, inputs, store);
  if (["Chấm điểm đầu ra AI", "Duyệt đầu ra AI"].includes(node.data.label)) return executeAiReviewNode(node, inputs);
  if (node.data.label === "Xem dữ liệu trên canvas") return executeCanvasDataViewer(node, inputs);
  if (["Cắt video", "Nối video", "Ghép các cảnh", "Thêm nhạc nền"].includes(node.data.label)) return executeLocalMediaNode(node, inputs, store);
  if (node.data.label === "Đặt tên") return executeFileNamingNode(node, inputs, store);
  if (node.data.label === "Lưu file") return executeFileStorageNode(node, inputs, store);
  if (["Tạo tiêu đề", "Bố cục thumbnail bằng AI", "Ghép chữ lên thumbnail"].includes(node.data.label)) return executeThumbnailNode(node, inputs, store);
  if (["Chọn ảnh thumbnail bằng AI"].includes(node.data.label)) return executeThumbnailNode(node, inputs, store);
  if (node.data.label === "Làm rõ highlight lặp") return executeIterativeHighlightNode(node, inputs, store);
  if (["Chọn highlight bằng AI", "Dựng video highlight"].includes(node.data.label)) return executeHighlightNode(node, inputs, store);
  if (["Chuẩn hóa video nguồn", "Tạo subtitle", "Chèn subtitle", "Kiểm tra kỹ thuật"].includes(node.data.label)) return executeVideoFinishingNode(node, inputs, store);
  if (["Kiểm tra yêu cầu và cấu trúc", "Chuẩn bị kiểm tra AI", "Đọc kết quả AI kiểm tra", "Tổng hợp báo cáo kiểm tra", "Chấm điểm thành phẩm", "Duyệt xuất bản"].includes(node.data.label)) return executeQualityNode(node, inputs);
  if (node.data.category === "Phát triển nội dung") return executeContentNode(node, inputs);
  if (["Lập chỉ mục video theo thời gian", "Trích frame từ video", "Tách âm thanh từ video", "Tạo transcript video theo thời gian", "Tạo storyboard từ video", "Phân tích video theo từng đoạn", "Rà soát đoạn video chưa chắc chắn", "Tổng hợp nội dung video"].includes(node.data.label)) {
    return executeVideoAnalysisNode(node, inputs, store);
  }
  if (node.data.category !== "Nghiên cứu") {
    throw new Error(`${executionUnavailableReason(node.data.label, node.data.category)} Node sẽ không trả output mô phỏng hoặc trạng thái thành công giả.`);
  }

  const config = node.data.config;
  if (node.data.label === "Tìm kiếm Internet") {
    const topic = input(node, inputs, "Topic") as { topic?: unknown } | string | undefined;
    const queryInput = list<string>(input(node, inputs, "Query[]"));
    const query = String(config.query || queryInput.join(" ") || (typeof topic === "string" ? topic : topic?.topic) || "").trim();
    const payload = await apiJson({ action: "search", query, provider: config.provider, limit: config.maxResults, domains: lines(config.domains) });
    return output(node, payload.results);
  }

  if (node.data.label === "Đọc trang web") {
    const raw = list<unknown>(input(node, inputs, "URL[]"));
    const urls = raw.flatMap((item) => typeof item === "string" ? [item] : item && typeof item === "object" && "url" in item ? [String((item as { url: unknown }).url)] : []);
    const payload = await apiJson({ action: "read-web", urls, maxChars: config.maxChars });
    return output(node, payload.sources);
  }

  if (node.data.label === "Đọc tài liệu") {
    const files = assetFiles(input(node, inputs, "Document[]"), store);
    const payload = await uploadFiles("read-document", files);
    return output(node, payload.sources);
  }

  const sources = list<Source>(input(node, inputs, "Source[]"));
  if (node.data.label === "Tổng hợp các nguồn") {
    if (!sources.length) throw new Error("Tổng hợp nguồn chưa nhận được Source[]");
    const count = Math.max(3, Math.min(20, Number(config.maxPoints) || 8));
    const result = await maybeAi(node, inputs, "Tổng hợp các nguồn thành ResearchBrief gồm summary, keyPoints và citations.", sources, () => {
      const keyPoints = topSentences(sources, count);
      return { summary: keyPoints.slice(0, 3).map((item) => item.text).join(" "), keyPoints, sourceCount: sources.length, method: "extractive-no-ai" };
    });
    return output(node, result);
  }

  if (node.data.label === "Trích xuất dữ kiện") {
    if (!sources.length) throw new Error("Trích xuất dữ kiện chưa nhận được Source[]");
    const result = await maybeAi(node, inputs, "Trích xuất Fact[]; mỗi fact cần claim, sourceTitle, sourceUrl, evidence và confidence.", sources, () => {
      const count = Math.max(3, Math.min(50, Number(config.maxFacts) || 15));
      const candidates = sources.flatMap((source) => sentences(String(source.content ?? ""))
        .filter((text) => /\d|%|năm|tháng|ngày|triệu|tỷ|theo|cho biết/i.test(text))
        .map((claim) => ({ claim, evidence: claim, sourceId: source.id, sourceTitle: source.title, sourceUrl: source.url, confidence: 0.65 })));
      return candidates.slice(0, count);
    });
    return output(node, result);
  }

  if (node.data.label === "Kiểm tra dữ kiện") {
    const facts = list<{ claim?: string }>(input(node, inputs, "Fact[]"));
    if (!facts.length || !sources.length) throw new Error("Kiểm tra dữ kiện cần cả Fact[] và Source[]");
    const result = await maybeAi(node, inputs, `Kiểm tra các dữ kiện sau và trả về FactCheckReport:\n${JSON.stringify(facts)}`, sources, () => ({
      checkedAt: new Date().toISOString(),
      results: facts.map((fact) => {
        const matches = sources.map((source) => ({ source, score: overlap(String(fact.claim ?? ""), String(source.content ?? "")) })).sort((a, b) => b.score - a.score);
        const support = matches.filter((item) => item.score >= 0.45);
        return { claim: fact.claim, status: support.length >= 2 ? "supported" : support.length === 1 ? "partially-supported" : "unverified", confidence: Math.min(0.95, support.length * 0.35), evidence: support.slice(0, 3).map((item) => ({ title: item.source.title, url: item.source.url, similarity: Number(item.score.toFixed(2)) })) };
      }),
    }));
    return output(node, result);
  }

  if (node.data.label === "So sánh các nguồn") {
    if (sources.length < 2) throw new Error("So sánh nhiều nguồn cần ít nhất 2 nguồn");
    const result = await maybeAi(node, inputs, "So sánh điểm giống, khác và mâu thuẫn giữa các nguồn; trả về ComparisonReport có dẫn URL.", sources, () => {
      const summaries = sources.map((source) => ({ id: source.id, title: source.title, url: source.url, keyPoints: topSentences([source], 4).map((item) => item.text) }));
      const comparisons = sources.flatMap((left, index) => sources.slice(index + 1).map((right) => ({ left: left.title, right: right.title, similarity: Number(overlap(String(left.content ?? ""), String(right.content ?? "")).toFixed(2)) })));
      return { sources: summaries, comparisons, method: "lexical-no-ai" };
    });
    return output(node, result);
  }

  if (node.data.label === "Xếp hạng độ tin cậy nguồn") {
    if (!sources.length) throw new Error("Xếp hạng độ tin cậy chưa nhận được Source[]");
    const result = await maybeAi(node, inputs, "Xếp hạng độ tin cậy của nguồn dựa trên tác giả, ngày, bằng chứng, tên miền và tính nhất quán.", sources, () => sources.map(rankSource).sort((a, b) => Number(b.reliabilityScore) - Number(a.reliabilityScore)));
    return output(node, result);
  }

  if (node.data.label === "Duyệt nguồn thủ công") {
    if (!sources.length) throw new Error("Duyệt nguồn chưa nhận được Source[]");
    const approvedUrls = lines(config.approvedUrls);
    const rejectedUrls = lines(config.rejectedUrls);
    const include = lines(config.includeDomains);
    const exclude = lines(config.excludeDomains);
    const minimum = Number(config.minimumScore) || 0;
    const approved = sources.map(rankSource).filter((source) => {
      const domain = String(source.domain ?? "");
      const url = String(source.url ?? "");
      return (!approvedUrls.length || approvedUrls.includes(url)) && !rejectedUrls.includes(url) && (!include.length || include.some((item) => domain.includes(item))) && !exclude.some((item) => domain.includes(item)) && Number(source.reliabilityScore) >= minimum;
    });
    return output(node, approved.map((source) => ({ ...source, approvalNote: config.approvalNote || "", approvedAt: new Date().toISOString() })));
  }

  throw new Error(`Node nghiên cứu “${node.data.label}” chưa có bộ thực thi`);
}
