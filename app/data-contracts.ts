/**
 * Hợp đồng dữ liệu v1 của Tesseract.
 *
 * Node executor cũ vẫn có thể nhận payload thô trong giai đoạn chuyển đổi,
 * nhưng runtime trao đổi Artifact có provenance để không phải đoán kiểu dữ
 * liệu, đường dẫn hay nguồn tạo ra dữ liệu ở mỗi node.
 */
export const ARTIFACT_SCHEMA_VERSION = 1 as const;

export const ARTIFACT_TYPES = [
  "Any", "Text", "Boolean", "Number", "Record", "File", "Folder",
  "Image", "ImageSet", "Audio", "Video", "FrameIndex", "TimedTranscript",
  "Table", "Report", "StoredFiles", "AIExecutionProfile", "CachedData",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export type PortCardinality = "one" | "many";
export type ArtifactStatus = "ready" | "running" | "failed" | "stale";
export type NodeRunStatus = "queued" | "running" | "success" | "failed" | "cancelled";
export type AIExecutionMode = "api" | "local";
export type AIExecutionProfile = {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  kind: "tesseract-ai-profile";
  provider: string;
  model: string;
  executionMode: AIExecutionMode;
  endpoint?: string;
  /** Chỉ là khóa tra bí mật trong runtime; tuyệt đối không phải API key. */
  secretRef?: string;
  temperature: number;
  maxOutputTokens: number;
  maxInputTokens: number;
  maxOutputWorkflowTokens: number;
};

export type TaskSpec = {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  kind: "tesseract-task";
  id: string;
  nodeId: string;
  goal: string;
  expectedOutput: ArtifactType;
  inputTypes: ArtifactType[];
  instructions?: string;
  successCriteria: string[];
};

export type ReportStatus = "completed" | "needs-review" | "needs-fix" | "failed";
export type AIReport = {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  kind: "tesseract-ai-report";
  status: ReportStatus;
  conclusion: string;
  evidence: unknown[];
  confidence?: number;
  passed?: boolean;
  needsFix: boolean;
  repairItems: Array<{ location?: string; reason: string; fix?: string }>;
  task: TaskSpec;
};

export type PortSpec = {
  id: string;
  label: string;
  type: string;
  artifactType: ArtifactType;
  cardinality: PortCardinality;
  required: boolean;
};

export type ArtifactProvenance = {
  workflowId: string;
  nodeId: string;
  portId: string;
  runId: string;
};

export type Artifact<T = unknown> = {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  kind: "tesseract-artifact";
  id: string;
  type: ArtifactType;
  cardinality: PortCardinality;
  name: string;
  status: ArtifactStatus;
  payload: T;
  location?: string;
  mimeType?: string;
  createdAt: string;
  provenance: ArtifactProvenance;
  metadata: Record<string, unknown>;
};

export type ArtifactSummary = Pick<Artifact, "id" | "type" | "cardinality" | "name" | "status" | "location" | "mimeType" | "createdAt" | "provenance" | "metadata">;

export type NodeDiagnostic = {
  code: string;
  level: "info" | "warning" | "error";
  message: string;
  cause?: string;
  suggestedAction?: string;
  createdAt: string;
};

export type NodeRunRecord = {
  runId: string;
  nodeId: string;
  status: NodeRunStatus;
  startedAt: string;
  endedAt?: string;
  progress?: { current?: number; total?: number; message: string; detail?: string };
  inputs: ArtifactSummary[];
  outputs: ArtifactSummary[];
  diagnostics: NodeDiagnostic[];
};

export type ArtifactOutputMap = Record<string, Artifact>;

function normalizedPortType(value: string): string {
  return value.replace(/\[\]$/, "").trim().toLowerCase();
}

export function cardinalityForPortType(value: string): PortCardinality {
  return /\[\]\s*$/i.test(value) || /^(imagesearchlist)$/i.test(normalizedPortType(value))
    ? "many"
    : "one";
}

export function artifactTypeForPortType(value: string): ArtifactType {
  const type = normalizedPortType(value);
  if (/^(du lieu|dữ liệu|any|free|workflow|gia tri|giá trị)$/i.test(type)) return "Any";
  if (/^(text|aitext|content|script|outline|chapter|subtitle|caption|prompt|systemprompt|query|brief|request|thuat ngu|thuật ngữ)$/i.test(type)) return "Text";
  if (/^(boolean|condition)$/i.test(type)) return "Boolean";
  if (/^(number|integer|float)$/i.test(type)) return "Number";
  if (/^(json|aijson|record|object|variable)$/i.test(type)) return "Record";
  if (/^(folder|searchfolder)$/i.test(type)) return "Folder";
  if (/^(imagesearchlist)$/i.test(type) || /^image$/i.test(type) && /\[\]$/.test(value)) return "ImageSet";
  if (/^(image|thumbnail|imagesample|imagesearch)$/i.test(type)) return "Image";
  if (/^(audio|music)$/i.test(type)) return "Audio";
  if (/^(video)$/i.test(type)) return "Video";
  if (/^(frameindex|videoindex|storyboard)$/i.test(type)) return "FrameIndex";
  if (/^(timedtranscript|transcript)$/i.test(type)) return "TimedTranscript";
  if (/^(table)$/i.test(type)) return "Table";
  if (/^(qareport|report|aianalysis|aiscore|aiapprovedresult|highlightplan|imagematch|image-match)$/i.test(type)) return "Report";
  if (/^(storedfile|storedfiles)$/i.test(type) || /^file$/i.test(type) && /\[\]$/.test(value)) return "StoredFiles";
  if (/^(file|namedfile|document|url)$/i.test(type)) return "File";
  if (/^(aimodel|aiprovider|apikey|profile|configuration|config)$/i.test(type)) return "AIExecutionProfile";
  if (/^(cacheddata)$/i.test(type)) return "CachedData";
  return "Any";
}

export function portSpecFor(port: Pick<PortSpec, "id" | "label" | "type"> & Partial<Pick<PortSpec, "required" | "cardinality" | "artifactType">>): PortSpec {
  return {
    id: port.id,
    label: port.label,
    type: port.type,
    artifactType: port.artifactType ?? artifactTypeForPortType(port.type),
    cardinality: port.cardinality ?? cardinalityForPortType(port.type),
    required: port.required === true,
  };
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

/** Chuẩn hóa cấu hình thực thi AI; secretRef chỉ trỏ đến bí mật runtime. */
export function aiExecutionProfile(input: Partial<AIExecutionProfile> & { provider?: unknown; model?: unknown; endpoint?: unknown; localEndpoint?: unknown; secretRef?: unknown; temperature?: unknown; maxOutputTokens?: unknown; maxInputTokens?: unknown; maxOutputWorkflowTokens?: unknown }): AIExecutionProfile {
  const provider = String(input.provider ?? "OpenAI").trim() || "OpenAI";
  const model = String(input.model ?? "").trim();
  const endpoint = String(input.endpoint ?? input.localEndpoint ?? "").trim();
  const executionMode: AIExecutionMode = provider === "Ollama" || provider === "AI local" ? "local" : "api";
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "tesseract-ai-profile",
    provider,
    model,
    executionMode,
    ...(endpoint ? { endpoint } : {}),
    ...(String(input.secretRef ?? "").trim() ? { secretRef: String(input.secretRef).trim() } : {}),
    temperature: boundedNumber(input.temperature, 0.7, 0, 2),
    maxOutputTokens: boundedNumber(input.maxOutputTokens, 2_000, 16, 50_000),
    maxInputTokens: boundedNumber(input.maxInputTokens, 40_000, 1_000, 40_000),
    maxOutputWorkflowTokens: boundedNumber(input.maxOutputWorkflowTokens, 20_000, 500, 20_000),
  };
}

export function taskSpec(input: Omit<TaskSpec, "schemaVersion" | "kind" | "id" | "successCriteria"> & { successCriteria?: string[]; instructions?: string }): TaskSpec {
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "tesseract-task",
    id: nextId("task"),
    nodeId: input.nodeId,
    goal: input.goal.trim() || "Xử lý dữ liệu đầu vào",
    expectedOutput: input.expectedOutput,
    inputTypes: [...new Set(input.inputTypes)],
    ...(input.instructions?.trim() ? { instructions: input.instructions.trim() } : {}),
    successCriteria: input.successCriteria?.filter(Boolean) ?? ["Kết luận chỉ dựa trên bằng chứng đầu vào."],
  };
}

