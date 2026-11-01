export const TESS_EXTENSION = ".tess";
export const TESS_MAGIC = "TESSERACT/1";
export const TESS_FORMAT = "tesseract-workflow";
export const TESS_DOCUMENT_VERSION = 3;
export const TESS_INTERFACE_VERSION = 1;
export const TESS_DATA_CONTRACT_VERSION = 1;
const ARTIFACT_TYPES = new Set([
  "Any", "Text", "Boolean", "Number", "Record", "File", "Folder",
  "Image", "ImageSet", "Audio", "Video", "FrameIndex", "TimedTranscript",
  "Table", "Report", "StoredFiles", "AIExecutionProfile", "CachedData",
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function generatedWorkflowId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `workflow-${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

export function createWorkflowId() {
  return generatedWorkflowId();
}

function normalizeInterfacePort(value, direction, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Cổng ${direction} số ${index + 1} không hợp lệ.`);
  }
  const port = value;
  const id = text(port.id);
  const name = text(port.name);
  const type = text(port.type);
  if (!id) throw new Error(`Cổng ${direction} số ${index + 1} thiếu ID.`);
  if (!name) throw new Error(`Cổng ${direction} “${id}” thiếu tên hiển thị.`);
  if (!type) throw new Error(`Cổng ${direction} “${id}” thiếu kiểu dữ liệu.`);
  const description = text(port.description);
  const artifactType = text(port.artifactType);
  const cardinality = port.cardinality === "one" || port.cardinality === "many" ? port.cardinality : "";
  return {
    id,
    name,
    type,
    required: port.required === true,
    ...(ARTIFACT_TYPES.has(artifactType) ? { artifactType } : {}),
    ...(cardinality ? { cardinality } : {}),
    ...(description ? { description } : {}),
  };
}

