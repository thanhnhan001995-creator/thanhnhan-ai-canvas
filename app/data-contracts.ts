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
  if (/^(text|content|script|outline|chapter|subtitle|caption|prompt|systemprompt|query|brief|request|thuat ngu|thuật ngữ)$/i.test(type)) return "Text";
  if (/^(boolean|condition)$/i.test(type)) return "Boolean";
  if (/^(number|integer|float)$/i.test(type)) return "Number";
  if (/^(json|record|object|variable)$/i.test(type)) return "Record";
  if (/^(folder|searchfolder)$/i.test(type)) return "Folder";
  if (/^(imagesearchlist)$/i.test(type) || /^image$/i.test(type) && /\[\]$/.test(value)) return "ImageSet";
  if (/^(image|thumbnail|imagesample|imagesearch)$/i.test(type)) return "Image";
  if (/^(audio|music)$/i.test(type)) return "Audio";
  if (/^(video)$/i.test(type)) return "Video";
  if (/^(frameindex|videoindex|storyboard)$/i.test(type)) return "FrameIndex";
  if (/^(timedtranscript|transcript)$/i.test(type)) return "TimedTranscript";
  if (/^(table)$/i.test(type)) return "Table";
  if (/^(qareport|report|aianalysis|aijson|aiscore|aiapprovedresult|imagematch|image-match)$/i.test(type)) return "Report";
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