/** Bao chuẩn cho kết quả AI; không tự tuyên bố đạt khi chưa có tiêu chí máy kiểm tra. */
export function aiReport(input: Omit<AIReport, "schemaVersion" | "kind" | "repairItems"> & { repairItems?: AIReport["repairItems"] }): AIReport {
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "tesseract-ai-report",
    status: input.status,
    conclusion: input.conclusion.trim(),
    evidence: input.evidence,
    ...(input.confidence === undefined ? {} : { confidence: Math.max(0, Math.min(1, input.confidence)) }),
    ...(input.passed === undefined ? {} : { passed: input.passed }),
    needsFix: input.needsFix,
    repairItems: input.repairItems ?? [],
    task: input.task,
  };
}

/** Cổng chứa nhiều phần tử không thể cấp thẳng một tập dữ liệu cho cổng đơn. */
export function portCardinalityCompatible(source: Pick<PortSpec, "cardinality">, target: Pick<PortSpec, "cardinality">): boolean {
  return source.cardinality !== "many" || target.cardinality === "many";
}

function nextId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${suffix}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function locationOf(value: unknown): string | undefined {
  const item = record(value);
  if (!item) return undefined;
  return [item.localPath, item.filePath, item.path, item.url].find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
}

function mimeTypeOf(value: unknown): string | undefined {
  const item = record(value);
  return item && typeof item.type === "string" && item.type.includes("/") ? item.type : undefined;
}

