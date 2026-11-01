"use client";

import { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent, ReactNode, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BaseEdge,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  EdgeProps,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  NodeChange,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  addEdge,
  applyEdgeChanges,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NODE_SPECS } from "./node-specs";
import { BASIC_NODE_PRESETS } from "./basic-node-presets";
import { getPortConnectSize, portContractLabel, portTypesCompatible, SELF_CONFIGURED_NODE_NAMES, type PortConnectSize } from "./node-contracts";
import { beginLocalMediaWorkflowRun, controlLocalMediaWorkflow, endLocalMediaWorkflowRun, executeCalledWorkflow, executeWorkflowNode, parseDurationInput, resetAiTokenUsage, type ExecutionProgress, type RuntimeFileStore, type WorkflowDocumentLike } from "./research-client";
import { hasNodeExecutor } from "./node-execution.ts";
import { currentOpenAiModel, getAiModelCapabilities, replacementForRetiredOpenAiModel, type CapabilityState } from "./ai-model-capabilities";
import { LOCAL_AI_REGISTRY_STORAGE_KEY, localAiModelIds, mergeScannedOllamaModel, normalizeLocalAiRegistry, removeLocalAiModel, type LocalAiModel, type ScannedOllamaModel } from "./local-ai-registry";
import { nextNodeName, nodeFamilyOf } from "./node-identity";
import { ARTIFACT_TYPES, artifactOutputsForPorts, artifactSummary, executionDiagnostic, finishNodeRun, portCardinalityCompatible, portSpecFor, startNodeRun, unwrapArtifact, type Artifact, type ArtifactOutputMap, type ArtifactSummary, type ArtifactType, type NodeRunRecord, type PortCardinality } from "./data-contracts";
import { createWorkflowId, normalizeWorkflowInterface, parseWorkflowDocument, prepareWorkflowForSave, serializeTessWorkflow, workflowNameFromPath } from "../shared/tess-document.mjs";
import { findWorkflowReferenceCycles } from "../shared/workflow-recursion.mjs";

declare global {
  interface Window {
    contentFlowDesktop?: {
      pickFolder: () => Promise<string | null>;
      pickFiles: (request: { accept?: string; multiple?: boolean }) => Promise<{ canceled: boolean; paths?: string[]; error?: string }>;
      readFiles: (paths: string[]) => Promise<{ files?: Array<{ name: string; type: string; data?: Uint8Array; path?: string; size?: number; pathOnly?: boolean }>; error?: string }>;
      saveWorkflow: (request: { workflow: unknown; currentPath: string | null; defaultName: string; saveAs: boolean }) => Promise<{ canceled: boolean; path?: string; workflow?: unknown; error?: string }>;
      openWorkflow: () => Promise<{ canceled: boolean; path?: string; workflow?: unknown; error?: string }>;
      openRecentWorkflow: (filePath: string) => Promise<{ canceled: boolean; path?: string; workflow?: unknown; error?: string }>;
      readWorkflowAtPath: (filePath: string) => Promise<{ path?: string; workflow?: unknown; error?: string }>;
      onCloseCanvas: (callback: () => void) => () => void;
    };
  }
}
import { displayPortLabel, getPortVisual } from "./port-library";

type PortType = string;

type NodeStatus = "idle" | "queued" | "running" | "success" | "error";
type NodeBeacon = "uncheck" | "miss" | "ready" | "error" | "paused" | "running";
type WorkflowCheckSummary = { message: string; beacon: "miss" | "ready" | "error" };
type FieldValue = string | number | boolean;
type StoredFileReference = { filePath: string; name: string; type: string; size: number; storedAt: string };
type RecentWorkflow = { path: string; name: string; openedAt: number };
type OllamaScan = { models: ScannedOllamaModel[]; scannedAt: string };

const RECENT_WORKFLOWS_STORAGE_KEY = "content-flow-recent-workflows-v1";
const RECENT_WORKFLOWS_LIMIT = 6;

function readRecentWorkflows(): RecentWorkflow[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_WORKFLOWS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry): entry is RecentWorkflow => (
        entry && typeof entry.path === "string" && typeof entry.name === "string" && typeof entry.openedAt === "number"
      ))
      .sort((left, right) => right.openedAt - left.openedAt)
      .slice(0, RECENT_WORKFLOWS_LIMIT);
  } catch {
    return [];
  }
}

function readLocalAiRegistry(): LocalAiModel[] {
  try { return normalizeLocalAiRegistry(JSON.parse(localStorage.getItem(LOCAL_AI_REGISTRY_STORAGE_KEY) ?? "[]")); }
  catch { return []; }
}

function localAiModelSize(size?: number): string {
  if (!size) return "Dung lượng chưa rõ";
  return `${(size / 1024 / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 * 1024 ? 0 : 1)} GB`;
}

function localAiModifiedAt(value?: string): string {
  if (!value) return "Thời điểm cập nhật chưa rõ";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Thời điểm cập nhật chưa rõ" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

type Port = {
  id: string;
  label: string;
  type: PortType;
  connectSize?: PortConnectSize;
  required?: boolean;
  /** Hợp đồng dữ liệu v1. Thiếu ở workflow cũ sẽ được suy ra từ `type`. */
  artifactType?: ArtifactType;
  cardinality?: PortCardinality;
};

function withPortDataContract(port: Port): Port {
  const spec = portSpecFor(port);
  return { ...port, artifactType: spec.artifactType, cardinality: spec.cardinality };
}

function portsCanConnect(source: Port, target: Port): boolean {
  const sourceSpec = portSpecFor(source);
  const targetSpec = portSpecFor(target);
  return portTypesCompatible(source, target) && portCardinalityCompatible(sourceSpec, targetSpec);
}

/**
 * Hiển thị cùng một hợp đồng dữ liệu ở cả hai đầu cổng. Người dùng cần biết
 * chính xác cổng vào yêu cầu gì trước khi kéo dây, chứ không chỉ ở cổng ra.
 */
function portInformationTooltip(port: Port): string {
  const spec = portSpecFor(port);
  return `${portContractLabel({ type: port.type, connectSize: port.connectSize })} · ${displayPortLabel(port.type)} · ${spec.artifactType} · ${spec.cardinality === "many" ? "nhiều" : "một"}`;
}

type ConfigField = {
  key: string;
  label: string;
  /** Nhóm hiển thị trong bảng chi tiết; dùng để chèn gạch ngăn giữa các cụm liên quan. */
  configGroup?: string;
  type: "text" | "textarea" | "select" | "multi-select" | "number" | "range" | "url" | "url-list" | "tags" | "code" | "file" | "folder" | "date" | "time" | "datetime-local" | "date-time-pair" | "model-catalog" | "checkbox" | "color" | "password" | "attention-grid" | "attention-editor";
  options?: string[];
  accept?: string;
  multiple?: boolean;
  placeholder?: string;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  defaultValue?: FieldValue;
  defaultValues?: Record<string, FieldValue>;
  required?: boolean;
  showWhen?: { key: string; value: string };
  maxLength?: number;
  fileValidation?: "text" | "image" | "audio" | "media";
  persistPaths?: boolean;
};

type WorkflowCheckIssue = { nodeId: string; message: string; beacon: "miss" | "error" };
type WorkflowInspection = { issues: WorkflowCheckIssue[]; beacons: Map<string, NodeBeacon> };
type LocalProcessor = { id: string; label: string; description: string; installed: boolean; version?: string; error?: string; bytes: number; updatedAt?: string; updatedAtEstimated?: boolean };

const LOCAL_TRANSCRIPT_MODEL_PROCESSOR_IDS: Record<string, string> = {
  "Nhanh (Whisper tiny)": "whisper-tiny",
  "Cân bằng (Whisper base)": "whisper-base",
  "Chất lượng (Whisper small)": "whisper-small",
  "Tiếng Việt (PhoWhisper base)": "phowhisper-base",
  "Tiếng Việt chất lượng cao (PhoWhisper small)": "phowhisper-small",
};

function localProcessorUpdatedAtLabel(processor: LocalProcessor): string {
  if (!processor.updatedAt) return "Cài/cập nhật gần nhất: chưa ghi nhận";
  const date = new Date(processor.updatedAt);
  if (Number.isNaN(date.valueOf())) return "Cài/cập nhật gần nhất: chưa ghi nhận";
  const formatted = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
  return `Cài/cập nhật gần nhất: ${formatted}${processor.updatedAtEstimated ? " (mốc tệp tham khảo)" : ""}`;
}

function nodeHasExecutor(node: ContentFlowNode): boolean {
  // Node Cơ bản là workflow con: phải xét executor của các bước bên trong,
  // không dùng nhãn bao ngoài như “Tạo prompt AI” để kết luận là thiếu executor.
  if (node.data.basicSteps?.length) return node.data.basicSteps.every((step) => hasNodeExecutor(step.label, step.category));
  return hasNodeExecutor(nodeFamilyOf(node), node.data.category);
}

function isConfigMissing(value: FieldValue | undefined): boolean {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

function missingAiConfiguration(node: ContentFlowNode, edges: Edge[]): string[] {
  if (node.data.category !== "AI & mô hình") return [];
  const missing = node.data.configFields
    .filter((field) => field.required && (!field.showWhen || String(node.data.config[field.showWhen.key] ?? "") === field.showWhen.value))
    .filter((field) => isConfigMissing(node.data.config[field.type === "model-catalog" ? "model" : field.key]))
    .map((field) => field.label);
  const family = nodeFamilyOf(node);
  const isProviderSetup = family === "Thiết lập AI" || family === "Chọn nhà cung cấp AI";
  const isModelSetup = isProviderSetup || family === "Chọn mô hình AI";
  if (isModelSetup && node.data.config.model === "Khác — nhập ID model" && isConfigMissing(node.data.config.customModel)) missing.push("ID model tùy chỉnh");
  if (!isProviderSetup) return [...new Set(missing)];
  const provider = String(node.data.config.provider ?? "");
  const hasConnectedApiKey = node.data.inputs.some((port) => port.type === "APIKey" && edges.some((edge) => edge.target === node.id && edge.targetHandle === port.id));
  const requiresApiKey = provider && !["Ollama", "AI local"].includes(provider);
  if (requiresApiKey && isConfigMissing(node.data.config.apiKey) && !hasConnectedApiKey) missing.push("API key");
  return [...new Set(missing)];
}

function inspectWorkflow(nodes: ContentFlowNode[], edges: Edge[]): WorkflowInspection {
  const issues: WorkflowCheckIssue[] = [];
  const beacons = new Map<string, NodeBeacon>();
  for (const node of nodes) {
    const family = nodeFamilyOf(node);
    if (node.data.paused) {
      beacons.set(node.id, "paused");
      continue;
    }
    let beacon: NodeBeacon = "ready";
    if (node.data.validationError) {
      issues.push({ nodeId: node.id, beacon: "error", message: `“${node.data.label}” có dữ liệu không hợp lệ: ${node.data.validationError}` });
      beacons.set(node.id, "error");
      continue;
    }
    if (!nodeHasExecutor(node)) {
      issues.push({ nodeId: node.id, beacon: "error", message: `“${node.data.label}” chưa có bộ thực thi thật.` });
      beacons.set(node.id, "error");
      continue;
    }
    if (family === "Gọi workflow" && !node.data.calledWorkflow) {
      issues.push({ nodeId: node.id, beacon: "miss", message: `“${node.data.label}” chưa chọn workflow .tess cần gọi.` });
      beacons.set(node.id, "miss");
      continue;
    }
    const hasConnectedInput = (port: Port) => edges.some((edge) => (
      edge.target === node.id
      && edge.targetHandle === port.id
    ));
    const hasActiveInput = (port: Port) => edges.some((edge) => (
      edge.target === node.id
      && edge.targetHandle === port.id
      && !nodes.find((source) => source.id === edge.source)?.data.paused
    ));
    const cacheAwareAiNode = new Set(["Lựa chọn model AI", "Gọi AI tạo văn bản", "Gọi AI trả JSON", "Phân tích hình ảnh bằng AI", "Phân tích âm thanh bằng AI", "Phân tích video bằng AI", "Phân tích từng đoạn video", "Tổng hợp nội dung video", "Chọn highlight bằng AI", "Làm rõ highlight lặp", "Tạo tiêu đề", "Chọn ảnh thumbnail bằng AI", "Bố cục thumbnail bằng AI"]).has(family);
    const hasValidCache = cacheAwareAiNode && node.data.inputs.some((port) => port.type === "CachedData" && hasActiveInput(port));
    // Lưu file có storedfile là nguồn tái sử dụng hoàn chỉnh; chỉ node mới
    // chưa từng lưu mới phải bị báo thiếu input/folder để bắt đầu một lượt lưu.
    const reusesStoredFiles = hasReusableStoredFiles(node);
    const missing = reusesStoredFiles ? [] : node.data.inputs.filter((port) => port.required && !hasConnectedInput(port) && !(hasValidCache && !/^(AIModel|AIProvider|APIKey|CachedData)$/i.test(port.type)));
    if (missing.length) {
      issues.push({ nodeId: node.id, beacon: "miss", message: `“${node.data.label}” thiếu đầu vào: ${missing.map((port) => port.label).join(", ")}.` });
      beacon = "miss";
    }
    const isVideoPreparation = node.data.basicPresetId === "prepare-video-analysis";
    const isTranscriptNode = family === "Tạo transcript video theo thời gian";
    const transcriptMode = String(node.data.config.transcriptMode ?? "");
    const transcriptModes = isVideoPreparation ? VIDEO_PREPARATION_TRANSCRIPT_MODES : [VIDEO_PREPARATION_TRANSCRIPT_LOCAL, VIDEO_PREPARATION_TRANSCRIPT_API];
    if ((isVideoPreparation || isTranscriptNode) && !transcriptModes.includes(transcriptMode)) {
      issues.push({ nodeId: node.id, beacon: "miss", message: `“${node.data.label}” chưa chọn cách tạo transcript.` });
      beacon = "miss";
    }
    if ((isVideoPreparation || isTranscriptNode) && transcriptMode !== VIDEO_PREPARATION_TRANSCRIPT_NONE && !String(node.data.config.language ?? "").trim()) {
      issues.push({ nodeId: node.id, beacon: "miss", message: `“${node.data.label}” chưa chọn ngôn ngữ lời thoại transcript.` });
      beacon = "miss";
    }
    const requiresDirectAiKey = (isTranscriptNode && transcriptMode === VIDEO_PREPARATION_TRANSCRIPT_API)
      || DIRECT_AI_RUNTIME_ALWAYS.has(family)
      || (isVideoPreparation
        ? transcriptMode === VIDEO_PREPARATION_TRANSCRIPT_API
        : Boolean(node.data.basicSteps?.some((step) => DIRECT_AI_RUNTIME_ALWAYS.has(step.label))))
      || (DIRECT_AI_RUNTIME_OPTIONAL.has(family) && Boolean(node.data.config.useAI));
    if (requiresDirectAiKey) {
      const hasConnectedApiKey = node.data.inputs.some((port) => port.type === "APIKey" && hasActiveInput(port));
      if (!String(node.data.config.apiKey ?? "").trim() && !hasConnectedApiKey) {
        issues.push({ nodeId: node.id, beacon: "miss", message: `“${node.data.label}” cần API key: nhập trực tiếp hoặc nối cổng APIKey.` });
        beacon = "miss";
      }
    }
    if (family === "Lấy vùng chú ý" || family === "Thiết lập vùng chú ý video" || node.data.basicPresetId === "image-input-optimize") {
      const hasMediaInput = node.data.inputs.some((port) => ["Image[]", "Video"].includes(port.type) && hasActiveInput(port));
      const simpleMode = String(node.data.config.selectionMode ?? "").startsWith("Đơn giản");
      const selectedCount = simpleMode
        ? String(node.data.config.simpleCells ?? "").split(",").filter((item) => /^\d+$/.test(item)).length
        : parseAttentionRects(node.data.config.exactRegions).length;
      if (!hasMediaInput) {
        issues.push({ nodeId: node.id, beacon: "miss", message: "Node vùng chú ý cần nối Image[] hoặc Video." });
        beacon = "miss";
      }
      if (!selectedCount) {
        issues.push({ nodeId: node.id, beacon: "miss", message: "Node vùng chú ý chưa có vùng nào được chọn." });
        beacon = "miss";
      }
    }
    if (family === "Tìm ảnh tương đồng") {
      const activePort = (type: string) => node.data.inputs.some((port) => port.type === type && hasActiveInput(port));
      const directTemplate = Boolean(String(node.data.config.templateImagesPaths ?? node.data.config.templateImages ?? "").trim());
      const templateSourceCount = Number(activePort("ImageSample")) + Number(directTemplate);
      if (!templateSourceCount) {
        issues.push({ nodeId: node.id, beacon: "miss", message: `“${node.data.label}” chưa có ảnh mẫu: nối image-sample hoặc chọn trực tiếp trong node.` });
        beacon = "miss";
      } else if (templateSourceCount > 1) {
        issues.push({ nodeId: node.id, beacon: "error", message: `“${node.data.label}” có đồng thời ảnh mẫu qua image-sample và chọn trực tiếp. Chỉ giữ một nguồn.` });
        beacon = "error";
      }
      const searchPortCount = ["ImageSearch", "ImageSearchList", "SearchFolder"].filter(activePort).length;
      const directSearch = String(node.data.config.searchSourceMode ?? "Chọn ảnh") === "Chọn folder ảnh"
        ? Boolean(String(node.data.config.searchFolder ?? "").trim())
        : Boolean(String(node.data.config.searchImagesPaths ?? node.data.config.searchImages ?? "").trim());
      const searchSourceCount = searchPortCount + Number(directSearch);
      if (!searchSourceCount) {
        issues.push({ nodeId: node.id, beacon: "miss", message: `“${node.data.label}” chưa có ảnh để tìm: dùng image-search, image-search-list, search-folder hoặc chọn trực tiếp.` });
        beacon = "miss";
      } else if (searchSourceCount > 1) {
        issues.push({ nodeId: node.id, beacon: "error", message: `“${node.data.label}” có nhiều nguồn ảnh để tìm. Chỉ giữ đúng một nguồn.` });
        beacon = "error";
      }
      if (String(node.data.config.selectionMode ?? "Cắt vùng chính xác") === "Cắt vùng chính xác" && !parseAttentionRects(node.data.config.exactRegions).length) {
        issues.push({ nodeId: node.id, beacon: "miss", message: `“${node.data.label}” chưa cắt vùng ảnh mẫu. Bấm “Mở trình chọn chính xác…” hoặc chọn “Dùng toàn bộ ảnh”.` });
        beacon = "miss";
      }
    }
    const missingConfiguration = missingAiConfiguration(node, edges);
    if (missingConfiguration.length) {
      issues.push({ nodeId: node.id, beacon: "miss", message: `“${node.data.label}” thiếu cấu hình bắt buộc: ${missingConfiguration.join(", ")}.` });
      beacon = "miss";
    }
    // Stored file biến Lưu file thành node nguồn. Khi chưa Reset, Folder và
    // dữ liệu đầu vào cũ không còn là điều kiện để dùng lại kết quả đã lưu.
    if (isFileStorageNode(node) && !reusesStoredFiles) {
      const folderPort = node.data.inputs.find((port) => port.type === "Folder");
      const hasFolderConnection = Boolean(folderPort && hasActiveInput(folderPort));
      const hasDirectFolder = Boolean(String(node.data.config.localFolder ?? "").trim());
      if (!hasFolderConnection && !hasDirectFolder) {
        issues.push({ nodeId: node.id, beacon: "miss", message: `“${node.data.label}” chưa có thư mục lưu: chọn trong node hoặc nối cổng Folder.` });
        beacon = "miss";
      }
      if (hasFolderConnection && hasDirectFolder) {
        issues.push({ nodeId: node.id, beacon: "error", message: `“${node.data.label}” có đồng thời thư mục trong node và qua cổng Folder.` });
        beacon = "error";
      }
    }
    const basicOperation = String(node.data.config.basicOperation ?? "").trim();
    if (node.data.basicMode === "choice" && (!basicOperation || basicOperation === NO_BASIC_OPERATION)) {
      issues.push({ nodeId: node.id, beacon: "miss", message: `“${node.data.label}” chưa chọn thao tác.` });
      beacon = "miss";
    }
    beacons.set(node.id, beacon);
  }
  const hasAiCall = nodes.some((node) => ["Gọi AI tạo văn bản", "Gọi AI trả JSON", "Phân tích hình ảnh bằng AI", "Phân tích âm thanh bằng AI", "Phân tích video bằng AI"].includes(nodeFamilyOf(node)));
  const hasKey = nodes.some((node) => String(node.data.config.apiKey ?? "").trim());
  const hasOllamaSetup = nodes.some((node) => ["Thiết lập AI", "Chọn nhà cung cấp AI"].includes(nodeFamilyOf(node)) && String(node.data.config.provider ?? "") === "Ollama");
  if (hasAiCall && !hasKey && !hasOllamaSetup) {
    const firstAi = nodes.find((node) => ["Gọi AI tạo văn bản", "Gọi AI trả JSON", "Phân tích hình ảnh bằng AI", "Phân tích âm thanh bằng AI", "Phân tích video bằng AI"].includes(nodeFamilyOf(node)));
    if (firstAi) {
      issues.push({ nodeId: firstAi.id, beacon: "error", message: "Workflow chưa có API key. Nhập trực tiếp trong Thiết lập AI hoặc nối Cấu hình API key vào cổng APIKey." });
      beacons.set(firstAi.id, "error");
    }
  }

  // Một line tồn tại chưa đủ để coi là có dữ liệu. Nguồn của mọi cổng bắt buộc
  // phải không tạm ngưng và phải qua kiểm tra cấu hình/dữ liệu của chính nó.
  // Lặp theo phụ thuộc để lỗi ở nguồn A cũng được truyền tới B rồi C.
  const reportedDependencyIssues = new Set<string>();
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const node of nodes) {
      if (node.data.paused) continue;
      // Lưu file có Stored file không phụ thuộc các line dùng để tạo file ở
      // lượt trước; nguồn cũ có thể tạm ngưng mà vẫn tái sử dụng được file.
      if (hasReusableStoredFiles(node)) continue;
      for (const port of node.data.inputs.filter((item) => item.required)) {
        const incoming = edges.find((edge) => edge.target === node.id && edge.targetHandle === port.id);
        if (!incoming) continue;
        const source = nodes.find((item) => item.id === incoming.source);
        const sourceBeacon = source ? beacons.get(source.id) : "error";
        const reason = !source
          ? "không còn tồn tại"
          : source.data.paused || sourceBeacon === "paused"
            ? "đang tạm ngưng"
            : sourceBeacon === "error"
              ? "đang có lỗi"
              : sourceBeacon === "miss"
                ? "chưa đủ dữ liệu hoặc cấu hình"
                : "";
        if (!reason) continue;
        const key = `${node.id}:${port.id}:${source?.id ?? "missing"}:${reason}`;
        if (!reportedDependencyIssues.has(key)) {
          issues.push({
            nodeId: node.id,
            beacon: "miss",
            message: `“${node.data.label}” không thể nhận “${port.label}”: node nguồn “${source?.data.label ?? "không xác định"}” ${reason}.`,
          });
          reportedDependencyIssues.add(key);
        }
        if (beacons.get(node.id) !== "error" && beacons.get(node.id) !== "miss") {
          beacons.set(node.id, "miss");
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return { issues, beacons };
}

type NodeDefinition = {
  kind: string;
  label: string;
  family: string;
  icon: string;
  category: string;
  description: string;
  inputs: Port[];
  outputs: Port[];
  configFields: ConfigField[];
  defaults: Record<string, FieldValue>;
  basicPresetId?: string;
  basicMode?: "pipeline" | "choice";
  basicNodeLabels?: string[];
  basicSteps?: BasicStep[];
};

type BasicStep = {
  kind: string;
  label: string;
  operation?: string;
  category: string;
  inputs: Port[];
  outputs: Port[];
  configFields: ConfigField[];
  config: Record<string, FieldValue>;
};

type PendingConnection = {
  nodeId: string;
  handleId: string;
  handleType: "source" | "target";
};

type AppMenuId = "file" | "edit" | "workflow" | "view" | "help";
type LibraryMode = "basic" | "advanced";
type CanvasViewerSize = "compact" | "expanded" | "maximized";
type PortFilter = { type: string; connectSize?: PortConnectSize; handleType: "source" | "target" };

const PortFilterContext = createContext<(filter: PortFilter) => void>(() => undefined);

interface ContentNodeData extends Record<string, unknown> {
  kind: string;
  /** Họ node: định danh bất biến dùng để chạy node và giải thích công dụng. */
  family?: string;
  label: string;
  icon: string;
  category: string;
  description: string;
  inputs: Port[];
  outputs: Port[];
  configFields: ConfigField[];
  config: Record<string, FieldValue>;
  status: NodeStatus;
  beacon?: NodeBeacon;
  paused?: boolean;
  output?: Record<string, unknown>;
  /** Metadata Artifact của output gần nhất. Payload lớn tiếp tục nằm trong runtime/file local. */
  artifacts?: ArtifactSummary[];
  /** Lần chạy gần nhất, độc lập với output để chẩn đoán rõ tiến trình và lỗi. */
  run?: NodeRunRecord;
  duration?: number;
  progress?: ExecutionProgress;
  basicPresetId?: string;
  basicMode?: "pipeline" | "choice";
  basicNodeLabels?: string[];
  basicSteps?: BasicStep[];
  /** Cổng do người dùng định nghĩa cho Cổng vào/Cổng ra workflow. */
  workflowPorts?: WorkflowGatewayPort[];
  /** Workflow ngoài được node Gọi workflow tham chiếu cùng interface đã đọc. */
  calledWorkflow?: CalledWorkflowReference;
  /** File đã được node Lưu file ghi thành công và có thể tái sử dụng. */
  storedFiles?: StoredFileReference[];
  /** Hợp đồng Artifact của lô stored file gần nhất, giữ type và provenance. */
  storedArtifacts?: ArtifactSummary[];
  validationError?: string;
  /** Ba mức mới; viewerExpanded giữ lại để khôi phục workflow cũ. */
  viewerSize?: CanvasViewerSize;
  viewerExpanded?: boolean;
}

type ContentFlowNode = Node<ContentNodeData, "contentNode">;

/** Nhóm chỉ tổ chức cây Workflow; không thay đổi canvas hoặc luồng dữ liệu. */
type WorkflowGroup = {
  id: string;
  name: string;
  nodeIds: string[];
  /** Thu gọn/mở các node con trong cửa sổ Workflow. */
  collapsed: boolean;
};

type WorkflowGatewayPort = {
  /** ID ổn định: đổi tên hoặc sắp thứ tự không làm đứt dây/caller đã lưu. */
  id: string;
  name: string;
  type: string;
  /** Hợp đồng v1; field vắng mặt trong .tess cũ sẽ được suy ra từ type. */
  artifactType?: ArtifactType;
  cardinality?: PortCardinality;
  required: boolean;
  description?: string;
};

type WorkflowInterfaceShape = {
  version: 1;
  inputs: WorkflowGatewayPort[];
  outputs: WorkflowGatewayPort[];
};

type CalledWorkflowReference = {
  /** File .tess đã chọn, bản nhúng từ trình duyệt, hoặc workflow đang mở. */
  source?: "file" | "current" | "open-tab";
  path: string;
  workflowId: string;
  workflowInterface: WorkflowInterfaceShape;
  tabId?: string;
  /** Bản .tess đã đọc qua input web, để chạy thử không cần Tesseract Desktop. */
  embeddedWorkflow?: WorkflowDocumentLike;
};

const WORKFLOW_INPUT_GATEWAY_FAMILY = "Cổng vào";
const WORKFLOW_OUTPUT_GATEWAY_FAMILY = "Cổng ra";
const WORKFLOW_PORT_TYPE_SUGGESTIONS = [
  "Dữ liệu", "Text", "JSON", "Boolean", "Number", "Condition", "Prompt",
  "File[]", "Document[]", "Image[]", "Audio", "Video", "Folder", "URL[]",
  "FrameIndex", "TimedTranscript", "AIModel", "CachedData",
];

function workflowGatewayDirection(node: ContentFlowNode | undefined): "input" | "output" | null {
  const family = node ? nodeFamilyOf(node) : "";
  if (family === WORKFLOW_INPUT_GATEWAY_FAMILY) return "input";
  if (family === WORKFLOW_OUTPUT_GATEWAY_FAMILY) return "output";
  return null;
}

function isWorkflowGatewayNode(node: ContentFlowNode | undefined): boolean {
  return workflowGatewayDirection(node) !== null;
}

function createWorkflowPortId() {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `port-${suffix}`;
}

function normalizeWorkflowPortName(value: unknown, index: number): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, "_") : "";
  return name || `Cổng_${index + 1}`;
}

function normalizeWorkflowGatewayPorts(value: unknown): WorkflowGatewayPort[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" && raw.id.trim() && !usedIds.has(raw.id.trim()) ? raw.id.trim() : createWorkflowPortId();
    usedIds.add(id);
    const name = normalizeWorkflowPortName(raw.name, index);
    const type = typeof raw.type === "string" && raw.type.trim() ? raw.type.trim() : "Dữ liệu";
    const description = typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : undefined;
    const spec = portSpecFor({
      id,
      label: name,
      type,
      required: raw.required === true,
      artifactType: ARTIFACT_TYPES.includes(raw.artifactType as ArtifactType) ? raw.artifactType as ArtifactType : undefined,
      cardinality: raw.cardinality === "many" || raw.cardinality === "one" ? raw.cardinality : undefined,
    });
    return [{ id, name, type, required: spec.required, artifactType: spec.artifactType, cardinality: spec.cardinality, ...(description ? { description } : {}) }];
  });
}

function portsForWorkflowGateway(direction: "input" | "output", gatewayPorts: WorkflowGatewayPort[]): Pick<NodeDefinition, "inputs" | "outputs"> {
  const ports = gatewayPorts.map((port) => withPortDataContract({
    id: `workflow-port-${port.id}`,
    label: port.name,
    type: port.type,
    connectSize: getPortConnectSize(port.type),
    required: direction === "output" ? port.required : false,
    artifactType: port.artifactType,
    cardinality: port.cardinality,
  }));
  return direction === "input" ? { inputs: [], outputs: ports } : { inputs: ports, outputs: [] };
}

function workflowInterfaceFromNodes(nodes: ContentFlowNode[]): WorkflowInterfaceShape {
  const inputNode = nodes.find((node) => workflowGatewayDirection(node) === "input");
  const outputNode = nodes.find((node) => workflowGatewayDirection(node) === "output");
  return {
    version: 1,
    inputs: normalizeWorkflowGatewayPorts(inputNode?.data.workflowPorts),
    outputs: normalizeWorkflowGatewayPorts(outputNode?.data.workflowPorts),
  };
}

function normalizeWorkflowInterfaceShape(value: unknown): WorkflowInterfaceShape {
  return normalizeWorkflowInterface(value) as WorkflowInterfaceShape;
}

function portsForCalledWorkflow(workflowInterface: WorkflowInterfaceShape): Pick<NodeDefinition, "inputs" | "outputs"> {
  const toPorts = (ports: WorkflowGatewayPort[], required: boolean) => ports.map((port) => withPortDataContract({
    id: `workflow-port-${port.id}`,
    label: port.name,
    type: port.type,
    connectSize: getPortConnectSize(port.type),
    required: required && port.required,
    artifactType: port.artifactType,
    cardinality: port.cardinality,
  }));
  return {
    inputs: toPorts(workflowInterface.inputs, true),
    outputs: toPorts(workflowInterface.outputs, false),
  };
}

type WorkflowOutlinerDrag = { kind: "node" | "group"; id: string };
type OutlinerSelectionGesture = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };
type OutlinerMarquee = { left: number; top: number; width: number; height: number };

type CanvasHistorySnapshot = {
  nodes: ContentFlowNode[];
  edges: Edge[];
  selectedId: string | null;
  groups: WorkflowGroup[];
};

type WorkflowTab = {
  id: string;
  name: string;
  filePath: string | null;
  workflowId: string;
  workflowInterface: unknown;
  nodes: ContentFlowNode[];
  edges: Edge[];
  groups: WorkflowGroup[];
  selectedId: string | null;
  history: { past: CanvasHistorySnapshot[]; future: CanvasHistorySnapshot[] };
  /** Nội dung tại lần lưu gần nhất; dùng để hiển thị dấu chưa lưu riêng từng tab. */
  savedContentKey: string;
};

const CANVAS_HISTORY_LIMIT = 100;

function canvasHistorySnapshot(nodes: ContentFlowNode[], edges: Edge[], selectedId: string | null, groups: WorkflowGroup[] = []): CanvasHistorySnapshot {
  // Lịch sử chỉ giữ cấu trúc và cấu hình canvas. Kết quả chạy, file tạm và lỗi
  // runtime không được hoàn tác vì chúng có thể đã hết hạn hoặc không còn tồn tại.
  const savedNodes = nodes.map((node) => {
    const { output: _output, duration: _duration, progress: _progress, validationError: _validationError, ...data } = node.data;
    return {
      ...node,
      selected: false,
      data: {
        ...data,
        status: "idle" as NodeStatus,
        beacon: data.paused ? "paused" as NodeBeacon : "uncheck" as NodeBeacon,
      },
    };
  });
  return JSON.parse(JSON.stringify({ nodes: savedNodes, edges, selectedId, groups })) as CanvasHistorySnapshot;
}

function canvasHistoryKey(snapshot: CanvasHistorySnapshot): string {
  return JSON.stringify(snapshot);
}

function workflowTabContentKey(value: Pick<WorkflowTab, "name" | "workflowId" | "workflowInterface" | "nodes" | "edges" | "groups">): string {
  return JSON.stringify({
    name: value.name,
    workflowId: value.workflowId,
    workflowInterface: value.workflowInterface,
    nodes: value.nodes,
    edges: value.edges,
    groups: value.groups,
  });
}

function createWorkflowTabId(): string {
  return `workflow-tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeWorkflowGroups(value: unknown, nodes: ContentFlowNode[]): WorkflowGroup[] {
  if (!Array.isArray(value)) return [];
  const validNodeIds = new Set(nodes.map((node) => node.id));
  const claimedNodeIds = new Set<string>();
  return value.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Partial<WorkflowGroup>;
    const nodeIds = Array.isArray(raw.nodeIds)
      ? raw.nodeIds.filter((nodeId): nodeId is string => typeof nodeId === "string" && validNodeIds.has(nodeId) && !claimedNodeIds.has(nodeId))
      : [];
    nodeIds.forEach((nodeId) => claimedNodeIds.add(nodeId));
    if (!nodeIds.length) return [];
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `Group ${index + 1}`;
    return [{
      id: typeof raw.id === "string" && raw.id ? raw.id : `group-${index + 1}`,
      name,
      nodeIds,
      // "hidden" là tên cũ từng ẩn nhầm canvas. Giữ ý nghĩa thu gọn khi mở
      // workflow cũ, nhưng từ phiên bản này canvas luôn phải hiện node.
      collapsed: (raw as { collapsed?: unknown }).collapsed === true || raw.hidden === true,
    }];
  });
}

function repairDuplicateWorkflowNodeIds(nodes: ContentFlowNode[]): { nodes: ContentFlowNode[]; repaired: number } {
  const usedIds = new Set<string>();
  let repaired = 0;
  return {
    nodes: nodes.map((node, index) => {
      const originalId = String(node.id || `node-${index + 1}`);
      if (!usedIds.has(originalId)) {
        usedIds.add(originalId);
        return node;
      }
      repaired += 1;
      let suffix = 2;
      let id = `${originalId}-recovered-${suffix}`;
      while (usedIds.has(id)) id = `${originalId}-recovered-${++suffix}`;
      usedIds.add(id);
      return { ...node, id };
    }),
    repaired,
  };
}
type CanvasClipboard = { nodes: ContentFlowNode[]; edges: Edge[] };

const CATEGORY_COLORS: Record<string, string> = {
  "Video": "#f000b8",
  "Đầu vào": "#00b8ff",
  "AI & mô hình": "#ff4d8d",
  "Nghiên cứu": "#00c896",
  "Phát triển nội dung": "#a855f7",
  "Hình ảnh": "#a8e600",
  "Âm thanh": "#ffd000",
  "Văn bản": "#dce7f3",
  "Kiểm tra chất lượng": "#ff9f1c",
  "Xuất bản": "#ff334f",
  "Điều khiển workflow": "#7c4dff",
  "Quản lý dữ liệu": "#c47a44",
};

function categoryStyle(category: string): CSSProperties {
  return {
    "--category-color": CATEGORY_COLORS[category] ?? "#7c5cff",
  } as CSSProperties;
}

const CATEGORY_ICONS: Record<string, string> = {
  "Video": "⏵",
  "Đầu vào": "⤓",
  "AI & mô hình": "✺",
  "Nghiên cứu": "🔎",
  "Phát triển nội dung": "✦",
  "Hình ảnh": "◫",
  "Âm thanh": "♪",
  "Văn bản": "T",
  "Kiểm tra chất lượng": "✓",
  "Xuất bản": "⇧",
  "Điều khiển workflow": "⑂",
  "Quản lý dữ liệu": "◇",
};

// Thứ tự được đọc trái sang phải, rồi xuống dòng: chuỗi sản xuất trước,
// các nhóm công cụ dùng xuyên suốt đặt sau để người mới dễ đi theo luồng.
const CATEGORY_ORDER = [
  "Đầu vào", "Nghiên cứu", "Phát triển nội dung", "Văn bản",
  "Hình ảnh", "Âm thanh", "Video", "Kiểm tra chất lượng", "Xuất bản",
  "AI & mô hình", "Điều khiển workflow", "Quản lý dữ liệu",
] as const;

const CATEGORY_RENAMES: Record<string, string> = {
  "Kịch bản video": "Phát triển nội dung",
  "Kịch bản": "Phát triển nội dung",
  "Tư liệu video": "Quản lý dữ liệu",
  "Giọng đọc và âm thanh": "Âm thanh",
  "Giọng đọc & âm thanh": "Âm thanh",
  "Subtitle và chữ": "Văn bản",
  "Dựng cảnh": "Video",
  "Dựng video tổng": "Video",
  "Dựng video": "Video",
};

const VIDEO_ASSET_NODES = new Set([
  "Tìm kho video", "Tìm thư viện video nội bộ", "Tải video từ nguồn",
]);
const VIDEO_RESEARCH_NODES = new Set([
  "Lập chỉ mục video", "Phiên âm video theo thời gian", "Tạo storyboard video",
  "Phân tích từng đoạn video", "Kiểm tra đoạn chưa chắc chắn", "Tổng hợp nội dung video", "Thiết lập vùng chú ý video", "Làm rõ highlight lặp",
]);
const VIDEO_AI_NODES = new Set([
  "Text-to-video", "Image-to-video", "Tạo chuyển động ảnh", "Tạo B-roll",
]);

// Tên hiển thị ưu tiên động từ + đối tượng, để hiểu công dụng node ngay từ thư viện.
// Khóa gốc được giữ lại làm định danh nội bộ, nhờ đó workflow cũ vẫn mở được.
const NODE_NAME_OVERRIDES: Record<string, string> = {
  "Gọi AI": "Xử lý văn bản bằng AI", "Phân tích hình ảnh, âm thanh hoặc video bằng AI": "Phân tích media bằng AI", "Phân tích ảnh hoặc âm thanh bằng AI": "Phân tích media bằng AI",
  "Nhập tài liệu": "Tải tài liệu từ máy", "Tải ảnh lên": "Tải ảnh từ máy", "Tải video lên": "Tải video gốc từ máy", "Tải âm thanh lên": "Tải âm thanh từ máy", "Lịch chạy": "Thiết lập lịch chạy", "Webhook": "Nhận dữ liệu qua webhook", "Chọn nguồn file": "Nguồn file", "Chọn nguồn media": "Nguồn media", "Chọn nguồn hình ảnh": "Nguồn hình ảnh", "Chọn nguồn âm thanh": "Nguồn âm thanh",
  "Lấy transcript": "Trích xuất transcript video", "Tổng hợp nguồn": "Tổng hợp các nguồn", "So sánh nguồn": "So sánh các nguồn", "Xếp hạng nguồn": "Xếp hạng độ tin cậy nguồn", "Duyệt nguồn": "Duyệt nguồn thủ công",
  "Xác định khán giả": "Xác định đối tượng xem", "Viết lại": "Viết lại nội dung", "Mở rộng": "Mở rộng nội dung", "Rút gọn": "Rút gọn nội dung", "Kiểm tra trùng lặp": "Kiểm tra nội dung trùng lặp", "Duyệt nội dung": "Duyệt nội dung thủ công",
  "Viết hook": "Viết hook video", "Viết mở đầu": "Viết phần mở đầu video", "Viết kịch bản": "Viết kịch bản video", "Chia chương": "Chia chương kịch bản", "Chia phân cảnh": "Chia phân cảnh video", "Ước tính thời lượng": "Ước tính thời lượng video", "Tạo lời thoại cảnh": "Viết lời thoại từng cảnh", "Mô tả hình ảnh cảnh": "Mô tả hình ảnh từng cảnh", "Chỉ dẫn dựng phim": "Tạo chỉ dẫn dựng phim", "Tạo CTA": "Viết CTA video", "Tạo intro/outro": "Viết intro và outro", "Kiểm tra nhịp độ": "Kiểm tra nhịp độ kịch bản", "Sắp xếp phân cảnh": "Sắp xếp lại phân cảnh",
  "Tìm kho ảnh": "Tìm ảnh trong kho", "Tìm thư viện ảnh nội bộ": "Tìm ảnh trong thư viện", "Tải kho ảnh từ thư mục": "Nạp kho ảnh từ thư mục", "Tạo ảnh AI": "Tạo ảnh bằng AI", "Image-to-image": "Chuyển đổi ảnh bằng AI", "Mở rộng khung ảnh": "Mở rộng khung hình ảnh", "Resize/crop ảnh": "Cắt khung và đổi kích thước ảnh", "Upscale ảnh": "Nâng độ phân giải ảnh", "Tạo phương án ảnh": "Tạo các phương án ảnh", "Chọn ảnh": "Chọn ảnh phù hợp", "Duyệt ảnh": "Duyệt ảnh thủ công",
  "Tìm kho video": "Tìm video trong kho", "Tìm thư viện video nội bộ": "Tìm video trong thư viện", "Text-to-video": "Tạo video từ văn bản", "Image-to-video": "Tạo video từ ảnh", "Tải video từ nguồn": "Tải video từ URL", "Cắt video": "Cắt đoạn từ video gốc", "Crop/resize video": "Cắt khung và đổi kích thước video", "Đổi tốc độ video": "Thay đổi tốc độ video", "Tạo chuyển động ảnh": "Tạo chuyển động từ ảnh", "Tạo B-roll": "Tạo video B-roll", "Nối video": "Ghép các đoạn video", "Tạo phương án video": "Tạo các phương án video", "Chọn video": "Chọn video phù hợp", "Duyệt video": "Duyệt video thủ công", "Lập chỉ mục video": "Lập chỉ mục video theo thời gian", "Phiên âm video theo thời gian": "Tạo transcript video theo thời gian", "Tạo storyboard video": "Tạo storyboard từ video", "Phân tích từng đoạn video": "Phân tích video theo từng đoạn", "Kiểm tra đoạn chưa chắc chắn": "Rà soát đoạn video chưa chắc chắn", "Chọn highlight bằng AI": "Chọn các đoạn highlight bằng AI", "Dựng video highlight": "Cắt và ghép video highlight",
  "Chọn giọng": "Chọn giọng đọc", "Clone giọng": "Nhân bản giọng đọc", "Chia lời đọc": "Chia đoạn lời đọc", "Ghép lời đọc": "Ghép các đoạn lời đọc", "Làm sạch âm thanh": "Làm sạch tạp âm", "Ducking": "Giảm nhạc nền theo lời đọc", "Trộn voice và nhạc": "Trộn lời đọc và nhạc", "Duyệt âm thanh": "Duyệt âm thanh thủ công",
  "Speech-to-text": "Chuyển giọng nói thành văn bản", "Tạo subtitle": "Tạo phụ đề", "Đồng bộ subtitle": "Đồng bộ phụ đề", "Sửa chính tả subtitle": "Sửa chính tả phụ đề", "Chia dòng subtitle": "Chia dòng phụ đề", "Dịch subtitle": "Dịch phụ đề", "Chọn kiểu subtitle": "Chọn kiểu phụ đề", "Chèn subtitle": "Chèn phụ đề vào video", "Xuất SRT/VTT": "Xuất tệp phụ đề SRT/VTT", "Text nhấn mạnh": "Tạo chữ nhấn mạnh", "Lower third": "Tạo nhãn tên lower third",
  "Tạo timeline cảnh": "Tạo timeline cho cảnh", "Ghép thoại và tư liệu": "Ghép lời thoại với tư liệu", "Căn thời lượng hình": "Căn thời lượng hình theo lời", "Chèn text cảnh": "Chèn chữ vào cảnh", "Preview cảnh": "Xem trước cảnh", "Render cảnh": "Render cảnh hoàn chỉnh", "Duyệt cảnh": "Duyệt cảnh thủ công", "Khóa cảnh": "Khóa cảnh đã duyệt",
  "Sắp xếp cảnh": "Sắp xếp thứ tự cảnh", "Ghép các cảnh": "Ghép các cảnh thành video", "Thêm intro": "Chèn video intro", "Thêm outro": "Chèn video outro", "Thêm nhạc nền": "Chèn nhạc nền vào video", "Chèn logo": "Chèn logo hoặc watermark", "Chèn chapter": "Chèn mốc chương", "Áp dụng thương hiệu": "Áp dụng bộ nhận diện", "Tạo timeline tổng": "Tạo timeline video tổng", "Preview chất lượng thấp": "Xem trước bản nhẹ", "Render nháp": "Render video nháp", "Render chính": "Render video chính", "Xuất nhiều tỷ lệ": "Xuất các tỷ lệ video",
  "Kiểm tra yêu cầu và cấu trúc": "Kiểm tra yêu cầu và cấu trúc", "Chuẩn bị kiểm tra AI": "Chuẩn bị kiểm tra AI", "Đọc kết quả AI kiểm tra": "Đọc kết quả AI kiểm tra", "Tổng hợp báo cáo kiểm tra": "Tổng hợp báo cáo kiểm tra", "Kiểm tra subtitle": "Kiểm tra phụ đề", "Kiểm tra hình–lời": "Kiểm tra hình và lời không khớp", "Kiểm tra kỹ thuật": "Kiểm tra độ phân giải và định dạng", "Kiểm tra nhạy cảm": "Kiểm tra nội dung nhạy cảm", "Kiểm tra YouTube": "Kiểm tra chính sách YouTube", "Duyệt xuất bản": "Duyệt trước khi xuất bản",
  "Tạo chapter metadata": "Tạo mốc chương video", "Tạo hashtag": "Tạo hashtag và từ khóa", "Chấm thumbnail": "Chấm điểm thumbnail", "A/B thumbnail": "Tạo phương án A/B thumbnail", "Upload YouTube": "Tải video lên YouTube", "Đặt lịch đăng": "Đặt lịch đăng video", "Thêm playlist": "Thêm video vào playlist", "Ghim bình luận": "Ghim bình luận YouTube", "Lưu kết quả xuất bản": "Lưu URL và Video ID",
  "If/Else": "Rẽ nhánh điều kiện If/Else", "Switch": "Rẽ nhánh nhiều điều kiện", "Loop từng cảnh": "Lặp qua từng cảnh", "Chờ xử lý": "Chờ tác vụ hoàn tất", "Delay": "Chờ theo thời gian", "Retry": "Thử lại khi lỗi", "Giới hạn thử lại": "Giới hạn số lần thử lại", "Chạy thủ công": "Chạy workflow thủ công", "Tạm dừng": "Tạm dừng workflow", "Workflow con": "Chạy workflow con", "Gọi API": "Gọi API ngoài", "Chạy mã": "Chạy mã tùy chỉnh",
  "Lưu biến": "Lưu biến dữ liệu", "Chọn phần tử": "Chọn một phần tử", "Đọc thư viện": "Đọc thư viện tư liệu", "Cache kết quả": "Lưu tư liệu/cache để dùng lại nhanh", "Xóa file tạm": "Xóa các file tạm",
};

function displayNodeName(name: string): string {
  return NODE_NAME_OVERRIDES[name] ?? name;
}

function displayCategory(category: string, nodeName?: string): string {
  if (category === "Video" && nodeName) {
    if (VIDEO_ASSET_NODES.has(nodeName)) return "Quản lý dữ liệu";
    if (VIDEO_RESEARCH_NODES.has(nodeName)) return "Nghiên cứu";
    if (VIDEO_AI_NODES.has(nodeName)) return "AI & mô hình";
  }
  return CATEGORY_RENAMES[category] ?? category;
}

// Icon là ngôn ngữ nhận dạng nhanh, không được luân phiên theo vị trí node.
// Các thao tác quan trọng có biểu tượng riêng; quy tắc phía dưới bao phủ node
// mới theo chức năng để icon luôn giữ đúng nghĩa khi catalog được mở rộng.
const SEMANTIC_NODE_ICONS: Record<string, string> = {
  "Nhập đề tài": "✎", "Nhập văn bản": "T", "Nhập URL": "🔗", "Nhập ngày giờ": "◷", "Nhập thời gian": "◴", "Nhập Boolean": "☑", "Nhập biến": "◇", "Nhập tài liệu": "▤",
  "Tải ảnh lên": "◫", "Tải video lên": "▶", "Tải âm thanh lên": "♪", "Chọn thư mục trên máy": "▰", "Tải kho ảnh từ thư mục": "▰",
  "Hồ sơ thương hiệu": "◆", "Cấu hình video": "⚙", "Lịch chạy": "◷", "Webhook": "⚡", "Cấu hình API key": "🔑",
  "Tìm kiếm Internet": "🔎", "Đọc trang web": "🔗", "Đọc tài liệu": "▤", "Lấy transcript": "T",
  "Tổng hợp nguồn": "≡", "Trích xuất dữ kiện": "◆", "Kiểm tra dữ kiện": "✓", "So sánh nguồn": "⇄", "Xếp hạng nguồn": "◎", "Duyệt nguồn": "✓",
  "Tạo ý tưởng": "✦", "Chấm điểm ý tưởng": "◎", "Xác định khán giả": "◉", "Tạo góc tiếp cận": "◔", "Tạo dàn ý": "☷",
  "Viết nội dung": "✎", "Viết lại": "↻", "Mở rộng": "↗", "Rút gọn": "↙", "Thay đổi giọng văn": "♬", "Kiểm tra nội dung": "✓", "Kiểm tra trùng lặp": "⧉", "Kiểm tra chính sách": "⚖", "Duyệt nội dung": "✓",
  "Viết hook": "⚡", "Viết mở đầu": "▣", "Viết kịch bản": "▤", "Chia chương": "☷", "Chia phân cảnh": "▦", "Ước tính thời lượng": "◷", "Tạo lời thoại cảnh": "♪", "Mô tả hình ảnh cảnh": "◫", "Chỉ dẫn dựng phim": "▶", "Tạo CTA": "↗", "Tạo intro/outro": "⟲", "Kiểm tra nhịp độ": "≋", "Sắp xếp phân cảnh": "↕",
  "Tạo từ khóa ảnh": "🔎", "Tìm kho ảnh": "🔎", "Tìm thư viện ảnh nội bộ": "▰", "Tạo ảnh AI": "✦", "Image-to-image": "⇄", "Xóa nền ảnh": "⌫", "Thay nền ảnh": "▧", "Mở rộng khung ảnh": "⤢", "Resize/crop ảnh": "⌗", "Giảm độ phân giải ảnh": "↘", "Upscale ảnh": "↗", "Chỉnh màu ảnh": "◐", "Thêm chữ vào ảnh": "T", "Thêm logo vào ảnh": "◆", "Tạo phương án ảnh": "⊕", "Chấm điểm ảnh": "◎", "Chọn ảnh": "◉", "Duyệt ảnh": "✓", "Tải ảnh từ URL": "🔗",
  "Tìm kho video": "🔎", "Tìm thư viện video nội bộ": "▰", "Text-to-video": "T", "Image-to-video": "◫", "Tải video từ nguồn": "🔗", "Cắt video": "✂", "Tách cảnh video": "▦", "Crop/resize video": "⌗", "Đổi tốc độ video": "≫", "Ổn định video": "⚓", "Xóa nền video": "⌫", "Chỉnh màu video": "◐", "Tạo chuyển động ảnh": "≈", "Tạo B-roll": "▶", "Nối video": "⋈", "Tạo phương án video": "⊕", "Chấm điểm video": "◎", "Chọn video": "◉", "Duyệt video": "✓", "Lập chỉ mục video": "≡", "Trích frame từ video": "▦", "Thiết lập vùng chú ý video": "⌖", "Làm rõ highlight lặp": "⟳", "Phiên âm video theo thời gian": "T", "Tạo storyboard video": "▦", "Phân tích từng đoạn video": "🔎", "Kiểm tra đoạn chưa chắc chắn": "?", "Tổng hợp nội dung video": "≡", "Chọn highlight bằng AI": "✦", "Dựng video highlight": "✂",
  "Chọn giọng": "◉", "Tạo giọng đọc": "♪", "Clone giọng": "⧉", "Chia lời đọc": "↹", "Ghép lời đọc": "⋈", "Điều chỉnh tốc độ giọng": "≫", "Điều chỉnh cảm xúc": "♥", "Làm sạch âm thanh": "✧", "Chuẩn hóa âm lượng": "▥", "Tìm nhạc nền": "🔎", "Tạo nhạc nền": "♫", "Tạo hiệu ứng âm thanh": "✦", "Trộn voice và nhạc": "⋈", "Ducking": "⇣", "Duyệt âm thanh": "✓", "Tìm kho âm thanh": "🔎", "Tìm thư viện âm thanh nội bộ": "▰", "Tải âm thanh từ URL": "🔗",
  "Speech-to-text": "T", "Tạo subtitle": "▤", "Đồng bộ subtitle": "↔", "Sửa chính tả subtitle": "✓", "Chia dòng subtitle": "≡", "Dịch subtitle": "文", "Chọn kiểu subtitle": "A", "Chèn subtitle": "T", "Xuất SRT/VTT": "⇩", "Text nhấn mạnh": "!", "Lower third": "▱",
  "Tạo timeline cảnh": "◷", "Ghép thoại và tư liệu": "⋈", "Căn thời lượng hình": "↔", "Tạo chuyển động ảnh cho cảnh": "≈", "Chèn text cảnh": "T", "Chèn hiệu ứng": "✦", "Chèn chuyển cảnh": "⇄", "Preview cảnh": "◉", "Render cảnh": "▶", "Kiểm tra cảnh": "✓", "Duyệt cảnh": "✓", "Khóa cảnh": "▣",
  "Sắp xếp cảnh": "↕", "Ghép các cảnh": "⋈", "Thêm intro": "↰", "Thêm outro": "↳", "Thêm nhạc nền": "♪", "Chèn logo": "◆", "Chèn chapter": "☷", "Áp dụng thương hiệu": "◆", "Tạo timeline tổng": "◷", "Preview chất lượng thấp": "◉", "Render nháp": "▷", "Render chính": "▶", "Xuất nhiều tỷ lệ": "⇧",
  "Kiểm tra yêu cầu và cấu trúc": "✓", "Chuẩn bị kiểm tra AI": "✎", "Đọc kết quả AI kiểm tra": "◇", "Tổng hợp báo cáo kiểm tra": "≡", "Kiểm tra subtitle": "T", "Kiểm tra hình–lời": "↔", "Kiểm tra kỹ thuật": "⚙", "Kiểm tra bản quyền": "©", "Kiểm tra nhạy cảm": "⚠", "Kiểm tra YouTube": "▶", "Chấm điểm thành phẩm": "◎", "Duyệt xuất bản": "✓",
  "Tạo tiêu đề": "T", "Tạo mô tả": "▤", "Tạo chapter metadata": "☷", "Tạo hashtag": "#", "Tạo thumbnail": "◫", "Chọn ảnh thumbnail bằng AI": "◉", "Chấm thumbnail": "◎", "A/B thumbnail": "⇄", "Upload YouTube": "⇧", "Đặt lịch đăng": "◷", "Thêm playlist": "☷", "Thiết lập quyền riêng tư": "▣", "Ghim bình luận": "⚑", "Lưu kết quả xuất bản": "◆",
  "Bắt đầu": "▶", "Kết thúc": "■", "If/Else": "?", "Switch": "⇄", "Chạy song song": "∥", "Gộp kết quả": "⋈", "Loop từng cảnh": "↻", "Chờ xử lý": "◷", "Delay": "◴", "Retry": "↻", "Giới hạn thử lại": "#", "Chạy thủ công": "☝", "Yêu cầu phê duyệt": "✓", "Tạm dừng": "Ⅱ", "Xử lý lỗi": "!", "Workflow con": "▧", "Gọi API": "{}", "Chạy mã": "</>",
  "Lưu biến": "◆", "Chuyển đổi dữ liệu": "⇄", "Ghép dữ liệu": "⋈", "Lọc danh sách": "🔎", "Sắp xếp danh sách": "↕", "Chọn phần tử": "◉", "Lưu file": "▤", "Lưu phiên bản": "◴", "Lấy phiên bản cũ": "↶", "Đọc thư viện": "▰", "Ghi log": "≡", "Theo dõi chi phí": "$", "Cache kết quả": "□", "Xóa file tạm": "⌫",
  "Chọn nhà cung cấp AI": "☁", "Chọn mô hình AI": "◈", "Lựa chọn model AI": "◎", "Soạn system prompt": "✎", "Tạo prompt từ dữ liệu": "✦", "Gọi AI trả JSON": "{}", "Phân tích hình ảnh bằng AI": "◫", "Phân tích âm thanh bằng AI": "♪", "Phân tích video bằng AI": "▶", "Chuẩn bị tư liệu phân tích video": "▣", "Tách âm thanh từ video": "♫", "Chấm điểm đầu ra AI": "◎", "Duyệt đầu ra AI": "✓",
  "Thiết lập AI": "⚙", "Tạo prompt AI": "✎", "Xử lý văn bản bằng AI": "✦", "Gọi AI": "✦", "Phân tích ảnh hoặc âm thanh bằng AI": "🔎", "Đánh giá đầu ra AI": "◎",
  "Nhập chủ đề và yêu cầu": "✎", "Nhập trực tiếp": "✎", "Nguồn file": "▤", "Nguồn folder": "▰", "Kho ảnh từ thư mục": "▰", "Cấu hình vận hành": "⚙", "Nghiên cứu Internet": "🔎", "Đọc nguồn": "▤", "Xác minh dữ kiện": "✓", "Đánh giá và duyệt nguồn": "◎", "Phát triển ý tưởng": "✦", "Phân tích khán giả": "◉", "Góc tiếp cận": "◔", "Dàn ý nội dung": "☷", "Viết và biên tập": "✎", "Kiểm tra và duyệt nội dung": "✓", "Viết kịch bản hoàn chỉnh": "▤", "Thiết kế phân cảnh": "▦", "Kiểm tra kịch bản": "✓", "Tạo ảnh": "✦", "Phân tích nội dung video": "🔎", "Tạo highlight bằng AI": "✂", "Tạo tư liệu video bằng AI": "✦", "Chỉnh sửa video": "✂", "Sản xuất giọng đọc": "♪", "Biên tập lời đọc": "↹", "Nhạc, hiệu ứng và phối âm": "♫", "Chuẩn hóa và xuất subtitle": "T", "Dựng cảnh": "▦", "Render và duyệt cảnh": "▶", "Dựng video tổng": "⋈", "Render video": "▶", "Kiểm tra thành phẩm": "✓", "Chấm điểm và duyệt thành phẩm": "◎", "Metadata xuất bản": "▤", "Thumbnail": "◫", "Chọn ảnh thumbnail bằng AI": "◉", "Đăng YouTube": "⇧", "Phân nhánh workflow": "?", "Chạy song song và gộp": "∥", "Chờ, thử lại và xử lý lỗi": "↻", "Tự động hóa nâng cao": "⚙", "Xử lý dữ liệu": "⇄", "Lưu trữ và vận hành": "◆",
};

function iconForNode(name: string, category: string): string {
  const exact = SEMANTIC_NODE_ICONS[name];
  if (exact) return exact;
  const text = name.toLocaleLowerCase("vi");
  if (text.includes("url")) return "🔗";
  if (text.includes("api")) return "{}";
  if (text.includes("thư mục") || text.includes("thư viện")) return "▰";
  if (text.includes("tìm") || text.includes("kiểm tra")) return "🔎";
  if (text.includes("tải") || text.includes("xuất")) return "⇩";
  if (text.includes("viết") || text.includes("văn bản") || text.includes("subtitle")) return "T";
  if (text.includes("ảnh") || text.includes("thumbnail")) return "◫";
  if (text.includes("video") || text.includes("cảnh") || text.includes("render")) return "▶";
  if (text.includes("âm thanh") || text.includes("giọng") || text.includes("nhạc")) return "♪";
  if (text.includes("duyệt") || text.includes("chấm điểm")) return "✓";
  return ({ "Đầu vào": "⤒", "Nghiên cứu": "🔎", "Phát triển nội dung": "✎", "Hình ảnh": "◫", "Âm thanh": "♪", "Văn bản": "T", "Video": "▶", "Kiểm tra chất lượng": "✓", "Xuất bản": "⇧", "AI & mô hình": "✦", "Điều khiển workflow": "⚙", "Quản lý dữ liệu": "◆" } as Record<string, string>)[category] ?? "◇";
}

// Một nhóm là một bộ công cụ độc lập: icon phải phân biệt được từng node ngay
// cả khi tên bị cắt bớt trong thư viện. Danh sách dự phòng chỉ dùng khi icon
// ngữ nghĩa đã trùng trong CÙNG nhóm; Basic và Chi tiết được xử lý riêng để
// cặp node tương ứng vẫn có thể dùng cùng dấu hiệu.
const DISTINCT_ICON_FALLBACKS = [
  "◆", "◇", "◈", "◉", "◍", "◐", "◑", "◒", "◓", "◔", "◕", "◖", "◗", "◘", "◙", "◚", "◛", "◜", "◝", "◞", "◟",
  "□", "■", "▣", "▤", "▥", "▦", "▧", "▰", "△", "▲", "▽", "▼", "⬟", "⬢", "✦", "✧", "✩", "✪", "✿", "✂", "✎",
  "☁", "☂", "☀", "☾", "⚙", "⚑", "⚡", "⚓", "⚖", "✓", "✔", "☑", "✕", "✖", "!", "?", "#", "$", "{}", "T", "A",
  "♪", "♫", "♬", "♥", "♠", "♣", "♦", "◎", "↔", "↕", "⇄", "↻", "↗", "↙", "↶", "⇧", "⇣", "⤢", "⌗", "⧉", "≡", "∥", "Ⅱ", "⋈", "⌫", "⟲", "◴", "◷", "⤒", "🔗", "🔎", "▶", "▷",
] as const;

function ensureUniqueIconsByCategory(definitions: NodeDefinition[]): NodeDefinition[] {
  const usedIconsByCategory = new Map<string, Set<string>>();
  return definitions.map((definition) => {
    const used = usedIconsByCategory.get(definition.category) ?? new Set<string>();
    usedIconsByCategory.set(definition.category, used);
    const icon = used.has(definition.icon)
      ? DISTINCT_ICON_FALLBACKS.find((candidate) => !used.has(candidate)) ?? definition.icon
      : definition.icon;
    used.add(icon);
    return icon === definition.icon ? definition : { ...definition, icon };
  });
}

function nodeIconClass(baseClass: string, icon: string): string {
  return `${baseClass}${icon === "🔎" ? " search-icon" : ""}`;
}

function splitContract(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function makePorts(value: string, prefix: "input" | "output", required: boolean): Port[] {
  return splitContract(value)
    .map((type, index) => withPortDataContract({
        id: prefix + "-" + (index + 1),
        label: displayPortLabel(type),
        type,
        connectSize: getPortConnectSize(type),
        required,
      }))
    .sort((left, right) => left.label.localeCompare(right.label, "vi", { sensitivity: "base" }));
}

const OPTIONAL_INPUT_TYPES: Record<string, string[]> = {
  "Lựa chọn model AI": ["CachedData"],
  "Gọi AI tạo văn bản": ["CachedData"],
  "Gọi AI trả JSON": ["CachedData"],
  "Phân tích hình ảnh bằng AI": ["CachedData", "AttentionRegion"],
  "Phân tích âm thanh bằng AI": ["CachedData"],
  "Phân tích video bằng AI": ["CachedData", "TimedTranscript"],
  "Phân tích từng đoạn video": ["CachedData"],
  "Tổng hợp nội dung video": ["CachedData"],
  "Chọn highlight bằng AI": ["CachedData"],
  "Làm rõ highlight lặp": ["CachedData", "TimedTranscript", "AttentionRegion"],
  "Lấy vùng chú ý": ["Image[]"],
  "Thiết lập vùng chú ý video": ["Video"],
  "Tạo tiêu đề": ["CachedData"],
  "Chọn ảnh thumbnail bằng AI": ["CachedData"],
  "Bố cục thumbnail bằng AI": ["CachedData"],
  "Tạo ý tưởng": ["ResearchBrief"],
  "Xác định khán giả": ["dữ liệu kênh"],
  "Tạo dàn ý": ["Source[]"],
  "Viết nội dung": ["Source[]", "BrandProfile"],
  "Viết lại": ["yêu cầu"],
  "Mở rộng": ["Source[]"],
  "Thay đổi giọng văn": ["BrandProfile"],
  "Kiểm tra trùng lặp": ["nguồn"],
  "Duyệt nội dung": ["ReviewResult"],
  "Lưu file": ["Folder"],
  // If/Else có điều kiện dự phòng khi người dùng chưa nối dây Condition.
  "If/Else": ["Condition"],
  // Tìm ảnh cho phép nạp mẫu/ảnh tìm trực tiếp trong node. FrameIndex chỉ bổ
  // sung timecode, nên không bao giờ là điều kiện bắt buộc để chạy tìm ảnh.
  "Tìm ảnh tương đồng": ["ImageSample", "ImageSearch", "ImageSearchList", "SearchFolder", "FrameIndex"],
};

// Cổng này nhận Text, Document[] hoặc File[] bằng cấp kết nối `down`. Nhờ vậy
// một danh sách thuật ngữ đã có sẵn trong file có thể nối thẳng vào transcript.
const TRANSCRIPT_TERMS_INPUT_PORT: Port = {
  id: "input-terms",
  label: "Thuật ngữ",
  type: "Thuật ngữ",
  connectSize: "down",
  required: false,
  artifactType: "Any",
  cardinality: "many",
};

function inputPortsForSpec(spec: { group: string; name: string; input: string }): Port[] {
  if (spec.group === "Đầu vào" || (SELF_CONFIGURED_NODE_NAMES.has(spec.name) && spec.name !== "Chọn nhà cung cấp AI")) return [];
  const allOptional = spec.group === "Nghiên cứu" && ["Tìm kiếm Internet", "Lấy transcript video"].includes(spec.name);
  const optionalTypes = OPTIONAL_INPUT_TYPES[spec.name] ?? [];
  const inputContract = DIRECT_AI_KEY_SPEC_NAMES.has(spec.name) ? [spec.input, "APIKey"].filter(Boolean).join(", ") : spec.input;
  const imageSearchSpecialInputs = new Set(["ImageSample", "ImageSearch", "ImageSearchList", "SearchFolder"]);
  const ports = makePorts(inputContract, "input", true).map((port) => ({
    ...port,
    // Cổng chuyên biệt vẫn nhận kiểu cha Image/Image[] hoặc Folder tiêu chuẩn.
    connectSize: spec.name === "Tìm ảnh tương đồng" && imageSearchSpecialInputs.has(port.type) ? "up" : port.connectSize,
    required: !allOptional && !optionalTypes.includes(port.type) && !(DIRECT_AI_KEY_SPEC_NAMES.has(spec.name) && port.type === "APIKey"),
  }));
  const namedPorts = spec.name === "Tạo prompt từ dữ liệu"
    ? ports.map((port) => port.type === "Dữ liệu" ? { ...port, label: "Dữ liệu nguồn" } : port)
    : ports;
  return spec.name === "Phiên âm video theo thời gian" ? [...namedPorts, TRANSCRIPT_TERMS_INPUT_PORT] : namedPorts;
}

function settingKey(label: string, index: number): string {
  return "setting-" + (index + 1) + "-" + label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const INPUT_NODE_FIELDS: Record<string, ConfigField[]> = {
  "Nhập đề tài": [
    { key: "topic", label: "Chủ đề", type: "textarea", placeholder: "Nội dung chính bạn muốn sản xuất..." },
    { key: "goal", label: "Mục tiêu", type: "textarea", placeholder: "Giáo dục, bán hàng, tăng nhận diện..." },
    { key: "audience", label: "Đối tượng", type: "text", placeholder: "Ví dụ: chủ shop online 25–40 tuổi" },
    { key: "length", label: "Độ dài mục tiêu (từ)", type: "number", min: 10, step: 10, defaultValue: 300 },
  ],
  "Nhập văn bản": [
    { key: "content", label: "Nhập trực tiếp", type: "textarea", placeholder: "Nhập hoặc dán toàn bộ nội dung tại đây...", maxLength: 50000, help: "Tối đa 50.000 ký tự, phù hợp cho bài viết dài hoặc kịch bản." },
  ],
  "Nhập URL": [
    { key: "urls", label: "Danh sách URL", type: "url-list", placeholder: "https://...", help: "Thêm từng URL; có thể xóa riêng từng mục." },
    { key: "readContent", label: "Tự động đọc nội dung trang", type: "checkbox", defaultValue: true },
  ],
  "Nhập ngày giờ": [
    { key: "dateTime", label: "Ngày giờ", type: "date-time-pair", defaultValues: { time: "00:00", date: new Date().toLocaleDateString("en-CA") } },
    { key: "timezone", label: "Múi giờ", type: "select", options: ["Asia/Bangkok (UTC+7)", "Asia/Ho_Chi_Minh (UTC+7)", "UTC", "Asia/Tokyo (UTC+9)", "America/New_York"], defaultValue: "Asia/Bangkok (UTC+7)" },
  ],
  "Nhập thời gian": [
    { key: "durationText", label: "Thời gian", type: "text", placeholder: "Ví dụ: 3d120m hoặc 3600", help: "Dùng y, M, d, h, m, s (ví dụ 1h30m), hoặc nhập số giây thuần. Năm = 365 ngày, tháng = 30 ngày." },
  ],
  "Nhập Boolean": [
    { key: "booleanValue", label: "Giá trị", type: "select", options: ["true", "false"], defaultValue: "true" },
  ],
  "Nhập biến": [
    { key: "variableName", label: "Tên biến", type: "text", placeholder: "Ví dụ: maxDuration" },
    { key: "variableValue", label: "Giá trị", type: "text", placeholder: "Ví dụ: 60" },
    { key: "variableType", label: "Kiểu dữ liệu", type: "select", options: ["String", "Number", "Boolean", "JSON"], defaultValue: "String" },
  ],
  "Cấu hình API key": [
    { key: "apiKey", label: "API key", type: "password", placeholder: "Dán API key", help: "Đầu ra APIKey để nối vào node cần xác thực. Giá trị được che trong Inspector." },
    { key: "keyLabel", label: "Tên ghi nhớ", type: "text", placeholder: "Ví dụ: OpenAI production" },
  ],
  "Nhập tài liệu": [
    { key: "documents", label: "Chọn tài liệu", type: "file", accept: ".pdf,.docx,.txt,.md,.csv,.json,.html", multiple: true, fileValidation: "text", persistPaths: true, help: "Hỗ trợ PDF, DOCX, TXT, Markdown, CSV, JSON và HTML." },
  ],
  "Tải file không rõ kiểu": [
    { key: "genericFiles", label: "Chọn file", type: "file", multiple: true, persistPaths: true, help: "Chọn file khi chưa xác định loại nội dung; đầu ra là File[]." },
  ],
  "Tải ảnh lên": [
    { key: "images", label: "Chọn ảnh", type: "file", accept: "image/*", multiple: true, fileValidation: "image", persistPaths: true, help: "Có thể chọn nhiều ảnh cùng lúc." },
    { key: "imageDescription", label: "Mô tả chung", type: "textarea", placeholder: "Bối cảnh hoặc cách sử dụng các ảnh..." },
  ],
  "Tải video lên": [
    { key: "videos", label: "Chọn video", type: "file", accept: "video/*", multiple: true, fileValidation: "media", persistPaths: true, help: "Có thể chọn nhiều video cùng lúc." },
  ],
  "Tải âm thanh lên": [
    { key: "audioFiles", label: "Chọn âm thanh", type: "file", accept: "audio/*", multiple: true, fileValidation: "audio", persistPaths: true, help: "Chọn voice, nhạc hoặc hiệu ứng âm thanh." },
  ],
  "Chọn thư mục trên máy": [
    { key: "localFolder", label: "Đường dẫn folder", type: "folder", placeholder: "D:\\Tư liệu\\Dự án", help: "Dán đường dẫn trực tiếp hoặc bấm Browse để chọn folder trên máy." },
    { key: "includeSubfolders", label: "Quét cả thư mục con", type: "checkbox", defaultValue: true },
  ],
  "Hồ sơ thương hiệu": [
    { key: "voice", label: "Giọng văn", type: "textarea", placeholder: "Ví dụ: chuyên nghiệp, gần gũi, câu ngắn..." },
    { key: "primaryColor", label: "Màu chính", type: "color", defaultValue: "#2563eb" },
    { key: "secondaryColor", label: "Màu phụ", type: "color", defaultValue: "#f59e0b" },
    { key: "logo", label: "Logo", type: "file", accept: "image/png,image/jpeg,image/webp,image/svg+xml" },
    { key: "fonts", label: "Font thương hiệu", type: "file", accept: ".ttf,.otf,.woff,.woff2", multiple: true },
    { key: "restrictions", label: "Điều cấm và lưu ý", type: "textarea", placeholder: "Từ ngữ, hình ảnh hoặc tuyên bố không được sử dụng..." },
  ],
  "Cấu hình video": [
    { key: "ratio", label: "Tỷ lệ", type: "select", options: ["16:9", "9:16", "1:1", "4:5"], defaultValue: "9:16" },
    { key: "duration", label: "Thời lượng (giây)", type: "number", min: 1, step: 1, defaultValue: 60 },
    { key: "fps", label: "FPS", type: "select", options: ["24", "25", "30", "50", "60"], defaultValue: "30" },
    { key: "resolution", label: "Độ phân giải", type: "select", options: ["720p", "1080p", "1440p", "4K"], defaultValue: "1080p" },
    { key: "language", label: "Ngôn ngữ", type: "select", options: ["Tiếng Việt", "English", "中文", "日本語", "한국어", "Tự động nhận diện"], defaultValue: "Tiếng Việt" },
  ],
  "Lịch chạy": [
    { key: "startDate", label: "Ngày bắt đầu", type: "date" },
    { key: "startTime", label: "Giờ chạy", type: "time", defaultValue: "09:00" },
    { key: "repeat", label: "Chu kỳ", type: "select", options: ["Chỉ một lần", "Hàng ngày", "Hàng tuần", "Hàng tháng"], defaultValue: "Chỉ một lần" },
    { key: "timezone", label: "Múi giờ", type: "select", options: ["Asia/Bangkok (UTC+7)", "Asia/Ho_Chi_Minh (UTC+7)", "UTC", "Asia/Tokyo (UTC+9)", "America/New_York"], defaultValue: "Asia/Bangkok (UTC+7)" },
  ],
  "Webhook": [
    { key: "endpoint", label: "URL nhận dữ liệu", type: "url", placeholder: "https://example.com/webhook" },
    { key: "method", label: "Phương thức", type: "select", options: ["POST", "PUT", "PATCH", "GET"], defaultValue: "POST" },
    { key: "authType", label: "Xác thực", type: "select", options: ["Không xác thực", "Bearer token", "API key", "Basic auth"], defaultValue: "Không xác thực" },
    { key: "credential", label: "Khóa hoặc token", type: "password", placeholder: "Nhập thông tin xác thực nếu cần" },
  ],
};

const AI_OPTION_FIELD: ConfigField = {
  key: "useAI",
  label: "Dùng AI để phân tích sâu",
  type: "checkbox",
  defaultValue: false,
  help: "Không bắt buộc. Khi bật, node cần API key được nhập trực tiếp hoặc nối qua cổng APIKey.",
};

const DIRECT_AI_API_KEY_FIELD: ConfigField = {
  key: "apiKey",
  label: "API key",
  type: "password",
  placeholder: "Nhập API key hoặc nối cổng APIKey",
  help: "Chỉ dùng một nguồn key: khi nối cổng APIKey, key nhập ở đây tự bị xóa; khi sửa ô này, kết nối APIKey tự bị ngắt.",
};

const DIRECT_AI_KEY_SPEC_NAMES = new Set([
  "Lấy transcript", "Tổng hợp nguồn", "Trích xuất dữ kiện", "Kiểm tra dữ kiện", "So sánh nguồn", "Xếp hạng nguồn",
  "Tạo ý tưởng", "Chấm điểm ý tưởng", "Xác định khán giả", "Tạo góc tiếp cận", "Tạo dàn ý", "Viết nội dung", "Viết lại", "Mở rộng", "Rút gọn", "Thay đổi giọng văn", "Kiểm tra nội dung", "Kiểm tra chính sách",
  "Phiên âm video theo thời gian",
]);

const DIRECT_AI_RUNTIME_ALWAYS = new Set([
  "Tạo ý tưởng", "Xác định đối tượng xem", "Tạo góc tiếp cận", "Tạo dàn ý", "Viết nội dung", "Viết lại nội dung", "Mở rộng nội dung", "Thay đổi giọng văn",
]);

const DIRECT_AI_RUNTIME_OPTIONAL = new Set([
  "Tổng hợp các nguồn", "Trích xuất dữ kiện", "Kiểm tra dữ kiện", "So sánh các nguồn", "Xếp hạng độ tin cậy nguồn", "Chấm điểm ý tưởng", "Rút gọn nội dung", "Kiểm tra nội dung", "Kiểm tra chính sách",
]);

const AI_MODEL_FIELD: ConfigField = {
  key: "model",
  label: "Model AI",
  type: "select",
  options: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
  defaultValue: "gpt-5.6-luna",
  help: "Luna tiết kiệm, Terra cân bằng, Sol ưu tiên chất lượng.",
};

const AI_MODEL_OPTIONS = ["Tự động (khuyến nghị)", "gpt-5.6-luna — tiết kiệm", "gpt-5.6-terra — cân bằng", "gpt-5.6-sol — chất lượng", "Khác — nhập ID model"];
const AI_NODE_FIELDS: Record<string, ConfigField[]> = {
  "Chọn nhà cung cấp AI": [
    { key: "provider", label: "Nhà cung cấp", type: "select", options: ["OpenAI", "Gemini", "Claude", "Ollama", "AI local", "Khác"], defaultValue: "OpenAI", required: true, help: "Chọn dịch vụ AI sẽ dùng cho workflow." },
    { key: "apiKey", label: "API key", type: "password", placeholder: "Nhập API key hoặc nối cổng APIKey", help: "Chỉ dùng một nguồn key: khi nối cổng APIKey, key nhập ở đây tự bị xóa; khi sửa ô này, kết nối APIKey tự bị ngắt." },
    { key: "localEndpoint", label: "Địa chỉ API AI local", type: "url", placeholder: "http://127.0.0.1:1234/v1", defaultValue: "http://127.0.0.1:1234/v1", required: true, showWhen: { key: "provider", value: "AI local" }, help: "Dùng cho LM Studio, llama.cpp server hoặc server tương thích OpenAI chạy trên máy. Ollama có lựa chọn riêng." },
    { key: "customProvider", label: "Tên hoặc URL nhà cung cấp", type: "text", placeholder: "Ví dụ: https://api.example.com", required: true, showWhen: { key: "provider", value: "Khác" } },
    { key: "region", label: "Khu vực xử lý", type: "select", options: ["Tự động (khuyến nghị)", "Châu Á - Thái Bình Dương", "Hoa Kỳ", "Châu Âu", "Máy local"], defaultValue: "Tự động (khuyến nghị)" },
    { key: "monthlyCostAlert", label: "Cảnh báo chi phí mỗi tháng (USD)", type: "select", options: ["Không cảnh báo", "5 USD", "10 USD", "25 USD", "50 USD", "100 USD", "Khác"], defaultValue: "Không cảnh báo", help: "Đây là mức cảnh báo chi phí API của workflow trong một tháng dương lịch, không phải giới hạn token." },
    { key: "customMonthlyCostAlert", label: "Mức cảnh báo tùy chỉnh (USD/tháng)", type: "number", min: 1, step: 1, required: true, showWhen: { key: "monthlyCostAlert", value: "Khác" } },
    { key: "maxInputTokens", label: "Ngân sách token đầu vào", type: "number", min: 1_000, max: 40_000, step: 1_000, defaultValue: 40_000, help: "Tổng token dữ liệu gửi vào AI trong một lần chạy. App dự trữ trước từng lượt gọi để không vượt 40.000 token." },
    { key: "maxOutputWorkflowTokens", label: "Ngân sách token đầu ra", type: "number", min: 500, max: 20_000, step: 500, defaultValue: 20_000, help: "Tổng token AI được phép trả về trong một lần chạy. Khác với giới hạn đầu ra của từng lời gọi." },
  ],
  "Chọn mô hình AI": [
    { key: "modelCatalog", label: "Nhà cung cấp và mô hình", type: "model-catalog", required: true, help: "Danh sách chỉ chứa model tương thích với nhà cung cấp đã chọn. Có thể làm mới từ API của provider." },
    { key: "temperature", label: "Mức sáng tạo", type: "select", options: ["Chính xác / ổn định (0.2)", "Cân bằng (0.7)", "Sáng tạo (1.0)", "Tùy chỉnh"], defaultValue: "Cân bằng (0.7)", help: "Mức cao tạo nhiều biến thể hơn; mức thấp nhất quán hơn." },
    { key: "customTemperature", label: "Nhiệt độ tùy chỉnh (0–2)", type: "number", min: 0, max: 2, step: 0.1, required: true, showWhen: { key: "temperature", value: "Tùy chỉnh" } },
    { key: "maxOutputTokens", label: "Token đầu ra tối đa", type: "select", options: ["500 — ngắn", "1.000 — vừa", "2.000 — tiêu chuẩn", "4.000 — dài", "8.000 — rất dài", "Tùy chỉnh"], defaultValue: "2.000 — tiêu chuẩn", help: "Chỉ giới hạn số token AI được phép trả về, không phải tổng token đầu vào + đầu ra." },
    { key: "customMaxOutputTokens", label: "Token đầu ra tùy chỉnh", type: "number", min: 1, max: 128000, step: 100, required: true, showWhen: { key: "maxOutputTokens", value: "Tùy chỉnh" } },
  ],
  "Lựa chọn model AI": [
    { key: "preference", label: "Ưu tiên lựa chọn", type: "select", options: ["Tiết kiệm", "Tốc độ", "Trung bình"], defaultValue: "Trung bình", required: true, help: "AI chỉ chọn trong các model thực sự có ở provider. Tiết kiệm và Tốc độ ưu tiên model nano; Trung bình ưu tiên model mini." },
    { key: "maxSelectionTokens", label: "Token đánh giá tối đa", type: "select", options: ["128 — rất ngắn", "256 — tiêu chuẩn", "512 — chi tiết"], defaultValue: "256 — tiêu chuẩn", help: "Ngân sách của lời gọi AI dùng để đánh giá và chọn model; không phải ngân sách chạy tác vụ chính." },
  ],
  "Cache kết quả": [
    { key: "cacheKey", label: "Khóa cache (để trống tự tạo)", type: "text", placeholder: "Ví dụ: video-source-v1", help: "Khóa ổn định giúp các lần gọi cùng tư liệu dùng prompt cache của OpenAI khi model hỗ trợ." },
    { key: "retention", label: "Thời hạn cache trong phiên", type: "select", options: ["30 phút", "2 giờ", "24 giờ"], defaultValue: "2 giờ", help: "Tư liệu và file chỉ được giữ trong bộ nhớ của phiên app; metadata cache được ghi vào session storage, không sao chép file media nặng." },
  ],
  "Soạn system prompt": [
    { key: "role", label: "Vai trò AI", type: "select", options: ["Trợ lý tổng quát", "Chuyên gia nghiên cứu", "Biên tập viên nội dung", "Biên kịch video", "Nhà phân tích dữ liệu", "Khác"], defaultValue: "Trợ lý tổng quát" },
    { key: "customRole", label: "Vai trò tùy chỉnh", type: "text", placeholder: "Mô tả ngắn vai trò AI", required: true, showWhen: { key: "role", value: "Khác" } },
    { key: "rules", label: "Quy tắc và điều cần tránh", type: "textarea", placeholder: "Ví dụ: không bịa nguồn, trả lời tiếng Việt..." },
    { key: "responseFormat", label: "Định dạng đầu ra", type: "select", options: ["Văn bản tự do", "Markdown", "Danh sách", "JSON"], defaultValue: "Văn bản tự do" },
  ],
  "Tạo prompt từ dữ liệu": [
    { key: "template", label: "Mẫu prompt", type: "select", options: ["Tóm tắt dữ liệu", "Viết nội dung từ dữ liệu", "Phân tích và đề xuất", "Trích xuất dữ kiện", "Khác"], defaultValue: "Tóm tắt dữ liệu" },
    { key: "customTemplate", label: "Mẫu prompt tùy chỉnh", type: "textarea", placeholder: "Dùng {{data}} cho dữ liệu đầu vào", required: true, showWhen: { key: "template", value: "Khác" } },
    { key: "instructions", label: "Yêu cầu bổ sung", type: "textarea", placeholder: "Điều cần ưu tiên trong prompt...", help: "Không bắt buộc; để trống nếu không có điều kiện bổ sung." },
  ],
  "Gọi AI tạo văn bản": [
    { key: "responseLength", label: "Độ dài phản hồi", type: "select", options: ["Ngắn", "Vừa", "Dài", "Rất dài"], defaultValue: "Vừa" },
    { key: "fallbackModel", label: "Model dự phòng khi chưa nối AIModel", type: "select", options: AI_MODEL_OPTIONS, defaultValue: "Tự động (khuyến nghị)" },
  ],
  "Gọi AI trả JSON": [
    { key: "jsonShape", label: "Kiểu JSON cần nhận", type: "select", options: ["Một đối tượng", "Danh sách đối tượng", "Bảng dữ liệu", "Khác"], defaultValue: "Một đối tượng" },
    { key: "customSchema", label: "JSON Schema tùy chỉnh", type: "code", placeholder: "{ \"type\": \"object\", \"properties\": {} }", required: true, showWhen: { key: "jsonShape", value: "Khác" } },
    { key: "fallbackModel", label: "Model dự phòng khi chưa nối AIModel", type: "select", options: AI_MODEL_OPTIONS, defaultValue: "Tự động (khuyến nghị)" },
  ],
  "Phân tích hình ảnh bằng AI": [
    { key: "analysisGoal", label: "Mục tiêu phân tích", type: "select", options: ["Mô tả ảnh", "Trích xuất chữ", "Phát hiện đối tượng", "Đánh giá chất lượng", "Kiểm tra thương hiệu", "Khác"], defaultValue: "Mô tả ảnh" },
    { key: "customAnalysisGoal", label: "Mục tiêu tùy chỉnh", type: "textarea", placeholder: "Bạn cần AI tìm hoặc đánh giá gì?", required: true, showWhen: { key: "analysisGoal", value: "Khác" } },
    { key: "detail", label: "Mức chi tiết", type: "select", options: ["Tiết kiệm", "Cân bằng", "Chuyên sâu"], defaultValue: "Cân bằng" },
  ],
  "Phân tích âm thanh bằng AI": [
    { key: "analysisGoal", label: "Mục tiêu phân tích", type: "select", options: ["Tóm tắt", "Tìm highlight", "Phân tích nội dung", "Kiểm tra chất lượng", "Khác"], defaultValue: "Tóm tắt" },
    { key: "customAnalysisGoal", label: "Mục tiêu tùy chỉnh", type: "textarea", placeholder: "Bạn cần AI phân tích gì?", required: true, showWhen: { key: "analysisGoal", value: "Khác" } },
    { key: "language", label: "Ngôn ngữ âm thanh", type: "select", options: ["Tự động", "Tiếng Việt", "English", "中文", "日本語", "한국어"], defaultValue: "Tự động" },
  ],
  "Chấm điểm đầu ra AI": [
    { key: "criteria", label: "Tiêu chí chấm", type: "multi-select", options: ["Đúng yêu cầu", "Tính chính xác", "Rõ ràng", "Đủ chi tiết", "An toàn", "Đúng định dạng"], defaultValue: "Đúng yêu cầu,Tính chính xác,Rõ ràng", required: true },
    { key: "minimumScore", label: "Điểm đạt tối thiểu", type: "range", min: 0, max: 100, step: 5, defaultValue: 70, suffix: "/100" },
  ],
  "Duyệt đầu ra AI": [
    { key: "approvalMode", label: "Cách duyệt", type: "select", options: ["Tự duyệt khi đạt ngưỡng", "Luôn cần duyệt thủ công", "Luôn từ chối để chỉnh sửa"], defaultValue: "Tự duyệt khi đạt ngưỡng" },
    { key: "approvalNote", label: "Ghi chú cho người duyệt", type: "textarea", placeholder: "Các điều cần xem kỹ trước khi duyệt..." },
  ],
};

const RESEARCH_NODE_FIELDS: Record<string, ConfigField[]> = {
  "Tìm kiếm Internet": [
    { key: "query", label: "Từ khóa tìm kiếm", type: "text", placeholder: "Để trống để dùng chủ đề từ node đầu vào" },
    { key: "provider", label: "Nguồn tìm kiếm", type: "select", options: ["DuckDuckGo (không cần API)", "Wikipedia (không cần API)"], defaultValue: "DuckDuckGo (không cần API)" },
    { key: "domains", label: "Chỉ lấy từ tên miền", type: "tags", placeholder: "Ví dụ: chinhphu.vn" },
    { key: "maxResults", label: "Số kết quả", type: "range", min: 1, max: 20, step: 1, defaultValue: 8 },
  ],
  "Đọc trang web": [
    { key: "maxChars", label: "Giới hạn ký tự mỗi trang", type: "number", min: 1000, max: 60000, step: 1000, defaultValue: 30000 },
  ],
  "Đọc tài liệu": [
    { key: "documentNote", label: "Ghi chú cách sử dụng tài liệu", type: "textarea", placeholder: "Ví dụ: ưu tiên số liệu và kết luận..." },
  ],
  "Lấy transcript video": [
    { key: "language", label: "Ngôn ngữ ưu tiên", type: "select", options: ["vi", "en", "auto"], defaultValue: "vi" },
  ],
  "Tổng hợp nguồn": [
    { key: "maxPoints", label: "Số ý chính", type: "range", min: 3, max: 20, step: 1, defaultValue: 8 },
    { key: "instructions", label: "Yêu cầu tổng hợp", type: "textarea", placeholder: "Các câu hỏi hoặc khía cạnh cần ưu tiên..." },
    AI_OPTION_FIELD,
  ],
  "Trích xuất dữ kiện": [
    { key: "maxFacts", label: "Số dữ kiện tối đa", type: "range", min: 3, max: 50, step: 1, defaultValue: 15 },
    { key: "instructions", label: "Loại dữ kiện cần lấy", type: "textarea", placeholder: "Ví dụ: số liệu, mốc thời gian, phát biểu..." },
    AI_OPTION_FIELD,
  ],
  "Kiểm tra dữ kiện": [
    { key: "instructions", label: "Quy tắc kiểm tra", type: "textarea", placeholder: "Tiêu chuẩn xác minh hoặc nguồn cần ưu tiên..." },
    AI_OPTION_FIELD,
  ],
  "So sánh nhiều nguồn": [
    { key: "dimensions", label: "Tiêu chí so sánh", type: "tags", placeholder: "Ví dụ: số liệu, quan điểm, thời điểm" },
    { key: "instructions", label: "Yêu cầu so sánh", type: "textarea", placeholder: "Điểm cần tìm sự đồng thuận hoặc mâu thuẫn..." },
    AI_OPTION_FIELD,
  ],
  "Xếp hạng độ tin cậy": [
    { key: "instructions", label: "Tiêu chuẩn bổ sung", type: "textarea", placeholder: "Tên miền hoặc loại nguồn cần ưu tiên..." },
    AI_OPTION_FIELD,
  ],
  "Duyệt nguồn": [
    { key: "approvedUrls", label: "URL duyệt thủ công", type: "url-list", placeholder: "https://...", help: "Nếu có giá trị, chỉ các URL trong danh sách này được duyệt." },
    { key: "rejectedUrls", label: "URL loại thủ công", type: "url-list", placeholder: "https://..." },
    { key: "includeDomains", label: "Tên miền được ưu tiên", type: "tags", placeholder: "Để trống để chấp nhận mọi tên miền" },
    { key: "excludeDomains", label: "Tên miền cần loại", type: "tags", placeholder: "Ví dụ: example.com" },
    { key: "minimumScore", label: "Điểm tin cậy tối thiểu", type: "range", min: 0, max: 100, step: 5, defaultValue: 40 },
    { key: "approvalNote", label: "Ghi chú duyệt", type: "textarea", placeholder: "Lý do hoặc quy tắc duyệt nguồn..." },
  ],
};

const CONTENT_NODE_FIELDS: Record<string, ConfigField[]> = {
  "Tạo ý tưởng": [
    { key: "ideaCount", label: "Số ý tưởng", type: "range", min: 1, max: 20, step: 1, defaultValue: 5 },
    { key: "style", label: "Phong cách", type: "select", options: ["Thực tế", "Giáo dục", "Kể chuyện", "Gây tranh luận", "Giải trí", "Bán hàng"], defaultValue: "Thực tế" },
    { key: "platform", label: "Nền tảng", type: "select", options: ["Đa nền tảng", "YouTube", "TikTok", "Facebook", "Instagram", "Website"], defaultValue: "Đa nền tảng" },
    { key: "instructions", label: "Yêu cầu bổ sung", type: "textarea", placeholder: "Điều cần có hoặc cần tránh trong ý tưởng..." },
    AI_MODEL_FIELD,
  ],
  "Chấm điểm ý tưởng": [
    { key: "criteria", label: "Tiêu chí", type: "multi-select", options: ["Hấp dẫn", "Mới lạ", "Hữu ích", "Phù hợp khán giả", "Khả năng triển khai", "Tiềm năng chuyển đổi"], defaultValue: "Hấp dẫn,Hữu ích,Phù hợp khán giả,Khả năng triển khai" },
    { key: "minimumScore", label: "Điểm đạt tối thiểu", type: "range", min: 0, max: 100, step: 5, defaultValue: 60 },
    AI_OPTION_FIELD,
    AI_MODEL_FIELD,
  ],
  "Xác định khán giả": [
    { key: "platform", label: "Kênh mục tiêu", type: "select", options: ["Đa nền tảng", "YouTube", "TikTok", "Facebook", "Instagram", "Website"], defaultValue: "Đa nền tảng" },
    { key: "market", label: "Thị trường/khu vực", type: "text", placeholder: "Ví dụ: Việt Nam, thành phố lớn..." },
    { key: "instructions", label: "Thông tin đã biết", type: "textarea", placeholder: "Độ tuổi, hành vi, nhu cầu hoặc nỗi đau đã biết..." },
    AI_MODEL_FIELD,
  ],
  "Tạo góc tiếp cận": [
    { key: "angleCount", label: "Số góc tiếp cận", type: "range", min: 1, max: 10, step: 1, defaultValue: 3 },
    { key: "style", label: "Cách kể", type: "select", options: ["Giải quyết vấn đề", "Kể chuyện", "Phản biện", "Hướng dẫn", "Case study", "Danh sách"], defaultValue: "Giải quyết vấn đề" },
    { key: "instructions", label: "Lời hứa nội dung", type: "textarea", placeholder: "Người xem nhận được gì sau khi xem/đọc?" },
    AI_MODEL_FIELD,
  ],
  "Tạo dàn ý": [
    { key: "structure", label: "Cấu trúc", type: "select", options: ["Mở bài–thân bài–kết luận", "Vấn đề–giải pháp", "Danh sách", "Kể chuyện", "AIDA", "PAS"], defaultValue: "Vấn đề–giải pháp" },
    { key: "sectionCount", label: "Số phần", type: "range", min: 3, max: 15, step: 1, defaultValue: 6 },
    { key: "targetLength", label: "Độ dài mục tiêu (từ)", type: "number", min: 100, max: 10000, step: 100, defaultValue: 1000 },
    { key: "instructions", label: "Yêu cầu dàn ý", type: "textarea", placeholder: "Luận điểm, CTA hoặc phần bắt buộc..." },
    AI_MODEL_FIELD,
  ],
  "Viết nội dung": [
    { key: "format", label: "Định dạng", type: "select", options: ["Bài viết", "Bài blog", "Bài mạng xã hội", "Email", "Landing page", "Nội dung video"], defaultValue: "Bài viết" },
    { key: "targetLength", label: "Độ dài mục tiêu (từ)", type: "number", min: 100, max: 10000, step: 100, defaultValue: 1000 },
    { key: "tone", label: "Giọng văn", type: "select", options: ["Gần gũi", "Chuyên gia", "Năng động", "Trang trọng", "Thuyết phục", "Trung tính"], defaultValue: "Gần gũi" },
    { key: "instructions", label: "Yêu cầu viết", type: "textarea", placeholder: "Thông điệp, CTA, từ khóa và điều cần tránh..." },
    AI_MODEL_FIELD,
  ],
  "Viết lại": [
    { key: "rewriteRequest", label: "Yêu cầu viết lại", type: "textarea", placeholder: "Ví dụ: rõ ràng hơn, giữ nguyên số liệu và cấu trúc..." },
    { key: "changeLevel", label: "Mức độ thay đổi", type: "range", min: 10, max: 100, step: 10, defaultValue: 50, suffix: "%" },
    AI_MODEL_FIELD,
  ],
  "Mở rộng": [
    { key: "focus", label: "Phần cần mở rộng", type: "textarea", placeholder: "Chủ đề hoặc đoạn cần bổ sung..." },
    { key: "targetLength", label: "Độ dài mục tiêu (từ)", type: "number", min: 100, max: 10000, step: 100, defaultValue: 1500 },
    AI_MODEL_FIELD,
  ],
  "Rút gọn": [
    { key: "targetLength", label: "Độ dài mục tiêu (từ)", type: "number", min: 30, max: 5000, step: 50, defaultValue: 300 },
    { key: "preserve", label: "Nội dung bắt buộc giữ", type: "tags", placeholder: "Số liệu, CTA hoặc luận điểm" },
    AI_OPTION_FIELD,
    AI_MODEL_FIELD,
  ],
  "Thay đổi giọng văn": [
    { key: "tone", label: "Giọng văn mới", type: "select", options: ["Gần gũi", "Chuyên gia", "Năng động", "Trang trọng", "Thuyết phục", "Hài hước", "Cảm xúc"], defaultValue: "Gần gũi" },
    { key: "emotion", label: "Cảm xúc", type: "select", options: ["Trung tính", "Tích cực", "Khẩn cấp", "Tin cậy", "Truyền cảm hứng"], defaultValue: "Trung tính" },
    { key: "instructions", label: "Lưu ý", type: "textarea", placeholder: "Từ ngữ hoặc đặc điểm cần giữ..." },
    AI_MODEL_FIELD,
  ],
  "Kiểm tra nội dung": [
    { key: "criteria", label: "Tiêu chí", type: "multi-select", options: ["Logic", "Mạch lạc", "Dễ đọc", "Giọng văn", "CTA", "Tính chính xác"], defaultValue: "Logic,Mạch lạc,Dễ đọc,Giọng văn" },
    AI_OPTION_FIELD,
    AI_MODEL_FIELD,
  ],
  "Kiểm tra trùng lặp": [
    { key: "comparisonText", label: "Văn bản đối chiếu bổ sung", type: "textarea", placeholder: "Dán nội dung cần đối chiếu nếu không nối nguồn..." },
    { key: "threshold", label: "Ngưỡng cảnh báo", type: "range", min: 10, max: 100, step: 5, defaultValue: 60, suffix: "%" },
  ],
  "Kiểm tra chính sách": [
    { key: "platform", label: "Nền tảng", type: "select", options: ["Chung", "YouTube", "TikTok", "Facebook", "Instagram", "Website"], defaultValue: "Chung" },
    { key: "customRules", label: "Quy tắc bổ sung", type: "textarea", placeholder: "Từ ngữ, tuyên bố hoặc chủ đề cần cảnh báo..." },
    AI_OPTION_FIELD,
    AI_MODEL_FIELD,
  ],
  "Duyệt nội dung": [
    { key: "decision", label: "Quyết định", type: "select", options: ["Đã duyệt", "Cần sửa", "Từ chối"], defaultValue: "Đã duyệt" },
    { key: "editedContent", label: "Nội dung chỉnh sửa thủ công", type: "textarea", placeholder: "Để trống để giữ nguyên nội dung đầu vào..." },
    { key: "approvalNote", label: "Ghi chú duyệt", type: "textarea", placeholder: "Lý do duyệt hoặc yêu cầu chỉnh sửa..." },
  ],
};

const VIDEO_ANALYSIS_NODE_FIELDS: Record<string, ConfigField[]> = {
  "Lập chỉ mục video": [
    { key: "videoType", label: "Loại video", type: "select", options: ["Tự động", "Phim", "Tabletop/game bàn", "Gameplay", "Bài giảng", "Podcast có hình", "Video bán hàng"], defaultValue: "Tự động" },
    { key: "analysisMode", label: "Mức phân tích", type: "select", options: ["Tiết kiệm", "Cân bằng", "Chuyên sâu"], defaultValue: "Cân bằng" },
    { key: "heartbeatSeconds", label: "Frame định kỳ", type: "range", min: 5, max: 60, step: 5, defaultValue: 15, suffix: " giây" },
    { key: "scanIntervalSeconds", label: "Khoảng quét thay đổi", type: "range", min: 1, max: 10, step: 1, defaultValue: 2, suffix: " giây" },
    { key: "changeSensitivity", label: "Độ nhạy thay đổi", type: "range", min: 1, max: 50, step: 1, defaultValue: 12, suffix: "%" },
    { key: "maxFrames", label: "Giới hạn frame gửi AI", type: "number", min: 12, max: 600, step: 12, defaultValue: 36, help: "Mặc định 36 để đủ pipeline phân tích, chọn highlight và thumbnail trong giới hạn 40.000 token input." },
  ],
  "Trích frame từ video": [
    { key: "analysisMode", label: "Mức lấy mẫu", type: "select", options: ["Tiết kiệm", "Cân bằng", "Chuyên sâu"], defaultValue: "Cân bằng" },
    { key: "heartbeatSeconds", label: "Frame định kỳ", type: "range", min: 5, max: 60, step: 5, defaultValue: 15, suffix: " giây" },
    { key: "scanIntervalSeconds", label: "Khoảng quét thay đổi", type: "range", min: 1, max: 10, step: 1, defaultValue: 2, suffix: " giây" },
    { key: "changeSensitivity", label: "Độ nhạy thay đổi", type: "range", min: 1, max: 50, step: 1, defaultValue: 12, suffix: "%" },
    { key: "maxFrames", label: "Giới hạn frame", type: "number", min: 1, max: 600, step: 1, defaultValue: 120 },
  ],
  "Tách âm thanh từ video": [
    { key: "audioFormat", label: "Định dạng audio", type: "select", options: ["MP3", "WAV"], defaultValue: "MP3" },
    { key: "audioBitrate", label: "Bitrate MP3", type: "select", options: ["96", "128", "192"], defaultValue: "128", suffix: " kbps", showWhen: { key: "audioFormat", value: "MP3" }, help: "Chỉ dùng khi xuất MP3. WAV giữ chất lượng PCM nhưng dung lượng lớn hơn." },
  ],
  "Lấy vùng chú ý": [
    { key: "selectionMode", label: "Cách chọn vùng", type: "select", options: ["Đơn giản (lưới 3×3)", "Chính xác (vẽ vùng)"], defaultValue: "Đơn giản (lưới 3×3)" },
    { key: "simpleCells", label: "Chọn tối đa 3 ô", type: "attention-grid", showWhen: { key: "selectionMode", value: "Đơn giản (lưới 3×3)" }, help: "Mỗi ô tương ứng 1/9 khung hình, độc lập với độ phân giải ảnh hoặc video." },
    { key: "exactRegions", label: "Vùng đã quét", type: "attention-editor", showWhen: { key: "selectionMode", value: "Chính xác (vẽ vùng)" }, help: "Mở trình chọn sau khi đã nối Image[] hoặc Video. Tối đa 3 vùng, tổng diện tích không quá 1/3 khung; các vùng không được chồng lên nhau." },
  ],
  "Thiết lập vùng chú ý video": [
    { key: "selectionMode", label: "Cách chọn vùng", type: "select", options: ["Đơn giản (lưới 3×3)", "Chính xác (vẽ vùng)"], defaultValue: "Đơn giản (lưới 3×3)" },
    { key: "simpleCells", label: "Chọn tối đa 3 ô", type: "attention-grid", showWhen: { key: "selectionMode", value: "Đơn giản (lưới 3×3)" }, help: "Mỗi ô tương ứng 1/9 khung hình, độc lập với độ phân giải video." },
    { key: "exactRegions", label: "Vùng đã quét", type: "attention-editor", showWhen: { key: "selectionMode", value: "Chính xác (vẽ vùng)" }, help: "Mở trình chọn sau khi đã nối Video. Tối đa 3 vùng, tổng diện tích không quá 1/3 khung; các vùng không được chồng lên nhau." },
  ],
  "Làm rõ highlight lặp": [
    { key: "focusMode", label: "Trọng số phân tích", type: "select", options: ["Tập trung hình ảnh (80/20)", "Tập trung âm thanh (20/80)", "Cân bằng (50/50)"], defaultValue: "Tập trung hình ảnh (80/20)", help: "Tỷ lệ quan trọng giữa frame/crop và transcript khi AI xác nhận highlight." },
    { key: "maxRounds", label: "Số vòng tối đa", type: "number", min: 1, max: 3, step: 1, defaultValue: 3, help: "Khóa cứng tối đa 3 vòng." },
    { key: "frameIntervalSeconds", label: "Khoảng cách frame tối thiểu", type: "number", min: 1, max: 15, step: 1, defaultValue: 1, suffix: " giây", help: "Không bao giờ trích dày hơn 1 frame mỗi giây." },
    { key: "maxFramesPerRound", label: "Frame tối đa mỗi vòng", type: "number", min: 4, max: 24, step: 1, defaultValue: 12, help: "Giới hạn cứng để giữ ngân sách API." },
    { key: "imageDetail", label: "Chi tiết frame", type: "select", options: ["low", "auto", "high"], defaultValue: "low" },
    { key: "minimumConfidence", label: "Ngưỡng giữ đoạn", type: "range", min: 40, max: 95, step: 5, defaultValue: 70, suffix: "%" },
    { key: "instructions", label: "Yêu cầu highlight", type: "textarea", placeholder: "Ví dụ: chỉ giữ lúc bảng điểm thay đổi hoặc hành động quyết định..." },
    AI_MODEL_FIELD,
  ],
  "Phiên âm video theo thời gian": [
    { key: "transcriptMode", label: "Cách xử lý transcript", type: "select", options: ["Transcript cục bộ", "Transcript bằng API"], required: true, placeholder: "Chọn cục bộ hoặc API...", help: "Bắt buộc chọn. Cục bộ dùng bộ xử lý đã cài trong Workflow → Điều chỉnh xử lý cục bộ; API chỉ dùng khi bạn chọn rõ chế độ này." },
    { ...DIRECT_AI_API_KEY_FIELD, label: "API key phiên âm", showWhen: { key: "transcriptMode", value: "Transcript bằng API" }, help: "Chỉ cần khi chọn Transcript bằng API. Nhập trực tiếp hoặc nối cổng APIKey; key chỉ gửi tới dịch vụ media cục bộ để gọi API phiên âm." },
    { key: "enhanceSpeech", label: "Làm rõ giọng trước khi phiên âm", type: "checkbox", defaultValue: true, help: "Chạy lọc nhiễu, nén âm và chuẩn hóa âm lượng cục bộ bằng FFmpeg." },
    { key: "language", label: "Ngôn ngữ", type: "select", options: ["auto", "vi", "en", "ja", "ko", "zh"], defaultValue: "auto" },
    { key: "knownTerms", label: "Tên riêng và thuật ngữ", type: "tags", placeholder: "Tên nhân vật, trò chơi, thẻ bài...", help: "Nhập trực tiếp hoặc nối file/văn bản vào cổng Thuật ngữ. Khi đã nối, nội dung từ cổng được ưu tiên." },
    { key: "localTranscriptModel", label: "Model transcript cục bộ", type: "select", options: ["Nhanh (Whisper tiny)", "Cân bằng (Whisper base)", "Chất lượng (Whisper small)", "Tiếng Việt (PhoWhisper base)", "Tiếng Việt chất lượng cao (PhoWhisper small)"], defaultValue: "Cân bằng (Whisper base)", showWhen: { key: "transcriptMode", value: "Transcript cục bộ" }, help: "Chỉ dùng khi chọn cục bộ. Model phải được người dùng cài trong Workflow → Điều chỉnh xử lý cục bộ." },
    { key: "speakerDiarization", label: "Nhận diện người nói", type: "checkbox", defaultValue: true, showWhen: { key: "transcriptMode", value: "Transcript bằng API" } },
    { key: "chunkMinutes", label: "Độ dài mỗi đoạn âm thanh", type: "range", min: 2, max: 20, step: 1, defaultValue: 10, suffix: " phút" },
  ],
  "Tạo storyboard video": [
    { key: "framesPerBoard", label: "Frame mỗi storyboard", type: "range", min: 4, max: 16, step: 1, defaultValue: 12 },
    { key: "columns", label: "Số cột", type: "select", options: ["2", "3", "4"], defaultValue: "4" },
    { key: "boardWidth", label: "Chiều rộng storyboard", type: "select", options: ["960", "1280", "1600"], defaultValue: "1280" },
    { key: "showTimestamp", label: "Hiện timestamp trên frame", type: "checkbox", defaultValue: true },
  ],
  "Phân tích từng đoạn video": [
    { key: "analysisGoal", label: "Mục tiêu", type: "select", options: ["Tóm tắt nội dung", "Phân tích cốt truyện", "Phân tích gameplay", "Phân tích chiến thuật", "Trích luật chơi", "Tìm highlight", "Đánh giá chất lượng nội dung"], defaultValue: "Tóm tắt nội dung" },
    { key: "segmentSeconds", label: "Độ dài đoạn phân tích", type: "range", min: 30, max: 180, step: 15, defaultValue: 60, suffix: " giây" },
    { key: "imageDetail", label: "Chi tiết hình ảnh", type: "select", options: ["low", "auto", "high"], defaultValue: "low" },
    { key: "boardsPerRequest", label: "Storyboard mỗi lượt AI", type: "range", min: 1, max: 8, step: 1, defaultValue: 4 },
    { key: "instructions", label: "Điểm cần chú ý", type: "textarea", placeholder: "Ví dụ: theo dõi thay đổi quân cờ, chiến thuật và nguyên nhân–kết quả..." },
    AI_MODEL_FIELD,
  ],
  "Phân tích video bằng AI": [
    { key: "analysisGoal", label: "Mục tiêu phân tích", type: "select", options: ["Tóm tắt nội dung", "Phân tích cốt truyện", "Phân tích gameplay", "Phân tích chiến thuật", "Tìm highlight", "Đánh giá chất lượng nội dung"], defaultValue: "Tóm tắt nội dung" },
    { key: "detail", label: "Chi tiết hình ảnh", type: "select", options: ["low", "auto", "high"], defaultValue: "low", help: "Áp dụng cho frame gửi AI; chọn low để tiết kiệm token." },
    { key: "language", label: "Ngôn ngữ âm thanh", type: "select", options: ["auto", "vi", "en", "ja", "ko", "zh"], defaultValue: "auto", help: "Chỉ dùng khi không nối TimedTranscript: app sẽ tạo bản phiên âm tạm từ Audio cho lần phân tích này." },
    { key: "instructions", label: "Yêu cầu phân tích", type: "textarea", placeholder: "Ví dụ: đối chiếu diễn biến frame với lời nói, chú ý thay đổi bảng điểm và thời điểm quyết định..." },
  ],
  "Kiểm tra đoạn chưa chắc chắn": [
    { key: "minimumConfidence", label: "Ngưỡng tin cậy", type: "range", min: 30, max: 95, step: 5, defaultValue: 70, suffix: "%" },
    { key: "paddingSeconds", label: "Khoảng đệm khi xem lại", type: "range", min: 2, max: 30, step: 1, defaultValue: 8, suffix: " giây" },
    { key: "manualReview", label: "Yêu cầu duyệt thủ công", type: "checkbox", defaultValue: true },
  ],
  "Tổng hợp nội dung video": [
    { key: "reportType", label: "Kiểu báo cáo", type: "select", options: ["Tổng quan", "Timeline chi tiết", "Cốt truyện và nhân vật", "Gameplay và chiến thuật", "Highlight và đề xuất dựng"], defaultValue: "Timeline chi tiết" },
    { key: "reportDetail", label: "Mức chi tiết", type: "select", options: ["Ngắn gọn", "Cân bằng", "Chuyên sâu"], defaultValue: "Cân bằng" },
    { key: "includeTimestamps", label: "Giữ timecode bằng chứng", type: "checkbox", defaultValue: true },
    AI_MODEL_FIELD,
  ],
  "Chọn highlight bằng AI": [
    { key: "highlightGoal", label: "Mục tiêu highlight", type: "select", options: ["Khoảnh khắc hấp dẫn nhất", "Gameplay/kỹ năng", "Cốt truyện", "Hài hước", "Thông tin quan trọng"], defaultValue: "Khoảnh khắc hấp dẫn nhất" },
    { key: "maxDurationSeconds", label: "Tổng thời lượng tối đa", type: "number", min: 30, max: 420, step: 10, defaultValue: 420, suffix: " giây", help: "Không bao giờ vượt 420 giây (7 phút)." },
    { key: "maxClipSeconds", label: "Độ dài tối đa mỗi đoạn", type: "number", min: 10, max: 120, step: 5, defaultValue: 75, suffix: " giây" },
    { key: "instructions", label: "Tiêu chí chọn", type: "textarea", placeholder: "Ví dụ: ưu tiên chiến thắng, phản ứng bất ngờ và câu nói đáng nhớ..." },
    AI_MODEL_FIELD,
  ],
};

const VIDEO_RENDER_NODE_FIELDS: Record<string, ConfigField[]> = {
  "Chuẩn hóa video nguồn": [
    { key: "targetProfile", label: "Hồ sơ đầu ra", type: "select", options: ["1080p · 30 FPS · H.264", "1080p · 60 FPS · H.264", "720p · 30 FPS · H.264", "Giữ kích thước · 30 FPS · H.264"], defaultValue: "1080p · 30 FPS · H.264", help: "Đưa video về định dạng ổn định trước khi trích frame, dựng hoặc xuất bản." },
    { key: "outputName", label: "Tên file chuẩn hóa", type: "text", defaultValue: "video-normalized" },
    { key: "localFolder", label: "Thư mục lưu", type: "folder", help: "Để trống để lưu vào Content Flow Output cạnh video nguồn." },
  ],
  "Cắt video": [
    { key: "startSeconds", label: "Điểm đầu (giây)", type: "number", min: 0, step: 0.1, defaultValue: 0, required: true },
    { key: "endSeconds", label: "Điểm cuối (giây)", type: "number", min: 0.1, step: 0.1, defaultValue: 10, required: true },
    { key: "outputName", label: "Tên file đầu ra", type: "text", defaultValue: "video-cat" },
    { key: "localFolder", label: "Thư mục lưu", type: "folder", help: "Để trống để lưu vào thư mục Content Flow Output cạnh video nguồn." },
  ],
  "Nối video": [
    { key: "outputName", label: "Tên file đầu ra", type: "text", defaultValue: "video-noi" },
    { key: "localFolder", label: "Thư mục lưu", type: "folder", help: "Để trống để lưu vào thư mục Content Flow Output cạnh video nguồn." },
  ],
  "Ghép các cảnh": [
    { key: "outputName", label: "Tên file đầu ra", type: "text", defaultValue: "video-ghep-canh" },
    { key: "localFolder", label: "Thư mục lưu", type: "folder", help: "Để trống để lưu vào thư mục Content Flow Output cạnh video nguồn." },
  ],
  "Thêm nhạc nền": [
    { key: "volumePercent", label: "Âm lượng nhạc nền", type: "range", min: 0, max: 100, step: 1, defaultValue: 30, suffix: "%" },
    { key: "outputName", label: "Tên file đầu ra", type: "text", defaultValue: "video-co-nhac" },
    { key: "localFolder", label: "Thư mục lưu", type: "folder", help: "Để trống để lưu vào thư mục Content Flow Output cạnh video nguồn." },
  ],
  "Dựng video highlight": [
    { key: "maxDurationSeconds", label: "Kiểm tra tổng thời lượng", type: "number", min: 30, max: 420, step: 10, defaultValue: 420, suffix: " giây", help: "Dừng ngay nếu kế hoạch AI vượt giới hạn này." },
    { key: "outputName", label: "Tên file highlight", type: "text", defaultValue: "video-highlight-final" },
    { key: "localFolder", label: "Thư mục lưu", type: "folder", help: "Chọn Test-Media để lưu ngay cạnh nguồn theo yêu cầu." },
  ],
  "Tạo subtitle": [
    { key: "maxCharsPerLine", label: "Tối đa ký tự mỗi dòng", type: "number", min: 12, max: 60, step: 1, defaultValue: 34 },
    { key: "maxLines", label: "Tối đa dòng mỗi mốc", type: "number", min: 1, max: 2, step: 1, defaultValue: 2 },
    { key: "outputName", label: "Tên file SRT", type: "text", defaultValue: "subtitle-final" },
    { key: "localFolder", label: "Thư mục lưu", type: "folder", help: "Để trống để lưu tại Content Flow Output của app." },
  ],
  "Chèn subtitle": [
    { key: "style", label: "Kiểu phụ đề", type: "select", options: ["Nổi bật · trắng viền đen", "Tối giản · trắng", "Gaming · vàng viền đen"], defaultValue: "Nổi bật · trắng viền đen" },
    { key: "fontSize", label: "Cỡ chữ", type: "number", min: 16, max: 72, step: 1, defaultValue: 30 },
    { key: "position", label: "Vị trí", type: "select", options: ["Dưới", "Giữa", "Trên"], defaultValue: "Dưới" },
    { key: "outputName", label: "Tên video đầu ra", type: "text", defaultValue: "video-subtitle-final" },
    { key: "localFolder", label: "Thư mục lưu", type: "folder", help: "Để trống để lưu vào Content Flow Output cạnh video nguồn." },
  ],
  "Kiểm tra kỹ thuật": [
    { key: "targetProfile", label: "Hồ sơ kiểm tra", type: "select", options: ["YouTube 1080p · H.264 · AAC", "Shorts/Reels 1080p dọc · H.264 · AAC", "Chỉ báo cáo metadata"], defaultValue: "YouTube 1080p · H.264 · AAC" },
    { key: "minimumBitrateMbps", label: "Bitrate tối thiểu", type: "number", min: 0, max: 60, step: 0.5, defaultValue: 5, suffix: " Mbps" },
  ],
};

const IMAGE_PROCESSING_NODE_FIELDS: Record<string, ConfigField[]> = {
  "Giảm độ phân giải ảnh": [
    { key: "targetResolution", label: "Cạnh ngắn tối đa", type: "select", options: ["720 (cạnh ngắn)", "480 (cạnh ngắn)"], defaultValue: "480 (cạnh ngắn)", help: "Ngang: 1280×720 hoặc 854×480. Dọc: 720×1280 hoặc 480×854. Ảnh có cạnh ngắn không vượt mức chọn được giữ nguyên kích thước." },
  ],
  "Tìm ảnh tương đồng": [
    { key: "templateImages", label: "Chọn ảnh mẫu trực tiếp", configGroup: "template", type: "file", accept: "image/*", multiple: false, fileValidation: "image", persistPaths: true, help: "Hoặc nối một ảnh vào cổng image-sample. Chỉ dùng một trong hai cách." },
    { key: "selectionMode", label: "Vùng của ảnh mẫu", configGroup: "template", type: "select", options: ["Dùng toàn bộ ảnh", "Cắt vùng chính xác"], defaultValue: "Cắt vùng chính xác", help: "Cắt phần đặc trưng như chữ CHIẾN THẮNG/THẤT BẠI để giảm nhầm lẫn." },
    { key: "exactRegions", label: "Vùng ảnh mẫu đã cắt", configGroup: "template", type: "attention-editor", showWhen: { key: "selectionMode", value: "Cắt vùng chính xác" }, help: "Mở ảnh đã nối hoặc đã chọn trực tiếp, vẽ một vùng. Ảnh mẫu đã cắt sẽ xuất ở cổng image-sample để có thể nối tới Lưu file." },
    { key: "searchSourceMode", label: "Nguồn ảnh để tìm", configGroup: "search-source", type: "select", options: ["Chọn ảnh", "Chọn folder ảnh"], defaultValue: "Chọn ảnh", help: "Dùng lựa chọn trực tiếp bên dưới, hoặc nối đúng một trong ba cổng image-search, image-search-list, search-folder." },
    { key: "searchImages", label: "Chọn ảnh để tìm trực tiếp", configGroup: "search-source", type: "file", accept: "image/*", multiple: true, fileValidation: "image", persistPaths: true, showWhen: { key: "searchSourceMode", value: "Chọn ảnh" }, help: "Nối một ảnh vào image-search, hoặc danh sách vào image-search-list. Nếu chỉ có một ảnh, cổng Condition trả true/false." },
    { key: "searchFolder", label: "Folder ảnh để tìm", configGroup: "search-source", type: "folder", showWhen: { key: "searchSourceMode", value: "Chọn folder ảnh" }, help: "Hoặc nối Folder vào search-folder. App sẽ quét ảnh trong thư mục rồi trả các ảnh khớp." },
    { key: "includeSubfolders", label: "Quét thư mục con", configGroup: "search-source", type: "checkbox", defaultValue: true, showWhen: { key: "searchSourceMode", value: "Chọn folder ảnh" } },
    { key: "maxFolderImages", label: "Số ảnh tối đa từ folder", configGroup: "search-source", type: "number", min: 1, max: 1000, step: 1, defaultValue: 500, showWhen: { key: "searchSourceMode", value: "Chọn folder ảnh" } },
    { key: "similarityThreshold", label: "Ngưỡng tương đồng", configGroup: "result", type: "range", min: 50, max: 99, step: 1, defaultValue: 85, suffix: "%", help: "Một ảnh trả Condition true/false. Nhiều ảnh/folder trả ImageMatch[] gồm tên ảnh, điểm và vùng tìm thấy." },
    { key: "maxMatches", label: "Số kết quả tối đa", configGroup: "result", type: "number", min: 1, max: 100, step: 1, defaultValue: 20, help: "Nhiều ảnh/folder: giữ kết quả có điểm cao nhất. Nối FrameIndex để thêm timecode; nếu không sẽ trả tên ảnh khớp." },
  ],
};

const PUBLISH_NODE_FIELDS: Record<string, ConfigField[]> = {
  "Tạo tiêu đề": [
    { key: "suggestionCount", label: "Số phương án", type: "range", min: 1, max: 12, step: 1, defaultValue: 5 },
    { key: "maxTitleLength", label: "Độ dài tối đa", type: "number", min: 20, max: 120, step: 5, defaultValue: 80, suffix: " ký tự" },
    { key: "keywords", label: "Từ khóa bắt buộc", type: "tags", placeholder: "Nhập từ khóa rồi nhấn Enter" },
    { key: "instructions", label: "Yêu cầu bổ sung", type: "textarea", placeholder: "Ví dụ: tiếng Việt, không giật gân, ưu tiên rõ ràng..." },
  ],
  "Bố cục thumbnail bằng AI": [
    { key: "style", label: "Phong cách", type: "select", options: ["Nổi bật YouTube", "Tối giản", "Gaming", "Giáo dục", "Điện ảnh"], defaultValue: "Nổi bật YouTube" },
    { key: "detail", label: "Mức phân tích ảnh", type: "select", options: ["Tiết kiệm", "Cân bằng", "Chuyên sâu"], defaultValue: "Cân bằng" },
    { key: "instructions", label: "Yêu cầu bố cục", type: "textarea", placeholder: "Ví dụ: chữ không che nhân vật, ưu tiên vùng trống bên phải..." },
  ],
  "Chọn ảnh thumbnail bằng AI": [
    { key: "maxCandidates", label: "Tối đa ảnh gửi AI", type: "number", min: 1, max: 12, step: 1, defaultValue: 4, help: "App lọc theo tên ảnh trước, sau đó chỉ gửi số ảnh này cho AI để kiểm soát token." },
    { key: "detail", label: "Mức phân tích ảnh", type: "select", options: ["low", "auto", "high"], defaultValue: "low" },
    { key: "instructions", label: "Tiêu chí chọn", type: "textarea", placeholder: "Ví dụ: nhân vật rõ nét, không che UI quan trọng, đúng khoảnh khắc highlight..." },
    AI_MODEL_FIELD,
  ],
  "Ghép chữ lên thumbnail": [
    { key: "outputName", label: "Tên file thumbnail", type: "text", defaultValue: "thumbnail-youtube" },
    { key: "localFolder", label: "Thư mục lưu", type: "folder", help: "Để trống để lưu vào Content Flow Output cạnh ảnh nguồn." },
  ],
};

const SPECIAL_NODE_FIELDS: Record<string, ConfigField[]> = {
  "Kiểm tra yêu cầu và cấu trúc": [
    { key: "requirements", label: "Yêu cầu bắt buộc", type: "textarea", placeholder: "Mỗi dòng một cụm phải có, ví dụ:\nTiêu đề\nKêu gọi hành động", help: "Node tìm chính xác từng cụm, không dùng AI." },
    { key: "minWords", label: "Số từ tối thiểu", type: "number", min: 0, max: 100000, step: 1, defaultValue: 0 },
    { key: "maxWords", label: "Số từ tối đa", type: "number", min: 0, max: 100000, step: 1, defaultValue: 0, help: "Để 0 nếu không giới hạn." },
  ],
  "Chuẩn bị kiểm tra AI": [
    { key: "checkGoal", label: "Mục tiêu kiểm tra", type: "textarea", placeholder: "Ví dụ: kiểm tra video có đúng nội dung và không có cảnh gây hiểu sai" },
    { key: "requirements", label: "Checklist", type: "textarea", placeholder: "Mỗi dòng một điều AI phải kiểm tra" },
  ],
  "Đọc kết quả AI kiểm tra": [],
  "Tổng hợp báo cáo kiểm tra": [
    { key: "cannotCheckIsFail", label: "Không thể kiểm tra là không đạt", type: "checkbox", defaultValue: true },
  ],
  "Chấm điểm thành phẩm": [
    { key: "warningDeduction", label: "Trừ điểm mỗi lỗi cần sửa", type: "number", min: 1, max: 50, step: 1, defaultValue: 10 },
    { key: "failDeduction", label: "Trừ điểm mỗi lỗi không đạt", type: "number", min: 1, max: 100, step: 1, defaultValue: 30 },
  ],
  "Duyệt xuất bản": [
    { key: "decision", label: "Quyết định", type: "select", options: ["Theo kết quả kiểm tra", "Đã duyệt", "Yêu cầu sửa", "Từ chối"], defaultValue: "Theo kết quả kiểm tra" },
    { key: "note", label: "Ghi chú duyệt", type: "textarea", placeholder: "Lý do duyệt hoặc việc cần sửa thêm..." },
  ],
  "Đặt tên": [
    { key: "namingPattern", label: "Mẫu tên", type: "text", defaultValue: "#file-name#", help: "#file-name#, #stt#, #folder-name#, #file-type#, #file-size#, #today#, #now#, #hour#" },
  ],
  "Lưu file": [
    { key: "localFolder", label: "Thư mục lưu", type: "folder", placeholder: "Chọn trong node hoặc nối cổng Folder", help: "Chọn thư mục tại đây hoặc nối Folder; hai cách loại trừ nhau." },
    { key: "duplicateMode", label: "File trùng tên và định dạng", type: "select", options: ["Lưu mới", "Ghi đè"], defaultValue: "Lưu mới" },
    {
      key: "storageOutputMode",
      label: "Cổng ra",
      type: "select",
      options: ["Tương đồng node kết nối", "Tự do"],
      defaultValue: "Tương đồng node kết nối",
      help: "Tương đồng node kết nối: cổng ra kế thừa đúng kiểu từ cổng dữ liệu đã nối vào. Tự do: cổng ra là Free để nối theo nhu cầu.",
    },
  ],
  // Node này chỉ hiển thị dữ liệu đã nối vào, không có cấu hình riêng.
  "Xem dữ liệu trên canvas": [],
  "Tải kho ảnh từ thư mục": [
    { key: "localFolder", label: "Thư mục ảnh", type: "folder", required: true, help: "Chọn kho ảnh cục bộ. App chỉ lưu đường dẫn, không sao chép toàn bộ ảnh vào workflow." },
    { key: "includeSubfolders", label: "Quét thư mục con", type: "checkbox", defaultValue: true },
    { key: "maxImages", label: "Số ảnh tối đa nạp", type: "number", min: 1, max: 500, step: 1, defaultValue: 120, help: "Giới hạn danh sách để canvas và AI vẫn phản hồi nhanh." },
  ],
  "Tìm nội dung trong kho": [
    { key: "query", label: "Từ khóa tìm kiếm", type: "text", placeholder: "Ví dụ: xu hướng video bán hàng 2026" },
    { key: "source", label: "Nguồn ưu tiên", type: "select", options: ["Web công khai", "Kho nội bộ", "Cả hai"], defaultValue: "Web công khai" },
    { key: "maxResults", label: "Số kết quả", type: "range", min: 1, max: 30, step: 1, defaultValue: 10 },
  ],
  "Tìm thư viện tài liệu nội bộ": [
    { key: "documentFolder", label: "Chọn thư mục tài liệu trên máy", type: "folder", accept: ".pdf,.docx,.txt,.md,.csv,.json,.html", multiple: true, help: "Chọn thư mục có tài liệu; có thể quét cả thư mục con." },
    { key: "includeSubfolders", label: "Quét cả thư mục con", type: "checkbox", defaultValue: true },
    { key: "documentFilter", label: "Lọc theo tên hoặc tag", type: "tags", placeholder: "Ví dụ: báo cáo, kịch bản, nghiên cứu" },
  ],
  "Tìm thư viện ảnh nội bộ": [
    { key: "imageFolder", label: "Chọn thư mục ảnh trên máy", type: "folder", accept: "image/*", multiple: true, help: "Mở cửa sổ chọn thư mục ảnh trên máy." },
    { key: "includeSubfolders", label: "Quét cả thư mục con", type: "checkbox", defaultValue: true },
    { key: "imageFilter", label: "Lọc theo tên hoặc tag", type: "tags", placeholder: "Ví dụ: sản phẩm, lifestyle, nền" },
  ],
  "Tải ảnh từ URL": [
    { key: "imageUrls", label: "Danh sách URL ảnh", type: "url-list", placeholder: "https://..." },
    { key: "usageRights", label: "Quyền sử dụng", type: "select", options: ["Tôi có quyền sử dụng", "Creative Commons", "Public domain", "Cần kiểm tra"], defaultValue: "Cần kiểm tra" },
  ],
  "Tìm thư viện video nội bộ": [
    { key: "videoFolder", label: "Chọn thư mục video trên máy", type: "folder", accept: "video/*", multiple: true, help: "Mở cửa sổ chọn thư mục. Ứng dụng sẽ quét các video bên trong thư mục đã chọn." },
    { key: "includeSubfolders", label: "Quét cả thư mục con", type: "checkbox", defaultValue: true },
    { key: "videoFilter", label: "Lọc theo tên hoặc tag", type: "tags", placeholder: "Ví dụ: intro, gameplay, review" },
  ],
  "Tìm kho âm thanh": [
    { key: "query", label: "Từ khóa", type: "tags", placeholder: "Ví dụ: upbeat, cinematic, tiếng vỗ tay" },
    { key: "audioType", label: "Loại âm thanh", type: "select", options: ["Nhạc nền", "Hiệu ứng âm thanh", "Voice mẫu", "Tất cả"], defaultValue: "Tất cả" },
    { key: "license", label: "Giấy phép", type: "select", options: ["Mọi giấy phép", "Thương mại", "Creative Commons", "Public domain"], defaultValue: "Mọi giấy phép" },
  ],
  "Tìm thư viện âm thanh nội bộ": [
    { key: "audioFolder", label: "Chọn thư mục âm thanh trên máy", type: "folder", accept: "audio/*", multiple: true, help: "Mở cửa sổ chọn thư mục voice, nhạc hoặc hiệu ứng âm thanh." },
    { key: "includeSubfolders", label: "Quét cả thư mục con", type: "checkbox", defaultValue: true },
    { key: "audioFilter", label: "Lọc theo tên hoặc tag", type: "tags", placeholder: "Ví dụ: voice, nhạc nền, hiệu ứng" },
  ],
  "Tải âm thanh từ URL": [
    { key: "audioUrls", label: "Danh sách URL âm thanh", type: "url-list", placeholder: "https://..." },
    { key: "usageRights", label: "Quyền sử dụng", type: "select", options: ["Tôi có quyền sử dụng", "Creative Commons", "Public domain", "Cần kiểm tra"], defaultValue: "Cần kiểm tra" },
  ],
  "Xuất nhiều tỷ lệ": [
    { key: "ratios", label: "Các tỷ lệ cần xuất", type: "multi-select", options: ["16:9", "9:16", "1:1", "4:5"], defaultValue: "16:9,9:16,1:1" },
  ],
  "Thiết lập quyền riêng tư": [
    { key: "privacy", label: "Quyền riêng tư", type: "select", options: ["Private", "Unlisted", "Public"], defaultValue: "Private" },
  ],
  "Gọi API": [
    { key: "url", label: "URL", type: "url", placeholder: "https://api.example.com/..." },
    { key: "method", label: "Phương thức", type: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE"], defaultValue: "POST" },
    { key: "headers", label: "Header (JSON)", type: "code", placeholder: "{\n  \"Authorization\": \"Bearer ...\"\n}" },
    { key: "body", label: "Body (JSON)", type: "code", placeholder: "{\n  \"key\": \"value\"\n}" },
  ],
  "Chạy mã": [
    { key: "javascript", label: "JavaScript", type: "code", placeholder: "return input;" },
    { key: "executionLimit", label: "Giới hạn thực thi (giây)", type: "number", min: 1, max: 300, defaultValue: 30, suffix: "giây" },
  ],
  "If/Else": [
    { key: "fallbackCondition", label: "Điều kiện dự phòng", type: "select", options: ["Đúng", "Sai"], defaultValue: "Đúng", help: "Ưu tiên Condition nối qua dây. Chỉ dùng lựa chọn này khi cổng Condition chưa được nối." },
  ],
  "Switch": [
    { key: "case1", label: "Giá trị cho Nhánh 1", type: "text", defaultValue: "true" },
    { key: "case2", label: "Giá trị cho Nhánh 2", type: "text", defaultValue: "false" },
    { key: "ignoreCase", label: "Không phân biệt hoa thường", type: "checkbox", defaultValue: true, help: "Switch đọc giá trị từ cổng Condition; nếu không khớp Nhánh 1/2 thì gửi Dữ liệu ra cổng Mặc định." },
  ],
};

function selectOptionsFor(label: string): string[] | undefined {
  const value = label.toLowerCase();
  if (value === "model" || value.includes("model ")) return ["Tự động", "OpenAI", "Gemini", "Claude", "Dịch vụ nội bộ", "API tùy chỉnh"];
  if (value.includes("nhà cung cấp")) return ["Tự động", "Thư viện nội bộ", "API bên thứ ba", "Tùy chỉnh"];
  if (value.includes("ngôn ngữ")) return ["Tiếng Việt", "English", "中文", "日本語", "한국어", "Tự động nhận diện"];
  if (value.includes("tỷ lệ")) return ["16:9", "9:16", "1:1", "4:5", "Tùy chỉnh"];
  if (value === "fps") return ["24", "25", "30", "50", "60"];
  if (value.includes("độ phân giải")) return ["720p", "1080p", "1440p", "4K", "Tự động"];
  if (value.includes("codec")) return ["H.264", "H.265", "VP9", "AV1", "ProRes"];
  if (value.includes("định dạng")) return ["Tự động", "MP4", "MOV", "WebM", "PNG", "JPG", "WAV", "MP3", "SRT", "VTT"];
  if (value.includes("giấy phép")) return ["Mọi giấy phép", "Thương mại", "Creative Commons", "Public domain", "Nội bộ"];
  if (value.includes("phương thức") || value === "method") return ["GET", "POST", "PUT", "PATCH", "DELETE"];
  if (value.includes("quyền riêng tư")) return ["Private", "Unlisted", "Public"];
  if (value.includes("vị trí")) return ["Trên trái", "Trên giữa", "Trên phải", "Giữa", "Dưới trái", "Dưới giữa", "Dưới phải", "Tùy chỉnh"];
  if (value.includes("chuyển cảnh")) return ["Cắt thẳng", "Mờ dần", "Trượt", "Zoom", "Whip", "Tự động"];
  if (value.includes("animation")) return ["Không", "Fade", "Slide", "Pop", "Typewriter", "Tùy chỉnh"];
  if (value.includes("giọng văn") || value.includes("phong cách") || value.includes("độ trang trọng")) return ["Tự động", "Gần gũi", "Chuyên gia", "Năng động", "Trang trọng", "Tùy chỉnh"];
  if (value.includes("cảm xúc") || value === "mood") return ["Trung tính", "Vui vẻ", "Hào hứng", "Tin cậy", "Cảm xúc", "Kịch tính", "Tùy chỉnh"];
  if (value.includes("loại hook")) return ["Câu hỏi", "Sự thật bất ngờ", "Vấn đề", "Lời hứa", "Kể chuyện", "Tùy chỉnh"];
  if (value.includes("loại cảnh")) return ["A-roll", "B-roll", "Ảnh", "Screen recording", "Text", "Tự động"];
  if (value.includes("loại hiệu ứng")) return ["Âm thanh", "Hình ảnh", "Chuyển động", "Ánh sáng", "Tùy chỉnh"];
  if (value.includes("nền tảng")) return ["YouTube", "TikTok", "Facebook", "Instagram", "Website", "Tùy chỉnh"];
  if (value.includes("kênh")) return ["Kênh mặc định", "Chọn khi chạy", "Tùy chỉnh"];
  if (value.includes("mức log")) return ["Debug", "Info", "Warning", "Error"];
  if (value.includes("tăng/giảm")) return ["Tăng dần", "Giảm dần"];
  if (value.includes("toán tử")) return ["Bằng", "Khác", "Lớn hơn", "Nhỏ hơn", "Có chứa", "Tồn tại"];
  if (value.includes("kiểu merge") || value.includes("chiến lược")) return ["Ghép theo thứ tự", "Ghép theo khóa", "Ghi đè", "Giữ cả hai", "Tùy chỉnh"];
  if (value.includes("kiểu kích hoạt")) return ["Thủ công", "Theo lịch", "Webhook", "Workflow khác"];
  if (value.includes("preset") || value === "lut") return ["Tự động", "Mặc định", "Cinematic", "Sáng", "Tương phản", "Tùy chỉnh"];
  if (value.includes("trạng thái")) return ["Tất cả", "Đang chờ", "Đã duyệt", "Từ chối", "Hoàn thành", "Lỗi"];
  if (value.includes("font")) return ["Theo thương hiệu", "Inter", "Arial", "Roboto", "Montserrat", "Tùy chỉnh"];
  return undefined;
}

function fieldForSetting(spec: { name: string; group?: string }, label: string, index: number): ConfigField {
  const key = settingKey(label, index);
  const value = label.toLowerCase();
  const selectOptions = selectOptionsFor(label);

  if (selectOptions) return { key, label, type: "select", options: selectOptions, defaultValue: selectOptions[0] };
  if (/^(màu|màu sắc|màu chữ|màu nền)$/i.test(label)) return { key, label, type: "color", defaultValue: "#ffffff" };
  if (value.includes("url")) return { key, label, type: value.includes("nhiều") ? "url-list" : "url", placeholder: "https://..." };
  if (value.includes("thư mục")) return { key, label, type: "folder", multiple: true, help: "Chọn thư mục trên máy." };
  if (/^(file|logo|ảnh nền|ảnh tham chiếu|mẫu giọng|font thương hiệu)$/i.test(label)) {
    const accept = value.includes("logo") || value.includes("ảnh") ? "image/*" : value.includes("font") ? ".ttf,.otf,.woff,.woff2" : undefined;
    return { key, label, type: "file", accept };
  }
  if (value.includes("ngày giờ")) return { key, label, type: "datetime-local" };
  if (value.includes("ngày đăng") || value.includes("ngày tạo") || value === "ngày") return { key, label, type: "date" };
  if (/^(ocr|phân trang|loại trùng|timestamp|nhận diện người nói|giữ cao độ|crop tự động|vòng lặp|loop|watermark|nghe thử|xem trước|preview|khóa)$/i.test(label)) {
    return { key, label, type: "checkbox", defaultValue: true };
  }
  if (/opacity|cường độ|độ nhạy|độ ảnh hưởng|mức ổn định|mức độ biến đổi|ngưỡng tương đồng|mức giảm|độ sáng|tương phản/i.test(value)) {
    return { key, label, type: "range", min: 0, max: 100, step: 1, defaultValue: 50, suffix: "%" };
  }
  if (/số lượng|số kết quả|số phương án|số ký tự|số dòng|số lần|giới hạn đồng thời|thời lượng|độ dài|fps|seed|timeout|bitrate|tốc độ|khoảng nghỉ|crossfade|fade|điểm đầu|điểm cuối|thời điểm|lufs|peak/i.test(value)) {
    return { key, label, type: "number", min: 0, step: value.includes("tốc độ") ? 0.1 : 1, defaultValue: value.includes("tốc độ") ? 1 : 0 };
  }
  if (/từ khóa|domain|tag|thuật ngữ|từ điển riêng|nguồn đối chiếu|chính sách nền tảng/i.test(value)) {
    return { key, label, type: "tags", placeholder: "Nhập một mục rồi nhấn Enter" };
  }
  if (/javascript|header|body|điều kiện|biểu thức|ánh xạ trường|nhiều điều kiện/i.test(value)) {
    return { key, label, type: "code", placeholder: value.includes("javascript") ? "return input;" : "Nhập cấu hình hoặc biểu thức..." };
  }
  if (/prompt|nội dung|mô tả|ghi chú|chỉ dẫn|yêu cầu|lời dẫn|lời hứa|cta|điều cấm|phần cần|hành động|lý do/i.test(value)) {
    return { key, label, type: "textarea", placeholder: "Nhập " + label.toLowerCase() + "..." };
  }
  return { key, label, type: "text", placeholder: "Nhập " + label.toLowerCase() + "..." };
}

function configForSpec(spec: { name: string; settings: string }): {
  fields: ConfigField[];
  defaults: Record<string, FieldValue>;
} {
  const specialFields = INPUT_NODE_FIELDS[spec.name] ?? AI_NODE_FIELDS[spec.name] ?? RESEARCH_NODE_FIELDS[spec.name] ?? CONTENT_NODE_FIELDS[spec.name] ?? VIDEO_ANALYSIS_NODE_FIELDS[spec.name] ?? VIDEO_RENDER_NODE_FIELDS[spec.name] ?? IMAGE_PROCESSING_NODE_FIELDS[spec.name] ?? PUBLISH_NODE_FIELDS[spec.name] ?? SPECIAL_NODE_FIELDS[spec.name];
  const fields = specialFields ? [...specialFields] : splitContract(spec.settings).map((label, index) => fieldForSetting(spec, label, index));
  if (DIRECT_AI_KEY_SPEC_NAMES.has(spec.name) && !fields.some((field) => field.key === "apiKey")) fields.push(DIRECT_AI_API_KEY_FIELD);
  return {
    fields,
    defaults: Object.fromEntries(fields.flatMap((field) => field.defaultValues
      ? Object.entries(field.defaultValues)
      : [[field.key, field.defaultValue ?? (field.type === "checkbox" ? false : "")]])),
  };
}

const NODE_DEFINITIONS: NodeDefinition[] = ensureUniqueIconsByCategory(NODE_SPECS.map((spec, index) => {
  const config = configForSpec(spec);
  const category = displayCategory(spec.group, spec.name);
  return {
    kind: "node-" + (index + 1),
    label: displayNodeName(spec.name),
    family: displayNodeName(spec.name),
    icon: iconForNode(spec.name, category),
    category,
    description: spec.settings,
    inputs: inputPortsForSpec(spec),
    outputs: makePorts(spec.output, "output", false),
    configFields: config.fields,
    defaults: config.defaults,
  };
}));

// Hai gateway này không thuộc catalog tác vụ thông thường: chúng chỉ mô tả hợp
// đồng công khai của workflow để node Gọi workflow có thể dùng an toàn.
const WORKFLOW_INTERFACE_NODE_DEFINITIONS: NodeDefinition[] = [
  {
    kind: "workflow-input-gateway",
    label: WORKFLOW_INPUT_GATEWAY_FAMILY,
    family: WORKFLOW_INPUT_GATEWAY_FAMILY,
    icon: "⤒",
    category: "Điều khiển workflow",
    description: "Khai báo dữ liệu workflow nhận từ node Gọi workflow. Mỗi cổng tại đây sẽ là một cổng vào trên node gọi.",
    inputs: [],
    outputs: [],
    configFields: [],
    defaults: {},
  },
  {
    kind: "workflow-output-gateway",
    label: WORKFLOW_OUTPUT_GATEWAY_FAMILY,
    family: WORKFLOW_OUTPUT_GATEWAY_FAMILY,
    icon: "⇧",
    category: "Điều khiển workflow",
    description: "Khai báo kết quả workflow trả về node Gọi workflow. Nối dữ liệu cần trả vào các cổng tại đây.",
    inputs: [],
    outputs: [],
    configFields: [],
    defaults: {},
  },
];

const WORKFLOW_CALL_NODE_DEFINITION: NodeDefinition = {
  kind: "workflow-call",
  label: "Gọi workflow",
  family: "Gọi workflow",
  icon: "▧",
  category: "Điều khiển workflow",
  description: "Chọn workflow .tess để gọi như một node. Cổng tự đồng bộ theo Cổng vào/Cổng ra của workflow được chọn.",
  inputs: [],
  outputs: [],
  configFields: [
    { key: "workflowTargetMode", label: "Nguồn workflow", type: "select", options: ["Chọn file .tess", "Workflow đang mở"], defaultValue: "Chọn file .tess" },
    {
      key: "workflowPath",
      label: "Workflow cần gọi",
      type: "file",
      accept: ".tess,.json",
      multiple: false,
      persistPaths: true,
      required: true,
      showWhen: { key: "workflowTargetMode", value: "Chọn file .tess" },
      help: "Chọn file .tess. App đọc interface và tạo các cổng tương ứng; file JSON cũ vẫn chỉ đọc để chuyển đổi an toàn.",
    },
  ],
  defaults: { workflowTargetMode: "Chọn file .tess" },
};

const primitiveDefinitionByLabel = new Map(NODE_SPECS.map((spec, index) => [spec.name, NODE_DEFINITIONS[index]]));

function uniquePorts(ports: Port[], prefix: "input" | "output"): Port[] {
  const seen = new Set<string>();
  return ports.filter((port) => {
    const key = port.type.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.label.localeCompare(right.label, "vi", { sensitivity: "base" }))
    .map((port, index) => ({ ...port, id: `${prefix}-${index + 1}` }));
}

function uniqueConfigFields(fields: ConfigField[]): ConfigField[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    if (seen.has(field.key)) return false;
    seen.add(field.key);
    return true;
  });
}

function externalPipelineInputs(steps: NodeDefinition[]): Port[] {
  const availableTypes: string[] = [];
  const external: Port[] = [];
  for (const step of steps) {
    for (const inputPort of step.inputs) {
      if (!availableTypes.some((type) => portTypesCompatible(type, inputPort.type))) {
        external.push(inputPort);
        availableTypes.push(inputPort.type);
      }
    }
    availableTypes.push(...step.outputs.map((port) => port.type));
  }
  return uniquePorts(external, "input");
}

const NO_BASIC_OPERATION = "Không thao tác";
const VIDEO_PREPARATION_TRANSCRIPT_NONE = "Không transcript";
const VIDEO_PREPARATION_TRANSCRIPT_LOCAL = "Transcript cục bộ";
const VIDEO_PREPARATION_TRANSCRIPT_API = "Transcript bằng API";
const VIDEO_PREPARATION_TRANSCRIPT_MODES = [
  VIDEO_PREPARATION_TRANSCRIPT_NONE,
  VIDEO_PREPARATION_TRANSCRIPT_LOCAL,
  VIDEO_PREPARATION_TRANSCRIPT_API,
];

const VIDEO_PREPARATION_TRANSCRIPT_FIELD: ConfigField = {
  key: "transcriptMode",
  label: "Transcript",
  type: "select",
  options: VIDEO_PREPARATION_TRANSCRIPT_MODES,
  required: true,
  placeholder: "Chọn cách tạo transcript...",
  help: "Bắt buộc chọn. Không transcript sẽ không tạo cổng TimedTranscript.",
};

const VIDEO_PREPARATION_LOCAL_MODEL_FIELD: ConfigField = {
  key: "localTranscriptModel",
  label: "Model transcript cục bộ",
  type: "select",
  options: ["Nhanh (Whisper tiny)", "Cân bằng (Whisper base)", "Chất lượng (Whisper small)", "Tiếng Việt (PhoWhisper base)", "Tiếng Việt chất lượng cao (PhoWhisper small)"],
  defaultValue: "Cân bằng (Whisper base)",
  showWhen: { key: "transcriptMode", value: VIDEO_PREPARATION_TRANSCRIPT_LOCAL },
  help: "Model được tải một lần rồi lưu cache cục bộ. Hai lựa chọn PhoWhisper chuyên tiếng Việt và tự đặt ngôn ngữ vi.",
};

const VIDEO_PREPARATION_TRANSCRIPT_LANGUAGE_FIELD: ConfigField = {
  key: "language",
  label: "Ngôn ngữ lời thoại transcript",
  type: "select",
  options: ["Tiếng Việt (vi)", "English (en)", "日本語 (ja)", "한국어 (ko)", "中文 (zh)", "Tự động nhận diện"],
  required: true,
  placeholder: "Chọn ngôn ngữ lời thoại...",
  help: "Chọn đúng ngôn ngữ để Whisper nhận diện chính xác. Với thoại tiếng Việt, chọn “Tiếng Việt (vi)” thay vì tự động.",
};

function videoPreparationConfigFields(steps: NodeDefinition[]): ConfigField[] {
  const fieldsOf = (stepLabel: string, configGroup: string) => {
    // Node nguyên thủy có thể đã được đổi tên hiển thị trong catalog. So khớp
    // cả hai dạng để các trường kế thừa (nhất là ngôn ngữ transcript) không mất.
    const step = steps.find((candidate) => candidate.label === stepLabel || displayNodeName(candidate.label) === displayNodeName(stepLabel));
    return (step?.configFields ?? []).map((field) => {
      if (field.key === "apiKey") return { ...field, configGroup, showWhen: { key: "transcriptMode", value: VIDEO_PREPARATION_TRANSCRIPT_API } };
      if (field.key === "speakerDiarization") return { ...field, configGroup, showWhen: { key: "transcriptMode", value: VIDEO_PREPARATION_TRANSCRIPT_API } };
      if (field.key === "language") return { ...VIDEO_PREPARATION_TRANSCRIPT_LANGUAGE_FIELD, configGroup };
      return { ...field, configGroup };
    });
  };

  return uniqueConfigFields([
    ...fieldsOf("Trích frame từ video", "frame"),
    ...fieldsOf("Tách âm thanh từ video", "audio"),
    { ...VIDEO_PREPARATION_TRANSCRIPT_FIELD, configGroup: "transcript" },
    ...fieldsOf("Phiên âm video theo thời gian", "transcript"),
    { ...VIDEO_PREPARATION_LOCAL_MODEL_FIELD, configGroup: "transcript" },
  ]);
}

function basicOperationName(step: NodeDefinition, primitiveName: string, preset: (typeof BASIC_NODE_PRESETS)[number]): string {
  return preset.operationLabels?.[primitiveName] ?? step.label;
}

function findBasicStep(definition: NodeDefinition, operation: string): BasicStep | undefined {
  return definition.basicSteps?.find((step) => (step.operation ?? step.label) === operation || step.label === operation);
}

/** Node Cơ bản chỉ có một thao tác không phải yêu cầu người dùng chọn lại. */
function singleBasicOperation(definition: Pick<NodeDefinition, "basicMode" | "basicSteps">): string | undefined {
  if (definition.basicMode !== "choice" || definition.basicSteps?.length !== 1) return undefined;
  const step = definition.basicSteps[0];
  return step.operation ?? step.label;
}

function normalizeBasicOperation(definition: NodeDefinition, operation: unknown): string {
  const fixedOperation = singleBasicOperation(definition);
  if (fixedOperation) return fixedOperation;
  if (operation === NO_BASIC_OPERATION) return NO_BASIC_OPERATION;
  const step = typeof operation === "string" ? findBasicStep(definition, displayNodeName(operation)) : undefined;
  return step?.operation ?? step?.label ?? NO_BASIC_OPERATION;
}

const BASIC_NODE_DEFINITIONS: NodeDefinition[] = ensureUniqueIconsByCategory(BASIC_NODE_PRESETS.map((preset, index) => {
  const steps = preset.nodes.map((label) => primitiveDefinitionByLabel.get(label)).filter((item): item is NodeDefinition => Boolean(item));
  const stepLabels = steps.map((step, stepIndex) => basicOperationName(step, preset.nodes[stepIndex], preset));
  const isSingleChoice = preset.mode === "choice" && steps.length === 1;
  const defaultOperation = isSingleChoice ? stepLabels[0] : NO_BASIC_OPERATION;
  const operationField: ConfigField = {
    key: "basicOperation",
    label: "Thao tác",
    type: "select",
    options: [...stepLabels, NO_BASIC_OPERATION],
    defaultValue: NO_BASIC_OPERATION,
  };
  const first = steps[0];
  const configFields = preset.id === "prepare-video-analysis"
    ? videoPreparationConfigFields(steps)
    : preset.mode === "choice"
      ? uniqueConfigFields([...(isSingleChoice ? [] : [operationField]), ...(first?.configFields ?? [])])
      : uniqueConfigFields(steps.flatMap((step) => step.configFields));
  const fieldDefaults = Object.fromEntries(configFields.flatMap((field) => field.defaultValues
    ? Object.entries(field.defaultValues)
    : field.defaultValue === undefined ? [] : [[field.key, field.defaultValue]]));
  const defaults = Object.assign({}, ...steps.map((step) => step.defaults), fieldDefaults, preset.mode === "choice" ? { basicOperation: defaultOperation } : {});
  const inferredInputs = preset.sourceNode
    ? []
    : preset.mode === "pipeline"
    ? externalPipelineInputs(steps)
    : isSingleChoice
      ? uniquePorts(first?.inputs ?? [], "input")
      : uniquePorts(steps.flatMap((step) => step.inputs).map((port) => ({ ...port, required: false })), "input");
  // “Dữ liệu” là cổng Free nên về lý thuyết có thể tương thích với Folder. Tuy
  // nhiên Lưu file cần hiển thị rõ Folder là nguồn vị trí lưu thứ hai, không để
  // nó bị suy luận nhầm là đã có sẵn trong pipeline.
  const inputs = preset.id === "data-save-file"
    ? uniquePorts([...inferredInputs, ...steps.flatMap((step) => step.inputs.filter((port) => port.type === "Folder"))], "input")
    : inferredInputs;
  // Thiết lập AI là một cấu hình ghép: AIProvider chỉ là bước trung gian,
  // người dùng nhận duy nhất AIModel để nối vào các node gọi AI.
  const outputs = preset.id === "ai-setup"
    ? uniquePorts(steps.at(-1)?.outputs ?? [], "output")
    : preset.id === "image-input-optimize"
      ? uniquePorts((steps.at(-1)?.outputs ?? []).filter((port) => port.type === "Image[]"), "output")
      : preset.id === "data-save-file"
        ? uniquePorts(steps.at(-1)?.outputs ?? [], "output")
    : uniquePorts(steps.flatMap((step) => step.outputs), "output");
  return {
    kind: `basic-${preset.id}`,
    label: preset.label,
    family: preset.label,
    icon: iconForNode(preset.label, preset.category),
    category: preset.category,
    description: preset.description,
    inputs,
    outputs,
    configFields,
    defaults,
    basicPresetId: preset.id,
    basicMode: preset.mode,
    basicNodeLabels: stepLabels,
    basicSteps: steps.map((step, stepIndex) => ({
      kind: step.kind,
      label: step.label,
      operation: stepLabels[stepIndex],
      category: step.category,
      inputs: step.inputs,
      outputs: step.outputs,
      configFields: step.configFields,
      config: { ...step.defaults },
    })),
  };
}));

// Đây là nguồn catalog duy nhất của ứng dụng. Thư viện bên trái và hộp Space
// chỉ lọc/hiển thị dữ liệu từ đây, không giữ hai danh sách node riêng.
// “Lấy transcript” là node API cũ. Giữ định nghĩa nội bộ để nhận diện workflow
// đã lưu, nhưng không còn cho thêm mới: mọi trường hợp dùng node thống nhất bên dưới.
const HIDDEN_LEGACY_ADVANCED_FAMILIES = new Set(["Trích xuất transcript video"]);
const NODE_LIBRARY: Record<LibraryMode, readonly NodeDefinition[]> = {
  basic: BASIC_NODE_DEFINITIONS,
  advanced: [...WORKFLOW_INTERFACE_NODE_DEFINITIONS, WORKFLOW_CALL_NODE_DEFINITION, ...NODE_DEFINITIONS.filter((definition) => !HIDDEN_LEGACY_ADVANCED_FAMILIES.has(definition.family))],
};
const ALL_NODE_DEFINITIONS = [...BASIC_NODE_DEFINITIONS, ...WORKFLOW_INTERFACE_NODE_DEFINITIONS, WORKFLOW_CALL_NODE_DEFINITION, ...NODE_DEFINITIONS];
const definitionMap = new Map(ALL_NODE_DEFINITIONS.map((definition) => [definition.kind, definition]));
const LEGACY_ADVANCED_KIND_MAP: Record<string, string> = (() => {
  const legacy = NODE_DEFINITIONS.find((definition) => definition.family === "Trích xuất transcript video");
  const unified = NODE_DEFINITIONS.find((definition) => definition.family === "Tạo transcript video theo thời gian");
  return legacy && unified ? { [legacy.kind]: unified.kind } : {};
})();

function definitionHasExecutor(definition: NodeDefinition): boolean {
  if (definition.basicSteps?.length) return definition.basicSteps.every((step) => hasNodeExecutor(step.label, step.category));
  return hasNodeExecutor(definition.label, definition.category);
}
const LEGACY_BASIC_KIND_MAP: Record<string, string> = {
  "basic-file-input": "basic-direct-input",
  "basic-media-input": "basic-file-source",
  "basic-find-image": "basic-file-source",
  "basic-audio-source": "basic-file-source",
};

function portsForBasicOperation(definition: NodeDefinition, operation: string): Pick<NodeDefinition, "inputs" | "outputs"> {
  if (definition.basicMode !== "choice" || operation === NO_BASIC_OPERATION) {
    return { inputs: definition.inputs, outputs: definition.outputs };
  }
  const step = findBasicStep(definition, operation);
  if (!step) return { inputs: definition.inputs, outputs: definition.outputs };
  const hasType = (ports: Port[], type: string) => ports.some((port) => port.type.toLowerCase() === type.toLowerCase());
  return {
    // Node Cơ bản đa thao tác khởi đầu bằng tập cổng tùy chọn. Khi người dùng
    // đã chọn một thao tác, khôi phục quy tắc bắt buộc của đúng node Chi tiết
    // tương ứng để Kiểm tra workflow phát hiện prompt/media bị thiếu hoặc pause.
    inputs: definition.inputs.filter((port) => hasType(step.inputs, port.type)).map((port) => ({
      ...port,
      required: step.inputs.find((item) => item.type.toLowerCase() === port.type.toLowerCase())?.required ?? port.required,
    })),
    outputs: definition.outputs.filter((port) => hasType(step.outputs, port.type)),
  };
}

function portsForBasicConfiguration(definition: NodeDefinition, config: Record<string, FieldValue>, operation = String(config.basicOperation ?? NO_BASIC_OPERATION)): Pick<NodeDefinition, "inputs" | "outputs"> {
  const base = portsForBasicOperation(definition, operation);
  const transcriptMode = String(config.transcriptMode ?? "");
  if (definition.basicPresetId === "prepare-video-analysis") {
    const createsTranscript = transcriptMode === VIDEO_PREPARATION_TRANSCRIPT_LOCAL || transcriptMode === VIDEO_PREPARATION_TRANSCRIPT_API;
    return {
      inputs: base.inputs.filter((port) => (port.type !== "APIKey" || transcriptMode === VIDEO_PREPARATION_TRANSCRIPT_API)
        && (port.type !== TRANSCRIPT_TERMS_INPUT_PORT.type || createsTranscript)),
      outputs: base.outputs.filter((port) => port.type !== "TimedTranscript" || createsTranscript),
    };
  }
  if (definition.family === "Tạo transcript video theo thời gian") {
    return {
      ...base,
      inputs: base.inputs.filter((port) => port.type !== "APIKey" || transcriptMode === VIDEO_PREPARATION_TRANSCRIPT_API),
    };
  }
  return base;
}

function choiceFields(definition: NodeDefinition, operation: string): ConfigField[] {
  const operationField = definition.configFields.find((field) => field.key === "basicOperation");
  if (operation === NO_BASIC_OPERATION) return operationField ? [operationField] : [];
  const step = findBasicStep(definition, operation);
  return uniqueConfigFields([...(operationField ? [operationField] : []), ...(step?.configFields ?? [])]);
}

function isObsoleteConfigRuntimeError(output: unknown): boolean {
  const error = output && typeof output === "object" && !Array.isArray(output)
    ? String((output as Record<string, unknown>).error ?? "")
    : "";
  return /Cannot read properties of undefined \(reading ['"]transcriptMode['"]\)/.test(error);
}

function refreshNodeAppearance(node: ContentFlowNode): ContentFlowNode {
  // Chuẩn hóa mọi node từ workflow cũ trước khi nạp lại UI. Không node nào
  // được phép giữ config undefined, kể cả node không còn trong catalog mới.
  const hasObsoleteError = node.data.status === "error" && isObsoleteConfigRuntimeError(node.data.output);
  const normalizedNode: ContentFlowNode = {
    ...node,
    data: {
      ...node.data,
      config: node.data.config ?? {},
      ...(hasObsoleteError ? { status: "idle", beacon: "uncheck", output: undefined, progress: undefined } : {}),
    },
  };
  const kind = LEGACY_ADVANCED_KIND_MAP[LEGACY_BASIC_KIND_MAP[normalizedNode.data.kind] ?? normalizedNode.data.kind]
    ?? LEGACY_BASIC_KIND_MAP[normalizedNode.data.kind]
    ?? normalizedNode.data.kind;
  const definition = definitionMap.get(kind);
  if (!definition) return normalizedNode;
  const savedConfig = normalizedNode.data.config;
  const selectedModel = String(savedConfig.model ?? "");
  const selectedCustomModel = String(savedConfig.customModel ?? "");
  const retiredModelReplacement = replacementForRetiredOpenAiModel(
    selectedModel === "Khác — nhập ID model" ? selectedCustomModel : selectedModel,
  );
  const migratedConfig = {
    ...definition.defaults,
    ...savedConfig,
    ...(LEGACY_ADVANCED_KIND_MAP[normalizedNode.data.kind] ? { transcriptMode: savedConfig.transcriptMode || VIDEO_PREPARATION_TRANSCRIPT_API } : {}),
    ...(retiredModelReplacement
      ? selectedModel === "Khác — nhập ID model"
        ? { customModel: retiredModelReplacement }
        : { model: retiredModelReplacement }
      : {}),
    ...(definition.basicMode === "choice"
      ? { basicOperation: normalizeBasicOperation(definition, savedConfig.basicOperation) }
      : {}),
  };
  const selectedOperation = String(migratedConfig.basicOperation ?? NO_BASIC_OPERATION);
  const gatewayDirection = workflowGatewayDirection(normalizedNode);
  const workflowPorts = gatewayDirection ? normalizeWorkflowGatewayPorts(normalizedNode.data.workflowPorts) : undefined;
  const gatewayActivePorts = gatewayDirection && workflowPorts ? portsForWorkflowGateway(gatewayDirection, workflowPorts) : undefined;
  const savedCalledWorkflow = nodeFamilyOf(normalizedNode) === "Gọi workflow" && normalizedNode.data.calledWorkflow
    ? normalizedNode.data.calledWorkflow
    : undefined;
  const calledWorkflow = savedCalledWorkflow && typeof savedCalledWorkflow.path === "string" && typeof savedCalledWorkflow.workflowId === "string"
    ? { ...savedCalledWorkflow, workflowInterface: normalizeWorkflowInterfaceShape(savedCalledWorkflow.workflowInterface) }
    : undefined;
  const calledWorkflowPorts = calledWorkflow ? portsForCalledWorkflow(calledWorkflow.workflowInterface) : undefined;
  const activePorts = portsForBasicConfiguration(definition, migratedConfig, selectedOperation);
  const migratedLegacyTranscript = Boolean(LEGACY_ADVANCED_KIND_MAP[normalizedNode.data.kind]);
  const migratedLabel = /^Trích xuất transcript video(?:\s+\d+)?$/.test(normalizedNode.data.label)
    ? normalizedNode.data.label.replace("Trích xuất transcript video", "Tạo transcript video theo thời gian")
    : normalizedNode.data.label;
  return {
    ...normalizedNode,
    data: {
      ...normalizedNode.data,
      kind,
      // Họ là định danh kỹ thuật do catalog quản lý. Cho phép catalog đổi Họ
      // khi node được mở rộng chức năng (ví dụ thêm phân tích video), nhưng
      // vẫn giữ nguyên Tên do người dùng đặt trên canvas.
      family: definition.family,
       label: migratedLegacyTranscript ? migratedLabel : NODE_NAME_OVERRIDES[normalizedNode.data.label] ? definition.label : normalizedNode.data.label,
      icon: definition.icon,
      category: definition.category,
       inputs: gatewayActivePorts?.inputs ?? calledWorkflowPorts?.inputs ?? activePorts.inputs,
       outputs: isFileStorageNode(normalizedNode)
         ? storageOutputsForType(
           activePorts.outputs,
           storageOutputMode(migratedConfig) === STORAGE_OUTPUT_MODE_FREE
             ? "Dữ liệu"
             : String(migratedConfig.storedDataType ?? "StoredFile"),
         )
           : gatewayActivePorts?.outputs ?? calledWorkflowPorts?.outputs ?? activePorts.outputs,
      configFields: definition.basicMode === "choice"
        ? choiceFields(definition, selectedOperation)
        : definition.configFields,
      config: migratedConfig,
      basicPresetId: definition.basicPresetId,
      basicMode: definition.basicMode,
      basicNodeLabels: definition.basicNodeLabels,
      basicSteps: definition.basicSteps,
       ...(workflowPorts ? { workflowPorts } : {}),
       ...(calledWorkflow ? { calledWorkflow } : {}),
      paused: normalizedNode.data.paused ?? false,
      beacon: normalizedNode.data.beacon ?? "uncheck",
    },
  };
}

function makeNode(kind: string, id: string, position: { x: number; y: number }, currentNodes: readonly ContentFlowNode[] = []): ContentFlowNode {
  const definition = definitionMap.get(kind)!;
  const operation = definition.basicMode === "choice"
    ? normalizeBasicOperation(definition, definition.defaults.basicOperation)
    : "";
  const activePorts = portsForBasicConfiguration(definition, definition.defaults, operation);
  const gatewayDirection = definition.family === WORKFLOW_INPUT_GATEWAY_FAMILY ? "input" : definition.family === WORKFLOW_OUTPUT_GATEWAY_FAMILY ? "output" : null;
  const gatewayPorts: WorkflowGatewayPort[] = [];
  const gatewayActivePorts = gatewayDirection ? portsForWorkflowGateway(gatewayDirection, gatewayPorts) : undefined;
  return {
    id,
    type: "contentNode",
    position,
    data: {
      ...definition,
      family: definition.family,
      label: nextNodeName(definition.family, currentNodes),
       inputs: gatewayActivePorts?.inputs ?? activePorts.inputs,
       outputs: gatewayActivePorts?.outputs ?? activePorts.outputs,
      configFields: definition.basicMode === "choice" ? choiceFields(definition, operation) : definition.configFields,
      config: { ...definition.defaults },
      status: "idle",
      paused: false,
      beacon: "uncheck",
       ...(gatewayDirection ? { workflowPorts: gatewayPorts } : {}),
    },
  };
}

const initialNodes: ContentFlowNode[] = [];
const initialEdges: Edge[] = [];

const edgeDefaults = {
  type: "stubCurve",
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#64748b" },
  style: { stroke: "#64748b", strokeWidth: 2 },
};

function edgeColorForSource(source: ContentFlowNode | undefined, sourceHandle: string | null | undefined): string {
  const sourceType = source?.data.outputs.find((port) => port.id === sourceHandle)?.type;
  return sourceType ? getPortVisual(sourceType).color : "#64748b";
}

function workflowEdge(connection: Connection, nodes: ContentFlowNode[], id: string): Edge {
  const color = edgeColorForSource(nodes.find((node) => node.id === connection.source), connection.sourceHandle);
  return {
    ...connection,
    ...edgeDefaults,
    id,
    style: { ...edgeDefaults.style, stroke: color },
    markerEnd: { ...edgeDefaults.markerEnd, color },
  };
}

function isAttentionMediaInput(node: ContentFlowNode | undefined, handleId: string | null | undefined): boolean {
  if (!node || !["Lấy vùng chú ý", "Thiết lập vùng chú ý video", "Tìm ảnh tương đồng"].includes(nodeFamilyOf(node)) && node.data.basicPresetId !== "image-input-optimize") return false;
  const port = node.data.inputs.find((item) => item.id === handleId);
  return port?.type === "Image[]" || port?.type === "Video" || port?.type === "ImageSample";
}

function removeAttentionSiblingEdges(current: Edge[], connection: Connection, nodes: ContentFlowNode[]): Edge[] {
  const target = nodes.find((node) => node.id === connection.target);
  if (!isAttentionMediaInput(target, connection.targetHandle)) return current;
  return current.filter((edge) => edge.target !== connection.target
    || edge.targetHandle === connection.targetHandle
    || !isAttentionMediaInput(target, edge.targetHandle));
}

function isFileStorageNode(node: ContentFlowNode | undefined): boolean {
  return Boolean(node && (nodeFamilyOf(node) === "Lưu file" || node.data.basicPresetId === "data-save-file"));
}

function hasReusableStoredFiles(node: ContentFlowNode | undefined): boolean {
  return Boolean(isFileStorageNode(node) && node?.data.storedFiles?.length);
}

function hasNewFileStorageInput(node: ContentFlowNode, edges: Edge[]): boolean {
  return isFileStorageNode(node) && node.data.inputs
    .filter((port) => port.type !== "Folder")
    .some((port) => edges.some((edge) => edge.target === node.id && edge.targetHandle === port.id));
}

function storedFileReferencesFromOutput(output: Record<string, unknown>): StoredFileReference[] {
  const files = new Map<string, StoredFileReference>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    const filePath = typeof item.localPath === "string" ? item.localPath : typeof item.filePath === "string" ? item.filePath : "";
    if (filePath) {
      files.set(filePath, {
        filePath,
        name: String(item.name ?? fileNameFromPath(filePath)),
        type: String(item.type ?? "application/octet-stream"),
        size: Math.max(0, Number(item.size) || 0),
        storedAt: new Date().toISOString(),
      });
    }
    Object.values(item).forEach(visit);
  };
  Object.values(output).forEach(visit);
  return [...files.values()];
}

const STORAGE_OUTPUT_MODE_MATCH_SOURCE = "Tương đồng node kết nối";
const STORAGE_OUTPUT_MODE_FREE = "Tự do";

function storageOutputMode(config: Record<string, FieldValue>): string {
  return config.storageOutputMode === STORAGE_OUTPUT_MODE_FREE
    ? STORAGE_OUTPUT_MODE_FREE
    : STORAGE_OUTPUT_MODE_MATCH_SOURCE;
}

function storedOutputTypeFromSource(sourceType: string | undefined, outputMode: string): string {
  // “Dữ liệu” nằm ở cấp Free trong hệ hợp đồng cổng. Khi người dùng chọn Tự
  // do, không suy đoán lại kiểu từ đầu vào nữa.
  if (outputMode === STORAGE_OUTPUT_MODE_FREE) return "Dữ liệu";
  // Chế độ mặc định truyền nguyên kiểu từ node đang nối vào, kể cả cache, JSON
  // hay các kiểu mới được bổ sung về sau. Nếu chưa có line thì giữ StoredFile
  // để phản ánh đúng trạng thái file đã lưu nhưng chưa xác định nguồn.
  return sourceType ?? "StoredFile";
}

function storageOutputsForType(outputs: Port[], storedDataType: string): Port[] {
  return outputs.map((port) => ({ ...port, type: storedDataType, label: displayPortLabel(storedDataType) }));
}

function inheritStorageOutputType(node: ContentFlowNode, sourceType: string | undefined): ContentFlowNode {
  if (!isFileStorageNode(node)) return node;
  const outputMode = storageOutputMode(node.data.config);
  const storedDataType = storedOutputTypeFromSource(sourceType, outputMode);
  return {
    ...node,
    data: {
      ...node.data,
      config: { ...node.data.config, storageOutputMode: outputMode, storedDataType },
      outputs: storageOutputsForType(node.data.outputs, storedDataType),
    },
  };
}

function storageInputSourceType(node: ContentFlowNode, nodes: ContentFlowNode[], edges: Edge[]): string | undefined {
  const dataInput = node.data.inputs.find((port) => port.type !== "Folder");
  const incoming = dataInput ? edges.find((edge) => edge.target === node.id && edge.targetHandle === dataInput.id) : undefined;
  return incoming
    ? nodes.find((source) => source.id === incoming.source)?.data.outputs.find((port) => port.id === incoming.sourceHandle)?.type
    : undefined;
}

function inheritStorageOutputTypes(nodes: ContentFlowNode[], edges: Edge[]): ContentFlowNode[] {
  return nodes.map((node) => {
    if (!isFileStorageNode(node)) return node;
    const sourceType = storageInputSourceType(node, nodes, edges);
    return inheritStorageOutputType(node, sourceType);
  });
}

function isFileStorageFolderInput(node: ContentFlowNode | undefined, handleId: string | null | undefined): boolean {
  return Boolean(isFileStorageNode(node) && node?.data.inputs.find((item) => item.id === handleId)?.type === "Folder");
}

function StubCurveEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
  markerEnd,
  style,
}: EdgeProps) {
  const sourceDirection = sourcePosition === Position.Left ? -1 : 1;
  const targetDirection = targetPosition === Position.Right ? 1 : -1;
  const horizontalDistance = Math.abs(targetX - sourceX);
  const stubLength = Math.min(52, Math.max(28, horizontalDistance * 0.24)) * 0.6;
  const startX = sourceX + sourceDirection * stubLength;
  const endX = targetX + targetDirection * stubLength;
  const bendLength = Math.max(26, Math.min(86, Math.abs(endX - startX) * 0.52));
  const path = [
    `M ${sourceX},${sourceY}`,
    `L ${startX},${sourceY}`,
    `C ${startX + sourceDirection * bendLength},${sourceY}`,
    `${endX + targetDirection * bendLength},${targetY}`,
    `${endX},${targetY}`,
    `L ${targetX},${targetY}`,
  ].join(" ");

  return <BaseEdge path={path} markerEnd={markerEnd} style={style} />;
}

const edgeTypes = { stubCurve: StubCurveEdge };

function normalizeWorkflowEdges(edges: Edge[], previousNodes: ContentFlowNode[] = [], refreshedNodes: ContentFlowNode[] = []): Edge[] {
  const previousById = new Map(previousNodes.map((node) => [node.id, node]));
  const refreshedById = new Map(refreshedNodes.map((node) => [node.id, node]));
  const remapHandle = (nodeId: string, handleId: string | null | undefined, direction: "inputs" | "outputs") => {
    if (!handleId) return handleId;
    const previousNode = previousById.get(nodeId);
    const previousPort = previousNode?.data[direction].find((port) => port.id === handleId);
    // Workflow cũ dùng Mẫu ảnh/Kho ảnh. Khi nạp, map đúng sang từng vai trò
    // mới để giữ lại dây đã nối thay vì để các dây treo ở handle cũ.
    const migratedType = direction === "inputs" && previousPort && nodeFamilyOf(previousNode) === "Tìm ảnh tương đồng"
      ? ({ "Mẫu ảnh": "ImageSample", "Kho ảnh": "ImageSearchList", "FrameIndex": "FrameIndex" }[previousPort.type] ?? previousPort.type)
      : previousPort?.type;
    const replacement = migratedType && refreshedById.get(nodeId)?.data[direction].find((port) => port.type === migratedType);
    return replacement?.id ?? handleId;
  };
  return edges.map((edge) => {
    const sourceHandle = remapHandle(edge.source, edge.sourceHandle, "outputs");
    const targetHandle = remapHandle(edge.target, edge.targetHandle, "inputs");
    const color = edgeColorForSource(refreshedById.get(edge.source) ?? previousById.get(edge.source), sourceHandle);
    return {
      ...edge,
      type: "stubCurve",
      sourceHandle,
      targetHandle,
      style: { ...edgeDefaults.style, ...edge.style, stroke: color },
      markerEnd: { ...edgeDefaults.markerEnd, color },
    };
  });
}

function connectionFromSourceHandle(source: ContentFlowNode, sourceHandle: string, target: ContentFlowNode, edges: Edge[]): Connection | null {
  const output = source.data.outputs.find((port) => port.id === sourceHandle);
  if (!output) return null;
  const input = target.data.inputs.find((port) => (
    (portSpecFor(port).cardinality === "many" || !edges.some((edge) => edge.target === target.id && edge.targetHandle === port.id))
    && portsCanConnect(output, port)
  ));
  return input ? { source: source.id, sourceHandle: output.id, target: target.id, targetHandle: input.id } : null;
}

function connectionToTargetHandle(source: ContentFlowNode, target: ContentFlowNode, targetHandle: string, edges: Edge[]): Connection | null {
  const input = target.data.inputs.find((port) => port.id === targetHandle);
  if (!input || (portSpecFor(input).cardinality === "one" && edges.some((edge) => edge.target === target.id && edge.targetHandle === input.id))) return null;
  const output = source.data.outputs.find((port) => portsCanConnect(port, input));
  return output ? { source: source.id, sourceHandle: output.id, target: target.id, targetHandle: input.id } : null;
}

const PORT_POLYGON_POINTS: Record<string, string> = {
  triangle: "8,1.9 14.5,14.2 1.5,14.2",
  "triangle-down": "1.5,1.8 14.5,1.8 8,14.1",
  diamond: "8,1.1 14.9,8 8,14.9 1.1,8",
  pentagon: "8,1.2 14.6,6 12.1,14.5 3.9,14.5 1.4,6",
  "pentagon-down": "3.9,1.5 12.1,1.5 14.6,10 8,14.8 1.4,10",
  hexagon: "4.2,1.4 11.8,1.4 15,8 11.8,14.6 4.2,14.6 1,8",
};

function PortGlyph({ shape, color, compact = false }: { shape: string; color: string; compact?: boolean }) {
  const common = { fill: color, stroke: "#05070b", strokeWidth: 1.6, strokeLinejoin: "miter" as const };
  return (
    <svg className={`port-glyph${compact ? " compact" : ""}`} viewBox="0 0 16 16" aria-hidden="true">
      {shape === "circle" ? <circle cx="8" cy="8" r="6.2" {...common} />
        : shape === "square" ? <rect x="1.8" y="1.8" width="12.4" height="12.4" {...common} />
          : <polygon points={PORT_POLYGON_POINTS[shape] ?? PORT_POLYGON_POINTS.hexagon} {...common} />}
    </svg>
  );
}

function CanvasDataPreview({ output, size, onToggle }: { output?: Record<string, unknown>; size: CanvasViewerSize; onToggle: () => void }) {
  const viewed = output?.viewed;
  const imageAssets = Array.isArray(viewed)
    ? viewed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).previewUrl === "string" && String((item as Record<string, unknown>).type ?? "").startsWith("image/")))
    : [];
  const [imageIndex, setImageIndex] = useState(0);
  const activeImageIndex = Math.min(imageIndex, Math.max(0, imageAssets.length - 1));
  const galleryImage = imageAssets[activeImageIndex];
  const asset = galleryImage ?? (Array.isArray(viewed)
    ? viewed.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined
    : viewed && typeof viewed === "object" ? viewed as Record<string, unknown> : undefined);
  const previewUrl = typeof asset?.previewUrl === "string" ? asset.previewUrl : "";
  const mime = typeof asset?.type === "string" ? asset.type : "";
  const nextLabel = size === "compact" ? "↗ Mở rộng" : size === "expanded" ? "⤢ Cực đại" : "↙ Thu gọn";
  const nextTitle = size === "compact" ? "Mở rộng vùng dữ liệu gấp đôi" : size === "expanded" ? "Mở vùng dữ liệu cực đại (gấp đôi mức mở rộng)" : "Thu gọn vùng dữ liệu";
  const controls = <button className="canvas-data-expand nodrag nopan" type="button" title={nextTitle} aria-label={nextTitle} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onToggle(); }}>{nextLabel}</button>;
  const wrap = (content: ReactNode) => <div className={`canvas-data-region nodrag nopan ${size}`} onMouseDown={(event) => event.stopPropagation()}>{controls}{content}</div>;
  if (imageAssets.length) return wrap(<div className="canvas-data-preview canvas-image-gallery">
    <img src={String(galleryImage.previewUrl)} alt={String(galleryImage.name ?? "Frame video")} />
    <div className="canvas-image-gallery-controls">
      <button className="nodrag nopan" type="button" disabled={imageAssets.length < 2} aria-label="Frame trước" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setImageIndex((activeImageIndex - 1 + imageAssets.length) % imageAssets.length); }}>‹</button>
      <span>{activeImageIndex + 1}/{imageAssets.length}{galleryImage.timecode ? ` · ${String(galleryImage.timecode)}` : ""}</span>
      <button className="nodrag nopan" type="button" disabled={imageAssets.length < 2} aria-label="Frame sau" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setImageIndex((activeImageIndex + 1) % imageAssets.length); }}>›</button>
    </div>
  </div>);
  if (previewUrl && mime.startsWith("image/")) return wrap(<div className="canvas-data-preview"><img src={previewUrl} alt={String(asset?.name ?? "Hình ảnh đầu vào")} /></div>);
  if (previewUrl && mime.startsWith("audio/")) return wrap(<div className="canvas-data-preview"><audio controls src={previewUrl}>Không thể phát âm thanh.</audio></div>);
  if (previewUrl && mime.startsWith("video/")) return wrap(<div className="canvas-data-preview"><video controls src={previewUrl}>Không thể phát video.</video></div>);
  if (viewed === undefined) return wrap(<div className="canvas-data-preview empty">Chạy workflow để xem dữ liệu.</div>);
  const text = typeof viewed === "string" ? viewed : JSON.stringify(viewed, null, 2);
  return wrap(<pre className="canvas-data-preview">{text}</pre>);
}

function WorkflowNode({ id, data, selected }: NodeProps<ContentFlowNode>) {
  const requestPortFilter = useContext(PortFilterContext);
  const { setNodes } = useReactFlow<ContentFlowNode>();
  const updateNodeInternals = useUpdateNodeInternals();
  const portLayoutKey = `${data.inputs.map((port) => port.id).join("|")}::${data.outputs.map((port) => port.id).join("|")}`;

  // Một số node thay đổi cổng theo cấu hình. React Flow cần đo lại Handle
  // sau render; nếu giữ toạ độ cũ, đầu dây sẽ dừng ở hàng cổng trước/sau.
  useLayoutEffect(() => {
    updateNodeInternals(id);
  }, [id, portLayoutKey, updateNodeInternals]);
  const beacon = data.paused ? "paused" : data.beacon ?? "uncheck";
  const beaconLabel: Record<NodeBeacon, string> = {
    uncheck: "Chưa kiểm tra",
    miss: "Thiếu dữ liệu bắt buộc hoặc chưa chọn thao tác",
    ready: "Sẵn sàng để chạy",
    error: "Có lỗi cần xử lý",
    paused: "Tạm ngưng: node không được chạy",
    running: "Đang xử lý dữ liệu",
  };

  const previewValue = (field: ConfigField) => {
    const raw = data.config[field.key];
    if (field.type === "model-catalog" || raw === undefined || raw === null || raw === "" || (field.key === "basicOperation" && raw === NO_BASIC_OPERATION)) return null;
    if (field.type === "password") return "••••••";
    if (typeof raw === "boolean") return raw ? "Bật" : "Tắt";
    const value = String(raw).replace(/\s+/g, " ").trim();
    return value.length > 46 ? `${value.slice(0, 45)}…` : value;
  };
  const configPreview = data.configFields
    .filter((field) => !field.showWhen || String(data.config[field.showWhen.key] ?? "") === field.showWhen.value)
    .map((field) => ({ label: field.label, value: previewValue(field) }))
    .filter((item): item is { label: string; value: string } => Boolean(item.value))
    .slice(0, 3);
  const validationHeight = data.validationError ? Math.max(28, Math.ceil(data.validationError.length / 40) * 12 + 12) : 0;
  // The old base retained the removed footer's space, leaving a large empty
  // area beneath the final port.  Keep only the compact bottom clearance.
  const isCanvasDataViewer = nodeFamilyOf({ data }) === "Xem dữ liệu trên canvas";
  const viewerSize: CanvasViewerSize = data.viewerSize === "maximized" || data.viewerSize === "expanded"
    ? data.viewerSize
    : data.viewerExpanded ? "expanded" : "compact";
  const viewerExpanded = viewerSize !== "compact";
  const viewerMaximized = viewerSize === "maximized";
  const viewerHeight = viewerMaximized ? 426 : viewerExpanded ? 222 : 112;
  const height = Math.max(data.inputs.length, data.outputs.length) * 27 + 71.5 + (isCanvasDataViewer ? 0 : Math.max(1, configPreview.length) * 17) + validationHeight + (isCanvasDataViewer ? viewerHeight : 0);

  return (
    <div
      className={`workflow-node ${selected ? "selected" : ""} ${data.validationError ? "invalid" : ""} ${data.paused ? "paused" : ""} status-${data.status}${isCanvasDataViewer ? " canvas-data-viewer" : ""}${viewerExpanded ? " viewer-expanded" : ""}${viewerMaximized ? " viewer-maximized" : ""}`}
      style={{ ...categoryStyle(data.category), minHeight: height }}
    >
      <div className="node-head">
        <span className={nodeIconClass("node-icon", data.icon)}>{data.icon}</span>
        <div>
          <strong>{data.label}</strong>
          <small>{nodeFamilyOf({ data })}</small>
        </div>
        <span className="node-kind-badge"><b>{data.basicPresetId ? "Node cơ bản" : "Node chi tiết"}</b><em>{data.category}</em></span>
        <span className={`status-dot beacon-${beacon}`} title={`Beacon: ${beaconLabel[beacon]}`} />
      </div>

      {!isCanvasDataViewer && <div className="node-capabilities" title={data.description}>
        {configPreview.length ? configPreview.map((item) => <span className="node-config-preview" key={item.label} title={`${item.label}: ${item.value}`}><b>{item.label}</b><em>{item.value}</em></span>) : <span className="node-config-preview empty">Chưa có cấu hình</span>}
      </div>}

      {isCanvasDataViewer && <CanvasDataPreview output={data.output} size={viewerSize} onToggle={() => setNodes((current) => current.map((node) => {
        if (node.id !== id) return node;
        const current = node.data.viewerSize === "maximized" || node.data.viewerSize === "expanded"
          ? node.data.viewerSize
          : node.data.viewerExpanded ? "expanded" : "compact";
        const next: CanvasViewerSize = current === "compact" ? "expanded" : current === "expanded" ? "maximized" : "compact";
        return { ...node, data: { ...node.data, viewerSize: next, viewerExpanded: next !== "compact" } };
      }))} />}

      <div className="node-ports">
        <div className="port-column inputs">
          {data.inputs.map((port) => (
            <div className="port-row" key={port.id}>
              <Handle
                type="target"
                position={Position.Left}
                id={port.id}
                isConnectable
                // Cho phép bắt đầu từ cổng vào rồi kéo sang cổng ra. React Flow
                // vẫn chuẩn hóa lane thành output → input khi thả đúng cổng.
                isConnectableStart
                isConnectableEnd
                className={`port-handle port-shape-${getPortVisual(port.type).shape}`}
                title={portInformationTooltip(port)}
              ><PortGlyph shape={getPortVisual(port.type).shape} color={getPortVisual(port.type).color} /></Handle>
              <button
                className="port-filter-button nodrag nopan"
                title={`Lọc node có đầu ra tương thích với ${displayPortLabel(port.type)}`}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); requestPortFilter({ type: port.type, connectSize: port.connectSize, handleType: "target" }); }}
              >{port.label}{port.required ? "*" : ""}</button>
            </div>
          ))}
        </div>
        <div className="port-column outputs">
          {data.outputs.map((port) => (
            <div className="port-row" key={port.id}>
              <button
                className="port-filter-button nodrag nopan"
                title={`Lọc node có đầu vào tương thích với ${displayPortLabel(port.type)}`}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); requestPortFilter({ type: port.type, connectSize: port.connectSize, handleType: "source" }); }}
              >{port.label}</button>
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                isConnectable
                isConnectableStart
                // Cổng ra cũng phải nhận điểm thả khi người dùng kéo ngược từ
                // cổng vào. Điều này chỉ là chiều thao tác, không đảo chiều data.
                isConnectableEnd
                className={`port-handle port-shape-${getPortVisual(port.type).shape}`}
                title={portInformationTooltip(port)}
              ><PortGlyph shape={getPortVisual(port.type).shape} color={getPortVisual(port.type).color} /></Handle>
            </div>
          ))}
        </div>
      </div>

      {data.validationError && <div className="node-validation-error" title={data.validationError}>{data.validationError}</div>}
    </div>
  );
}

const nodeTypes = { contentNode: WorkflowNode };

const FILE_EXTENSIONS: Record<NonNullable<ConfigField["fileValidation"]>, string[]> = {
  text: ["pdf", "doc", "docx", "txt", "md", "csv", "json", "html", "htm", "rtf", "odt"],
  image: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "avif", "tiff"],
  audio: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma"],
  media: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "mpeg", "mpg", "jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"],
};

function validateSelectedFiles(files: File[], kind?: ConfigField["fileValidation"]): string | undefined {
  if (!kind || !files.length) return undefined;
  const allowed = FILE_EXTENSIONS[kind];
  const invalid = files.filter((file) => !allowed.includes(file.name.split(".").pop()?.toLowerCase() ?? ""));
  return invalid.length ? `Sai kiểu ${kind}: ${invalid.map((file) => file.name).join(", ")}` : undefined;
}

function filePathsFromConfig(value: FieldValue | undefined): string[] {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === "string") : [];
  } catch {
    return [];
  }
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function desktopRuntimeFile(file: { name: string; type: string; data?: Uint8Array; path?: string; size?: number; pathOnly?: boolean }) {
  const runtimeFile = new File([file.data ?? new Uint8Array()], file.name, { type: file.type }) as File & { contentFlowPath?: string; contentFlowSize?: number; contentFlowPathOnly?: boolean };
  if (file.path) runtimeFile.contentFlowPath = file.path;
  runtimeFile.contentFlowSize = file.size ?? runtimeFile.size;
  runtimeFile.contentFlowPathOnly = Boolean(file.pathOnly);
  return runtimeFile;
}

function validateSelectedPaths(paths: string[], kind?: ConfigField["fileValidation"]): string | undefined {
  if (!kind || !paths.length) return undefined;
  const allowed = FILE_EXTENSIONS[kind];
  const invalid = paths.filter((filePath) => !allowed.includes(filePath.split(".").pop()?.toLowerCase() ?? ""));
  return invalid.length ? `Sai kiểu ${kind}: ${invalid.map(fileNameFromPath).join(", ")}` : undefined;
}

function UrlListField({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const urls = value.split("\n").map((item) => item.trim()).filter(Boolean);

  const addUrl = () => {
    const next = draft.trim();
    if (!next || urls.includes(next)) return;
    try {
      new URL(next);
      onChange([...urls, next].join("\n"));
      setDraft("");
    } catch {
      return;
    }
  };

  return (
    <div className="url-list-field">
      <div className="url-entry-row">
        <input
          type="url"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addUrl();
            }
          }}
        />
        <button type="button" onClick={addUrl}>Thêm</button>
      </div>
      {urls.length > 0 && (
        <div className="url-chips">
          {urls.map((url) => (
            <span key={url} title={url}>
              <i>{url}</i>
              <button type="button" aria-label={`Xóa ${url}`} onClick={() => onChange(urls.filter((item) => item !== url).join("\n"))}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

type AttentionRect = { x: number; y: number; width: number; height: number };
type AttentionPreview = { file: File; sourceUrl?: string };
const ATTENTION_MAX_AREA = 1 / 3;
const ATTENTION_GRID_CELLS = ["Trên trái", "Trên giữa", "Trên phải", "Giữa trái", "Giữa", "Giữa phải", "Dưới trái", "Dưới giữa", "Dưới phải"];

function parseAttentionRects(value: unknown): AttentionRect[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((region) => ({
      x: Math.max(0, Math.min(1, Number(region?.x ?? 0))),
      y: Math.max(0, Math.min(1, Number(region?.y ?? 0))),
      width: Math.max(0, Math.min(1, Number(region?.width ?? 0))),
      height: Math.max(0, Math.min(1, Number(region?.height ?? 0))),
    })).filter((region) => region.width > 0 && region.height > 0);
  } catch {
    return [];
  }
}

function attentionArea(regions: AttentionRect[]) {
  return regions.reduce((total, region) => total + region.width * region.height, 0);
}

function attentionRectsOverlap(left: AttentionRect, right: AttentionRect) {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

function AttentionGridField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = value.split(",").map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item < 9);
  const toggle = (index: number) => {
    const next = selected.includes(index)
      ? selected.filter((item) => item !== index)
      : selected.length < 3 ? [...selected, index] : selected;
    onChange(next.join(","));
  };
  return <div className="attention-grid-field" role="group" aria-label="Lưới chọn vùng chú ý 3 nhân 3">
    <div className="attention-grid">
      {ATTENTION_GRID_CELLS.map((label, index) => <button
        type="button"
        key={label}
        className={selected.includes(index) ? "selected" : ""}
        disabled={!selected.includes(index) && selected.length >= 3}
        aria-pressed={selected.includes(index)}
        title={label}
        onClick={() => toggle(index)}
      ><span>{index + 1}</span><small>{label}</small></button>)}
    </div>
    <small>{selected.length}/3 vùng đã chọn</small>
  </div>;
}

function AttentionEditorDialog({
  preview,
  regions,
  onApply,
  onClose,
}: {
  preview: AttentionPreview;
  regions: AttentionRect[];
  onApply: (regions: AttentionRect[]) => void;
  onClose: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [working, setWorking] = useState(regions);
  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<AttentionRect | null>(null);
  const [error, setError] = useState("");
  const sourceUrl = useMemo(() => preview.sourceUrl ?? URL.createObjectURL(preview.file), [preview]);
  const isVideo = preview.file.type.startsWith("video/");
  const selectedArea = attentionArea(working);
  const canSelect = working.length < 3 && selectedArea < ATTENTION_MAX_AREA - 0.0001;
  useEffect(() => () => { if (!preview.sourceUrl) URL.revokeObjectURL(sourceUrl); }, [preview.sourceUrl, sourceUrl]);

  const point = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const startDrawing = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing || !canSelect) return;
    const next = point(event);
    if (!next) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setStart(next);
    setDraft({ x: next.x, y: next.y, width: 0, height: 0 });
    setError("");
  };
  const moveDrawing = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start) return;
    const current = point(event);
    if (!current) return;
    setDraft({ x: Math.min(start.x, current.x), y: Math.min(start.y, current.y), width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y) });
  };
  const finishDrawing = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start || !draft) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setStart(null);
    setDrawing(false);
    if (draft.width < 0.01 || draft.height < 0.01) { setDraft(null); setError("Vùng quét quá nhỏ. Hãy kéo lại vùng rõ ràng hơn."); return; }
    const nextArea = selectedArea + draft.width * draft.height;
    if (nextArea > ATTENTION_MAX_AREA + 0.0001) { setDraft(null); setError("Tổng diện tích các vùng không thể vượt quá 1/3 khung."); return; }
    if (working.some((region) => attentionRectsOverlap(region, draft))) { setDraft(null); setError("Các vùng chọn không được chồng lên nhau."); return; }
    setWorking((current) => [...current, draft]);
    setDraft(null);
  };

  return <div className="attention-dialog-overlay" role="dialog" aria-modal="true" aria-label="Chọn vùng chú ý chính xác" onMouseDown={onClose}>
    <section className="attention-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><small>VÙNG CHÚ Ý AI</small><h3>Quét vùng cần AI ưu tiên</h3></div><button type="button" aria-label="Đóng" onClick={onClose}>×</button></header>
      <p>Chọn tối đa 3 vùng, tổng diện tích không quá 1/3 khung. Các vùng đã chọn có lớp phủ trắng trong suốt và viền xanh dương nhạt.</p>
      <div className={`attention-media-stage ${drawing ? "drawing" : ""}`} ref={stageRef} onPointerDown={startDrawing} onPointerMove={moveDrawing} onPointerUp={finishDrawing}>
        {isVideo ? <video src={sourceUrl} controls preload="metadata" /> : <img src={sourceUrl} alt={`Xem trước ${preview.file.name}`} />}
        {[...working, ...(draft ? [draft] : [])].map((region, index) => <i key={`${region.x}-${region.y}-${index}`} className="attention-rect" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}><b>{index + 1}</b></i>)}
      </div>
      <div className="attention-dialog-actions">
        <button type="button" className="primary" disabled={!canSelect} onClick={() => { setDrawing(true); setError(""); }}>Chọn vùng</button>
        <button type="button" disabled={!working.length} onClick={() => { setWorking((current) => current.slice(0, -1)); setError(""); }}>Xóa vừa chọn</button>
        <button type="button" disabled={!working.length} onClick={() => { setWorking([]); setError(""); }}>Xóa tất cả</button>
        <span>{working.length}/3 vùng · {(attentionArea(working) * 100).toFixed(1)}% / 33,3%</span>
      </div>
      {error && <p className="field-error">{error}</p>}
      <footer><button type="button" onClick={onClose}>Hủy</button><button type="button" className="primary" onClick={() => onApply(working)}>Áp dụng vùng đã chọn</button></footer>
    </section>
  </div>;
}

function DateTimePairField({
  date,
  time,
  onDateChange,
  onTimeChange,
}: {
  date: string;
  time: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
}) {
  const timeInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const openPicker = (input: HTMLInputElement | null) => {
    input?.focus();
    input?.showPicker?.();
  };

  return (
    <div className="datetime-pair" lang="vi-VN">
      <input ref={timeInputRef} aria-label="Giờ, định dạng 24 giờ" type="time" step="60" value={time} onChange={(event) => onTimeChange(event.target.value)} />
      <button className="datetime-picker-button" type="button" aria-label="Mở bộ chọn giờ" title="Chọn giờ" onClick={() => openPicker(timeInputRef.current)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg>
      </button>
      <input ref={dateInputRef} aria-label="Ngày, định dạng dd/mm/yyyy" type="date" value={date} onChange={(event) => onDateChange(event.target.value)} />
      <button className="datetime-picker-button" type="button" aria-label="Mở lịch chọn ngày" title="Chọn ngày" onClick={() => openPicker(dateInputRef.current)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>
      </button>
    </div>
  );
}

function FilterableSelect({
  value,
  options,
  optionLabels,
  onChange,
  placeholder = "Chọn…",
  sort = false,
}: {
  value: string;
  options: string[];
  optionLabels?: Record<string, string>;
  onChange: (value: string) => void;
  placeholder?: string;
  sort?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const orderedOptions = useMemo(() => {
    const unique = [...new Set(options)];
    return sort ? unique.sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })) : unique;
  }, [options, sort]);
  const displayOption = (option: string) => optionLabels?.[option] ?? option;
  const visibleOptions = orderedOptions.filter((option) => `${option} ${displayOption(option)}`.toLocaleLowerCase("vi-VN").includes(query.toLocaleLowerCase("vi-VN")));
  const choose = (option: string) => {
    onChange(option);
    setQuery("");
    setOpen(false);
  };
  return (
    <div className="filterable-select" onBlur={() => window.setTimeout(() => setOpen(false), 120)}>
      <div className="filterable-select-input">
        <input
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={open ? query : displayOption(value)}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setQuery(""); }}
          onChange={(event) => { setOpen(true); setQuery(event.target.value); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setOpen(false); return; }
            if (event.key === "Enter" && visibleOptions[0]) { event.preventDefault(); choose(visibleOptions[0]); }
          }}
        />
        <button type="button" aria-label="Mở danh sách lựa chọn" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen((current) => !current); setQuery(""); }}>⌄</button>
      </div>
      {open && <div className="filterable-select-menu" role="listbox">
        {visibleOptions.length ? visibleOptions.map((option) => <button type="button" role="option" aria-selected={option === value} key={option} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>{displayOption(option)}</button>) : <span>Không tìm thấy lựa chọn phù hợp.</span>}
      </div>}
    </div>
  );
}

const FALLBACK_MODELS: Record<string, string[]> = {
  OpenAI: ["gpt-5.2", "gpt-5.1", "gpt-5-mini", "gpt-4.1", "gpt-4o-mini"],
  Gemini: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-2.5-flash"],
  Claude: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  Ollama: [],
  "AI local": [],
  "Khác": [],
};

function ProviderModelField({
  config,
  providerConfig,
  localAiModels,
  onManageLocalAi,
  onChange,
}: {
  config: Record<string, FieldValue>;
  providerConfig?: Record<string, FieldValue> | null;
  localAiModels: LocalAiModel[];
  onManageLocalAi: () => void;
  onChange: (key: string, value: FieldValue, error?: string | null) => void;
}) {
  const provider = String(providerConfig?.provider ?? "");
  const [models, setModels] = useState<string[]>(() => {
    try { return typeof window === "undefined" ? [] : JSON.parse(localStorage.getItem(`content-flow-models:${provider}`) ?? "[]") as string[]; } catch { return []; }
  });
  useEffect(() => {
    try { setModels(JSON.parse(localStorage.getItem(`content-flow-models:${provider}`) ?? "[]") as string[]); } catch { setModels([]); }
  }, [provider]);
  const activeModels = useMemo(() => [...new Set((provider === "Ollama"
    ? localAiModelIds(localAiModels)
    : (models.length ? models : (FALLBACK_MODELS[provider] ?? [])))
    .map((model) => provider === "OpenAI" ? currentOpenAiModel(model) : model))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })), [localAiModels, models, provider]);
  const selected = String(config.model ?? "");
  const modelForCapabilities = selected === "Khác — nhập ID model" ? String(config.customModel ?? "") : selected;
  const capabilities = getAiModelCapabilities(provider, modelForCapabilities);
  const compatible = !selected || selected === "Khác — nhập ID model" || activeModels.includes(selected);
  const refresh = async () => {
    if (provider === "Ollama") { onManageLocalAi(); return; }
    if (provider === "Khác") { onChange("modelCatalogStatus", "Nhà cung cấp khác: nhập ID model chính xác ở bên dưới; không thể tự động làm mới danh sách.", null); return; }
    const response = await fetch("/api/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "list-models", provider, localEndpoint: providerConfig?.localEndpoint, apiKey: providerConfig?.apiKey }) });
    const body = await response.json() as { models?: string[]; error?: string; updatedAt?: string };
    if (!response.ok || !body.models) { onChange("modelCatalogStatus", body.error ?? "Không thể cập nhật danh sách model", body.error ?? "Không thể cập nhật danh sách model"); return; }
    setModels(body.models); localStorage.setItem(`content-flow-models:${provider}`, JSON.stringify(body.models));
    onChange("modelCatalogStatus", `Đã cập nhật ${body.models.length} model lúc ${body.updatedAt ?? "vừa xong"}`, null);
  };
  if (!provider) return <div className="provider-model-field"><small className="field-help">Hãy nối đầu ra AIProvider từ node “Chọn nhà cung cấp AI” trước khi chọn model.</small></div>;
  return <div className="provider-model-field">
    <div className="selected-provider">Nhà cung cấp đã chọn: <strong>{provider}</strong></div>
    {providerConfig?.apiKeyFromPort === true && <small className="field-help">Đã kết nối key API qua cổng APIKey.</small>}
    <div className="model-row"><FilterableSelect value={selected} options={provider === "Ollama" ? activeModels : [...activeModels, "Khác — nhập ID model"]} placeholder={provider === "Ollama" && !activeModels.length ? "Chưa có model Ollama trong danh mục" : "Chọn model…"} sort onChange={(value) => onChange("model", value, null)} /><button type="button" onClick={() => { void refresh(); }} disabled={provider === "Khác"}>{provider === "Ollama" ? "Quản lý AI" : "Cập nhật model"}</button></div>
    {provider === "Ollama" && <small className="field-help">Ollama không dùng API key. Mở Quản lý AI để quét và thêm model local vào danh mục.</small>}
    {selected === "Khác — nhập ID model" && provider !== "Ollama" && <input value={String(config.customModel ?? "")} placeholder="Nhập chính xác ID model" onChange={(event) => onChange("customModel", event.target.value)} />}
    <section className="model-capabilities" aria-live="polite" aria-label="Khả năng model đã chọn">
      <strong>Khả năng trong Content Flow</strong>
      {([
        ["Văn bản và JSON", capabilities.text],
        ["Phân tích ảnh", capabilities.image],
        ["Phân tích âm thanh", capabilities.audioAnalysis],
        ["Tham số reasoning", capabilities.reasoning],
      ] as Array<[string, CapabilityState]>).map(([label, state]) => <span key={label} className={`capability-${state}`}><i aria-hidden="true" />{label}: <b>{state === "supported" ? "Dùng được" : state === "unsupported" ? "Không hỗ trợ" : "Chưa xác minh"}</b></span>)}
      <small>{capabilities.audioAnalysis === "supported" ? "Âm thanh được app phiên âm trước, rồi model xử lý transcript; model không nhận trực tiếp file âm thanh ở node này." : capabilities.message}</small>
      {capabilities.audioAnalysis === "supported" && <small>{capabilities.message}</small>}
    </section>
    {!compatible && <small className="field-error">Model “{selected}” không tương thích với {provider}. Hãy chọn model trong danh sách.</small>}
    {config.modelCatalogStatus && <small className="field-help">{String(config.modelCatalogStatus)}</small>}
  </div>;
}

function TagListField({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const items = value.split("\n").map((item) => item.trim()).filter(Boolean);
  const addItem = () => {
    const next = draft.trim();
    if (!next || items.includes(next)) return;
    onChange([...items, next].join("\n"));
    setDraft("");
  };

  return (
    <div className="tag-list-field">
      <div className="url-entry-row">
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addItem();
            }
          }}
        />
        <button type="button" onClick={addItem}>Thêm</button>
      </div>
      {items.length > 0 && (
        <div className="tag-chips">
          {items.map((item) => (
            <span key={item}>
              {item}
              <button type="button" aria-label={`Xóa ${item}`} onClick={() => onChange(items.filter((value) => value !== item).join("\n"))}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryNodeItem({ definition, onAdd, compact = false }: {
  definition: NodeDefinition;
  onAdd: (kind: string) => void;
  compact?: boolean;
}) {
  const actionCount = definition.basicNodeLabels?.length ?? 1;
  const actionLabel = definition.basicMode === "pipeline" ? "bước" : definition.basicNodeLabels ? "lựa chọn" : "thao tác";
  const unavailable = !definitionHasExecutor(definition);
  return (
    <button
      className={`library-item ${compact ? "compact" : ""} ${unavailable ? "execution-unavailable" : ""}`}
      style={categoryStyle(definition.category)}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("application/content-node", definition.kind);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onAdd(definition.kind)}
      title={definition.description}
      aria-label={`Thêm ${definition.label}: ${definition.description}`}
    >
      <span className="library-icon">{definition.icon}</span>
      <span>
        <strong>{definition.label}</strong>
        {!compact && <em className="library-step-count">{actionCount} {actionLabel}</em>}
      </span>
      <span className="add-symbol">＋</span>
    </button>
  );
}

function WorkflowApp() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const runtimeFilesRef = useRef<RuntimeFileStore>(new Map());
  // Bản lưu cục bộ chỉ được phục hồi một lần khi khởi động app. Nếu phụ thuộc
  // tab đang hoạt động, mỗi tab mới sẽ bị bản workflow cũ ghi đè.
  const workspaceRestoredRef = useRef(false);
  const initialWorkflowTabId = useRef(createWorkflowTabId()).current;
  const initialWorkflowId = useRef(createWorkflowId()).current;
  const [workflowName, setWorkflowName] = useState("New workflow");
  const [workflowPath, setWorkflowPath] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState(initialWorkflowId);
  const [workflowInterface, setWorkflowInterface] = useState<unknown>(undefined);
  const [nodes, setNodes, onNodesChange] = useNodesState<ContentFlowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workflowGroups, setWorkflowGroups] = useState<WorkflowGroup[]>([]);
  const [workflowTabs, setWorkflowTabs] = useState<WorkflowTab[]>(() => {
    const initial: Omit<WorkflowTab, "savedContentKey"> = {
      id: initialWorkflowTabId,
      name: "New workflow",
      filePath: null,
      workflowId: initialWorkflowId,
      workflowInterface: undefined,
      nodes: initialNodes,
      edges: initialEdges,
      groups: [],
      selectedId: null,
      history: { past: [], future: [] },
    };
    return [{ ...initial, savedContentKey: workflowTabContentKey(initial) }];
  });
  const [activeWorkflowTabId, setActiveWorkflowTabId] = useState(initialWorkflowTabId);
  const [gatewayPortNameDrafts, setGatewayPortNameDrafts] = useState<Record<string, string>>({});
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [outlinerHeight, setOutlinerHeight] = useState(230);

  // Cổng vào/Cổng ra là nguồn chân thực của interface. Nhờ đồng bộ này,
  // đổi cổng được ghi vào .tess cùng với canvas thay vì thành một cấu hình rời.
  useEffect(() => {
    const nextInterface = workflowInterfaceFromNodes(nodes);
    setWorkflowInterface((current) => JSON.stringify(current) === JSON.stringify(nextInterface) ? current : nextInterface);
  }, [nodes]);
  const [outlinerDropTarget, setOutlinerDropTarget] = useState<string | null>(null);
  const [outlinerMarquee, setOutlinerMarquee] = useState<OutlinerMarquee | null>(null);
  const [search, setSearch] = useState("");
  const [libraryMode, setLibraryMode] = useState<LibraryMode>("basic");
  const [openMenu, setOpenMenu] = useState<AppMenuId | null>(null);
  const [openWorkflowDialog, setOpenWorkflowDialog] = useState(false);
  const [openWorkflowDialogError, setOpenWorkflowDialogError] = useState<string | null>(null);
  const [recentWorkflows, setRecentWorkflows] = useState<RecentWorkflow[]>([]);
  const [localProcessorsOpen, setLocalProcessorsOpen] = useState(false);
  const [localProcessors, setLocalProcessors] = useState<LocalProcessor[]>([]);
  const [localProcessorError, setLocalProcessorError] = useState<string | null>(null);
  const [localProcessorBusy, setLocalProcessorBusy] = useState<string | null>(null);
  const [localAiManagerOpen, setLocalAiManagerOpen] = useState(false);
  const [localAiModels, setLocalAiModels] = useState<LocalAiModel[]>(() => readLocalAiRegistry());
  const [scannedOllamaModels, setScannedOllamaModels] = useState<ScannedOllamaModel[]>([]);
  const [localAiScannedAt, setLocalAiScannedAt] = useState<string | null>(null);
  const [localAiError, setLocalAiError] = useState<string | null>(null);
  const [localAiBusy, setLocalAiBusy] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(242);
  const [rightPanelWidth, setRightPanelWidth] = useState(340);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [canvasClosed, setCanvasClosed] = useState(false);
  const [activeLibraryCategory, setActiveLibraryCategory] = useState("Đầu vào");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddSearch, setQuickAddSearch] = useState("");
  const [quickAddCategory, setQuickAddCategory] = useState("Đầu vào");
  const [quickAddPreviewKind, setQuickAddPreviewKind] = useState<string | null>(null);
  const [quickAddPosition, setQuickAddPosition] = useState<{ x: number; y: number } | undefined>();
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
  const [manualPortFilter, setManualPortFilter] = useState<PortFilter | null>(null);
  const [runState, setRunState] = useState<"idle" | "running" | "paused">("idle");
  const running = runState !== "idle";
  const [notice, setNotice] = useState("Chọn hoặc kéo một node từ thư viện để bắt đầu.");
  const [workflowCheckSummary, setWorkflowCheckSummary] = useState<WorkflowCheckSummary | null>(null);
  const [workflowCheck, setWorkflowCheck] = useState<WorkflowCheckIssue[]>([]);
  const [confirmAction, setConfirmAction] = useState<"delete" | "reset" | null>(null);
  const [attentionPreviewFile, setAttentionPreviewFile] = useState<AttentionPreview | null>(null);
  const [attentionEditorOpen, setAttentionEditorOpen] = useState(false);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const idCounter = useRef(20);
  const checkWorkflowRef = useRef<() => void>(() => undefined);
  const toggleWorkflowRunRef = useRef<() => void>(() => undefined);
  const stopWorkflowRef = useRef<() => void>(() => undefined);
  const runControlRef = useRef<{ paused: boolean; stopped: boolean; resume?: () => void }>({ paused: false, stopped: false });
  const canvasClipboardRef = useRef<CanvasClipboard | null>(null);
  const clipboardPasteCountRef = useRef(0);
  const outlinerDragRef = useRef<WorkflowOutlinerDrag | null>(null);
  const canvasHistoryRef = useRef<{ past: CanvasHistorySnapshot[]; future: CanvasHistorySnapshot[] }>({ past: [], future: [] });
  const currentCanvasRef = useRef<CanvasHistorySnapshot>(canvasHistorySnapshot(initialNodes, initialEdges, null, []));
  const draggingCanvasRef = useRef<CanvasHistorySnapshot | null>(null);

  // idCounter bắt đầu lại khi app khởi động, còn workflow nạp lại có thể đã
  // dùng các số đó. Luôn dò toàn bộ node hiện có trước khi cấp ID mới.
  const claimNextNodeId = useCallback((kind: string) => {
    const usedIds = new Set(nodes.map((node) => node.id));
    let id = `${kind}-${idCounter.current++}`;
    while (usedIds.has(id)) id = `${kind}-${idCounter.current++}`;
    return id;
  }, [nodes]);

  const syncCanvasSnapshot = useCallback((nextNodes: ContentFlowNode[], nextEdges: Edge[], nextSelectedId: string | null, nextGroups: WorkflowGroup[]) => {
    currentCanvasRef.current = canvasHistorySnapshot(nextNodes, nextEdges, nextSelectedId, nextGroups);
  }, []);

  const pushCanvasHistory = useCallback((snapshot: CanvasHistorySnapshot) => {
    if (runState !== "idle") return;
    const history = canvasHistoryRef.current;
    if (canvasHistoryKey(history.past.at(-1) ?? snapshot) === canvasHistoryKey(snapshot) && history.past.length) return;
    history.past = [...history.past, snapshot].slice(-CANVAS_HISTORY_LIMIT);
    history.future = [];
  }, [runState]);

  const rememberCanvasChange = useCallback(() => {
    pushCanvasHistory(currentCanvasRef.current);
  }, [pushCanvasHistory]);

  const resetCanvasHistory = useCallback((nextNodes: ContentFlowNode[], nextEdges: Edge[], nextSelectedId: string | null, nextGroups: WorkflowGroup[] = []) => {
    canvasHistoryRef.current = { past: [], future: [] };
    syncCanvasSnapshot(nextNodes, nextEdges, nextSelectedId, nextGroups);
  }, [syncCanvasSnapshot]);

  const restoreCanvasSnapshot = useCallback((snapshot: CanvasHistorySnapshot, message: string) => {
    runtimeFilesRef.current.clear();
    // Thu gọn nhóm chỉ tác động danh sách Workflow; không bao giờ khôi phục
    // trạng thái ẩn trên canvas từ các snapshot/phiên bản cũ.
    const restoredNodes = snapshot.nodes.map((node) => ({ ...node, hidden: false, selected: node.id === snapshot.selectedId }));
    setNodes(restoredNodes);
    setEdges(snapshot.edges);
    setSelectedId(snapshot.selectedId);
    setWorkflowGroups(snapshot.groups ?? []);
    setWorkflowCheck([]);
    setWorkflowCheckSummary(null);
    syncCanvasSnapshot(restoredNodes, snapshot.edges, snapshot.selectedId, snapshot.groups ?? []);
    setNotice(message);
  }, [setEdges, setNodes, syncCanvasSnapshot]);

  const undoCanvasChange = useCallback(() => {
    if (runState !== "idle") {
      setNotice("Không thể hoàn tác khi workflow đang chạy. Hãy dừng workflow trước.");
      return;
    }
    const history = canvasHistoryRef.current;
    const previous = history.past.pop();
    if (!previous) {
      setNotice("Không có thao tác canvas nào để hoàn tác.");
      return;
    }
    history.future.unshift(currentCanvasRef.current);
    restoreCanvasSnapshot(previous, "Đã hoàn tác thao tác canvas.");
  }, [restoreCanvasSnapshot, runState]);

  const redoCanvasChange = useCallback(() => {
    if (runState !== "idle") {
      setNotice("Không thể phục hồi khi workflow đang chạy. Hãy dừng workflow trước.");
      return;
    }
    const history = canvasHistoryRef.current;
    const next = history.future.shift();
    if (!next) {
      setNotice("Không có thao tác canvas nào để phục hồi.");
      return;
    }
    history.past.push(currentCanvasRef.current);
    restoreCanvasSnapshot(next, "Đã phục hồi thao tác canvas.");
  }, [restoreCanvasSnapshot, runState]);

  const activeWorkflowTab = useMemo(
    () => workflowTabs.find((tab) => tab.id === activeWorkflowTabId) ?? null,
    [activeWorkflowTabId, workflowTabs],
  );
  const activeWorkflowDirty = useMemo(() => {
    if (!activeWorkflowTab) return false;
    return workflowTabContentKey({ name: workflowName, workflowId, workflowInterface, nodes, edges, groups: workflowGroups }) !== activeWorkflowTab.savedContentKey;
  }, [activeWorkflowTab, edges, nodes, workflowGroups, workflowId, workflowInterface, workflowName]);

  const switchWorkflowTab = useCallback((targetTabId: string) => {
    if (targetTabId === activeWorkflowTabId) return;
    if (runState !== "idle") {
      setNotice("Không thể chuyển workflow khi đang chạy. Hãy tạm dừng hoặc dừng workflow trước.");
      return;
    }
    const target = workflowTabs.find((tab) => tab.id === targetTabId);
    if (!target) return;
    const activeTab = workflowTabs.find((tab) => tab.id === activeWorkflowTabId);
    setWorkflowTabs((tabs) => tabs.map((tab) => tab.id !== activeWorkflowTabId ? tab : {
      ...tab,
      name: workflowName,
      filePath: workflowPath,
      workflowId,
      workflowInterface,
      nodes,
      edges,
      groups: workflowGroups,
      selectedId,
      history: { past: [...canvasHistoryRef.current.past], future: [...canvasHistoryRef.current.future] },
      savedContentKey: activeTab?.savedContentKey ?? tab.savedContentKey,
    }));
    runtimeFilesRef.current.clear();
    const targetNodes = target.nodes.map((node) => ({ ...node, hidden: false, selected: node.id === target.selectedId }));
    setWorkflowName(target.name);
    setWorkflowPath(target.filePath);
    setWorkflowId(target.workflowId);
    setWorkflowInterface(target.workflowInterface);
    setNodes(targetNodes);
    setEdges(target.edges);
    setWorkflowGroups(target.groups);
    setSelectedId(target.selectedId);
    canvasHistoryRef.current = { past: [...target.history.past], future: [...target.history.future] };
    syncCanvasSnapshot(targetNodes, target.edges, target.selectedId, target.groups);
    setWorkflowCheck([]);
    setWorkflowCheckSummary(null);
    setActiveWorkflowTabId(targetTabId);
    setCanvasClosed(false);
    setNotice(`Đã chuyển sang workflow “${target.name}”.`);
    setTimeout(() => fitView({ padding: 0.15, duration: 350 }), 50);
  }, [activeWorkflowTabId, edges, fitView, nodes, runState, selectedId, syncCanvasSnapshot, workflowGroups, workflowId, workflowInterface, workflowName, workflowPath, workflowTabs]);

  const createNewWorkflowTab = useCallback(() => {
    if (runState !== "idle") {
      setNotice("Không thể tạo workflow mới khi workflow hiện tại đang chạy.");
      return;
    }
    const newWorkflowId = createWorkflowId();
    const baseTab: Omit<WorkflowTab, "savedContentKey"> = {
      id: createWorkflowTabId(), name: "New workflow", filePath: null, workflowId: newWorkflowId, workflowInterface: undefined,
      nodes: initialNodes.map((node) => ({ ...node, selected: false })), edges: initialEdges, groups: [], selectedId: null,
      history: { past: [], future: [] },
    };
    const nextTab: WorkflowTab = { ...baseTab, savedContentKey: workflowTabContentKey(baseTab) };
    setWorkflowTabs((tabs) => tabs.concat(nextTab));
    runtimeFilesRef.current.clear();
    setWorkflowName(nextTab.name);
    setWorkflowPath(null);
    setWorkflowId(nextTab.workflowId);
    setWorkflowInterface(undefined);
    setNodes(nextTab.nodes);
    setEdges(nextTab.edges);
    setWorkflowGroups([]);
    setSelectedId(null);
    resetCanvasHistory(nextTab.nodes, nextTab.edges, null, []);
    setActiveWorkflowTabId(nextTab.id);
    setCanvasClosed(false);
    setNotice("Đã tạo workflow mới trong tab riêng.");
    setTimeout(() => fitView({ padding: 0.15, duration: 350 }), 50);
  }, [fitView, resetCanvasHistory, runState, setEdges, setNodes]);

  const closeWorkflowTab = useCallback((tabId: string) => {
    const tab = workflowTabs.find((item) => item.id === tabId);
    if (!tab) return;
    const tabDirty = tab.id === activeWorkflowTabId
      ? activeWorkflowDirty
      : workflowTabContentKey(tab) !== tab.savedContentKey;
    if (tabDirty && !window.confirm(`Workflow “${tab.name}” chưa lưu. Đóng tab này?`)) return;
    if (tab.id !== activeWorkflowTabId) {
      setWorkflowTabs((tabs) => tabs.filter((item) => item.id !== tabId));
      setNotice(`Đã đóng tab workflow “${tab.name}”.`);
      return;
    }
    if (runState !== "idle") {
      setNotice("Không thể đóng workflow đang chạy. Hãy dừng workflow trước.");
      return;
    }
    const remaining = workflowTabs.filter((item) => item.id !== tabId);
    if (!remaining.length) {
      runtimeFilesRef.current.clear();
      setWorkflowTabs([]);
      setSelectedId(null);
      setCanvasClosed(true);
      setNotice("Đã đóng workflow cuối cùng.");
      return;
    }
    const target = remaining.at(-1)!;
    setWorkflowTabs(remaining);
    runtimeFilesRef.current.clear();
    const targetNodes = target.nodes.map((node) => ({ ...node, hidden: false, selected: node.id === target.selectedId }));
    setWorkflowName(target.name);
    setWorkflowPath(target.filePath);
    setWorkflowId(target.workflowId);
    setWorkflowInterface(target.workflowInterface);
    setNodes(targetNodes);
    setEdges(target.edges);
    setWorkflowGroups(target.groups);
    setSelectedId(target.selectedId);
    canvasHistoryRef.current = { past: [...target.history.past], future: [...target.history.future] };
    syncCanvasSnapshot(targetNodes, target.edges, target.selectedId, target.groups);
    setActiveWorkflowTabId(target.id);
    setNotice(`Đã đóng “${tab.name}” và chuyển sang “${target.name}”.`);
  }, [activeWorkflowDirty, activeWorkflowTabId, runState, syncCanvasSnapshot, workflowTabs]);

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedId) ?? null, [nodes, selectedId]);
  const selectedOutputText = useMemo(
    () => selectedNode?.data.output ? JSON.stringify(selectedNode.data.output, null, 2) : "",
    [selectedNode],
  );
  useEffect(() => {
    syncCanvasSnapshot(nodes, edges, selectedId, workflowGroups);
  }, [edges, nodes, selectedId, syncCanvasSnapshot, workflowGroups]);
  useEffect(() => {
    setWorkflowTabs((current) => current.map((tab) => tab.id !== activeWorkflowTabId ? tab : {
      ...tab,
      name: workflowName,
      filePath: workflowPath,
      workflowId,
      workflowInterface,
      nodes,
      edges,
      groups: workflowGroups,
      selectedId,
      history: { past: [...canvasHistoryRef.current.past], future: [...canvasHistoryRef.current.future] },
    }));
  }, [activeWorkflowTabId, edges, nodes, selectedId, workflowGroups, workflowId, workflowInterface, workflowName, workflowPath]);
  useEffect(() => {
    const existingIds = new Set(nodes.map((node) => node.id));
    setWorkflowGroups((current) => {
      const normalized = current
        .map((group) => ({ ...group, nodeIds: group.nodeIds.filter((nodeId) => existingIds.has(nodeId)) }))
        .filter((group) => group.nodeIds.length);
      return normalized.length === current.length && normalized.every((group, index) => group.nodeIds.length === current[index].nodeIds.length)
        ? current
        : normalized;
    });
  }, [nodes]);
  const localTranscriptModelLabels = useMemo(() => {
    if (!localProcessors.length) return {};
    const processorsById = new Map(localProcessors.map((processor) => [processor.id, processor]));
    return Object.fromEntries(Object.entries(LOCAL_TRANSCRIPT_MODEL_PROCESSOR_IDS).map(([model, processorId]) => {
      const installed = processorsById.get(processorId)?.installed;
      return [model, installed ? model : `${model} (Chưa cài đặt)`];
    }));
  }, [localProcessors]);
  // React Flow only updates node.selected for interactions originating on the
  // canvas. The workflow outliner is a second selection surface, therefore it
  // must explicitly update the controlled node list as well as the inspector.
  const applyOutlinerSelection = useCallback((nodeIds: Set<string>, focusedNodeId: string | null) => {
    const selectedIds = new Set(nodes.filter((node) => node.selected || node.id === selectedId).map((node) => node.id));
    const unchanged = selectedIds.size === nodeIds.size
      && [...selectedIds].every((nodeId) => nodeIds.has(nodeId))
      && selectedId === focusedNodeId;
    if (unchanged) return;
    rememberCanvasChange();
    setSelectedId(focusedNodeId);
    setNodes((current) => current.map((node) => node.selected === nodeIds.has(node.id)
      ? node
      : { ...node, selected: nodeIds.has(node.id) }));
  }, [nodes, rememberCanvasChange, selectedId, setNodes]);
  const selectNodeFromOutliner = useCallback((nodeId: string, gesture?: OutlinerSelectionGesture) => {
    if (gesture?.shiftKey) return;
    const selectedIds = new Set(nodes.filter((node) => node.selected || node.id === selectedId).map((node) => node.id));
    if (gesture?.ctrlKey || gesture?.metaKey) {
      if (selectedIds.has(nodeId)) selectedIds.delete(nodeId);
      else selectedIds.add(nodeId);
      applyOutlinerSelection(selectedIds, selectedIds.has(nodeId) ? nodeId : [...selectedIds][0] ?? null);
      return;
    }
    applyOutlinerSelection(new Set([nodeId]), nodeId);
  }, [applyOutlinerSelection, nodes, selectedId]);
  const selectGroupFromOutliner = useCallback((group: WorkflowGroup) => {
    const nodeIds = new Set(group.nodeIds);
    const firstNodeId = group.nodeIds.find((nodeId) => nodes.some((node) => node.id === nodeId)) ?? null;
    applyOutlinerSelection(nodeIds, firstNodeId);
  }, [applyOutlinerSelection, nodes]);
  const clearOutlinerSelection = useCallback(() => {
    applyOutlinerSelection(new Set(), null);
  }, [applyOutlinerSelection]);
  const startOutlinerMarquee = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const initialSelectedIds = new Set(nodes.filter((node) => node.selected || node.id === selectedId).map((node) => node.id));
    let historyRecorded = false;
    const applyAtPointer = (clientX: number, clientY: number) => {
      const left = Math.min(startX, clientX);
      const top = Math.min(startY, clientY);
      const right = Math.max(startX, clientX);
      const bottom = Math.max(startY, clientY);
      setOutlinerMarquee({ left, top, width: right - left, height: bottom - top });
      const nodeIds = new Set<string>();
      document.querySelectorAll<HTMLElement>("[data-outliner-selectable]").forEach((element) => {
        const bounds = element.getBoundingClientRect();
        const intersects = bounds.left <= right && bounds.right >= left && bounds.top <= bottom && bounds.bottom >= top;
        if (!intersects) return;
        const nodeId = element.dataset.outlinerNodeId;
        if (nodeId) nodeIds.add(nodeId);
        const groupId = element.dataset.outlinerGroupId;
        if (groupId) workflowGroups.find((group) => group.id === groupId)?.nodeIds.forEach((id) => nodeIds.add(id));
      });
      const changed = initialSelectedIds.size !== nodeIds.size || [...initialSelectedIds].some((id) => !nodeIds.has(id));
      if (changed && !historyRecorded) {
        rememberCanvasChange();
        historyRecorded = true;
      }
      const focusedNodeId = [...nodeIds][0] ?? null;
      setSelectedId(focusedNodeId);
      setNodes((current) => current.map((node) => node.selected === nodeIds.has(node.id)
        ? node
        : { ...node, selected: nodeIds.has(node.id) }));
    };
    const onMove = (pointer: PointerEvent) => applyAtPointer(pointer.clientX, pointer.clientY);
    const stop = () => {
      setOutlinerMarquee(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    applyAtPointer(startX, startY);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  }, [nodes, rememberCanvasChange, selectedId, setNodes, workflowGroups]);
  const selectedNodeIds = useMemo(
    () => nodes.filter((node) => node.selected || node.id === selectedId).map((node) => node.id),
    [nodes, selectedId],
  );
  const createWorkflowGroup = useCallback(() => {
    const selectedIds = new Set(selectedNodeIds);
    if (!selectedIds.size) {
      setNotice("Hãy chọn ít nhất một node trước khi tạo nhóm.");
      return;
    }
    rememberCanvasChange();
    const number = workflowGroups.reduce((largest, group) => {
      const match = /^Group\s+(\d+)$/i.exec(group.name.trim());
      return Math.max(largest, match ? Number(match[1]) : 0);
    }, 0) + 1;
    const group: WorkflowGroup = {
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `Group ${number}`,
      nodeIds: [...selectedIds],
      collapsed: false,
    };
    setWorkflowGroups((current) => [
      ...current.map((item) => ({ ...item, nodeIds: item.nodeIds.filter((nodeId) => !selectedIds.has(nodeId)) })).filter((item) => item.nodeIds.length),
      group,
    ]);
    setNotice(`Đã tạo ${group.name} với ${group.nodeIds.length} node.`);
  }, [rememberCanvasChange, selectedNodeIds, workflowGroups]);
  const ungroupSelectedNodes = useCallback(() => {
    const selectedIds = new Set(selectedNodeIds);
    const groupsToRemove = workflowGroups.filter((group) => group.nodeIds.some((nodeId) => selectedIds.has(nodeId)));
    if (!groupsToRemove.length) {
      setNotice("Vùng chọn chưa thuộc nhóm nào.");
      return;
    }
    rememberCanvasChange();
    const groupIds = new Set(groupsToRemove.map((group) => group.id));
    setWorkflowGroups((current) => current.filter((group) => !groupIds.has(group.id)));
    setNotice(`Đã tách ${groupsToRemove.length} nhóm thành các node riêng.`);
  }, [rememberCanvasChange, selectedNodeIds, workflowGroups]);
  const toggleWorkflowGroupVisibility = useCallback((groupId: string) => {
    const group = workflowGroups.find((item) => item.id === groupId);
    if (!group) return;
    rememberCanvasChange();
    const collapsed = !group.collapsed;
    setWorkflowGroups((current) => current.map((item) => item.id === groupId ? { ...item, collapsed } : item));
    setNotice(collapsed ? `Đã thu gọn các node con của ${group.name} trong Workflow.` : `Đã mở các node con của ${group.name} trong Workflow.`);
  }, [rememberCanvasChange, workflowGroups]);
  const beginOutlinerDrag = useCallback((event: DragEvent<HTMLElement>, item: WorkflowOutlinerDrag) => {
    outlinerDragRef.current = item;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-content-flow-outliner", JSON.stringify(item));

    // Chromium/Electron đôi khi dùng cả layer chứa panel làm drag image khi
    // kéo từ outliner. Tạo preview độc lập chỉ từ chính dòng đang kéo để
    // Properties và những dòng khác không xuất hiện thành ảnh mờ.
    const source = event.currentTarget;
    const sourceRect = source.getBoundingClientRect();
    const preview = document.createElement("div");
    preview.className = "outliner-drag-preview";
    preview.style.width = `${Math.max(120, Math.ceil(sourceRect.width))}px`;
    preview.textContent = source.innerText.replace(/\s+/g, " ").trim();
    document.body.appendChild(preview);
    event.dataTransfer.setDragImage(
      preview,
      Math.min(Math.max(12, event.nativeEvent.offsetX), Math.max(12, sourceRect.width - 12)),
      Math.min(Math.max(12, event.nativeEvent.offsetY), Math.max(12, sourceRect.height - 12)),
    );
    window.requestAnimationFrame(() => preview.remove());
  }, []);
  const endOutlinerDrag = useCallback(() => {
    outlinerDragRef.current = null;
    setOutlinerDropTarget(null);
  }, []);
  const moveNodeIntoGroup = useCallback((nodeId: string, targetGroupId: string, beforeNodeId?: string) => {
    const targetGroup = workflowGroups.find((group) => group.id === targetGroupId);
    if (!targetGroup) return;
    rememberCanvasChange();
    setWorkflowGroups((current) => current
      .map((group) => {
        const withoutNode = group.nodeIds.filter((id) => id !== nodeId);
        if (group.id !== targetGroupId) return { ...group, nodeIds: withoutNode };
        const insertAt = beforeNodeId ? Math.max(0, withoutNode.indexOf(beforeNodeId)) : withoutNode.length;
        return { ...group, nodeIds: [...withoutNode.slice(0, insertAt), nodeId, ...withoutNode.slice(insertAt)] };
      })
      .filter((group) => group.nodeIds.length));
    setNotice(`Đã đưa node vào ${targetGroup.name}.`);
  }, [rememberCanvasChange, workflowGroups]);
  const moveNodeToRoot = useCallback((nodeId: string, beforeNodeId?: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;
    rememberCanvasChange();
    setWorkflowGroups((current) => current
      .map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => id !== nodeId) }))
      .filter((group) => group.nodeIds.length));
    setNodes((current) => {
      const withoutNode = current.filter((item) => item.id !== nodeId);
      const insertAt = beforeNodeId ? Math.max(0, withoutNode.findIndex((item) => item.id === beforeNodeId)) : withoutNode.length;
      return [...withoutNode.slice(0, insertAt), node, ...withoutNode.slice(insertAt)];
    });
    setNotice("Đã đưa node ra cấp Workflow gốc.");
  }, [nodes, rememberCanvasChange, setNodes]);
  const moveWorkflowGroup = useCallback((groupId: string, beforeGroupId?: string) => {
    const group = workflowGroups.find((item) => item.id === groupId);
    if (!group) return;
    rememberCanvasChange();
    setWorkflowGroups((current) => {
      const withoutGroup = current.filter((item) => item.id !== groupId);
      const insertAt = beforeGroupId ? Math.max(0, withoutGroup.findIndex((item) => item.id === beforeGroupId)) : withoutGroup.length;
      return [...withoutGroup.slice(0, insertAt), group, ...withoutGroup.slice(insertAt)];
    });
    setNotice(`Đã sắp xếp ${group.name}.`);
  }, [rememberCanvasChange, workflowGroups]);
  const dropOnWorkflowGroup = useCallback((event: DragEvent<HTMLElement>, targetGroupId: string, beforeNodeId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    const item = outlinerDragRef.current;
    endOutlinerDrag();
    if (!item) return;
    if (item.kind === "node") moveNodeIntoGroup(item.id, targetGroupId, beforeNodeId);
    else if (item.id !== targetGroupId) moveWorkflowGroup(item.id, targetGroupId);
  }, [endOutlinerDrag, moveNodeIntoGroup, moveWorkflowGroup]);
  const dropOnRootNode = useCallback((event: DragEvent<HTMLElement>, beforeNodeId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    const item = outlinerDragRef.current;
    endOutlinerDrag();
    if (!item) return;
    if (item.kind === "node" && item.id !== beforeNodeId) moveNodeToRoot(item.id, beforeNodeId);
    else if (item.kind === "group") moveWorkflowGroup(item.id);
  }, [endOutlinerDrag, moveNodeToRoot, moveWorkflowGroup]);
  const dropOnWorkflowRoot = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const item = outlinerDragRef.current;
    endOutlinerDrag();
    if (!item) return;
    if (item.kind === "node") moveNodeToRoot(item.id);
    else moveWorkflowGroup(item.id);
  }, [endOutlinerDrag, moveNodeToRoot, moveWorkflowGroup]);
  const commitWorkflowGroupName = useCallback(() => {
    if (!editingGroupId) return;
    const original = workflowGroups.find((group) => group.id === editingGroupId);
    const name = editingGroupName.trim() || original?.name || "Group";
    if (original && name !== original.name) {
      rememberCanvasChange();
      setWorkflowGroups((current) => current.map((group) => group.id === editingGroupId ? { ...group, name } : group));
      setNotice(`Đã đổi tên nhóm thành ${name}.`);
    }
    setEditingGroupId(null);
    setEditingGroupName("");
  }, [editingGroupId, editingGroupName, rememberCanvasChange, workflowGroups]);
  const selectedCheckIssues = useMemo(() => {
    if (!selectedNode || (selectedNode.data.beacon !== "miss" && selectedNode.data.beacon !== "error")) return [];
    return workflowCheck.filter((issue) => issue.nodeId === selectedNode.id);
  }, [selectedNode, workflowCheck]);
  const handleNodesChange = useCallback((changes: NodeChange<ContentFlowNode>[]) => {
    if (changes.some((change) => change.type === "remove")) rememberCanvasChange();
    onNodesChange(changes);
  }, [onNodesChange, rememberCanvasChange]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    const affectedNodeIds = new Set<string>();
    for (const change of changes) {
      if (change.type !== "remove") continue;
      const removed = edges.find((edge) => edge.id === change.id);
      if (removed) {
        affectedNodeIds.add(removed.source);
        affectedNodeIds.add(removed.target);
      }
    }
    if (affectedNodeIds.size) rememberCanvasChange();
    onEdgesChange(changes);
    if (affectedNodeIds.size) {
      const nextEdges = applyEdgeChanges(changes, edges);
      setNodes((current) => inheritStorageOutputTypes(current, nextEdges).map((node) => affectedNodeIds.has(node.id)
        ? { ...node, data: { ...node.data, beacon: "uncheck" } }
        : node));
    }
  }, [edges, onEdgesChange, rememberCanvasChange, setNodes]);
  // Some saved canvases predate the APIKey port type.  The selected AI setup
  // node only accepts APIKey here, so an incoming edge is the reliable signal
  // that its direct key field has been replaced by a port connection.
  const selectedApiKeyConnected = useMemo(
    () => Boolean(selectedNode && edges.some((edge) => edge.target === selectedNode.id)),
    [edges, selectedNode],
  );
  const selectedStorageFolderConnected = useMemo(
    () => Boolean(selectedNode && isFileStorageNode(selectedNode) && edges.some((edge) => isFileStorageFolderInput(selectedNode, edge.targetHandle) && edge.target === selectedNode.id)),
    [edges, selectedNode],
  );
  const modelProviderConfig = useMemo(() => {
    if (!selectedNode) return null;
    const configWithConnectedKey = (owner: ContentFlowNode) => {
      const hasApiKeyInput = owner.data.inputs.some((port) => port.type === "APIKey");
      const apiKeyEdge = hasApiKeyInput ? edges.find((edge) => edge.target === owner.id) : undefined;
      const apiKeySource = apiKeyEdge ? nodes.find((node) => node.id === apiKeyEdge.source) : undefined;
      const connectedKey = apiKeySource?.data.config.apiKey ?? apiKeySource?.data.config.content ?? apiKeySource?.data.config.variableValue;
      return apiKeyEdge ? { ...owner.data.config, apiKey: connectedKey ? String(connectedKey) : "", apiKeyFromPort: true } : owner.data.config;
    };
    if (nodeFamilyOf(selectedNode) !== "Chọn mô hình AI") return configWithConnectedKey(selectedNode);
    const providerInput = selectedNode.data.inputs.find((port) => port.type === "AIProvider");
    const providerEdge = providerInput ? edges.find((edge) => edge.target === selectedNode.id && edge.targetHandle === providerInput.id) : undefined;
    const providerNode = providerEdge ? nodes.find((node) => node.id === providerEdge.source) : undefined;
    return providerNode ? configWithConnectedKey(providerNode) : null;
  }, [edges, nodes, selectedNode]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!workflowCheckSummary) return;
    const timeout = window.setTimeout(() => setWorkflowCheckSummary(null), 30000);
    return () => window.clearTimeout(timeout);
  }, [workflowCheckSummary]);

  useEffect(() => {
    if (!nodes.some((node) => node.data.validationError)) return;
    const timeout = window.setTimeout(() => {
      setNodes((current) => current.map((node) => node.data.validationError
        ? { ...node, data: { ...node.data, validationError: undefined } }
        : node));
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [nodes, setNodes]);

  useEffect(() => {
    if (workspaceRestoredRef.current) return;
    workspaceRestoredRef.current = true;
    const saved = localStorage.getItem("content-flow-workspace-v5");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { name?: string; filePath?: string; workflowId?: unknown; workflowInterface?: unknown; nodes: ContentFlowNode[]; edges: Edge[]; groups?: unknown };
      if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
        const filePath = typeof parsed.filePath === "string" ? parsed.filePath : null;
        setWorkflowName(filePath ? workflowNameFromPath(filePath) : parsed.name?.trim() || "New workflow");
        setWorkflowPath(filePath);
        const restoredWorkflowId = typeof parsed.workflowId === "string" && parsed.workflowId.trim() ? parsed.workflowId : createWorkflowId();
        setWorkflowId(restoredWorkflowId);
        setWorkflowInterface(parsed.workflowInterface);
        const repairedWorkflow = repairDuplicateWorkflowNodeIds(parsed.nodes);
        const refreshedNodes = repairedWorkflow.nodes.map(refreshNodeAppearance);
        const normalizedEdges = normalizeWorkflowEdges(parsed.edges, repairedWorkflow.nodes, refreshedNodes);
        const typedNodes = inheritStorageOutputTypes(refreshedNodes, normalizedEdges);
        const visibleNodes = typedNodes.map((node) => node.hidden ? { ...node, hidden: false } : node);
        const groups = normalizeWorkflowGroups(parsed.groups, visibleNodes);
        setNodes(visibleNodes);
        setEdges(normalizedEdges);
        setWorkflowGroups(groups);
        resetCanvasHistory(visibleNodes, normalizedEdges, null, groups);
        setWorkflowTabs((current) => current.map((tab) => {
          if (tab.id !== activeWorkflowTabId) return tab;
          const restoredTab = {
            ...tab,
            name: filePath ? workflowNameFromPath(filePath) : parsed.name?.trim() || "New workflow",
            filePath,
            workflowId: restoredWorkflowId,
            workflowInterface: parsed.workflowInterface,
            nodes: visibleNodes,
            edges: normalizedEdges,
            groups,
            selectedId: null,
            history: { past: [], future: [] },
          };
          return { ...restoredTab, savedContentKey: workflowTabContentKey(restoredTab) };
        }));
        setNotice(repairedWorkflow.repaired
          ? `Đã khôi phục workflow và sửa ${repairedWorkflow.repaired} node có ID trùng.`
          : "Đã khôi phục workflow gần nhất trên máy này.");
      }
    } catch {
      setNotice("Không thể đọc bản lưu cũ; canvas đang để trống.");
    }
  }, [resetCanvasHistory, setEdges, setNodes]);

  useEffect(() => {
    setRecentWorkflows(readRecentWorkflows());
  }, []);

  useEffect(() => {
    const savedMode = localStorage.getItem("content-flow-library-mode-v1");
    if (savedMode === "basic" || savedMode === "advanced") setLibraryMode(savedMode);
  }, []);

  const changeLibraryMode = useCallback((mode: LibraryMode) => {
    setLibraryMode(mode);
    localStorage.setItem("content-flow-library-mode-v1", mode);
  }, []);

  const syncRecentWorkflowPath = useCallback((previousPath: string | null, nextPath: string, name: string) => {
    if (!previousPath) return;
    setRecentWorkflows((current) => {
      const next = current.map((entry) => entry.path === previousPath ? { ...entry, path: nextPath, name } : entry);
      localStorage.setItem(RECENT_WORKFLOWS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const saveWorkflow = useCallback(async (saveAs = false) => {
    const name = workflowName.trim() || "New workflow";
    const workflow = prepareWorkflowForSave({ version: 6, name, workflowId, workflowInterface: workflowInterfaceFromNodes(nodes), nodes, edges, groups: workflowGroups });
    setWorkflowName(name);
    if (!window.contentFlowDesktop) {
      setNotice("Tính năng Lưu tệp chỉ dùng được trong ứng dụng Content Flow Desktop.");
      return false;
    }
    const result = await window.contentFlowDesktop.saveWorkflow({
      workflow,
      currentPath: saveAs ? null : workflowPath,
      defaultName: name,
      saveAs,
    });
    if (result.canceled) return false;
    if (result.error || !result.path) {
      setNotice(result.error || "Không thể lưu workflow.");
      return false;
    }
    const savedName = workflowNameFromPath(result.path);
    const returnedWorkflow = result.workflow && typeof result.workflow === "object" && !Array.isArray(result.workflow)
      ? result.workflow as { workflowId?: unknown; workflowInterface?: unknown }
      : workflow;
    const savedWorkflow = { ...workflow, ...returnedWorkflow, name: savedName };
    setWorkflowName(savedName);
    setWorkflowId(typeof savedWorkflow.workflowId === "string" ? savedWorkflow.workflowId : workflowId);
    setWorkflowInterface(savedWorkflow.workflowInterface);
    setWorkflowPath(result.path);
    syncRecentWorkflowPath(workflowPath, result.path, savedName);
    setWorkflowTabs((current) => current.map((tab) => {
      if (tab.id !== activeWorkflowTabId) return tab;
      const savedTab = {
        ...tab,
        name: savedName,
        filePath: result.path,
        workflowId: typeof savedWorkflow.workflowId === "string" ? savedWorkflow.workflowId : workflowId,
        workflowInterface: savedWorkflow.workflowInterface,
        nodes,
        edges,
        groups: workflowGroups,
        selectedId,
      };
      return { ...savedTab, savedContentKey: workflowTabContentKey(savedTab) };
    }));
    localStorage.setItem("content-flow-workspace-v5", JSON.stringify({ ...savedWorkflow, filePath: result.path }));
    setNotice(saveAs ? `Đã lưu workflow mới: ${result.path}` : `Đã lưu workflow: ${result.path}`);
    return true;
  }, [activeWorkflowTabId, edges, nodes, selectedId, syncRecentWorkflowPath, workflowGroups, workflowId, workflowInterface, workflowName, workflowPath]);

  const rememberRecentWorkflow = useCallback((filePath: string, name: string) => {
    const next = [
      { path: filePath, name: name.trim() || "Workflow không tên", openedAt: Date.now() },
      ...recentWorkflows.filter((entry) => entry.path !== filePath),
    ].slice(0, RECENT_WORKFLOWS_LIMIT);
    setRecentWorkflows(next);
    localStorage.setItem(RECENT_WORKFLOWS_STORAGE_KEY, JSON.stringify(next));
  }, [recentWorkflows]);

  const forgetRecentWorkflow = useCallback((filePath: string) => {
    const next = recentWorkflows.filter((entry) => entry.path !== filePath);
    setRecentWorkflows(next);
    localStorage.setItem(RECENT_WORKFLOWS_STORAGE_KEY, JSON.stringify(next));
  }, [recentWorkflows]);

  const loadWorkflowData = useCallback((value: unknown, fallbackName: string, filePath: string | null) => {
    try {
      const parsed = value as { name?: string; workflowId?: unknown; workflowInterface?: unknown; nodes: ContentFlowNode[]; edges: Edge[]; groups?: unknown };
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error("invalid");
      const name = (filePath ? fallbackName : parsed.name?.trim()) || fallbackName || "New workflow";
      const repairedWorkflow = repairDuplicateWorkflowNodeIds(parsed.nodes);
      const refreshedNodes = repairedWorkflow.nodes.map(refreshNodeAppearance);
      const normalizedEdges = normalizeWorkflowEdges(parsed.edges, repairedWorkflow.nodes, refreshedNodes);
      const typedNodes = inheritStorageOutputTypes(refreshedNodes, normalizedEdges);
      const visibleNodes = typedNodes.map((node) => node.hidden ? { ...node, hidden: false } : node);
      const groups = normalizeWorkflowGroups(parsed.groups, visibleNodes);
      const loadedWorkflowId = typeof parsed.workflowId === "string" && parsed.workflowId.trim() ? parsed.workflowId : createWorkflowId();
      const existingTab = filePath ? workflowTabs.find((tab) => tab.filePath === filePath) : undefined;
      if (existingTab) {
        switchWorkflowTab(existingTab.id);
        setNotice(`Workflow “${existingTab.name}” đã được mở ở tab khác.`);
        return true;
      }
      const baseTab: Omit<WorkflowTab, "savedContentKey"> = {
        id: createWorkflowTabId(),
        name,
        filePath,
        workflowId: loadedWorkflowId,
        workflowInterface: parsed.workflowInterface,
        nodes: visibleNodes,
        edges: normalizedEdges,
        groups,
        selectedId: null,
        history: { past: [], future: [] },
      };
      const nextTab: WorkflowTab = { ...baseTab, savedContentKey: workflowTabContentKey(baseTab) };
      const previousHistory = { past: [...canvasHistoryRef.current.past], future: [...canvasHistoryRef.current.future] };
      runtimeFilesRef.current.clear();
      setWorkflowName(name);
      setWorkflowPath(filePath);
      setWorkflowId(loadedWorkflowId);
      setWorkflowInterface(parsed.workflowInterface);
      setNodes(visibleNodes);
      setEdges(normalizedEdges);
      setWorkflowGroups(groups);
      resetCanvasHistory(visibleNodes, normalizedEdges, null, groups);
      setWorkflowTabs((current) => current.map((tab) => tab.id !== activeWorkflowTabId ? tab : {
        ...tab,
        name: workflowName,
        filePath: workflowPath,
        workflowId,
        workflowInterface,
        nodes,
        edges,
        groups: workflowGroups,
        selectedId,
        history: previousHistory,
      }).concat(nextTab));
      setActiveWorkflowTabId(nextTab.id);
      localStorage.setItem("content-flow-workspace-v5", JSON.stringify({ version: 6, name, workflowId: loadedWorkflowId, workflowInterface: parsed.workflowInterface, nodes: visibleNodes, edges: normalizedEdges, groups, filePath }));
      if (filePath) rememberRecentWorkflow(filePath, name);
      // Mọi nguồn mở workflow (gần đây, hộp tìm file, import) đều phải đưa
      // canvas trở lại. Nếu không, dữ liệu đã nạp nhưng vẫn bị màn hình đóng che.
      setCanvasClosed(false);
      setSelectedId(null);
      const repairNote = repairedWorkflow.repaired ? ` Đã sửa ${repairedWorkflow.repaired} node có ID trùng.` : "";
      setNotice((filePath ? `Đã mở workflow: ${filePath}` : "Đã nhập workflow thành công. Lần Lưu tiếp theo sẽ hỏi vị trí tệp.") + repairNote);
      setTimeout(() => fitView({ padding: 0.15, duration: 500 }), 50);
      return true;
    } catch {
      setNotice("Tệp workflow không hợp lệ.");
      return false;
    }
  }, [activeWorkflowTabId, edges, fitView, nodes, rememberRecentWorkflow, resetCanvasHistory, selectedId, setEdges, setNodes, switchWorkflowTab, workflowGroups, workflowId, workflowInterface, workflowName, workflowPath, workflowTabs]);

  const openWorkflow = useCallback(async (): Promise<boolean> => {
    if (!window.contentFlowDesktop?.openWorkflow) {
      importRef.current?.click();
      return false;
    }
    const result = await window.contentFlowDesktop.openWorkflow();
    if (result.canceled) return false;
    if (result.error || !result.path) {
      setNotice(result.error || "Không thể mở workflow.");
      return false;
    }
    const fileName = workflowNameFromPath(result.path);
    return loadWorkflowData(result.workflow, fileName, result.path);
  }, [loadWorkflowData]);

  const openRecentWorkflow = useCallback(async (recent: RecentWorkflow): Promise<boolean> => {
    const desktop = window.contentFlowDesktop;
    if (!desktop) {
      setNotice("Mở workflow gần đây chỉ dùng được trong ứng dụng Content Flow Desktop.");
      setOpenWorkflowDialogError("Mở workflow gần đây chỉ dùng được trong ứng dụng Content Flow Desktop.");
      return false;
    }
    // readFiles đã có từ các bản desktop cũ, nên dùng làm phương án tương thích
    // khi cửa sổ Electron chưa nạp preload mới có openRecentWorkflow.
    const result = desktop.openRecentWorkflow
      ? await desktop.openRecentWorkflow(recent.path)
      : await desktop.readFiles([recent.path]).then(({ files, error }) => {
        const file = files?.[0];
        if (error || !file?.data) return { canceled: false, error: error || "Không thể đọc tệp workflow gần đây." };
        try {
          return { canceled: false, path: recent.path, workflow: parseWorkflowDocument(new TextDecoder().decode(file.data)) };
        } catch {
          return { canceled: false, error: "Tệp workflow gần đây không hợp lệ." };
        }
      });
    if (result.canceled) return false;
    if (result.error || !result.path) {
      forgetRecentWorkflow(recent.path);
      const message = result.error || `Không thể mở workflow “${recent.name}”. Mục này đã được bỏ khỏi danh sách gần đây.`;
      setNotice(message);
      setOpenWorkflowDialogError(message);
      return false;
    }
    return loadWorkflowData(result.workflow, workflowNameFromPath(result.path), result.path);
  }, [forgetRecentWorkflow, loadWorkflowData]);

  const showOpenWorkflowDialog = useCallback(() => {
    setOpenMenu(null);
    setOpenWorkflowDialogError(null);
    setOpenWorkflowDialog(true);
  }, []);

  const refreshLocalProcessors = useCallback(async () => {
    try {
      const response = await fetch("http://127.0.0.1:4317/local-processors");
      const payload = await response.json() as { processors?: LocalProcessor[]; error?: string };
      if (!response.ok) throw new Error(payload.error || `Dịch vụ cục bộ trả về lỗi ${response.status}`);
      setLocalProcessors(Array.isArray(payload.processors) ? payload.processors : []);
      setLocalProcessorError(null);
    } catch (error) {
      setLocalProcessorError(error instanceof Error ? error.message : "Không thể kết nối dịch vụ xử lý cục bộ.");
    }
  }, []);

  useEffect(() => {
    void refreshLocalProcessors();
  }, [refreshLocalProcessors]);

  const showLocalProcessors = useCallback(() => {
    setOpenMenu(null);
    setLocalProcessorsOpen(true);
    setLocalProcessorError(null);
    void refreshLocalProcessors();
  }, [refreshLocalProcessors]);

  const manageLocalProcessor = useCallback(async (processorId: string, action: "install" | "update" | "remove") => {
    setLocalProcessorBusy(processorId);
    setLocalProcessorError(null);
    try {
      const response = await fetch("http://127.0.0.1:4317/local-processors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ processorId, action }),
      });
      const payload = await response.json() as { processors?: LocalProcessor[]; error?: string };
      if (!response.ok) throw new Error(payload.error || `Dịch vụ cục bộ trả về lỗi ${response.status}`);
      setLocalProcessors(Array.isArray(payload.processors) ? payload.processors : []);
    } catch (error) {
      setLocalProcessorError(error instanceof Error ? error.message : "Không thể điều chỉnh bộ xử lý cục bộ.");
    } finally {
      setLocalProcessorBusy(null);
    }
  }, []);

  const persistLocalAiModels = useCallback((next: LocalAiModel[]) => {
    const normalized = normalizeLocalAiRegistry(next);
    setLocalAiModels(normalized);
    localStorage.setItem(LOCAL_AI_REGISTRY_STORAGE_KEY, JSON.stringify(normalized));
  }, []);

  const scanOllamaModels = useCallback(async () => {
    setLocalAiBusy(true);
    setLocalAiError(null);
    try {
      const response = await fetch("/api/local-ai", { cache: "no-store" });
      const payload = await response.json() as { models?: ScannedOllamaModel[]; scannedAt?: string; error?: string };
      if (!response.ok || !Array.isArray(payload.models)) throw new Error(payload.error || "Không thể quét model Ollama.");
      setScannedOllamaModels(payload.models);
      setLocalAiScannedAt(typeof payload.scannedAt === "string" ? payload.scannedAt : new Date().toISOString());
    } catch (error) {
      setLocalAiError(error instanceof Error ? error.message : "Không thể quét model Ollama.");
    } finally {
      setLocalAiBusy(false);
    }
  }, []);

  const showLocalAiManager = useCallback(() => {
    setOpenMenu(null);
    setLocalAiManagerOpen(true);
    setLocalAiError(null);
    void scanOllamaModels();
  }, [scanOllamaModels]);

  const addLocalAiModel = useCallback((model: ScannedOllamaModel) => {
    persistLocalAiModels(mergeScannedOllamaModel(localAiModels, model));
  }, [localAiModels, persistLocalAiModels]);

  const removeRegisteredLocalAiModel = useCallback((modelId: string) => {
    persistLocalAiModels(removeLocalAiModel(localAiModels, modelId));
  }, [localAiModels, persistLocalAiModels]);

  const browseWorkflow = useCallback(async () => {
    const opened = await openWorkflow();
    if (opened) {
      setCanvasClosed(false);
      setOpenWorkflowDialog(false);
    }
  }, [openWorkflow]);

  const closeWorkflow = useCallback(() => {
    // Khi đã có nhiều tab, Đóng chỉ đóng tab đang hoạt động. Canvas khác vẫn
    // giữ nguyên node, selection và lịch sử riêng của chúng.
    setOpenMenu(null);
    setQuickAddOpen(false);
    setOpenWorkflowDialog(false);
    setOpenWorkflowDialogError(null);
    setPendingConnection(null);
    setManualPortFilter(null);
    closeWorkflowTab(activeWorkflowTabId);
  }, [activeWorkflowTabId, closeWorkflowTab]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const source = nodes.find((node) => node.id === connection.source);
      const target = nodes.find((node) => node.id === connection.target);
      const output = source?.data.outputs.find((port) => port.id === connection.sourceHandle);
      const input = target?.data.inputs.find((port) => port.id === connection.targetHandle);
      if (!source || !target || !output || !input || source.id === target.id) return false;
      if (portSpecFor(input).cardinality === "one" && edges.some((edge) => edge.target === target.id && edge.targetHandle === input.id)) return false;
      return portsCanConnect(output, input);
    },
    [edges, nodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) {
        setNotice("Không thể nối: kiểu dữ liệu hoặc số lượng dữ liệu không phù hợp, hoặc cổng đơn đã có đầu vào.");
        return;
      }
      rememberCanvasChange();
      const target = nodes.find((node) => node.id === connection.target);
      const source = nodes.find((node) => node.id === connection.source);
      const targetPort = target?.data.inputs.find((port) => port.id === connection.targetHandle);
      const sourcePort = source?.data.outputs.find((port) => port.id === connection.sourceHandle);
      const isApiKeyInput = targetPort?.type === "APIKey";
      const isStorageFolderInput = isFileStorageFolderInput(target, connection.targetHandle);
      const isImageSearchTemplateInput = targetPort?.type === "ImageSample";
      const isImageSearchImageInput = targetPort?.type === "ImageSearch" || targetPort?.type === "ImageSearchList";
      const isImageSearchFolderInput = targetPort?.type === "SearchFolder";
      const replacesAttentionInput = isAttentionMediaInput(target, connection.targetHandle)
        && edges.some((edge) => edge.target === target?.id && edge.targetHandle !== connection.targetHandle && isAttentionMediaInput(target, edge.targetHandle));
      setEdges((current) => addEdge(workflowEdge(connection, nodes, `edge-${Date.now()}`), removeAttentionSiblingEdges(current, connection, nodes)));
      setNodes((current) => current.map((node) => node.id === connection.source || node.id === connection.target
        ? { ...node, data: { ...node.data, beacon: "uncheck" } }
        : node));
      if (isApiKeyInput && target) {
        setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, config: { ...node.data.config, apiKey: "" }, validationError: undefined, beacon: "uncheck" } } : node));
      }
      if (isStorageFolderInput && target) {
        setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, config: { ...node.data.config, localFolder: "" }, validationError: undefined, beacon: "uncheck" } } : node));
      }
      if (target && isImageSearchTemplateInput) {
        setNodes((current) => current.map((node) => node.id === target.id ? {
          ...node,
          data: { ...node.data, config: { ...node.data.config, templateImages: "", templateImagesPaths: "", exactRegions: "" }, validationError: undefined, beacon: "uncheck" },
        } : node));
        runtimeFilesRef.current.delete(`${target.id}:templateImages`);
      }
      if (target && (isImageSearchImageInput || isImageSearchFolderInput)) {
        setNodes((current) => current.map((node) => node.id === target.id ? {
          ...node,
          data: {
            ...node.data,
            config: {
              ...node.data.config,
              searchSourceMode: isImageSearchFolderInput ? "Chọn folder ảnh" : "Chọn ảnh",
              searchImages: "",
              searchImagesPaths: "",
              searchFolder: "",
            },
            validationError: undefined,
            beacon: "uncheck",
          },
        } : node));
        runtimeFilesRef.current.delete(`${target.id}:searchImages`);
      }
      if (target && isFileStorageNode(target) && !isStorageFolderInput) {
        setNodes((current) => current.map((node) => node.id === target.id ? inheritStorageOutputType(node, sourcePort?.type) : node));
      }
      setNotice(isApiKeyInput ? "Đã nhận API key từ kết nối; key nhập trực tiếp đã được xóa." : isStorageFolderInput ? "Đã nhận thư mục từ kết nối; thư mục chọn trực tiếp đã được xóa." : isImageSearchTemplateInput ? "Đã nhận ảnh qua image-sample; đã xóa ảnh mẫu và vùng cắt cũ trong node." : isImageSearchImageInput ? "Đã nhận ảnh cần tìm qua dây; lựa chọn ảnh trực tiếp đã được xóa." : isImageSearchFolderInput ? "Đã nhận folder cần tìm qua dây; lựa chọn trực tiếp đã được xóa." : replacesAttentionInput ? "Đã kết nối node mới và tự tháo line ảnh/video còn lại của vùng chú ý." : "Đã kết nối hai node.");
    },
    [isValidConnection, nodes, rememberCanvasChange, setEdges, setNodes],
  );

  const applyPortFilter = useCallback((filter: PortFilter) => {
    setManualPortFilter(filter);
    setSearch("");
    setNotice(`Đang lọc node ${filter.handleType === "source" ? "có đầu vào" : "có đầu ra"} tương thích với ${displayPortLabel(filter.type)} (${portContractLabel(filter)}).`);
  }, []);

  const onWireConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const pending = pendingConnection;
    setPendingConnection(null);
    if (!pending) return;
    const pointer = event instanceof MouseEvent ? event : event.changedTouches[0];
    if (!pointer) return;
    const dropElement = document.elementFromPoint(pointer.clientX, pointer.clientY);
    // A precise handle drop is completed by React Flow's regular onConnect.
    if (dropElement?.closest(".react-flow__handle")) return;
    const targetElement = dropElement?.closest<HTMLElement>(".react-flow__node");
    const targetId = targetElement?.dataset.id;
    if (!targetId || targetId === pending.nodeId) return;
    const pendingNode = nodes.find((node) => node.id === pending.nodeId);
    const targetNode = nodes.find((node) => node.id === targetId);
    if (!pendingNode || !targetNode) return;
    const connection = pending.handleType === "source"
      ? connectionFromSourceHandle(pendingNode, pending.handleId, targetNode, edges)
      : connectionToTargetHandle(targetNode, pendingNode, pending.handleId, edges);
    if (!connection || !isValidConnection(connection)) return;
    rememberCanvasChange();
    const replacesAttentionInput = isAttentionMediaInput(targetNode, connection.targetHandle)
      && edges.some((edge) => edge.target === targetNode.id && edge.targetHandle !== connection.targetHandle && isAttentionMediaInput(targetNode, edge.targetHandle));
    setEdges((current) => {
      const next = removeAttentionSiblingEdges(current, connection, nodes);
      const targetOccupied = next.some((edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle);
      return targetOccupied ? next : addEdge(workflowEdge(connection, nodes, `edge-${Date.now()}`), next);
    });
    setNodes((current) => current.map((node) => node.id === connection.source || node.id === connection.target
      ? { ...node, data: { ...node.data, beacon: "uncheck" } }
      : node));
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    const sourcePort = source?.data.outputs.find((port) => port.id === connection.sourceHandle);
    const targetPort = target?.data.inputs.find((port) => port.id === connection.targetHandle);
    if (targetPort?.type === "APIKey" && target) {
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, config: { ...node.data.config, apiKey: "" }, validationError: undefined, beacon: "uncheck" } } : node));
    }
    if (isFileStorageFolderInput(target, connection.targetHandle) && target) {
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, config: { ...node.data.config, localFolder: "" }, validationError: undefined, beacon: "uncheck" } } : node));
    }
    if (target && isFileStorageNode(target) && !isFileStorageFolderInput(target, connection.targetHandle)) {
      setNodes((current) => current.map((node) => node.id === target.id ? inheritStorageOutputType(node, sourcePort?.type) : node));
    }
    setNotice(targetPort?.type === "APIKey" ? "Đã nhận API key từ kết nối; key nhập trực tiếp đã được xóa." : replacesAttentionInput ? "Đã nối nhanh và tự tháo line ảnh/video còn lại của vùng chú ý." : `Đã nối nhanh “${source?.data.label ?? "node nguồn"}” → “${target?.data.label ?? "node đích"}”.`);
  }, [edges, isValidConnection, nodes, pendingConnection, rememberCanvasChange, setEdges, setNodes]);

  const addNodeToCanvas = useCallback(
    (kind: string, position?: { x: number; y: number }) => {
      const definition = definitionMap.get(kind);
      const gatewayFamily = definition?.family === WORKFLOW_INPUT_GATEWAY_FAMILY || definition?.family === WORKFLOW_OUTPUT_GATEWAY_FAMILY
        ? definition.family
        : null;
      const existingGateway = gatewayFamily ? nodes.find((node) => nodeFamilyOf(node) === gatewayFamily) : undefined;
      if (existingGateway) {
        setSelectedId(existingGateway.id);
        setNotice(`Workflow chỉ có một node ${gatewayFamily}. Đã chọn node hiện có để bạn chỉnh các cổng.`);
        return;
      }
      rememberCanvasChange();
      const id = claimNextNodeId(kind);
      const fallback = screenToFlowPosition({
        x: (wrapperRef.current?.getBoundingClientRect().left ?? 0) + 420,
        y: (wrapperRef.current?.getBoundingClientRect().top ?? 0) + 260,
      });
      setNodes((current) => [...current, makeNode(kind, id, position ?? fallback, current)]);
      void refreshLocalProcessors();
      setSelectedId(id);
      setNotice("Đã thêm node mới. Hãy nối các cổng cùng loại dữ liệu.");
    },
    [claimNextNodeId, nodes, refreshLocalProcessors, rememberCanvasChange, screenToFlowPosition, setNodes],
  );

  const copyCanvasSelection = useCallback(() => {
    const selected = nodes.filter((node) => node.selected || node.id === selectedId);
    if (!selected.length) {
      setNotice("Hãy chọn ít nhất một node hoặc lane để sao chép.");
      return;
    }
    const selectedIds = new Set(selected.map((node) => node.id));
    canvasClipboardRef.current = {
      nodes: JSON.parse(JSON.stringify(selected)) as ContentFlowNode[],
      edges: JSON.parse(JSON.stringify(edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)))) as Edge[],
    };
    clipboardPasteCountRef.current = 0;
    setNotice(`Đã sao chép ${selected.length} node và ${canvasClipboardRef.current.edges.length} lane nội bộ.`);
  }, [edges, nodes, selectedId]);

  const pasteCanvasSelection = useCallback(() => {
    const clipboard = canvasClipboardRef.current;
    if (!clipboard?.nodes.length) {
      setNotice("Clipboard canvas đang trống. Hãy chọn node/lane rồi nhấn Ctrl+C.");
      return;
    }
    rememberCanvasChange();
    const offset = 36 * (++clipboardPasteCountRef.current);
    const idMap = new Map<string, string>();
    const pastedNodes = clipboard.nodes.map((source) => {
      const id = claimNextNodeId(source.data.kind);
      idMap.set(source.id, id);
      const clone = JSON.parse(JSON.stringify(source)) as ContentFlowNode;
      return {
        ...clone,
        id,
        selected: true,
        position: { x: clone.position.x + offset, y: clone.position.y + offset },
        data: { ...clone.data, status: "idle" as NodeStatus, beacon: "uncheck", output: undefined, duration: undefined, validationError: undefined },
      };
    });
    const pastedEdges = clipboard.edges.flatMap((source) => {
      const sourceId = idMap.get(source.source);
      const targetId = idMap.get(source.target);
      return sourceId && targetId ? [{ ...source, id: `edge-copy-${Date.now()}-${idCounter.current++}`, source: sourceId, target: targetId, selected: false }] : [];
    });
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...pastedNodes]);
    setEdges((current) => [...current, ...pastedEdges]);
    setSelectedId(pastedNodes[0]?.id ?? null);
    setNotice(`Đã dán ${pastedNodes.length} node và ${pastedEdges.length} lane nội bộ.`);
  }, [claimNextNodeId, rememberCanvasChange, setEdges, setNodes]);

  const openQuickAdd = useCallback((position?: { x: number; y: number }) => {
    setQuickAddPosition(position);
    setQuickAddSearch("");
    setQuickAddPreviewKind(null);
    setQuickAddOpen(true);
  }, []);

  const toggleSelectedNodePause = useCallback(() => {
    const selectedIds = new Set(nodes.filter((node) => node.selected || node.id === selectedId).map((node) => node.id));
    if (!selectedIds.size) {
      setNotice("Hãy chọn ít nhất một node rồi nhấn Ctrl+P để tạm ngưng.");
      return;
    }
    rememberCanvasChange();
    const selectedNodes = nodes.filter((node) => selectedIds.has(node.id));
    // Một node còn hoạt động có nghĩa là cả vùng chọn sẽ được tạm ngưng.
    // Chỉ bật lại khi tất cả node trong vùng chọn đang tạm ngưng.
    const paused = selectedNodes.some((node) => !node.data.paused);
    setNodes((current) => current.map((node) => {
      if (!selectedIds.has(node.id)) return node;
      return {
        ...node,
        data: {
          ...node.data,
          paused,
          status: "idle",
          beacon: paused ? "paused" : "uncheck",
          output: paused ? node.data.output : undefined,
        },
      };
    }));
    if (selectedNodes.length === 1) {
      const label = selectedNodes[0].data.label;
      setNotice(paused ? `Đã tạm ngưng node “${label}”. Node sẽ không chạy.` : `Đã bật lại node “${label}”. Hãy kiểm tra workflow trước khi chạy.`);
      return;
    }
    setNotice(paused
      ? `Đã tạm ngưng ${selectedNodes.length} node đã chọn. Các node này sẽ không chạy.`
      : `Đã bật lại ${selectedNodes.length} node đã chọn. Hãy kiểm tra workflow trước khi chạy.`);
  }, [nodes, rememberCanvasChange, selectedId, setNodes]);

  useEffect(() => {
    return window.contentFlowDesktop?.onCloseCanvas(closeWorkflow);
  }, [closeWorkflow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']");
      if (event.key === "Escape") {
        setQuickAddOpen(false);
        setOpenMenu(null);
        setOpenWorkflowDialog(false);
        setOpenWorkflowDialogError(null);
        return;
      }
      if (editing) return;
      if (canvasClosed) {
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "o") {
          event.preventDefault();
          showOpenWorkflowDialog();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "n") {
          event.preventDefault();
          createNewWorkflowTab();
          return;
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        closeWorkflow();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveWorkflow(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveWorkflow();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        showOpenWorkflowDialog();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        createNewWorkflowTab();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoCanvasChange();
        else undoCanvasChange();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "g") {
        event.preventDefault();
        createWorkflowGroup();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "g") {
        event.preventDefault();
        ungroupSelectedNodes();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copyCanvasSelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteCanvasSelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        checkWorkflowRef.current();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        toggleSelectedNodePause();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        toggleWorkflowRunRef.current();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        stopWorkflowRef.current();
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        fitView({ padding: 0.15, duration: 350 });
        return;
      }
      if (event.code === "Space" && !editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        openQuickAdd();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canvasClosed, closeWorkflow, copyCanvasSelection, createNewWorkflowTab, createWorkflowGroup, fitView, openQuickAdd, pasteCanvasSelection, redoCanvasChange, saveWorkflow, showOpenWorkflowDialog, toggleSelectedNodePause, undoCanvasChange, ungroupSelectedNodes]);

  useEffect(() => {
    const closeMenuOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".menu-group")) setOpenMenu(null);
    };
    window.addEventListener("pointerdown", closeMenuOutside, true);
    return () => window.removeEventListener("pointerdown", closeMenuOutside, true);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData("application/content-node");
      if (!kind || !wrapperRef.current) return;
      addNodeToCanvas(kind, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [addNodeToCanvas, screenToFlowPosition],
  );

  const updateWorkflowGatewayPorts = (change: (ports: WorkflowGatewayPort[]) => WorkflowGatewayPort[]) => {
    if (!selectedNode || !selectedId) return;
    const direction = workflowGatewayDirection(selectedNode);
    if (!direction) return;
    const nextPorts = normalizeWorkflowGatewayPorts(change(normalizeWorkflowGatewayPorts(selectedNode.data.workflowPorts)));
    const nextCanvasPorts = portsForWorkflowGateway(direction, nextPorts);
    const allowedHandleIds = new Set((direction === "input" ? nextCanvasPorts.outputs : nextCanvasPorts.inputs).map((port) => port.id));
    rememberCanvasChange();
    setEdges((current) => current.filter((edge) => (
      (edge.source !== selectedId || Boolean(edge.sourceHandle && allowedHandleIds.has(edge.sourceHandle)))
      && (edge.target !== selectedId || Boolean(edge.targetHandle && allowedHandleIds.has(edge.targetHandle)))
    )));
    setNodes((current) => current.map((node) => node.id === selectedId ? {
      ...node,
      data: {
        ...node.data,
        workflowPorts: nextPorts,
        inputs: nextCanvasPorts.inputs,
        outputs: nextCanvasPorts.outputs,
        status: "idle",
        beacon: "uncheck",
        output: undefined,
      },
    } : node));
  };

  const updateConfig = (key: string, value: FieldValue, validationError?: string | null) => {
    if (!selectedId) return;
    rememberCanvasChange();
    const selectedDefinition = selectedNode ? definitionMap.get(selectedNode.data.kind) : undefined;
    const invalidatesAiDependents = selectedNode?.data.category === "AI & mô hình"
      && ["provider", "model", "customModel", "apiKey"].includes(key);
    const dependentNodeIds = new Set<string>();
    if (invalidatesAiDependents) {
      const queue = [selectedId];
      while (queue.length) {
        const sourceId = queue.shift()!;
        for (const edge of edges) {
          if (edge.source !== sourceId || dependentNodeIds.has(edge.target)) continue;
          dependentNodeIds.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
    const operationChanged = key === "basicOperation" && selectedDefinition?.basicMode === "choice";
    const transcriptModeChanged = key === "transcriptMode" && (selectedDefinition?.basicPresetId === "prepare-video-analysis" || selectedDefinition?.family === "Tạo transcript video theo thời gian");
    const nextOperationPorts = selectedDefinition && (operationChanged || transcriptModeChanged)
      ? portsForBasicConfiguration(selectedDefinition, { ...selectedNode?.data.config, [key]: value }, key === "basicOperation" ? String(value) : undefined)
      : undefined;
    if (nextOperationPorts) {
      const activeInputIds = new Set(nextOperationPorts.inputs.map((port) => port.id));
      const activeOutputIds = new Set(nextOperationPorts.outputs.map((port) => port.id));
      setEdges((current) => current.filter((edge) => (
        (edge.source !== selectedId || Boolean(edge.sourceHandle && activeOutputIds.has(edge.sourceHandle)))
        && (edge.target !== selectedId || Boolean(edge.targetHandle && activeInputIds.has(edge.targetHandle)))
      )));
    }
    if (key === "apiKey") {
      const apiKeyInputIds = new Set(selectedNode?.data.inputs.filter((port) => port.type === "APIKey").map((port) => port.id) ?? []);
      if (apiKeyInputIds.size) setEdges((current) => current.filter((edge) => !(edge.target === selectedId && edge.targetHandle && apiKeyInputIds.has(edge.targetHandle))));
    }
    if (key === "localFolder" && String(value).trim() && isFileStorageNode(selectedNode)) {
      const folderInputIds = new Set(selectedNode?.data.inputs.filter((port) => port.type === "Folder").map((port) => port.id) ?? []);
      if (folderInputIds.size) setEdges((current) => current.filter((edge) => !(edge.target === selectedId && edge.targetHandle && folderInputIds.has(edge.targetHandle))));
    }
    const durationError = selectedNode && nodeFamilyOf(selectedNode) === "Nhập thời gian" && key === "durationText"
      ? (() => { try { parseDurationInput(String(value)); return null; } catch (error) { return error instanceof Error ? error.message : "Định dạng thời gian không hợp lệ"; } })()
      : undefined;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedId
          ? (() => {
            const definition = definitionMap.get(node.data.kind);
            const nextConfig = { ...node.data.config, [key]: value };
            const selectedStep = key === "basicOperation" && definition?.basicMode === "choice"
              ? findBasicStep(definition, String(value))
              : undefined;
            const activePorts = definition && ((key === "basicOperation" && definition.basicMode === "choice") || (key === "transcriptMode" && (definition.basicPresetId === "prepare-video-analysis" || definition.family === "Tạo transcript video theo thời gian")))
              ? portsForBasicConfiguration(definition, nextConfig, key === "basicOperation" ? String(value) : undefined)
              : { inputs: node.data.inputs, outputs: node.data.outputs };
            const updatedNode: ContentFlowNode = {
              ...node,
              data: {
                ...node.data,
                config: selectedStep ? { ...selectedStep.config, ...nextConfig } : nextConfig,
                inputs: activePorts.inputs,
                outputs: activePorts.outputs,
                configFields: key === "basicOperation" && definition?.basicMode === "choice"
                  ? choiceFields(definition, String(value))
                  : node.data.configFields,
                validationError: key === "basicOperation" || key === "apiKey"
                  ? undefined
                  : durationError !== undefined
                    ? durationError ?? undefined
                  : validationError === undefined
                    ? node.data.validationError
                    : validationError ?? undefined,
                status: "idle" as NodeStatus,
                beacon: "uncheck",
                output: undefined,
              },
            };
            // Đổi chế độ cổng ra phải phản ánh ngay trên canvas. Ở chế độ
            // tương đồng, kiểu được đọc lại từ line đang cấp dữ liệu vào node.
            return isFileStorageNode(updatedNode) && key === "storageOutputMode"
              ? inheritStorageOutputType(updatedNode, storageInputSourceType(updatedNode, current, edges))
              : updatedNode;
          })()
          : dependentNodeIds.has(node.id)
            ? {
              ...node,
              data: {
                ...node.data,
                validationError: undefined,
                status: "idle" as NodeStatus,
                beacon: "uncheck",
                output: undefined,
                duration: undefined,
              },
            }
            : node,
      ),
    );
    if (invalidatesAiDependents) {
      setNotice(dependentNodeIds.size
        ? `Đã đổi cấu hình AI; đã xóa kết quả cũ ở ${dependentNodeIds.size} node phụ thuộc. Hãy kiểm tra rồi chạy lại.`
        : "Đã đổi cấu hình AI. Hãy kiểm tra rồi chạy lại workflow.");
    }
  };

  const hydratePersistedFiles = useCallback(async (node: ContentFlowNode, field: ConfigField) => {
    const paths = filePathsFromConfig(node.data.config[`${field.key}Paths`]);
    const runtimeKey = `${node.id}:${field.key}`;
    if (!paths.length || runtimeFilesRef.current.has(runtimeKey)) return;
    if (!window.contentFlowDesktop?.readFiles) throw new Error(`Không thể đọc lại nguồn “${field.label}” ngoài Content Flow Desktop.`);
    const result = await window.contentFlowDesktop.readFiles(paths);
    if (result.error || !result.files) throw new Error(result.error || `Không thể đọc lại nguồn “${field.label}”.`);
    runtimeFilesRef.current.set(runtimeKey, result.files.map(desktopRuntimeFile));
  }, []);

  const hydrateStoredFiles = useCallback(async (node: ContentFlowNode) => {
    const storedFiles = node.data.storedFiles ?? [];
    const runtimeKey = `${node.id}:stored-files`;
    if (!storedFiles.length || runtimeFilesRef.current.has(runtimeKey)) return;
    if (!window.contentFlowDesktop?.readFiles) throw new Error("Không thể nạp lại stored file ngoài Content Flow Desktop.");
    const result = await window.contentFlowDesktop.readFiles(storedFiles.map((file) => file.filePath));
    if (result.error || !result.files) throw new Error(result.error || "Không thể nạp lại stored file đã lưu.");
    runtimeFilesRef.current.set(runtimeKey, result.files.map(desktopRuntimeFile));
  }, []);

  const syncCalledWorkflowReference = useCallback(async (nodeId: string, filePath: string) => {
    if (!window.contentFlowDesktop?.readWorkflowAtPath) {
      setNotice("Chọn workflow cần gọi chỉ dùng được trong ứng dụng Tesseract Desktop.");
      return false;
    }
    const result = await window.contentFlowDesktop.readWorkflowAtPath(filePath);
    if (result.error || !result.workflow || !result.path) {
      setNotice(result.error || "Không thể đọc workflow cần gọi.");
      return false;
    }
    try {
      const workflow = result.workflow as { workflowId?: unknown; workflowInterface?: unknown };
      if (typeof workflow.workflowId !== "string" || !workflow.workflowId.trim()) throw new Error("Workflow cần gọi chưa có ID ổn định. Hãy mở và lưu lại workflow đó bằng Tesseract.");
      const workflowInterface = normalizeWorkflowInterfaceShape(workflow.workflowInterface);
      const reference: CalledWorkflowReference = { source: "file", path: result.path, workflowId: workflow.workflowId, workflowInterface };
      const callPorts = portsForCalledWorkflow(workflowInterface);
      rememberCanvasChange();
      setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
      setNodes((current) => current.map((node) => node.id === nodeId ? {
        ...node,
        data: {
          ...node.data,
          calledWorkflow: reference,
          inputs: callPorts.inputs,
          outputs: callPorts.outputs,
          config: {
            ...node.data.config,
            workflowPath: workflowNameFromPath(result.path),
            workflowPathPaths: JSON.stringify([result.path]),
          },
          validationError: undefined,
          status: "idle",
          beacon: "uncheck",
          output: undefined,
        },
      } : node));
      setNotice(`Đã đồng bộ ${workflowInterface.inputs.length} cổng vào và ${workflowInterface.outputs.length} cổng ra từ “${workflowNameFromPath(result.path)}”.`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Interface workflow cần gọi không hợp lệ.");
      return false;
    }
  }, [rememberCanvasChange, setEdges, setNodes]);

  const syncBrowserWorkflowReference = useCallback(async (nodeId: string, file: File) => {
    try {
      const workflow = parseWorkflowDocument(await file.text()) as WorkflowDocumentLike & { workflowId?: unknown; workflowInterface?: unknown };
      if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges) || typeof workflow.workflowId !== "string" || !workflow.workflowId.trim()) {
        throw new Error("Workflow cần gọi chưa có ID ổn định. Hãy mở và lưu lại workflow đó bằng Tesseract.");
      }
      const workflowInterface = normalizeWorkflowInterfaceShape(workflow.workflowInterface);
      const browserPath = `browser://${file.name}`;
      const reference: CalledWorkflowReference = {
        source: "file",
        path: browserPath,
        workflowId: workflow.workflowId,
        workflowInterface,
        embeddedWorkflow: workflow,
      };
      const callPorts = portsForCalledWorkflow(workflowInterface);
      rememberCanvasChange();
      setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
      setNodes((current) => current.map((node) => node.id === nodeId ? {
        ...node,
        data: {
          ...node.data,
          calledWorkflow: reference,
          inputs: callPorts.inputs,
          outputs: callPorts.outputs,
          config: {
            ...node.data.config,
            workflowPath: workflowNameFromPath(file.name),
            workflowPathPaths: JSON.stringify([browserPath]),
          },
          validationError: undefined,
          status: "idle",
          beacon: "uncheck",
          output: undefined,
        },
      } : node));
      setNotice(`Đã nạp và đồng bộ ${workflowInterface.inputs.length} cổng vào, ${workflowInterface.outputs.length} cổng ra từ “${workflowNameFromPath(file.name)}” trong trình duyệt.`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể đọc workflow cần gọi từ tệp đã chọn.");
      return false;
    }
  }, [rememberCanvasChange, setEdges, setNodes]);

  const syncCurrentWorkflowReference = useCallback((nodeId: string) => {
    const workflowInterface = workflowInterfaceFromNodes(nodes);
    const reference: CalledWorkflowReference = {
      source: "current",
      // Đây là định danh lưu được vào .tess, không phải đường dẫn thật. Khi
      // chạy, runner sẽ lấy snapshot canvas đang mở có cùng workflowId.
      path: `current://${workflowId}`,
      workflowId,
      workflowInterface,
    };
    const callPorts = portsForCalledWorkflow(workflowInterface);
    rememberCanvasChange();
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setNodes((current) => current.map((node) => node.id === nodeId ? {
      ...node,
      data: {
        ...node.data,
        calledWorkflow: reference,
        inputs: callPorts.inputs,
        outputs: callPorts.outputs,
        config: {
          ...node.data.config,
          workflowPath: `${workflowName.trim() || "Workflow hiện tại"} (đang mở)`,
          workflowPathPaths: "",
        },
        validationError: undefined,
        status: "idle",
        beacon: "uncheck",
        output: undefined,
      },
    } : node));
    setNotice(`Đã đồng bộ ${workflowInterface.inputs.length} cổng vào và ${workflowInterface.outputs.length} cổng ra từ workflow đang mở “${workflowName.trim() || "Workflow hiện tại"}”.`);
  }, [nodes, rememberCanvasChange, workflowId, workflowName]);

  const syncOpenWorkflowReference = useCallback((nodeId: string, targetTabId: string) => {
    const target = targetTabId === activeWorkflowTabId
      ? {
        id: activeWorkflowTabId,
        name: workflowName,
        workflowId,
        workflowInterface: workflowInterfaceFromNodes(nodes),
      }
      : workflowTabs.find((tab) => tab.id === targetTabId);
    if (!target) {
      setNotice("Workflow đang mở đã không còn tồn tại. Hãy chọn lại workflow cần gọi.");
      return;
    }
    const workflowInterface = normalizeWorkflowInterfaceShape(target.workflowInterface);
    const reference: CalledWorkflowReference = {
      source: "open-tab",
      path: `open-tab://${target.id}`,
      tabId: target.id,
      workflowId: target.workflowId,
      workflowInterface,
    };
    const callPorts = portsForCalledWorkflow(workflowInterface);
    rememberCanvasChange();
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setNodes((current) => current.map((node) => node.id === nodeId ? {
      ...node,
      data: {
        ...node.data,
        calledWorkflow: reference,
        inputs: callPorts.inputs,
        outputs: callPorts.outputs,
        config: {
          ...node.data.config,
          workflowPath: `${target.name || "Workflow"} (tab đang mở)`,
          workflowPathPaths: "",
          openWorkflowTabId: target.id,
        },
        validationError: undefined,
        status: "idle",
        beacon: "uncheck",
        output: undefined,
      },
    } : node));
    setNotice(`Đã đồng bộ ${workflowInterface.inputs.length} cổng vào và ${workflowInterface.outputs.length} cổng ra từ tab “${target.name || "Workflow"}”.`);
  }, [activeWorkflowTabId, nodes, rememberCanvasChange, workflowId, workflowName, workflowTabs]);

  const executeWorkflowCallNode = useCallback(async (
    initialNode: ContentFlowNode,
    initialInputs: Record<string, unknown>,
    reportProgress?: (progress: ExecutionProgress) => void,
  ): Promise<Record<string, unknown>> => {
    const context = { stack: [] as string[], calls: 0 };
    const currentDocument: WorkflowDocumentLike & { workflowId: string; workflowInterface: WorkflowInterfaceShape } = {
      workflowId,
      workflowInterface: workflowInterfaceFromNodes(nodes),
      nodes,
      edges,
    };
    const openDocuments = new Map(workflowTabs.map((tab) => [tab.id, {
      workflowId: tab.workflowId,
      workflowInterface: normalizeWorkflowInterfaceShape(tab.workflowInterface),
      nodes: tab.nodes,
      edges: tab.edges,
    }]));
    openDocuments.set(activeWorkflowTabId, currentDocument);
    const visit = async (node: ContentFlowNode | WorkflowDocumentLike["nodes"][number], inputs: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const extended = node as typeof node & { data: { calledWorkflow?: CalledWorkflowReference; config: Record<string, FieldValue> } };
      const reference = extended.data.calledWorkflow;
      const configuredPath = reference?.path ?? filePathsFromConfig(extended.data.config.workflowPathPaths)[0];
      if (!configuredPath) throw new Error(`Node “${extended.data.label}” chưa chọn workflow .tess cần gọi.`);
      if (context.stack.length >= 32) throw new Error(`Workflow gọi lồng vượt độ sâu an toàn 32: ${[...context.stack, configuredPath].join(" → ")}`);
      if (context.calls >= 500) throw new Error(`Workflow gọi lồng vượt giới hạn an toàn 500 lần trong một lượt chạy.`);
      const openTabId = reference?.source === "open-tab"
        ? reference.tabId ?? String(extended.data.config.openWorkflowTabId ?? "")
        : configuredPath.startsWith("open-tab://") ? configuredPath.slice("open-tab://".length) : "";
      const loaded: { path?: string; workflow?: unknown; error?: string } = openTabId
        ? openDocuments.has(openTabId)
          ? { path: `open-tab://${openTabId}`, workflow: openDocuments.get(openTabId) }
          : { error: "Workflow đang mở được gọi không còn tồn tại. Hãy chọn lại tại node Gọi workflow." }
        : reference?.source === "current" || configuredPath === `current://${workflowId}`
          ? { path: configuredPath, workflow: currentDocument }
          : reference?.embeddedWorkflow
            ? { path: configuredPath, workflow: reference.embeddedWorkflow }
          : await window.contentFlowDesktop?.readWorkflowAtPath(configuredPath);
      if (!loaded?.workflow || !loaded.path || loaded.error) throw new Error(loaded?.error || `Không thể đọc workflow cần gọi: ${configuredPath}`);
      const document = loaded.workflow as WorkflowDocumentLike & { workflowId?: unknown; workflowInterface?: unknown };
      if (!Array.isArray(document.nodes) || !Array.isArray(document.edges) || typeof document.workflowId !== "string") throw new Error(`Workflow cần gọi “${workflowNameFromPath(configuredPath)}” không hợp lệ hoặc chưa được lưu bằng Tesseract.`);
      const recursiveAt = context.stack.indexOf(loaded.path);
      if (recursiveAt >= 0) {
        throw new Error(`Đệ quy vòng không an toàn: ${[...context.stack.slice(recursiveAt), loaded.path].join(" → ")}. Đã dừng để tránh chạy vô tận.`);
      }
      const expectedInterface = extended.data.calledWorkflow?.workflowInterface;
      const actualInterface = normalizeWorkflowInterfaceShape(document.workflowInterface);
      if (expectedInterface && JSON.stringify(expectedInterface) !== JSON.stringify(actualInterface)) {
        throw new Error(`Workflow “${workflowNameFromPath(configuredPath)}” đã đổi interface. Hãy chọn lại file tại node Gọi workflow để đồng bộ cổng.`);
      }
      context.calls += 1;
      context.stack.push(loaded.path);
      try {
        return await executeCalledWorkflow(document, inputs, runtimeFilesRef.current, {
          callWorkflow: (nestedNode, nestedInputs) => visit(nestedNode, nestedInputs),
        }, reportProgress);
      } finally {
        context.stack.pop();
      }
    };
    return visit(initialNode, initialInputs);
  }, [activeWorkflowTabId, edges, nodes, workflowId, workflowTabs]);

  const updatePersistedFiles = useCallback(async (field: ConfigField) => {
    if (!selectedNode || !selectedId) return;
    if (!window.contentFlowDesktop?.pickFiles) {
      setNotice("Chọn nguồn có lưu đường dẫn chỉ dùng được trong Content Flow Desktop.");
      return;
    }
    const result = await window.contentFlowDesktop.pickFiles({ accept: field.accept, multiple: field.multiple });
    if (result.canceled) return;
    if (result.error || !result.paths?.length) {
      setNotice(result.error || "Không có tệp nào được chọn.");
      return;
    }
    const paths = result.paths;
    if (nodeFamilyOf(selectedNode) === "Gọi workflow" && field.key === "workflowPath") {
      await syncCalledWorkflowReference(selectedNode.id, paths[0]);
      return;
    }
    const validationError = validateSelectedPaths(paths, field.fileValidation);
    setNodes((current) => current.map((node) => node.id === selectedId ? {
      ...node,
      data: {
        ...node.data,
        config: {
          ...node.data.config,
          [field.key]: paths.map(fileNameFromPath).join(", "),
          [`${field.key}Paths`]: JSON.stringify(paths),
          // Vùng cắt thuộc ảnh mẫu cũ; giữ nó khi đổi ảnh sẽ dễ khớp sai.
          ...(field.key === "templateImages" ? { exactRegions: "" } : {}),
        },
        validationError,
        status: "idle",
        beacon: "uncheck",
        output: undefined,
      },
    } : node));
    runtimeFilesRef.current.delete(`${selectedNode.id}:${field.key}`);
    try {
      const restored = await window.contentFlowDesktop.readFiles(paths);
      if (restored.error || !restored.files) throw new Error(restored.error || "Không thể nạp tệp đã chọn.");
      runtimeFilesRef.current.set(`${selectedNode.id}:${field.key}`, restored.files.map(desktopRuntimeFile));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể nạp tệp đã chọn.";
      setNotice(message);
    }
  }, [hydratePersistedFiles, selectedId, selectedNode, syncCalledWorkflowReference]);

  const openAttentionEditor = useCallback(async () => {
    if (!selectedNode || !["Lấy vùng chú ý", "Thiết lập vùng chú ý video", "Tìm ảnh tương đồng"].includes(nodeFamilyOf(selectedNode)) && selectedNode.data.basicPresetId !== "image-input-optimize") return;
    const incoming = edges.filter((edge) => edge.target === selectedNode.id && isAttentionMediaInput(selectedNode, edge.targetHandle));
    if (!incoming.length) {
      if (nodeFamilyOf(selectedNode) === "Tìm ảnh tương đồng") {
        const templateField = selectedNode.data.configFields.find((field) => field.key === "templateImages");
        try {
          if (templateField) await hydratePersistedFiles(selectedNode, templateField);
          const preview = (runtimeFilesRef.current.get(`${selectedNode.id}:templateImages`) ?? []).find((file) => file.type.startsWith("image/"));
          if (!preview) {
            setNotice("Hãy nối một ảnh vào cổng image-sample hoặc chọn ảnh mẫu trực tiếp trước khi cắt ảnh tìm kiếm.");
            return;
          }
          const localPreview = preview as File & { contentFlowPath?: string; contentFlowPathOnly?: boolean };
          setAttentionPreviewFile({
            file: preview,
            sourceUrl: localPreview.contentFlowPath && localPreview.contentFlowPathOnly
              ? `http://127.0.0.1:4317/preview-media?filePath=${encodeURIComponent(localPreview.contentFlowPath)}`
              : undefined,
          });
          setAttentionEditorOpen(true);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Không thể mở ảnh mẫu đã chọn.");
        }
        return;
      }
      setNotice("Hãy nối Image[] hoặc Video vào node trước khi mở trình chọn chính xác.");
      return;
    }
    if (incoming.length > 1) {
      setNotice(nodeFamilyOf(selectedNode) === "Tìm ảnh tương đồng" ? "Node tìm ảnh chỉ dùng một ảnh từ cổng image-sample để cắt mẫu." : "Node vùng chú ý chỉ dùng một nguồn tại một thời điểm. Hãy giữ lại Image[] hoặc Video.");
      return;
    }
    const connection = incoming[0];
    const source = nodes.find((node) => node.id === connection.source);
    const targetPort = selectedNode.data.inputs.find((port) => port.id === connection.targetHandle);
    if (!source || !targetPort) {
      setNotice("Không tìm thấy node nguồn của ảnh/video đã nối.");
      return;
    }
    const acceptsFile = (file: File) => targetPort.type === "Video" ? file.type.startsWith("video/") : file.type.startsWith("image/");
    const fileFromOutput = (value: unknown): File | undefined => {
      const visited = new Set<unknown>();
      const visit = (candidate: unknown): File | undefined => {
        if (!candidate || typeof candidate !== "object" || visited.has(candidate)) return undefined;
        visited.add(candidate);
        const record = candidate as { runtimeKey?: unknown; fileIndex?: unknown } & Record<string, unknown>;
        if (typeof record.runtimeKey === "string") {
          const files = runtimeFilesRef.current.get(record.runtimeKey) ?? [];
          const indexed = Number.isInteger(record.fileIndex) ? files[Number(record.fileIndex)] : files[0];
          if (indexed && acceptsFile(indexed)) return indexed;
        }
        for (const nested of Array.isArray(candidate) ? candidate : Object.values(record)) {
          const found = visit(nested);
          if (found) return found;
        }
        return undefined;
      };
      return visit(value);
    };
    try {
      const sourceOutput = (source.data.output as Record<string, unknown> | undefined)?.[connection.sourceHandle ?? ""];
      let preview = fileFromOutput(sourceOutput);
      if (!preview) {
        for (const field of source.data.configFields.filter((item) => item.type === "file" && item.persistPaths)) {
          await hydratePersistedFiles(source, field);
          preview = (runtimeFilesRef.current.get(`${source.id}:${field.key}`) ?? []).find(acceptsFile);
          if (preview) break;
        }
      }
      if (!preview) {
        setNotice("Không nạp được ảnh/video từ node nguồn. Hãy chọn file tại node nguồn, hoặc chạy node nguồn trước nếu nó tạo media.");
        return;
      }
      const localPathPreview = preview as File & { contentFlowPath?: string; contentFlowPathOnly?: boolean };
      setAttentionPreviewFile({
        file: preview,
        sourceUrl: localPathPreview.contentFlowPath && localPathPreview.contentFlowPathOnly
          ? `http://127.0.0.1:4317/preview-media?filePath=${encodeURIComponent(localPathPreview.contentFlowPath)}`
          : undefined,
      });
      setAttentionEditorOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể mở ảnh/video từ cổng vào.");
    }
  }, [edges, hydratePersistedFiles, nodes, selectedNode]);

  const updateNodeIdentity = (key: "label" | "description", value: string) => {
    if (!selectedId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedId
          ? { ...node, data: { ...node.data, [key]: value, status: "idle", beacon: "uncheck", output: undefined } }
          : node,
      ),
    );
  };

  const resetStoredFile = useCallback(() => {
    if (!selectedNode || !selectedId || !hasReusableStoredFiles(selectedNode)) return;
    rememberCanvasChange();
    runtimeFilesRef.current.delete(`${selectedId}:stored-files`);
    setNodes((current) => current.map((node) => node.id === selectedId ? {
      ...node,
      data: {
        ...node.data,
        storedFiles: undefined,
        storedArtifacts: undefined,
        artifacts: undefined,
        run: undefined,
        output: undefined,
        duration: undefined,
        progress: undefined,
        status: "idle",
        beacon: "uncheck",
      },
    } : node));
    setNotice("Đã Reset stored file. Liên kết đã ngắt; file trên máy không bị xóa và node sẵn sàng lưu lượt mới.");
  }, [rememberCanvasChange, selectedId, selectedNode, setNodes]);

  const copyNodeOutput = useCallback(async () => {
    if (!selectedOutputText) {
      setNotice("Node này chưa có output để sao chép.");
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API không khả dụng");
      await navigator.clipboard.writeText(selectedOutputText);
      setNotice("Đã sao chép output vào clipboard.");
    } catch {
      // Electron/HTTP có thể không cấp Clipboard API. Fallback này vẫn cho phép
      // người dùng copy bằng nút thay vì phải chụp màn hình.
      const textarea = document.createElement("textarea");
      textarea.value = selectedOutputText;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      setNotice(copied ? "Đã sao chép output vào clipboard." : "Không thể sao chép tự động. Bạn vẫn có thể bôi đen nội dung Output và nhấn Ctrl+C.");
    }
  }, [selectedOutputText]);

  const checkWorkflow = useCallback((): WorkflowCheckIssue[] => {
    // Kiểm tra là thao tác độc lập: lỗi dữ liệu của một workflow cũ không được
    // phép làm nút “Kiểm tra” im lặng hoặc chặn toàn bộ giao diện.
    try {
      const inspection = inspectWorkflow(nodes, edges);
      const { issues, beacons } = inspection;
      setWorkflowCheck(issues);
      setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, beacon: beacons.get(node.id) ?? "ready" } })));
      const misses = new Set(issues.filter((issue) => issue.beacon === "miss").map((issue) => issue.nodeId)).size;
      const errors = new Set(issues.filter((issue) => issue.beacon === "error").map((issue) => issue.nodeId)).size;
      const summaryParts = [
        errors ? `${errors} node lỗi` : "",
        misses ? `${misses} node thiếu` : "",
      ].filter(Boolean);
      const message = summaryParts.length
        ? `Đã kiểm tra ${nodes.length} node: ${summaryParts.join(" và ")}.`
        : `Đã kiểm tra ${nodes.length} node: Tất cả sẵn sàng.`;
      const beacon: WorkflowCheckSummary["beacon"] = errors ? "error" : misses ? "miss" : "ready";
      setWorkflowCheckSummary({ message, beacon });
      setNotice(message);
      if (issues.length) setSelectedId(issues[0].nodeId);
      return issues;
    } catch (error) {
      const detail = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "dữ liệu workflow không hợp lệ";
      const message = `Không thể kiểm tra workflow: ${detail}.`;
      console.error("Không thể kiểm tra workflow", error);
      setWorkflowCheck([]);
      setWorkflowCheckSummary({ message, beacon: "error" });
      setNotice(message);
      return [{ nodeId: selectedId ?? nodes[0]?.id ?? "workflow", beacon: "error", message }];
    }
  }, [edges, nodes, selectedId, setNodes]);

  const checkWorkflowRecursion = useCallback(async (): Promise<WorkflowCheckIssue[]> => {
    type RecursionDocument = WorkflowDocumentLike & { workflowId: string; workflowInterface?: unknown; name?: string; filePath?: string | null };
    type RecursionTarget = { key: string; label: string; document: RecursionDocument };
    const currentDocument: RecursionDocument = {
      workflowId,
      workflowInterface: workflowInterfaceFromNodes(nodes),
      name: workflowName,
      filePath: workflowPath,
      nodes,
      edges,
    };
    const openDocuments = new Map<string, RecursionDocument>(workflowTabs.map((tab) => [tab.id, {
      workflowId: tab.workflowId,
      workflowInterface: tab.workflowInterface,
      name: tab.name,
      filePath: tab.filePath,
      nodes: tab.nodes,
      edges: tab.edges,
    }]));
    openDocuments.set(activeWorkflowTabId, currentDocument);
    const issues: WorkflowCheckIssue[] = [];
    const resolveTarget = async (callNode: WorkflowDocumentLike["nodes"][number]): Promise<RecursionTarget | null> => {
      const raw = callNode as typeof callNode & { data: { calledWorkflow?: CalledWorkflowReference; config?: Record<string, FieldValue> } };
      const reference = raw.data.calledWorkflow;
      const configuredPath = reference?.path ?? filePathsFromConfig(raw.data.config?.workflowPathPaths)[0];
      const openTabId = reference?.source === "open-tab"
        ? reference.tabId ?? String(raw.data.config?.openWorkflowTabId ?? "")
        : configuredPath?.startsWith("open-tab://") ? configuredPath.slice("open-tab://".length) : "";
      if (openTabId) {
        const target = openDocuments.get(openTabId);
        if (!target) throw new Error("Tab workflow được gọi đã đóng hoặc không còn tồn tại.");
        return { key: target.workflowId, label: target.name || "Workflow đang mở", document: target };
      }
      if (reference?.source === "current" || configuredPath === `current://${workflowId}`) {
        return { key: currentDocument.workflowId, label: currentDocument.name || "Workflow hiện tại", document: currentDocument };
      }
      if (!configuredPath) throw new Error("chưa chọn workflow cần gọi.");
      if (reference?.embeddedWorkflow) {
        const document = reference.embeddedWorkflow as RecursionDocument;
        if (!Array.isArray(document.nodes) || !Array.isArray(document.edges) || !document.workflowId) throw new Error(`workflow “${workflowNameFromPath(configuredPath)}” không hợp lệ hoặc chưa được lưu bằng Tesseract.`);
        return { key: document.workflowId, label: workflowNameFromPath(configuredPath), document };
      }
      const loaded = await window.contentFlowDesktop?.readWorkflowAtPath(configuredPath);
      if (!loaded?.workflow || loaded.error) throw new Error(loaded?.error || `không thể đọc “${configuredPath}”.`);
      const document = loaded.workflow as RecursionDocument;
      if (!Array.isArray(document.nodes) || !Array.isArray(document.edges) || !document.workflowId) throw new Error(`workflow “${workflowNameFromPath(configuredPath)}” không hợp lệ hoặc chưa được lưu bằng Tesseract.`);
      return { key: document.workflowId, label: workflowNameFromPath(loaded.path ?? configuredPath), document: { ...document, filePath: loaded.path ?? configuredPath } };
    };
    const root: RecursionTarget = { key: currentDocument.workflowId, label: currentDocument.name || "Workflow hiện tại", document: currentDocument };
    try {
      const cycles = await findWorkflowReferenceCycles(root, {
        getKey: (target) => target.key,
        getLabel: (target) => target.label,
        getCalls: (target) => target.document.nodes.filter((node) => nodeFamilyOf(node as ContentFlowNode) === "Gọi workflow" && !node.data.paused),
        resolveTarget,
      });
      for (const cycle of cycles) {
        const callNode = cycle.originCall;
        issues.push({
          nodeId: callNode.id,
          beacon: "error",
          message: `Đệ quy vòng không an toàn: ${cycle.chain.join(" → ")}. Hãy ngắt một node Gọi workflow hoặc bổ sung điều kiện dừng trước khi chạy.`,
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "không thể đọc workflow được gọi.";
      issues.push({ nodeId: root.document.nodes.find((node) => nodeFamilyOf(node as ContentFlowNode) === "Gọi workflow")?.id ?? "workflow", beacon: "error", message: `Không thể kiểm tra đệ quy: ${detail}` });
    }
    if (!issues.length) return [];
    const issueNodes = new Set(issues.map((issue) => issue.nodeId));
    setWorkflowCheck((current) => [...current.filter((issue) => !issue.message.startsWith("Đệ quy vòng") && !issue.message.startsWith("Không thể kiểm tra đệ quy")), ...issues]);
    setNodes((current) => current.map((node) => issueNodes.has(node.id)
      ? { ...node, data: { ...node.data, beacon: "error" } }
      : node));
    setWorkflowCheckSummary({ message: `Không thể chạy workflow: phát hiện ${issues.length} vòng/đích gọi không an toàn.`, beacon: "error" });
    setNotice(issues[0].message);
    if (issues[0]?.nodeId) setSelectedId(issues[0].nodeId);
    return issues;
  }, [activeWorkflowTabId, edges, nodes, workflowId, workflowName, workflowPath, workflowTabs]);

  const checkWorkflowWithRecursion = useCallback(async (): Promise<WorkflowCheckIssue[]> => {
    const basicIssues = checkWorkflow();
    if (basicIssues.length) return basicIssues;
    const recursionIssues = await checkWorkflowRecursion();
    if (!recursionIssues.length) setNotice(`Đã kiểm tra ${nodes.length} node: Tất cả sẵn sàng, không có vòng gọi workflow.`);
    return recursionIssues;
  }, [checkWorkflow, checkWorkflowRecursion, nodes.length]);
  // Phím tắt được đăng ký trước khi hàm kiểm tra được khởi tạo; ref luôn trỏ
  // tới dữ liệu canvas hiện tại, không giữ closure cũ sau khi workflow đổi.
  checkWorkflowRef.current = () => { void checkWorkflowWithRecursion(); };

  const runWorkflow = async () => {
    if (runState !== "idle") return;
    if ((await checkWorkflowWithRecursion()).length) return;
    resetAiTokenUsage();
    const localMediaRunId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    beginLocalMediaWorkflowRun(localMediaRunId);
    const control = { paused: false, stopped: false, resume: undefined as (() => void) | undefined };
    runControlRef.current = control;
    setRunState("running");
    setNotice("Đang kiểm tra và chạy workflow...");
    setNodes((current) => current.map((node) => ({
      ...node,
      data: node.data.paused
        ? { ...node.data, status: "idle", beacon: "paused", progress: undefined }
        : {
          ...node.data,
          status: "queued",
          output: undefined,
          artifacts: undefined,
          progress: { message: "Đang chờ các node đầu vào hoàn tất.", detail: "Node sẽ tự chạy khi đủ dữ liệu." },
          run: startNodeRun({
            runId: workflowRunId,
            nodeId: node.id,
            status: "queued",
            progress: { message: "Đang chờ các node đầu vào hoàn tất.", detail: "Node sẽ tự chạy khi đủ dữ liệu." },
          }),
        },
    })));

    const workingNodes = nodes.map((node) => ({ ...node, data: { ...node.data } }));
    const pausedNodes = new Set(workingNodes.filter((node) => node.data.paused).map((node) => node.id));
    const remaining = new Set(workingNodes.filter((node) => !node.data.paused).map((node) => node.id));
    const completed = new Set<string>();
    const outputs = new Map<string, Record<string, unknown>>();
    // Bản runtime của output dùng Artifact để giữ type, provenance và trạng
    // thái. Executor cũ vẫn nhận payload thô qua unwrapArtifact trong giai
    // đoạn chuyển đổi, nên workflow .tess cũ không bị hỏng.
    const artifactOutputs = new Map<string, ArtifactOutputMap>();
    let failed = false;

    // Lệnh workflow cũng được chuyển đến media service: FFmpeg bị treo/tiếp tục
    // ở cấp tiến trình và Dừng sẽ hủy cưỡng bức cây tiến trình của nó.
    const waitForRunPermission = async () => {
      if (control.stopped) return false;
      if (!control.paused) return true;
      await new Promise<void>((resolve) => { control.resume = resolve; });
      control.resume = undefined;
      return !control.stopped;
    };

    while (remaining.size > 0 && !failed && !control.stopped) {
      if (!(await waitForRunPermission())) break;
      const ready = workingNodes.filter((node) => {
        if (!remaining.has(node.id)) return false;
        // Lưu file có Stored file chỉ là node nguồn khi không nhận dữ liệu mới.
        // Khi có cổng dữ liệu nối vào, phải đợi nguồn hoàn tất để lưu và cộng
        // dồn những file mới vào Stored file hiện có.
        const reusesStoredFilesOnly = hasReusableStoredFiles(node) && !hasNewFileStorageInput(node, edges);
        const requiredEdges = reusesStoredFilesOnly ? [] : edges.filter((edge) => edge.target === node.id);
        return requiredEdges.every((edge) => completed.has(edge.source) || pausedNodes.has(edge.source));
      }).sort((left, right) => {
        // Viewer là node quan sát không làm thay đổi dữ liệu. Ưu tiên nó trước
        // nhánh xử lý tốn kém để người dùng vẫn thấy audio/frame/transcript
        // nguồn nếu một nhánh AI chạy song song gặp lỗi.
        const leftViewer = nodeFamilyOf(left) === "Xem dữ liệu trên canvas" ? 1 : 0;
        const rightViewer = nodeFamilyOf(right) === "Xem dữ liệu trên canvas" ? 1 : 0;
        return rightViewer - leftViewer;
      });

      if (ready.length === 0) {
        failed = true;
          setNodes((current) => current.map((item) => remaining.has(item.id)
            ? { ...item, data: { ...item.data, status: "error", beacon: "error" } }
            : item));
        setNotice("Workflow có vòng lặp hoặc phụ thuộc không hợp lệ.");
        break;
      }

      for (const node of ready) {
        if (!(await waitForRunPermission())) break;
        const reusesStoredFilesOnly = hasReusableStoredFiles(node) && !hasNewFileStorageInput(node, edges);
        const missing = reusesStoredFilesOnly ? [] : node.data.inputs.filter(
          (port) => port.required && !edges.some((edge) => edge.target === node.id && edge.targetHandle === port.id),
        );
        if (missing.length > 0) {
          setNodes((current) => current.map((item) => item.id === node.id ? { ...item, data: { ...item.data, status: "error", beacon: "miss" } } : item));
          setNotice(`Node “${node.data.label}” thiếu đầu vào bắt buộc: ${missing.map((port) => port.label).join(", ")}.`);
          failed = true;
          break;
        }

        setNodes((current) => current.map((item) => item.id === node.id ? {
          ...item,
          data: {
            ...item.data,
            status: "running",
            beacon: "running",
            progress: { message: `Đang chuẩn bị ${item.data.family ?? item.data.label}.`, detail: "Đang nhận dữ liệu đầu vào và khởi tạo xử lý trên máy." },
          },
        } : item));
        const start = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 260));
        if (!(await waitForRunPermission())) break;

        const nodeInputs: Record<string, unknown> = {};
        const inputSources: Record<string, { outputName: string }> = {};
        const nodeInputArtifacts: Artifact[] = [];
        edges.filter((edge) => edge.target === node.id).forEach((edge) => {
          const sourceOutput = outputs.get(edge.source);
          if (edge.targetHandle && edge.sourceHandle && sourceOutput) {
            const transportedArtifact = artifactOutputs.get(edge.source)?.[edge.sourceHandle];
            const transportedValue = transportedArtifact
              ? unwrapArtifact(transportedArtifact)
              : sourceOutput[edge.sourceHandle];
            const targetPort = node.data.inputs.find((port) => port.id === edge.targetHandle);
            if (targetPort && portSpecFor(targetPort).cardinality === "many") {
              const current = Array.isArray(nodeInputs[edge.targetHandle]) ? nodeInputs[edge.targetHandle] as unknown[] : [];
              const values = transportedArtifact?.cardinality === "many" && Array.isArray(transportedValue)
                ? transportedValue
                : [transportedValue];
              nodeInputs[edge.targetHandle] = [...current, ...values];
            } else {
              nodeInputs[edge.targetHandle] = transportedValue;
            }
            if (transportedArtifact) nodeInputArtifacts.push(transportedArtifact);
            const sourcePort = workingNodes.find((item) => item.id === edge.source)?.data.outputs.find((port) => port.id === edge.sourceHandle);
            const outputName = String(sourcePort?.label ?? sourcePort?.type ?? "").trim().replace(/\[\]$/, "");
            if (outputName) inputSources[edge.targetHandle] = { outputName };
          }
        });
        if (Object.keys(inputSources).length) nodeInputs.__contentFlowInputSources = inputSources;

        try {
          setNodes((current) => current.map((item) => item.id === node.id && item.data.status === "running"
            ? {
              ...item,
              data: {
                ...item.data,
                run: startNodeRun({
                  runId: workflowRunId,
                  nodeId: item.id,
                  status: "running",
                  inputs: nodeInputArtifacts.map(artifactSummary),
                  progress: item.data.progress,
                }),
              },
            }
            : item));
          if (hasReusableStoredFiles(node)) await hydrateStoredFiles(node);
          if (nodeFamilyOf(node) !== "Gọi workflow") {
            for (const field of node.data.configFields.filter((field) => field.persistPaths)) {
              await hydratePersistedFiles(node, field);
            }
          }
          const output = nodeFamilyOf(node) === "Gọi workflow"
            ? await executeWorkflowCallNode(node, nodeInputs, (progress) => {
              setNodes((current) => current.map((item) => item.id === node.id && item.data.status === "running"
                ? { ...item, data: { ...item.data, progress } }
                : item));
            })
            : await executeWorkflowNode(node, nodeInputs, runtimeFilesRef.current, (progress) => {
            setNodes((current) => current.map((item) => item.id === node.id && item.data.status === "running"
              ? { ...item, data: { ...item.data, progress } }
              : item));
          });
          outputs.set(node.id, output);
          const outputArtifacts = artifactOutputsForPorts(output, node.data.outputs, {
            workflowId,
            nodeId: node.id,
            runId: workflowRunId,
          });
          artifactOutputs.set(node.id, outputArtifacts);
          completed.add(node.id);
          remaining.delete(node.id);
          const duration = Math.round(performance.now() - start);
          setNodes((current) => current.map((item) => {
            if (item.id !== node.id) return item;
            const storedFiles = isFileStorageNode(item) ? storedFileReferencesFromOutput(output) : [];
            const storedArtifacts = isFileStorageNode(item) ? Object.values(outputArtifacts).map(artifactSummary) : [];
            return {
              ...item,
              data: {
                ...item.data,
                ...(storedFiles.length ? { storedFiles } : {}),
                ...(storedArtifacts.length ? { storedArtifacts } : {}),
                status: "success",
                beacon: "ready",
                output,
                artifacts: Object.values(outputArtifacts).map(artifactSummary),
                run: finishNodeRun(item.data.run, "success", { outputs: Object.values(outputArtifacts).map(artifactSummary) }),
                duration,
                progress: undefined,
              },
            };
          }));
        } catch (error) {
          if (control.stopped) break;
          const message = error instanceof Error ? error.message : "Lỗi thực thi không xác định";
          const diagnostic = error && typeof error === "object" ? (error as { executionDiagnostic?: unknown }).executionDiagnostic : undefined;
          const runDiagnostic = executionDiagnostic(error);
          setNodes((current) => current.map((item) => item.id === node.id ? {
            ...item,
            data: {
              ...item.data,
              status: "error",
              beacon: "error",
              output: { error: message, ...(diagnostic ? { diagnostic } : {}), runDiagnostic },
              run: finishNodeRun(item.data.run, "failed", { diagnostic: runDiagnostic }),
              progress: undefined,
            },
          } : item));
          setNotice(`Node “${node.data.label}” gặp lỗi: ${message}`);
          failed = true;
          break;
        }
      }
    }

    if (control.stopped) {
      setNodes((current) => current.map((node) => node.data.status === "running" || node.data.status === "queued"
        ? { ...node, data: { ...node.data, status: "idle", beacon: node.data.paused ? "paused" : "uncheck", run: finishNodeRun(node.data.run, "cancelled"), progress: undefined } }
        : node));
      setNotice(`Đã dừng workflow. Hoàn tất ${completed.size} node trước khi dừng.`);
    } else if (!failed) {
      setNotice(`Đã chạy thành công ${completed.size} node${pausedNodes.size ? `; bỏ qua ${pausedNodes.size} node tạm ngưng` : ""}. Chọn một node để xem output.`);
    }
    if (runControlRef.current === control) runControlRef.current = { paused: false, stopped: false };
    endLocalMediaWorkflowRun(localMediaRunId);
    setRunState("idle");
  };
  const toggleWorkflowRun = () => {
    if (runState === "idle") { void runWorkflow(); return; }
    const control = runControlRef.current;
    if (runState === "paused") {
      control.paused = false;
      control.resume?.();
      void controlLocalMediaWorkflow("resume");
      setRunState("running");
      setNotice("Tiếp tục workflow và các bộ xử lý cục bộ.");
    } else {
      control.paused = true;
      void controlLocalMediaWorkflow("pause");
      setRunState("paused");
      setNotice("Workflow và bộ xử lý cục bộ đã tạm dừng. Nhấn Ctrl+R để tiếp tục hoặc Ctrl+T để dừng hẳn.");
    }
  };
  const stopWorkflow = () => {
    if (runState === "idle") return;
    const control = runControlRef.current;
    control.stopped = true;
    control.paused = false;
    control.resume?.();
    setRunState("running");
    void controlLocalMediaWorkflow("stop");
    setNotice("Đang dừng cưỡng bức workflow và bộ xử lý cục bộ...");
  };
  toggleWorkflowRunRef.current = toggleWorkflowRun;
  stopWorkflowRef.current = stopWorkflow;

  const resizePanel = (side: "left" | "right", startX: number) => {
    const maximum = side === "left" ? 242 : 340;
    const minimum = Math.round(maximum / 5);
    const startWidth = side === "left" ? leftPanelWidth : rightPanelWidth;
    const onMove = (event: MouseEvent) => {
      const delta = side === "left" ? event.clientX - startX : startX - event.clientX;
      const next = Math.max(minimum, Math.min(maximum, startWidth + delta));
      if (side === "left") setLeftPanelWidth(next);
      else setRightPanelWidth(next);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const resizeOutliner = (startY: number) => {
    const startHeight = outlinerHeight;
    const onMove = (event: MouseEvent) => {
      const maximum = Math.max(180, window.innerHeight - 190);
      setOutlinerHeight(Math.max(120, Math.min(maximum, startHeight + event.clientY - startY)));
    };
    const onUp = () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    document.body.style.cursor = "row-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    rememberCanvasChange();
    for (const key of runtimeFilesRef.current.keys()) {
      if (key.startsWith(`${selectedId}:`)) runtimeFilesRef.current.delete(key);
    }
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) => current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId));
    setSelectedId(null);
    setConfirmAction(null);
    setNotice("Đã xóa node và các kết nối liên quan.");
  };

  const resetWorkflow = () => {
    rememberCanvasChange();
    setWorkflowName("New workflow");
    setWorkflowPath(null);
    setWorkflowId(createWorkflowId());
    setWorkflowInterface(undefined);
    runtimeFilesRef.current.clear();
    setNodes(initialNodes);
    setEdges(initialEdges);
    setWorkflowGroups([]);
    setSelectedId(null);
    setCanvasClosed(false);
    localStorage.removeItem("content-flow-workspace-v5");
    setConfirmAction(null);
    setNotice("Đã xóa toàn bộ node khỏi canvas.");
    setTimeout(() => fitView({ padding: 0.15, duration: 500 }), 50);
  };

  const exportWorkflow = () => {
    const name = workflowName.trim() || "New workflow";
    const safeFileName = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").trim() || "New workflow";
    setWorkflowName(name);
    const workflow = prepareWorkflowForSave({ version: 6, name, workflowId, workflowInterface: workflowInterfaceFromNodes(nodes), nodes, edges, groups: workflowGroups });
    setWorkflowId(workflow.workflowId);
    setWorkflowInterface(workflow.workflowInterface);
    const blob = new Blob([serializeTessWorkflow(workflow)], { type: "application/x-tesseract-workflow" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName}.tess`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Đã xuất workflow thành tệp Tesseract (.tess).");
  };

  const importWorkflow = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadWorkflowData(parseWorkflowDocument(String(reader.result)), workflowNameFromPath(file.name), null);
      } catch {
        setNotice("Tệp workflow không hợp lệ.");
      }
    };
    reader.readAsText(file);
  };

  const visibleDefinitions = NODE_LIBRARY[libraryMode];
  const pendingPort = useMemo(() => {
    if (!pendingConnection) return undefined;
    const node = nodes.find((item) => item.id === pendingConnection.nodeId);
    const ports = pendingConnection.handleType === "source" ? node?.data.outputs : node?.data.inputs;
    return ports?.find((port) => port.id === pendingConnection.handleId);
  }, [nodes, pendingConnection]);
  const activePortFilter = useMemo<PortFilter | null>(() => (
    pendingConnection && pendingPort
      ? { type: pendingPort.type, connectSize: pendingPort.connectSize, handleType: pendingConnection.handleType }
      : manualPortFilter
  ), [manualPortFilter, pendingConnection, pendingPort]);
  const compatibleDefinitions = useMemo(() => {
    if (!activePortFilter) return visibleDefinitions;
    return visibleDefinitions.filter((definition) => (
      activePortFilter.handleType === "source"
        ? definition.inputs.some((port) => portsCanConnect(withPortDataContract({ id: "filter", label: "filter", ...activePortFilter }), port))
        : definition.outputs.some((port) => portsCanConnect(port, withPortDataContract({ id: "filter", label: "filter", ...activePortFilter })))
    ));
  }, [activePortFilter, visibleDefinitions]);
  const searchableDefinitions = useMemo(() => compatibleDefinitions.filter((item) => (
    `${item.label} ${item.description} ${item.basicNodeLabels?.join(" ") ?? ""}`.toLowerCase().includes(search.toLowerCase())
  )), [compatibleDefinitions, search]);
  const categoryForDefinition = useCallback((definition: NodeDefinition) => definition.category, []);
  const libraryCategories = useMemo(() => {
    const available = new Set(searchableDefinitions.map(categoryForDefinition));
    return CATEGORY_ORDER.filter((category) => available.has(category));
  }, [categoryForDefinition, searchableDefinitions]);
  const activeDefinitions = useMemo(() => {
    if (search) return searchableDefinitions;
    return searchableDefinitions.filter((definition) => categoryForDefinition(definition) === activeLibraryCategory);
  }, [activeLibraryCategory, categoryForDefinition, search, searchableDefinitions]);
  useEffect(() => {
    if (!activePortFilter || !libraryCategories.length || libraryCategories.includes(activeLibraryCategory)) return;
    setActiveLibraryCategory(libraryCategories[0]);
  }, [activeLibraryCategory, activePortFilter, libraryCategories]);
  const quickAddCategories = useMemo(() => {
    const available = new Set(compatibleDefinitions.map(categoryForDefinition));
    return CATEGORY_ORDER.filter((category) => available.has(category));
  }, [categoryForDefinition, compatibleDefinitions]);
  const quickAddDefinitions = useMemo(() => compatibleDefinitions.filter((item) => {
    const matchedSearch = `${item.label} ${item.description} ${item.basicNodeLabels?.join(" ") ?? ""}`.toLowerCase().includes(quickAddSearch.toLowerCase());
    if (!matchedSearch) return false;
    if (quickAddSearch) return true;
    return categoryForDefinition(item) === quickAddCategory;
  }), [categoryForDefinition, compatibleDefinitions, quickAddCategory, quickAddSearch]);
  const quickAddPreview = useMemo(() => {
    const preferred = compatibleDefinitions.find((item) => item.kind === quickAddPreviewKind);
    return preferred ?? quickAddDefinitions[0] ?? compatibleDefinitions[0] ?? null;
  }, [compatibleDefinitions, quickAddDefinitions, quickAddPreviewKind]);
  const workspaceStyle = {
    "--left-panel-width": `${leftPanelCollapsed ? 0 : leftPanelWidth}px`,
    "--right-panel-width": `${rightPanelCollapsed ? 0 : rightPanelWidth}px`,
  } as CSSProperties;

  return (
    <PortFilterContext.Provider value={applyPortFilter}>
    <main className="app-shell">
      <header className="studio-header">
        <div className="app-menubar">
          <img className="brand-mark" src="/tesseract-icon.svg" alt="" aria-hidden="true" />
          <strong className="app-name">Tesseract</strong>
          <nav className="app-menu" aria-label="Menu ứng dụng">
            <div className="menu-group">
              <button aria-expanded={openMenu === "file"} onClick={() => setOpenMenu((current) => current === "file" ? null : "file")}>Tệp</button>
              {openMenu === "file" && <div className="menu-popover" role="menu">
                <button onClick={() => { setOpenMenu(null); createNewWorkflowTab(); }}><span>Workflow mới</span><kbd>Ctrl+N</kbd></button>
                <button onClick={showOpenWorkflowDialog}><span>Mở workflow</span><kbd>Ctrl+O</kbd></button>
                <button disabled={canvasClosed} onClick={() => { setOpenMenu(null); exportWorkflow(); }}><span>Xuất workflow</span></button>
                <i />
                <button disabled={canvasClosed} onClick={() => { setOpenMenu(null); void saveWorkflow(); }}><span>Lưu workflow</span><kbd>Ctrl+S</kbd></button>
                <button disabled={canvasClosed} onClick={() => { setOpenMenu(null); void saveWorkflow(true); }}><span>Lưu mới</span><kbd>Ctrl+Shift+S</kbd></button>
              </div>}
            </div>
            <div className="menu-group">
              <button aria-expanded={openMenu === "edit"} onClick={() => setOpenMenu((current) => current === "edit" ? null : "edit")}>Chỉnh sửa</button>
              {openMenu === "edit" && <div className="menu-popover" role="menu">
                <button disabled={canvasClosed || !selectedNode} onClick={() => { setOpenMenu(null); copyCanvasSelection(); }}><span>Sao chép node/lane đã chọn</span><kbd>Ctrl+C</kbd></button>
                <button disabled={canvasClosed || !canvasClipboardRef.current} onClick={() => { setOpenMenu(null); pasteCanvasSelection(); }}><span>Dán node/lane</span><kbd>Ctrl+V</kbd></button>
                <button disabled={canvasClosed || !selectedNodeIds.length} onClick={() => { setOpenMenu(null); createWorkflowGroup(); }}><span>Nhóm các node đã chọn</span><kbd>Ctrl+G</kbd></button>
                <button disabled={canvasClosed || !selectedNodeIds.length} onClick={() => { setOpenMenu(null); ungroupSelectedNodes(); }}><span>Tách nhóm node đã chọn</span><kbd>Ctrl+Shift+G</kbd></button>
                <button disabled={canvasClosed || !selectedNode} onClick={() => { setOpenMenu(null); setConfirmAction("delete"); }}><span>Xóa node đã chọn</span><kbd>Delete</kbd></button>
                <button disabled={canvasClosed} onClick={() => { setOpenMenu(null); openQuickAdd(); }}><span>Thêm node</span><kbd>Space</kbd></button>
                <i />
                <button disabled={canvasClosed} onClick={() => { setOpenMenu(null); setConfirmAction("reset"); }}><span>Xóa canvas</span></button>
              </div>}
            </div>
            <div className="menu-group">
              <button aria-expanded={openMenu === "workflow"} onClick={() => setOpenMenu((current) => current === "workflow" ? null : "workflow")}>Workflow</button>
              {openMenu === "workflow" && <div className="menu-popover" role="menu">
                <button disabled={canvasClosed} onClick={() => { setOpenMenu(null); void checkWorkflowWithRecursion(); }}><span>Kiểm tra workflow</span><kbd>Ctrl+E</kbd></button>
                <button disabled={canvasClosed} onClick={() => { setOpenMenu(null); toggleWorkflowRun(); }}><span>{runState === "idle" ? "Chạy workflow" : runState === "paused" ? "Tiếp tục workflow" : "Tạm dừng workflow"}</span><kbd>Ctrl+R</kbd></button>
                <button onClick={() => { setOpenMenu(null); stopWorkflow(); }} disabled={canvasClosed || !running}><span>Dừng workflow</span><kbd>Ctrl+T</kbd></button>
                <button disabled={canvasClosed} onClick={() => { setOpenMenu(null); toggleSelectedNodePause(); }}><span>Tạm ngưng/bật node đã chọn</span><kbd>Ctrl+P</kbd></button>
                <button disabled={canvasClosed} onClick={() => { setOpenMenu(null); void saveWorkflow(); }}><span>Lưu trước khi chạy</span></button>
                <i />
                <button onClick={showLocalAiManager}><span>Quản lý AI</span></button>
                <button onClick={showLocalProcessors}><span>Điều chỉnh xử lý cục bộ</span></button>
              </div>}
            </div>
            <div className="menu-group">
              <button aria-expanded={openMenu === "view"} onClick={() => setOpenMenu((current) => current === "view" ? null : "view")}>Xem</button>
              {openMenu === "view" && <div className="menu-popover" role="menu">
                <button disabled={canvasClosed} onClick={() => { setOpenMenu(null); fitView({ padding: 0.15, duration: 350 }); }}><span>Vừa màn hình</span><kbd>F</kbd></button>
                <button disabled={canvasClosed} onClick={() => { setOpenMenu(null); setLeftPanelCollapsed((value) => !value); }}><span>{leftPanelCollapsed ? "Hiện thư viện node" : "Ẩn thư viện node"}</span></button>
                <button disabled={canvasClosed} onClick={() => { setOpenMenu(null); setRightPanelCollapsed((value) => !value); }}><span>{rightPanelCollapsed ? "Hiện Properties" : "Ẩn Properties"}</span></button>
                <button disabled={canvasClosed} onClick={() => { setOpenMenu(null); closeWorkflow(); }}><span>Đóng workflow</span><kbd>Ctrl+Shift+W</kbd></button>
              </div>}
            </div>
            <div className="menu-group">
              <button aria-expanded={openMenu === "help"} onClick={() => setOpenMenu((current) => current === "help" ? null : "help")}>Trợ giúp</button>
              {openMenu === "help" && <div className="menu-popover shortcuts-menu" role="menu">
                <span><kbd>Space</kbd> Tìm và thêm node</span><span><kbd>F</kbd> Vừa màn hình</span><span><kbd>Ctrl+S</kbd> Lưu workflow</span><span><kbd>Ctrl+Shift+S</kbd> Lưu mới</span><span><kbd>Ctrl+Shift+W</kbd> Đóng workflow</span><span><kbd>Ctrl+C</kbd> Sao chép node/lane</span><span><kbd>Ctrl+V</kbd> Dán node/lane</span><span><kbd>Ctrl+G</kbd> Nhóm node đã chọn</span><span><kbd>Ctrl+Shift+G</kbd> Tách nhóm node</span><span><kbd>Ctrl+Z</kbd> Hoàn tác</span><span><kbd>Ctrl+Shift+Z</kbd> Phục hồi</span><span><kbd>Ctrl+E</kbd> Kiểm tra workflow</span><span><kbd>Ctrl+R</kbd> Chạy / tạm dừng / tiếp tục</span><span><kbd>Ctrl+T</kbd> Dừng workflow</span><span><kbd>Delete</kbd> Xóa node đang chọn</span>
              </div>}
            </div>
          </nav>
          {!canvasClosed && <>
          <div className="workflow-title">
            <span className="live-dot" />
            <input
              aria-label="Tên workflow"
              value={workflowName}
              size={Math.max(12, Math.min(36, workflowName.length + 1))}
              onChange={(event) => setWorkflowName(event.target.value)}
              onBlur={() => setWorkflowName((current) => current.trim() || "New workflow")}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </div>
          <div className="top-actions">
            <button className="menu-action" title="Workflow mới trong tab riêng (Ctrl+N)" onClick={createNewWorkflowTab}>Mới</button>
            <button className="menu-action" title="Mở workflow (Ctrl+O)" onClick={showOpenWorkflowDialog}>Mở</button>
            <input ref={importRef} type="file" accept=".tess,application/json,.json" hidden onChange={(event) => { importWorkflow(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            <button className="menu-action" onClick={exportWorkflow}>Xuất</button>
            <button className="menu-action" title="Lưu workflow (Ctrl+S)" onClick={() => { void saveWorkflow(); }}>Lưu</button>
            <button className="menu-action" title="Lưu mới (Ctrl+Shift+S)" onClick={() => { void saveWorkflow(true); }}>Lưu mới</button>
            <button className="menu-action" title="Kiểm tra node trước khi chạy (Ctrl+E)" onClick={() => { void checkWorkflowWithRecursion(); }}>Kiểm tra</button>
            <button className="run-action" title={runState === "idle" ? "Chạy workflow (Ctrl+R)" : runState === "paused" ? "Tiếp tục workflow (Ctrl+R)" : "Tạm dừng workflow (Ctrl+R)"} onClick={toggleWorkflowRun}>
              <span>{runState === "running" ? "Ⅱ" : "▶"}</span>
              {runState === "idle" ? "Chạy" : runState === "paused" ? "Tiếp tục" : "Tạm dừng"}
            </button>
            <button className="stop-run-action" title="Dừng workflow (Ctrl+T)" onClick={stopWorkflow} disabled={!running}><span>■</span>Dừng</button>
          </div>
          </>}
        </div>
      </header>

      {!canvasClosed && <nav className="workflow-tabs" aria-label="Các workflow đang mở">
        {workflowTabs.map((tab) => {
          const tabDirty = tab.id === activeWorkflowTabId
            ? activeWorkflowDirty
            : workflowTabContentKey(tab) !== tab.savedContentKey;
          return (
            <div key={tab.id} className={`workflow-tab ${tab.id === activeWorkflowTabId ? "active" : ""}`}>
              <button type="button" className="workflow-tab-select" onClick={() => switchWorkflowTab(tab.id)} title={tab.filePath ?? "Workflow chưa lưu"}>
                <span>{tabDirty ? "●" : ""}</span>{tab.name || "New workflow"}
              </button>
              <button type="button" className="workflow-tab-close" aria-label={`Đóng workflow ${tab.name}`} title="Đóng workflow" onClick={(event) => { event.stopPropagation(); closeWorkflowTab(tab.id); }}>×</button>
            </div>
          );
        })}
        <button type="button" className="workflow-tab-new" title="Mở workflow mới trong tab khác" onClick={createNewWorkflowTab}>＋</button>
      </nav>}

      {canvasClosed ? (
        <section className="canvas-closed-screen" aria-label="Workflow đã đóng">
          <div>
            <span>◫</span>
            <h1>Workflow đã đóng</h1>
            <p>Canvas, thư viện node, Properties và các điều khiển workflow đã đóng. Tạo workflow mới hoặc mở một workflow đã lưu để tiếp tục.</p>
            <div className="canvas-closed-actions">
              <button type="button" onClick={createNewWorkflowTab}>Tạo mới <kbd>Ctrl+N</kbd></button>
              <button type="button" onClick={showOpenWorkflowDialog}>Mở <kbd>Ctrl+O</kbd></button>
            </div>
          </div>
        </section>
      ) : <section className={`workspace${leftPanelCollapsed ? " left-panel-collapsed" : ""}${rightPanelCollapsed ? " right-panel-collapsed" : ""}`} style={workspaceStyle}>
        <aside className="library-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">THƯ VIỆN</span>
              <h2>Thêm node</h2>
            </div>
            <button className="quick-add-button" onClick={() => openQuickAdd()} title="Mở tìm nhanh (Space)">＋</button>
          </div>
          <div className="library-mode-switch" role="tablist" aria-label="Chế độ thư viện node">
            <button className={libraryMode === "basic" ? "active" : ""} onClick={() => changeLibraryMode("basic")}>Cơ bản</button>
            <button className={libraryMode === "advanced" ? "active" : ""} onClick={() => changeLibraryMode("advanced")}>Chi tiết</button>
          </div>
          <label className="search-box">
            <span>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm node..." aria-label="Tìm node" />
            <kbd>Space</kbd>
          </label>
          <div className="library-body">
            <div className="section-label"><span>{search || activePortFilter ? "KẾT QUẢ" : "NHÓM NODE"}</span><small>{searchableDefinitions.length}</small></div>
            {!search && (
              <nav className="category-rail" aria-label="Nhóm node">
                {libraryCategories.map((category) => {
                  const categoryCount = searchableDefinitions.filter((definition) => categoryForDefinition(definition) === category).length;
                  return (
                    <button
                      key={category}
                      className={activeLibraryCategory === category ? "active" : ""}
                      style={categoryStyle(category)}
                      title={category}
                      onClick={() => setActiveLibraryCategory(category)}
                    >
                      <span>{CATEGORY_ICONS[category] ?? "◇"}</span>
                      <strong>{category}</strong>
                      <small>{categoryCount}</small>
                    </button>
                  );
                })}
              </nav>
            )}
            {activePortFilter && (
              <div className="connection-filter">
                <span>↳ {pendingConnection ? "Đang nối" : "Bộ lọc"}: {activePortFilter.handleType === "source" ? "node có đầu vào" : "node có đầu ra"} tương thích với <strong>{displayPortLabel(activePortFilter.type)}</strong> <small>({portContractLabel(activePortFilter)})</small></span>
                {!pendingConnection && <button onClick={() => setManualPortFilter(null)}>Xóa lọc</button>}
              </div>
            )}
            <div className="node-library node-library-grid" aria-live="polite">
              {activeDefinitions.length ? activeDefinitions.map((definition) => (
                <LibraryNodeItem key={definition.kind} definition={definition} onAdd={addNodeToCanvas} />
              )) : <div className="library-empty">Không tìm thấy node phù hợp.</div>}
            </div>
          </div>
          <div className="library-help">
            {libraryMode === "basic"
              ? "Khối cơ bản chạy như workflow con. Nhấn Space để tìm và thêm nhanh."
              : "Node chi tiết dành cho cấu hình và xử lý chuyên sâu."}
          </div>
        </aside>
        <div
          className="panel-resizer left-resizer"
          role="separator"
          aria-label="Kéo đổi kích thước thư viện node"
          title="Kéo để đổi kích thước · nhấp đúp để về kích thước tối đa"
          onMouseDown={(event) => resizePanel("left", event.clientX)}
          onDoubleClick={() => setLeftPanelWidth(242)}
        >
          <button
            className="panel-toggle"
            title={leftPanelCollapsed ? "Hiện thư viện node" : "Ẩn thư viện node"}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => setLeftPanelCollapsed((value) => !value)}
          >{leftPanelCollapsed ? ">" : "<"}</button>
        </div>

        <div className="canvas-panel" ref={wrapperRef} onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}>
          <div className="viewport-header">
            <div><strong>Workflow canvas</strong><span>Node editor</span></div>
            {workflowCheckSummary && <span className={`workflow-check-summary beacon-${workflowCheckSummary.beacon}`} role="status"><i aria-hidden="true" />{workflowCheckSummary.message}</span>}
            <nav aria-label="Công cụ canvas">
              <button onClick={() => setNotice("Chế độ chọn: kéo vùng trống để quét chọn node.")}>Chọn</button>
              <button onClick={() => fitView({ padding: 0.15, duration: 500 })}>Xem</button>
              <button onClick={() => openQuickAdd()}>Thêm</button>
              <button onClick={() => setConfirmAction("reset")}>Canvas</button>
            </nav>
          </div>
          <div className="workflow-toolstrip" aria-label="Thanh công cụ">
            <button className="active" title="Chọn node">↖</button>
            <button title="Thêm node (Space)" onClick={() => openQuickAdd()}>＋</button>
            <button title="Vừa màn hình (F)" onClick={() => fitView({ padding: 0.15, duration: 500 })}>⌖</button>
            <button title={runState === "idle" ? "Chạy workflow (Ctrl+R)" : runState === "paused" ? "Tiếp tục workflow (Ctrl+R)" : "Tạm dừng workflow (Ctrl+R)"} onClick={toggleWorkflowRun}>{runState === "running" ? "Ⅱ" : "▶"}</button>
            <button title="Dừng workflow (Ctrl+T)" onClick={stopWorkflow} disabled={!running}>■</button>
            <span />
            <button title="Xóa canvas" onClick={() => setConfirmAction("reset")}>⌫</button>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onConnectStart={(_, params) => {
              if (!params.nodeId || !params.handleId || (params.handleType !== "source" && params.handleType !== "target")) return;
              setPendingConnection({ nodeId: params.nodeId, handleId: params.handleId, handleType: params.handleType });
            }}
            onConnectEnd={onWireConnectEnd}
            isValidConnection={isValidConnection}
            nodeTypes={nodeTypes}
            // Kéo node không luôn phát onNodeClick. Đồng bộ ngay từ đầu thao tác
            // để Properties luôn theo node đang có viền chọn trên canvas.
            onNodeDragStart={(_, node) => {
              draggingCanvasRef.current = currentCanvasRef.current;
              setSelectedId(node.id);
            }}
            onNodeDragStop={(_, node) => {
              const before = draggingCanvasRef.current;
              draggingCanvasRef.current = null;
              const previous = before?.nodes.find((item) => item.id === node.id);
              if (previous && (previous.position.x !== node.position.x || previous.position.y !== node.position.y)) pushCanvasHistory(before);
            }}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            onPaneDoubleClick={(event) => openQuickAdd(screenToFlowPosition({ x: event.clientX, y: event.clientY }))}
            selectionMode={SelectionMode.Partial}
            fitView
            fitViewOptions={{ padding: 0.16 }}
            minZoom={0.25}
            maxZoom={1.5}
            defaultEdgeOptions={edgeDefaults}
            edgeTypes={edgeTypes}
            deleteKeyCode={["Backspace", "Delete"]}
            colorMode="dark"
          >
            <Background color="#243047" gap={24} size={1.2} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              zoomStep={3}
              nodeColor={(node) => node.id === selectedId ? "#7c5cff" : "#334155"}
              maskColor="rgba(5, 9, 18, 0.72)"
            />
          </ReactFlow>
          {notice && <div className="notice-bar" role="status"><span>i</span>{notice}</div>}
        </div>
        <div
          className="panel-resizer right-resizer"
          role="separator"
          aria-label="Kéo đổi kích thước Properties"
          title="Kéo để đổi kích thước · nhấp đúp để về kích thước tối đa"
          onMouseDown={(event) => resizePanel("right", event.clientX)}
          onDoubleClick={() => setRightPanelWidth(340)}
        >
          <button
            className="panel-toggle"
            title={rightPanelCollapsed ? "Hiện Properties" : "Ẩn Properties"}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => setRightPanelCollapsed((value) => !value)}
          >{rightPanelCollapsed ? "<" : ">"}</button>
        </div>

        {quickAddOpen && (
          <div className="quick-add-overlay" role="dialog" aria-modal="true" aria-label="Tìm và thêm node" onMouseDown={() => setQuickAddOpen(false)}>
            <section
              className="quick-add-dialog"
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key !== "Tab") return;
                event.preventDefault();
                event.stopPropagation();
                changeLibraryMode(libraryMode === "basic" ? "advanced" : "basic");
                setQuickAddPreviewKind(null);
              }}
            >
              <div className="quick-add-head">
                <span>⌕</span>
                <input autoFocus value={quickAddSearch} onChange={(event) => { setQuickAddSearch(event.target.value); setQuickAddPreviewKind(null); }} placeholder="Tìm node theo tên hoặc chức năng..." onKeyDown={(event) => {
                  if (event.key === "Enter" && quickAddDefinitions[0]) {
                    addNodeToCanvas(quickAddDefinitions[0].kind, quickAddPosition);
                    setQuickAddOpen(false);
                  }
                }} />
                <div className="quick-add-mode-switch" role="tablist" aria-label="Chế độ bảng thêm nhanh">
                  <button className={libraryMode === "basic" ? "active" : ""} onClick={() => { changeLibraryMode("basic"); setQuickAddPreviewKind(null); }}>Cơ bản</button>
                  <button className={libraryMode === "advanced" ? "active" : ""} onClick={() => { changeLibraryMode("advanced"); setQuickAddPreviewKind(null); }}>Chi tiết</button>
                </div>
                <kbd>Tab đổi chế độ · Esc</kbd>
              </div>
              <div className="quick-add-subhead">
                <span>{activePortFilter ? `Đang lọc node tương thích với ${displayPortLabel(activePortFilter.type)}` : "Chọn nhóm, xem nhanh rồi thêm vào canvas"}</span>
                {manualPortFilter && !pendingConnection && <button className="quick-filter-clear" onClick={() => setManualPortFilter(null)}>Xóa lọc</button>}
                <span><kbd>Enter</kbd> Thêm node đầu tiên</span>
              </div>
              <div className="quick-add-content">
                <nav className="quick-add-categories" aria-label="Nhóm node">
                  {quickAddCategories.map((category) => (
                    <button key={category} className={quickAddCategory === category ? "active" : ""} style={categoryStyle(category)} title={category} onClick={() => { setQuickAddCategory(category); setQuickAddPreviewKind(null); }}>
                      <span>{CATEGORY_ICONS[category] ?? "◇"}</span><strong>{category}</strong>
                    </button>
                  ))}
                </nav>
                <div className="quick-add-results">
                  <div className="quick-add-result-head"><strong>{quickAddSearch ? `Kết quả: ${quickAddSearch}` : quickAddCategory}</strong><small>{quickAddDefinitions.length} node</small></div>
                  <div className="quick-add-grid">
                    {quickAddDefinitions.map((definition) => (
                      <button key={definition.kind} className={`quick-node-card ${quickAddPreview?.kind === definition.kind ? "selected" : ""} ${!definitionHasExecutor(definition) ? "execution-unavailable" : ""}`} style={categoryStyle(definition.category)} onMouseEnter={() => setQuickAddPreviewKind(definition.kind)} onFocus={() => setQuickAddPreviewKind(definition.kind)} onClick={() => { addNodeToCanvas(definition.kind, quickAddPosition); setQuickAddOpen(false); }} title={!definitionHasExecutor(definition) ? `${definition.label} — Chưa có bộ thực thi thật` : `Thêm ${definition.label}`}>
                        <span className={nodeIconClass("quick-node-icon", definition.icon)}>{definition.icon}</span>
                        <strong>{definition.label}</strong>
                        <small>{displayCategory(definition.category)}</small>
                      </button>
                    ))}
                    {!quickAddDefinitions.length && <div className="library-empty">Không có node phù hợp.</div>}
                  </div>
                </div>
                <aside className="quick-add-preview" aria-label="Xem trước node">
                  {quickAddPreview ? <>
                    <span className={nodeIconClass("quick-preview-icon", quickAddPreview.icon)} style={categoryStyle(quickAddPreview.category)}>{quickAddPreview.icon}</span>
                    <div><small>{displayCategory(quickAddPreview.category)}</small><h3>{quickAddPreview.label}</h3></div>
                    <p>{quickAddPreview.description}</p>
                    <div className="quick-preview-contract"><span>IN</span><strong>{quickAddPreview.inputs.length ? quickAddPreview.inputs.map((port) => port.label).join(", ") : "Không cần đầu vào"}</strong></div>
                    <div className="quick-preview-contract"><span>OUT</span><strong>{quickAddPreview.outputs.length ? quickAddPreview.outputs.map((port) => port.label).join(", ") : "Không có đầu ra"}</strong></div>
                    <button className="quick-preview-add" onClick={() => { addNodeToCanvas(quickAddPreview.kind, quickAddPosition); setQuickAddOpen(false); }}>＋ Thêm node</button>
                  </> : <p>Chọn một node để xem chi tiết.</p>}
                </aside>
              </div>
            </section>
          </div>
        )}

        <aside className="right-dock">
          <section className="workflow-outliner" style={{ flexBasis: outlinerHeight }} aria-label="Cây workflow">
            <div className="dock-title"><span>WORKFLOW</span><small>{nodes.length} node</small></div>
            <div className="outliner-root"><span>⌘</span><strong>{workflowName.trim() || "New workflow"}</strong></div>
            <div
              className={`outliner-list ${outlinerDropTarget === "root" ? "drop-target" : ""}`}
              onPointerDown={startOutlinerMarquee}
              onClick={(event) => {
                if (event.shiftKey) return;
                if (!(event.target as HTMLElement).closest("[data-outliner-selectable]")) clearOutlinerSelection();
              }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOutlinerDropTarget("root"); }}
              onDragLeave={(event) => { if (event.currentTarget === event.target) setOutlinerDropTarget(null); }}
              onDrop={dropOnWorkflowRoot}
            >
              {workflowGroups.map((group) => {
                const members = group.nodeIds.flatMap((nodeId) => nodes.find((node) => node.id === nodeId) ?? []);
                const groupSelected = members.some((node) => node.selected || node.id === selectedId);
                return (
                  <div className={`workflow-group ${group.collapsed ? "collapsed" : ""}`} key={group.id}>
                    <div
                      className={`workflow-group-head ${groupSelected ? "active" : ""} ${outlinerDropTarget === `group:${group.id}` ? "drop-target" : ""}`}
                      draggable={editingGroupId !== group.id}
                      data-outliner-selectable="group"
                      data-outliner-group-id={group.id}
                      onDragStart={(event) => beginOutlinerDrag(event, { kind: "group", id: group.id })}
                      onDragEnd={endOutlinerDrag}
                      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; setOutlinerDropTarget(`group:${group.id}`); }}
                      onDragLeave={(event) => { if (event.currentTarget === event.target) setOutlinerDropTarget(null); }}
                      onDrop={(event) => dropOnWorkflowGroup(event, group.id)}
                    >
                      {editingGroupId === group.id ? (
                        <input
                          autoFocus
                          aria-label="Tên nhóm"
                          value={editingGroupName}
                          onChange={(event) => setEditingGroupName(event.target.value)}
                          onBlur={commitWorkflowGroupName}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") { setEditingGroupId(null); setEditingGroupName(""); }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="workflow-group-select"
                          onClick={(event) => { if (!event.shiftKey) selectGroupFromOutliner(group); }}
                          onDoubleClick={() => { setEditingGroupId(group.id); setEditingGroupName(group.name); }}
                          title="Bấm để chọn cả nhóm · Nhấn đúp để đổi tên"
                        >
                          <span>⊞</span><strong>{group.name}</strong><small>{members.length}</small>
                        </button>
                      )}
                      <button
                        type="button"
                        className="workflow-group-visibility"
                        title={group.collapsed ? "Hiện các node con trong Workflow" : "Ẩn các node con trong Workflow"}
                        aria-label={group.collapsed ? `Hiện node con của ${group.name}` : `Ẩn node con của ${group.name}`}
                        onClick={() => toggleWorkflowGroupVisibility(group.id)}
                      >{group.collapsed ? "⌄" : "⌃"}</button>
                    </div>
                    {!group.collapsed && <div className="workflow-group-members">
                      {members.map((node) => (
                        <button
                          key={node.id}
                          className={node.selected || node.id === selectedId ? "active" : ""}
                          style={categoryStyle(node.data.category)}
                          onClick={(event) => { if (!event.shiftKey) selectNodeFromOutliner(node.id, event); }}
                          title={`Chọn ${node.data.label}`}
                          data-outliner-node-id={node.id}
                          data-outliner-selectable="node"
                          draggable
                          onDragStart={(event) => beginOutlinerDrag(event, { kind: "node", id: node.id })}
                          onDragEnd={endOutlinerDrag}
                          onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; setOutlinerDropTarget(`node:${node.id}`); }}
                          onDragLeave={(event) => { if (event.currentTarget === event.target) setOutlinerDropTarget(null); }}
                          onDrop={(event) => dropOnWorkflowGroup(event, group.id, node.id)}
                          data-drop-target={outlinerDropTarget === `node:${node.id}` ? "true" : undefined}
                        >
                          <span>{node.data.icon}</span>
                          <strong>{node.data.label}</strong>
                          <i className={`status-dot ${node.data.status}`} />
                        </button>
                      ))}
                    </div>}
                  </div>
                );
              })}
              {nodes.filter((node) => !workflowGroups.some((group) => group.nodeIds.includes(node.id))).map((node) => (
                <button
                  key={node.id}
                  className={node.selected || node.id === selectedId ? "active" : ""}
                  style={categoryStyle(node.data.category)}
                  onClick={(event) => { if (!event.shiftKey) selectNodeFromOutliner(node.id, event); }}
                  title={`Chọn ${node.data.label}`}
                  data-outliner-node-id={node.id}
                  data-outliner-selectable="node"
                  draggable
                  onDragStart={(event) => beginOutlinerDrag(event, { kind: "node", id: node.id })}
                  onDragEnd={endOutlinerDrag}
                  onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; setOutlinerDropTarget(`root-node:${node.id}`); }}
                  onDragLeave={(event) => { if (event.currentTarget === event.target) setOutlinerDropTarget(null); }}
                  onDrop={(event) => dropOnRootNode(event, node.id)}
                  data-drop-target={outlinerDropTarget === `root-node:${node.id}` ? "true" : undefined}
                >
                  <span>{node.data.icon}</span>
                  <strong>{node.data.label}</strong>
                  <i className={`status-dot ${node.data.status}`} />
                </button>
              ))}
              {!nodes.length && <p>Chưa có node. Nhấn Space để thêm.</p>}
              {outlinerMarquee && <div
                className="outliner-marquee"
                aria-hidden="true"
                style={{ left: outlinerMarquee.left, top: outlinerMarquee.top, width: outlinerMarquee.width, height: outlinerMarquee.height }}
              />}
            </div>
          </section>
          <div
            className="outliner-resizer"
            role="separator"
            aria-label="Kéo đổi diện tích Workflow và Properties"
            title="Kéo lên hoặc xuống để đổi diện tích Workflow và Properties"
            onMouseDown={(event) => resizeOutliner(event.clientY)}
            onDoubleClick={() => setOutlinerHeight(230)}
          />
          <section className="inspector-panel">
            <div className="properties-tabs">
              <span>PROPERTIES</span>
              {selectedNode ? <button
                type="button"
                className={`node-pause-toggle ${selectedNode.data.paused ? "paused" : "active"}`}
                title={selectedNode.data.paused ? "Bật lại node (Ctrl+P)" : "Tạm ngưng node (Ctrl+P)"}
                onClick={toggleSelectedNodePause}
              >{selectedNode.data.paused ? "Bật node" : "Tạm ngưng"}</button> : <small>Chọn node</small>}
            </div>
          {selectedNode ? (
            <>
              <div className="inspector-head">
                <span className="large-icon">{selectedNode.data.icon}</span>
                <div>
                  <span className="eyebrow">{nodeFamilyOf(selectedNode) === "Xem dữ liệu trên canvas" ? "XEM DỮ LIỆU" : "CẤU HÌNH NODE"}</span>
                  <h2>{selectedNode.data.label}</h2>
                </div>
              </div>
              <p className="node-identity" aria-label="Thông tin phân loại node">
                {selectedNode.data.basicPresetId ? "Cơ bản" : "Chi tiết"} - {selectedNode.data.category} - {nodeFamilyOf(selectedNode)}
              </p>
              <p className="inspector-description">{selectedNode.data.description}</p>
              <div className="config-form">
                <label>
                  <span>Tên node</span>
                  <input
                    value={selectedNode.data.label}
                    onChange={(event) => updateNodeIdentity("label", event.target.value)}
                  />
                </label>
                {nodeFamilyOf(selectedNode) === "Gọi workflow" && selectedNode.data.config.workflowTargetMode === "Workflow đang mở" && (
                  <section className="workflow-current-reference" aria-label="Workflow đang mở">
                    <div>
                      <strong>Workflow đang mở</strong>
                      <small>Chọn bất kỳ tab đang mở, kể cả tab hiện tại để tự gọi. Cổng sẽ được đồng bộ lại theo Cổng vào/Cổng ra của workflow đó.</small>
                    </div>
                    <select
                      aria-label="Workflow đang mở cần gọi"
                      value={selectedNode.data.calledWorkflow?.source === "open-tab" ? selectedNode.data.calledWorkflow.tabId ?? activeWorkflowTabId : activeWorkflowTabId}
                      onChange={(event) => syncOpenWorkflowReference(selectedNode.id, event.target.value)}
                    >
                      {workflowTabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name || "New workflow"}{tab.id === activeWorkflowTabId ? " (tab hiện tại)" : ""}</option>)}
                    </select>
                    <button type="button" onClick={() => syncOpenWorkflowReference(selectedNode.id, selectedNode.data.calledWorkflow?.source === "open-tab" ? selectedNode.data.calledWorkflow.tabId ?? activeWorkflowTabId : activeWorkflowTabId)}>Đồng bộ workflow đã chọn</button>
                  </section>
                )}
                {isWorkflowGatewayNode(selectedNode) && (() => {
                  const direction = workflowGatewayDirection(selectedNode)!;
                  const ports = normalizeWorkflowGatewayPorts(selectedNode.data.workflowPorts);
                  const role = direction === "input" ? "đầu vào của workflow" : "đầu ra của workflow";
                  return (
                    <section className="workflow-gateway-editor" aria-label={`Cổng ${role}`}>
                      <div>
                        <strong>{direction === "input" ? "Cổng workflow nhận" : "Cổng workflow trả"}</strong>
                        <small>{direction === "input" ? "Các cổng này sẽ hiện ở bên vào của node Gọi workflow." : "Nối dữ liệu cần trả vào đây; chúng sẽ hiện ở bên ra của node Gọi workflow."}</small>
                      </div>
                      <datalist id="workflow-port-type-suggestions">
                        {WORKFLOW_PORT_TYPE_SUGGESTIONS.map((type) => <option key={type} value={type} />)}
                      </datalist>
                      {ports.length === 0 && <p className="gateway-empty-state">Chưa có cổng nào. Thêm cổng để công bố interface của workflow.</p>}
                      {ports.map((port, index) => (
                        <div className="workflow-gateway-port" key={port.id}>
                          <input
                            aria-label={`Tên cổng ${index + 1}`}
                            value={gatewayPortNameDrafts[port.id] ?? port.name}
                            placeholder="Tên cổng"
                            onChange={(event) => setGatewayPortNameDrafts((current) => ({
                              ...current,
                              [port.id]: event.target.value.replace(/\s+/g, "_"),
                            }))}
                            onBlur={() => {
                              const draft = gatewayPortNameDrafts[port.id];
                              if (draft === undefined) return;
                              const name = normalizeWorkflowPortName(draft, index);
                              updateWorkflowGatewayPorts((current) => current.map((item) => item.id === port.id ? { ...item, name } : item));
                              setGatewayPortNameDrafts((current) => {
                                const next = { ...current };
                                delete next[port.id];
                                return next;
                              });
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") event.currentTarget.blur();
                            }}
                          />
                          <input
                            aria-label={`Kiểu dữ liệu cổng ${index + 1}`}
                            list="workflow-port-type-suggestions"
                            value={port.type}
                            placeholder="Kiểu dữ liệu"
                            onChange={(event) => updateWorkflowGatewayPorts((current) => current.map((item) => item.id === port.id ? { ...item, type: event.target.value } : item))}
                          />
                          <label className="gateway-required">
                            <input
                              type="checkbox"
                              checked={port.required}
                              onChange={(event) => updateWorkflowGatewayPorts((current) => current.map((item) => item.id === port.id ? { ...item, required: event.target.checked } : item))}
                            />
                            Bắt buộc
                          </label>
                          <div className="gateway-port-actions">
                            <button type="button" title="Đưa cổng lên" disabled={index === 0} onClick={() => updateWorkflowGatewayPorts((current) => {
                              const next = [...current];
                              [next[index - 1], next[index]] = [next[index], next[index - 1]];
                              return next;
                            })}>↑</button>
                            <button type="button" title="Đưa cổng xuống" disabled={index === ports.length - 1} onClick={() => updateWorkflowGatewayPorts((current) => {
                              const next = [...current];
                              [next[index + 1], next[index]] = [next[index], next[index + 1]];
                              return next;
                            })}>↓</button>
                            <button type="button" title="Xóa cổng" onClick={() => updateWorkflowGatewayPorts((current) => current.filter((item) => item.id !== port.id))}>Xóa</button>
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="add-workflow-gateway-port"
                        onClick={() => updateWorkflowGatewayPorts((current) => [...current, {
                          id: createWorkflowPortId(),
                          name: `Cổng_${current.length + 1}`,
                          type: "Dữ liệu",
                          required: false,
                        }])}
                      >+ Thêm cổng</button>
                    </section>
                  );
                })()}
                {nodeFamilyOf(selectedNode) !== "Xem dữ liệu trên canvas" && selectedNode.data.configFields.filter((field) => !field.showWhen || String(selectedNode.data.config[field.showWhen.key] ?? "") === field.showWhen.value).map((field, index, visibleFields) => (
                  <div className="config-field-block" key={field.key}>
                    {index > 0 && field.configGroup && field.configGroup !== visibleFields[index - 1]?.configGroup && <div className="config-section-divider" aria-hidden="true" />}
                    <div className={`config-field type-${field.type}`}>
                    <span>{field.label}{field.required && <b className="required-mark" title="Bắt buộc">*</b>}</span>
                    {field.type === "model-catalog" ? (
                      <ProviderModelField config={selectedNode.data.config} providerConfig={modelProviderConfig} localAiModels={localAiModels} onManageLocalAi={showLocalAiManager} onChange={updateConfig} />
                    ) : field.type === "date-time-pair" ? (
                      <DateTimePairField
                        time={String(selectedNode.data.config.time ?? "00:00")}
                        date={String(selectedNode.data.config.date ?? new Date().toLocaleDateString("en-CA"))}
                        onTimeChange={(value) => updateConfig("time", value)}
                        onDateChange={(value) => updateConfig("date", value)}
                      />
                    ) : field.type === "textarea" ? (
                      <>
                        <textarea value={String(selectedNode.data.config[field.key] ?? "")} placeholder={field.placeholder} maxLength={field.maxLength} onChange={(event) => updateConfig(field.key, event.target.value)} rows={4} />
                        {field.maxLength && <small className="field-help">{String(selectedNode.data.config[field.key] ?? "").length.toLocaleString("vi-VN")} / {field.maxLength.toLocaleString("vi-VN")} ký tự</small>}
                      </>
                    ) : field.type === "select" ? (
                      <FilterableSelect
                        value={String(selectedNode.data.config[field.key] ?? "")}
                        options={field.options ?? []}
                        optionLabels={field.key === "localTranscriptModel" ? localTranscriptModelLabels : undefined}
                        placeholder={field.placeholder ?? "Chọn lựa chọn…"}
                        onChange={(value) => updateConfig(field.key, value)}
                      />
                    ) : field.type === "multi-select" ? (
                      <div className="multi-select-control">
                        {field.options?.map((option) => {
                          const selected = String(selectedNode.data.config[field.key] ?? "").split(",").filter(Boolean);
                          return (
                            <label key={option}>
                              <input
                                type="checkbox"
                                checked={selected.includes(option)}
                                onChange={(event) => {
                                  const next = event.target.checked
                                    ? [...selected, option]
                                    : selected.filter((item) => item !== option);
                                  updateConfig(field.key, next.join(","));
                                }}
                              />
                              <span>{option}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : field.type === "url-list" ? (
                      <UrlListField
                        value={String(selectedNode.data.config[field.key] ?? "")}
                        placeholder={field.key === "apiKey" && selectedApiKeyConnected ? "Đã kết nối key API qua cổng APIKey" : field.placeholder}
                        onChange={(value) => updateConfig(field.key, value)}
                      />
                    ) : field.type === "tags" ? (
                      <TagListField
                        value={String(selectedNode.data.config[field.key] ?? "")}
                        placeholder={field.placeholder}
                        onChange={(value) => updateConfig(field.key, value)}
                      />
                    ) : field.type === "code" ? (
                      <textarea
                        className="code-input"
                        value={String(selectedNode.data.config[field.key] ?? "")}
                        placeholder={field.placeholder}
                        onChange={(event) => updateConfig(field.key, event.target.value)}
                        rows={6}
                        spellCheck={false}
                      />
                    ) : field.type === "attention-grid" ? (
                      <AttentionGridField
                        value={String(selectedNode.data.config[field.key] ?? "")}
                        onChange={(value) => updateConfig(field.key, value)}
                      />
                    ) : field.type === "attention-editor" ? (
                      <div className="attention-editor-control">
                        <button type="button" onClick={() => { void openAttentionEditor(); }}>Mở trình chọn chính xác…</button>
                        <small>{parseAttentionRects(selectedNode.data.config[field.key]).length}/{nodeFamilyOf(selectedNode) === "Tìm ảnh tương đồng" ? 1 : 3} vùng đã quét</small>
                      </div>
                    ) : field.type === "range" ? (
                      <div className="range-control">
                        <input
                          type="range"
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          value={Number(selectedNode.data.config[field.key] ?? field.defaultValue ?? 0)}
                          onChange={(event) => updateConfig(field.key, Number(event.target.value))}
                        />
                        <output>{String(selectedNode.data.config[field.key] ?? field.defaultValue ?? 0)}{field.suffix}</output>
                      </div>
                    ) : field.type === "folder" && (field.key === "localFolder" || field.key === "searchFolder") ? (
                      <>
                        <div className="folder-picker-control">
                          <input disabled={isFileStorageNode(selectedNode) && selectedStorageFolderConnected} value={String(selectedNode.data.config[field.key] ?? "")} placeholder={selectedStorageFolderConnected ? "Đã nhận Folder qua cổng vào" : field.placeholder} onChange={(event) => updateConfig(field.key, event.target.value)} />
                          <button type="button" onClick={async () => {
                            const folder = await window.contentFlowDesktop?.pickFolder();
                            if (folder) updateConfig(field.key, folder);
                          }} disabled={isFileStorageNode(selectedNode) && selectedStorageFolderConnected}>Browse…</button>
                        </div>
                        <small className="field-help selected-files">{selectedStorageFolderConnected ? "Đã nhận thư mục từ cổng Folder. Tháo dây để chọn ngay trong node." : field.help}</small>
                      </>
                    ) : field.type === "file" && nodeFamilyOf(selectedNode) === "Gọi workflow" && field.key === "workflowPath" && !window.contentFlowDesktop?.pickFiles ? (
                      <>
                        <input
                          type="file"
                          accept={field.accept}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            if (file) void syncBrowserWorkflowReference(selectedNode.id, file);
                          }}
                        />
                        <small className="field-help selected-files">Chọn file .tess để nạp workflow vào node và chạy thử trong trình duyệt. Bản workflow được lưu kèm node gọi.</small>
                        {selectedNode.data.validationError && <small className="field-error">{selectedNode.data.validationError}</small>}
                      </>
                    ) : field.type === "file" && field.persistPaths && typeof window !== "undefined" && window.contentFlowDesktop?.pickFiles ? (
                      <>
                        <button
                          className="native-file-picker"
                          type="button"
                          title={filePathsFromConfig(selectedNode.data.config[`${field.key}Paths`]).join("\n") || undefined}
                          onClick={() => { void updatePersistedFiles(field); }}
                        >
                          {filePathsFromConfig(selectedNode.data.config[`${field.key}Paths`]).length
                            ? filePathsFromConfig(selectedNode.data.config[`${field.key}Paths`]).map(fileNameFromPath).join(", ")
                            : String(selectedNode.data.config[field.key] || "Chọn file…")}
                        </button>
                        <small className="field-help selected-files">
                          {filePathsFromConfig(selectedNode.data.config[`${field.key}Paths`]).length
                            ? filePathsFromConfig(selectedNode.data.config[`${field.key}Paths`]).map(fileNameFromPath).join(", ")
                            : selectedNode.data.config[field.key]
                              ? `Đã chọn trước đó: ${selectedNode.data.config[field.key]} — hãy chọn lại để khôi phục đường dẫn.`
                              : field.help || "Chưa chọn tệp"}
                        </small>
                        {selectedNode.data.validationError && <small className="field-error">{selectedNode.data.validationError}</small>}
                      </>
                    ) : field.type === "file" || field.type === "folder" ? (
                      <>
                        <input
                          type="file"
                          accept={field.accept}
                          multiple={field.multiple}
                          {...(field.type === "folder" ? { webkitdirectory: "", directory: "" } : {})}
                          onChange={(event) => {
                            const files = Array.from(event.currentTarget.files ?? []);
                            runtimeFilesRef.current.set(`${selectedNode.id}:${field.key}`, files);
                            const summary = files.map((file) => file.name).join(", ");
                            updateConfig(field.key, summary, validateSelectedFiles(files, field.fileValidation) ?? null);
                          }}
                        />
                        <small className="field-help selected-files">
                          {String(selectedNode.data.config[field.key] || field.help || "Chưa chọn tệp")}
                        </small>
                        {selectedNode.data.validationError && <small className="field-error">{selectedNode.data.validationError}</small>}
                      </>
                    ) : field.type === "checkbox" ? (
                      <label className="checkbox-control">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedNode.data.config[field.key])}
                          onChange={(event) => updateConfig(field.key, event.target.checked)}
                        />
                        <i />
                        <em>{Boolean(selectedNode.data.config[field.key]) ? "Đang bật" : "Đang tắt"}</em>
                      </label>
                    ) : (
                      <input
                        type={field.type}
                        value={String(selectedNode.data.config[field.key] ?? "")}
                        placeholder={field.key === "apiKey" && selectedApiKeyConnected
                          ? "Đã kết nối key API qua cổng APIKey"
                          : field.placeholder}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        onChange={(event) => updateConfig(field.key, field.type === "number" ? Number(event.target.value) : event.target.value)}
                      />
                    )}
                    {field.help && field.type !== "file" && field.type !== "folder" && <small className="field-help">{field.help}</small>}
                    {field.key === "durationText" && selectedNode.data.validationError && <small className="field-error">{selectedNode.data.validationError}</small>}
                    </div>
                  </div>
                ))}
              </div>

              {selectedCheckIssues.length > 0 && (
                <section className="node-check-section" aria-label="Kết quả kiểm tra node">
                  <h3>Kết quả kiểm tra</h3>
                  {selectedCheckIssues.map((issue) => (
                    <div className={`node-check-feedback ${issue.beacon}`} key={issue.message}>
                      <strong>{issue.beacon === "error" ? "Lỗi" : "Thiếu"}</strong>
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </section>
              )}
              <div className="output-section">
                <div className="section-title">
                  <h3>Output gần nhất</h3>
                  <span className={`output-status ${selectedNode.data.status}`}>{selectedNode.data.status}</span>
                </div>
                {isFileStorageNode(selectedNode) && hasReusableStoredFiles(selectedNode) && (
                  <div className="stored-file-state">
                    <div>
                      <strong>Stored file đang liên kết</strong>
                      <span>{selectedNode.data.storedFiles?.length} file đã lưu sẽ được dùng lại ở lượt chạy tiếp theo.</span>
                      {selectedNode.data.storedArtifacts?.length ? <span>{selectedNode.data.storedArtifacts.map((artifact) => artifact.type).join(", ")} · nguồn: Artifact runtime</span> : null}
                    </div>
                    <button type="button" onClick={resetStoredFile}>Reset stored file</button>
                  </div>
                )}
                {selectedNode.data.run && (
                  <div className={`run-contract-summary ${selectedNode.data.run.status}`}>
                    <strong>Lần chạy: {selectedNode.data.run.status}</strong>
                    <span>{selectedNode.data.run.inputs.length} Artifact đầu vào · {selectedNode.data.run.outputs.length} Artifact đầu ra</span>
                    {selectedNode.data.artifacts?.length ? (
                      <small>{selectedNode.data.artifacts.map((artifact) => `${artifact.name} (${artifact.type})`).join(", ")}</small>
                    ) : null}
                    {selectedNode.data.run.diagnostics.at(-1) && <small className="run-contract-error">{selectedNode.data.run.diagnostics.at(-1)?.message}</small>}
                  </div>
                )}
                {(selectedNode.data.status === "running" || selectedNode.data.status === "queued") && selectedNode.data.progress ? (
                  <div className={`running-output ${selectedNode.data.status}`} aria-live="polite">
                    <span className="running-output-spinner" aria-hidden="true" />
                    <strong>{selectedNode.data.progress.message}</strong>
                    {selectedNode.data.progress.detail && <small>{selectedNode.data.progress.detail}</small>}
                    {selectedNode.data.progress.total && (
                      <div className="running-output-progress">
                        <progress max={selectedNode.data.progress.total} value={Math.max(0, (selectedNode.data.progress.current ?? 1) - 1)} />
                        <span>{Math.max(0, (selectedNode.data.progress.current ?? 1) - 1)}/{selectedNode.data.progress.total} bước hoàn tất</span>
                      </div>
                    )}
                  </div>
                ) : selectedNode.data.output ? (
                  <>
                    <div className="output-actions">
                      <button type="button" onClick={() => { void copyNodeOutput(); }}>Sao chép output</button>
                    </div>
                    <pre tabIndex={0} aria-label="Nội dung output có thể sao chép">{selectedOutputText}</pre>
                  </>
                ) : (
                  <div className="empty-output"><span>◇</span>Chạy workflow để xem dữ liệu đầu ra.</div>
                )}
              </div>

              <button className="delete-button" onClick={() => setConfirmAction("delete")}>Xóa node này</button>
            </>
          ) : (
            <div className="empty-inspector">
              <span className="empty-graphic">⌘</span>
              <h2>Chọn một node</h2>
              <p>Bấm vào node trên canvas để chỉnh cấu hình, kiểm tra hợp đồng dữ liệu và xem output.</p>
              <div className="tip-card"><strong>Mẹo</strong><span>Cổng cùng màu thể hiện cùng một kiểu dữ liệu và có thể kết nối.</span></div>
            </div>
          )}
          </section>
        </aside>
      </section>}

      {!canvasClosed && <footer className="studio-statusbar">
        <span>Chuột trái chọn · Kéo nền để quét · Cuộn để zoom</span>
        <span><kbd>Space</kbd> Thêm node <kbd>F</kbd> Vừa màn hình <kbd>Ctrl+C/V</kbd> Sao chép/Dán <kbd>Ctrl+G</kbd> Nhóm <kbd>Ctrl+Shift+G</kbd> Tách nhóm <kbd>Ctrl+Z</kbd> Hoàn tác <kbd>Ctrl+Shift+Z</kbd> Phục hồi <kbd>Ctrl+E</kbd> Kiểm tra <kbd>Ctrl+R</kbd> Chạy/Tạm dừng/Tiếp tục <kbd>Ctrl+T</kbd> Dừng</span>
      </footer>}

      {confirmAction && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Xác nhận thao tác">
          <div className="confirm-modal">
            <span className="warning-icon">!</span>
            <h2>{confirmAction === "delete" ? "Xóa node đã chọn?" : "Xóa toàn bộ canvas?"}</h2>
            <p>{confirmAction === "delete" ? "Các kết nối đến node này cũng sẽ bị xóa." : "Toàn bộ node và kết nối hiện tại trên canvas sẽ bị xóa."}</p>
            <div>
              <button className="button ghost" onClick={() => setConfirmAction(null)}>Hủy</button>
              <button className="button danger" onClick={confirmAction === "delete" ? deleteSelected : resetWorkflow}>Xác nhận</button>
            </div>
          </div>
        </div>
      )}
      {openWorkflowDialog && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="open-workflow-title">
          <div className="recent-workflows-modal">
            <div className="recent-workflows-head">
              <div>
                <span className="eyebrow">WORKFLOW</span>
                <h2 id="open-workflow-title">Mở workflow</h2>
              </div>
              <button type="button" className="recent-workflows-close" onClick={() => { setOpenWorkflowDialog(false); setOpenWorkflowDialogError(null); }} aria-label="Đóng">×</button>
            </div>
            <p>Chọn một workflow đã mở gần đây hoặc tìm tệp workflow khác.</p>
            {openWorkflowDialogError && <div className="recent-workflows-error" role="alert">{openWorkflowDialogError}</div>}
            <div className="recent-workflows-list" aria-label="Workflow đã mở gần đây">
              {recentWorkflows.length ? recentWorkflows.map((recent) => (
                <button
                  type="button"
                  className="recent-workflow-item"
                  key={recent.path}
                  onClick={() => { void openRecentWorkflow(recent).then((opened) => { if (opened) setOpenWorkflowDialog(false); }); }}
                  title={recent.path}
                >
                  <span className="recent-workflow-icon">◫</span>
                  <span><strong>{recent.name}</strong><small>{recent.path}</small></span>
                </button>
              )) : <div className="recent-workflows-empty">Chưa có workflow nào được mở gần đây trên máy này.</div>}
            </div>
            <div className="recent-workflows-actions">
              <button type="button" className="button ghost" onClick={() => { setOpenWorkflowDialog(false); setOpenWorkflowDialogError(null); }}>Hủy</button>
              <button type="button" className="button primary" onClick={() => { void browseWorkflow(); }}>Tìm workflow… <kbd>Ctrl+O</kbd></button>
            </div>
          </div>
        </div>
      )}
      {localProcessorsOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="local-processors-title">
          <div className="local-processors-modal">
            <div className="recent-workflows-head">
              <div>
                <span className="eyebrow">WORKFLOW</span>
                <h2 id="local-processors-title">Điều chỉnh xử lý cục bộ</h2>
              </div>
              <button type="button" className="recent-workflows-close" onClick={() => setLocalProcessorsOpen(false)} aria-label="Đóng">×</button>
            </div>
            <p>Các bộ xử lý này không tự cài, cập nhật hoặc gỡ khi cài app. Chọn thao tác tại đây khi bạn cần dùng chúng.</p>
            {localProcessorError && <div className="recent-workflows-error" role="alert">{localProcessorError}</div>}
            <div className="local-processors-list" aria-label="Bộ xử lý cục bộ">
              {localProcessors.length ? localProcessors.map((processor) => (
                <article className={`local-processor ${processor.installed ? "installed" : "missing"}`} key={processor.id}>
                  <div className="local-processor-status" aria-label={processor.installed ? "Đã cài" : "Chưa cài"}>{processor.installed ? "●" : "○"}</div>
                  <div className="local-processor-copy">
                    <strong>{processor.label}</strong>
                    <p>{processor.description}</p>
                    <small>{processor.installed
                      ? `${processor.version ?? "Đã sẵn sàng"}${processor.bytes ? ` · ${(processor.bytes / 1024 / 1024).toFixed(0)} MB` : ""}`
                      : processor.error || "Chưa được cài trên máy này."}</small>
                    {processor.installed && <small className="local-processor-updated-at">{localProcessorUpdatedAtLabel(processor)}</small>}
                  </div>
                  <div className="local-processor-actions">
                    {processor.installed ? <>
                      <button type="button" disabled={Boolean(localProcessorBusy)} onClick={() => { void manageLocalProcessor(processor.id, "update"); }}>{localProcessorBusy === processor.id ? "Đang xử lý..." : "Cập nhật"}</button>
                      <button type="button" className="danger" disabled={Boolean(localProcessorBusy)} onClick={() => { void manageLocalProcessor(processor.id, "remove"); }}>Gỡ</button>
                    </> : <button type="button" className="primary" disabled={Boolean(localProcessorBusy)} onClick={() => { void manageLocalProcessor(processor.id, "install"); }}>{localProcessorBusy === processor.id ? "Đang cài..." : "Cài đặt"}</button>}
                  </div>
                </article>
              )) : <div className="recent-workflows-empty">Đang kiểm tra bộ xử lý cục bộ...</div>}
            </div>
            <div className="local-processors-note">FFmpeg thay đổi ở cấp hệ thống: sau khi cài/cập nhật/gỡ, hãy khởi động lại Content Flow trước khi chạy media.</div>
            <div className="recent-workflows-actions">
              <button type="button" className="button ghost" disabled={Boolean(localProcessorBusy)} onClick={() => setLocalProcessorsOpen(false)}>Đóng</button>
              <button type="button" className="button primary" disabled={Boolean(localProcessorBusy)} onClick={() => { void refreshLocalProcessors(); }}>Làm mới trạng thái</button>
            </div>
          </div>
        </div>
      )}
      {localAiManagerOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="local-ai-manager-title">
          <div className="local-processors-modal local-ai-manager-modal">
            <div className="recent-workflows-head">
              <div>
                <span className="eyebrow">WORKFLOW</span>
                <h2 id="local-ai-manager-title">Quản lý AI</h2>
              </div>
              <button type="button" className="recent-workflows-close" onClick={() => setLocalAiManagerOpen(false)} aria-label="Đóng">×</button>
            </div>
            <p>Quét model đã cài trong Ollama rồi chủ động thêm vào danh mục Tesseract. Gỡ chỉ xóa khỏi danh mục app, không xóa model khỏi máy.</p>
            {localAiError && <div className="recent-workflows-error" role="alert">{localAiError}</div>}
            <div className="local-processors-list local-ai-model-list" aria-label="Model Ollama local">
              {scannedOllamaModels.length ? scannedOllamaModels.map((model) => {
                const registered = localAiModels.some((item) => item.id === model.id);
                return <article className={`local-processor ${registered ? "installed" : "missing"}`} key={model.id}>
                  <div className="local-processor-status" aria-label={registered ? "Đã thêm vào Tesseract" : "Chưa thêm vào Tesseract"}>{registered ? "●" : "○"}</div>
                  <div className="local-processor-copy">
                    <strong>{model.id}</strong>
                    <p>Ollama local · {localAiModelSize(model.size)}</p>
                    <small>Cập nhật trong Ollama: {localAiModifiedAt(model.modifiedAt)}</small>
                  </div>
                  <div className="local-processor-actions">
                    {registered
                      ? <button type="button" className="danger" disabled={localAiBusy} onClick={() => removeRegisteredLocalAiModel(model.id)}>Gỡ khỏi Tesseract</button>
                      : <button type="button" className="primary" disabled={localAiBusy} onClick={() => addLocalAiModel(model)}>Thêm vào Tesseract</button>}
                  </div>
                </article>;
              }) : !localAiBusy && !localAiError && <div className="recent-workflows-empty">Chưa quét được model nào. Bấm Quét lại để kiểm tra Ollama.</div>}
              {!scannedOllamaModels.length && localAiBusy && <div className="recent-workflows-empty">Đang quét model Ollama trên máy…</div>}
              {localAiModels.filter((registered) => !scannedOllamaModels.some((model) => model.id === registered.id)).map((model) => (
                <article className="local-processor missing" key={`missing-${model.id}`}>
                  <div className="local-processor-status" aria-label="Không tìm thấy khi quét">○</div>
                  <div className="local-processor-copy"><strong>{model.id}</strong><p>Đã có trong Tesseract nhưng không tìm thấy khi quét Ollama gần nhất.</p><small>Không thể dùng cho tới khi model xuất hiện lại hoặc được gỡ khỏi danh mục.</small></div>
                  <div className="local-processor-actions"><button type="button" className="danger" disabled={localAiBusy} onClick={() => removeRegisteredLocalAiModel(model.id)}>Gỡ khỏi Tesseract</button></div>
                </article>
              ))}
            </div>
            <div className="local-processors-note">{localAiScannedAt ? `Quét gần nhất: ${localAiModifiedAt(localAiScannedAt)}.` : "Chưa có lượt quét thành công trong phiên này."} Model đã thêm sẽ xuất hiện trong node Thiết lập AI khi chọn nhà cung cấp Ollama.</div>
            <div className="recent-workflows-actions">
              <button type="button" className="button ghost" disabled={localAiBusy} onClick={() => setLocalAiManagerOpen(false)}>Đóng</button>
              <button type="button" className="button primary" disabled={localAiBusy} onClick={() => { void scanOllamaModels(); }}>{localAiBusy ? "Đang quét…" : "Quét lại"}</button>
            </div>
          </div>
        </div>
      )}
      {attentionEditorOpen && attentionPreviewFile && (
        <AttentionEditorDialog
          preview={attentionPreviewFile}
          regions={parseAttentionRects(selectedNode?.data.config.exactRegions)}
          onClose={() => { setAttentionEditorOpen(false); setAttentionPreviewFile(null); }}
          onApply={(regions) => {
            const applied = nodeFamilyOf(selectedNode) === "Tìm ảnh tương đồng" ? regions.slice(0, 1) : regions;
            updateConfig("exactRegions", JSON.stringify(applied));
            setAttentionEditorOpen(false);
            setAttentionPreviewFile(null);
          }}
        />
      )}
    </main>
    </PortFilterContext.Provider>
  );
}

export default function Home() {
  return (
    <ReactFlowProvider>
      <WorkflowApp />
    </ReactFlowProvider>
  );
}