function normalizePortList(value, direction) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Danh sách cổng ${direction} phải là một mảng.`);
  const usedIds = new Set();
  return value.map((port, index) => {
    const normalized = normalizeInterfacePort(port, direction, index);
    if (usedIds.has(normalized.id)) throw new Error(`Cổng ${direction} có ID trùng: “${normalized.id}”.`);
    usedIds.add(normalized.id);
    return normalized;
  });
}

/**
 * Interface là hợp đồng duy nhất giữa workflow được gọi và node Gọi workflow.
 * REC-02 sẽ tạo interface này từ node Cổng vào/Cổng ra; ở đây chỉ chuẩn hóa,
 * kiểm tra và lưu nó để workflow cũ vẫn đọc được khi chưa có cổng nào.
 */
export function normalizeWorkflowInterface(value) {
  if (value === undefined || value === null) {
    return { version: TESS_INTERFACE_VERSION, inputs: [], outputs: [] };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Interface workflow không hợp lệ.");
  }
  const raw = value;
  const version = raw.version === undefined ? TESS_INTERFACE_VERSION : raw.version;
  if (version !== TESS_INTERFACE_VERSION) {
    throw new Error(`Phiên bản interface workflow không được hỗ trợ: ${String(version)}.`);
  }
  return {
    version: TESS_INTERFACE_VERSION,
    inputs: normalizePortList(raw.inputs, "vào"),
    outputs: normalizePortList(raw.outputs, "ra"),
  };
}

export function validateWorkflowInterface(value) {
  try {
    return { valid: true, value: normalizeWorkflowInterface(value), issues: [] };
  } catch (error) {
    return { valid: false, value: null, issues: [error instanceof Error ? error.message : "Interface workflow không hợp lệ."] };
  }
}

/** Dấu vân tay lưu cùng caller để phát hiện workflow con đổi interface. */
export function workflowInterfaceFingerprint(value) {
  return JSON.stringify(normalizeWorkflowInterface(value));
}

/** Thông báo ngắn, chỉ rõ cổng nào thay đổi thay vì lỗi JSON chung chung. */
export function describeWorkflowInterfaceChange(expected, actual) {
  const left = normalizeWorkflowInterface(expected);
  const right = normalizeWorkflowInterface(actual);
  const changes = [];
  for (const direction of ["inputs", "outputs"]) {
    const label = direction === "inputs" ? "đầu vào" : "đầu ra";
    const before = new Map(left[direction].map((port) => [port.id, port]));
    const after = new Map(right[direction].map((port) => [port.id, port]));
    for (const [id, port] of before) {
      const replacement = after.get(id);
      if (!replacement) changes.push(`mất cổng ${label} “${port.name}”`);
      else if (JSON.stringify(port) !== JSON.stringify(replacement)) changes.push(`đổi hợp đồng cổng ${label} “${port.name}”`);
    }
    for (const [id, port] of after) {
      if (!before.has(id)) changes.push(`thêm cổng ${label} “${port.name}”`);
    }
  }
  return changes.length ? changes.join("; ") : "metadata interface thay đổi";
}

export function prepareWorkflowForSave(workflow) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    throw new Error("Workflow cần lưu không hợp lệ.");
  }
  const workflowId = text(workflow.workflowId) || createWorkflowId();
  return {
    ...workflow,
    workflowId,
    // Dữ liệu workflow cũ vẫn được page adapter nâng cấp lúc mở; mọi lần lưu
    // mới ghi rõ version hợp đồng để bản app cũ không hiểu nhầm dữ liệu typed.
    dataContractVersion: TESS_DATA_CONTRACT_VERSION,
    workflowInterface: normalizeWorkflowInterface(workflow.workflowInterface),
  };
}

export function workflowNameFromPath(filePath) {
  return String(filePath || "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.tess$/i, "")
    .replace(/\.contentflow\.json$/i, "")
    .replace(/\.json$/i, "")
    .trim() || "New workflow";
}

export function isWorkflowDocumentPath(filePath) {
  const extension = String(filePath || "").match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase();
  return extension === "tess" || extension === "json";
}

export function workflowPathWithTessExtension(filePath) {
  const value = String(filePath || "").trim();
  if (!value) return `New workflow${TESS_EXTENSION}`;
  if (value.toLowerCase().endsWith(TESS_EXTENSION)) return value;
  const extension = value.match(/\.([^.\\/]+)$/)?.[0] ?? "";
  return `${extension ? value.slice(0, -extension.length) : value}${TESS_EXTENSION}`;
}

export function serializeTessWorkflow(workflow) {
  const persistedWorkflow = prepareWorkflowForSave(workflow);
  return `${TESS_MAGIC}\n${JSON.stringify({
    format: TESS_FORMAT,
    version: TESS_DOCUMENT_VERSION,
    dataContractVersion: TESS_DATA_CONTRACT_VERSION,
    workflowId: persistedWorkflow.workflowId,
    workflowInterface: persistedWorkflow.workflowInterface,
    workflow: persistedWorkflow,
  }, null, 2)}\n`;
}

export function parseWorkflowDocument(source) {
  const sourceText = String(source ?? "").replace(/^\uFEFF/, "");
  if (sourceText.trimStart().startsWith(TESS_MAGIC)) {
    const payload = sourceText.slice(sourceText.indexOf(TESS_MAGIC) + TESS_MAGIC.length).trim();
    const envelope = JSON.parse(payload);
    if (!envelope || envelope.format !== TESS_FORMAT || !envelope.workflow || typeof envelope.workflow !== "object") {
      throw new Error("Tệp .tess không đúng định dạng Tesseract.");
    }
    const envelopeVersion = Number(envelope.version ?? 1);
    if (!Number.isInteger(envelopeVersion) || envelopeVersion < 1) throw new Error("Tệp .tess có phiên bản tài liệu không hợp lệ.");
    if (envelopeVersion > TESS_DOCUMENT_VERSION) {
      throw new Error(`Tệp .tess dùng phiên bản ${envelopeVersion} mới hơn Tesseract hiện tại (${TESS_DOCUMENT_VERSION}). Hãy cập nhật app rồi mở lại.`);
    }
    const dataContractVersion = Number(envelope.dataContractVersion ?? envelope.workflow.dataContractVersion ?? 0);
    if (!Number.isInteger(dataContractVersion) || dataContractVersion < 0) throw new Error("Tệp .tess có phiên bản hợp đồng dữ liệu không hợp lệ.");
    if (dataContractVersion > TESS_DATA_CONTRACT_VERSION) {
      throw new Error(`Tệp .tess dùng hợp đồng dữ liệu v${dataContractVersion} mới hơn app hỗ trợ (v${TESS_DATA_CONTRACT_VERSION}). Hãy cập nhật app rồi mở lại.`);
    }
    const workflowId = text(envelope.workflow.workflowId) || text(envelope.workflowId);
    if (!workflowId) throw new Error("Tệp .tess thiếu ID workflow ổn định.");
    const embeddedInterface = normalizeWorkflowInterface(envelope.workflow.workflowInterface ?? envelope.workflowInterface);
    const declaredInterface = normalizeWorkflowInterface(envelope.workflowInterface ?? envelope.workflow.workflowInterface);
    if (JSON.stringify(embeddedInterface) !== JSON.stringify(declaredInterface)) {
      throw new Error("Metadata interface của tệp .tess không khớp workflow bên trong.");
    }
    return {
      ...envelope.workflow,
      workflowId,
      // V0/v1/v2 không khai báo hợp đồng typed: adapter page sẽ suy ra từ port
      // type; một lần lưu kế tiếp sẽ ghi v1 minh bạch.
      dataContractVersion: dataContractVersion || TESS_DATA_CONTRACT_VERSION,
      workflowInterface: embeddedInterface,
    };
  }
  // Giữ khả năng mở workflow JSON cũ; lần lưu tiếp theo sẽ chuyển sang .tess.
  return JSON.parse(sourceText);
}