function displayNameOf(value: unknown, fallback: string): string {
  const item = record(value);
  if (item && typeof item.name === "string" && item.name.trim()) return item.name.trim();
  if (Array.isArray(value)) return `${fallback} (${value.length} mục)`;
  return fallback;
}

export function createArtifact<T>(value: T, port: Pick<PortSpec, "id" | "label" | "type" | "artifactType" | "cardinality">, provenance: ArtifactProvenance, status: ArtifactStatus = "ready"): Artifact<T> {
  const createdAt = new Date().toISOString();
  const itemCount = Array.isArray(value) ? value.length : 1;
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "tesseract-artifact",
    id: nextId("artifact"),
    type: port.artifactType,
    cardinality: port.cardinality,
    name: displayNameOf(value, port.label),
    status,
    payload: value,
    ...(locationOf(value) ? { location: locationOf(value) } : {}),
    ...(mimeTypeOf(value) ? { mimeType: mimeTypeOf(value) } : {}),
    createdAt,
    provenance,
    metadata: { portType: port.type, itemCount },
  };
}

export function isArtifact(value: unknown): value is Artifact {
  const item = record(value);
  return item?.kind === "tesseract-artifact" && item.schemaVersion === ARTIFACT_SCHEMA_VERSION && typeof item.id === "string";
}

export function unwrapArtifact<T = unknown>(value: T | Artifact<T>): T {
  return isArtifact(value) ? value.payload as T : value as T;
}

export function artifactSummary(artifact: Artifact): ArtifactSummary {
  const { payload: _payload, ...summary } = artifact;
  return summary;
}

export function artifactOutputsForPorts(outputs: Record<string, unknown>, ports: Array<Pick<PortSpec, "id" | "label" | "type"> & Partial<Pick<PortSpec, "artifactType" | "cardinality">>>, provenance: Omit<ArtifactProvenance, "portId">): ArtifactOutputMap {
  return Object.fromEntries(ports.flatMap((rawPort) => {
    const value = outputs[rawPort.id];
    if (value === undefined) return [];
    const port = portSpecFor(rawPort);
    return [[port.id, createArtifact(value, port, { ...provenance, portId: port.id })]];
  }));
}

export function startNodeRun(input: Pick<NodeRunRecord, "runId" | "nodeId"> & Partial<Pick<NodeRunRecord, "status" | "inputs" | "progress">>): NodeRunRecord {
  return {
    runId: input.runId,
    nodeId: input.nodeId,
    status: input.status ?? "queued",
    startedAt: new Date().toISOString(),
    ...(input.progress ? { progress: input.progress } : {}),
    inputs: input.inputs ?? [],
    outputs: [],
    diagnostics: [],
  };
}

export function finishNodeRun(run: NodeRunRecord | undefined, status: Extract<NodeRunStatus, "success" | "failed" | "cancelled">, options: { outputs?: ArtifactSummary[]; diagnostic?: NodeDiagnostic } = {}): NodeRunRecord {
  const current = run ?? startNodeRun({ runId: nextId("run"), nodeId: "unknown", status: "running" });
  return {
    ...current,
    status,
    endedAt: new Date().toISOString(),
    progress: undefined,
    outputs: options.outputs ?? current.outputs,
    diagnostics: options.diagnostic ? [...current.diagnostics, options.diagnostic] : current.diagnostics,
  };
}

export function executionDiagnostic(error: unknown, suggestedAction = "Kiểm tra đầu vào, cấu hình node và chạy lại."): NodeDiagnostic {
  const message = error instanceof Error && error.message.trim() ? error.message.trim() : "Lỗi thực thi không xác định";
  return {
    code: "execution_failed",
    level: "error",
    message,
    suggestedAction,
    createdAt: new Date().toISOString(),
  };
}
