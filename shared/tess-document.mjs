export const TESS_EXTENSION = ".tess";
export const TESS_MAGIC = "TESSERACT/1";
export const TESS_FORMAT = "tesseract-workflow";
export const TESS_DOCUMENT_VERSION = 2;
export const TESS_INTERFACE_VERSION = 1;

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
  return {
    id,
    name,
    type,
    required: port.required === true,
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

export function prepareWorkflowForSave(workflow) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    throw new Error("Workflow cần lưu không hợp lệ.");
  }
  const workflowId = text(workflow.workflowId) || createWorkflowId();
  return {
    ...workflow,
    workflowId,
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
    if (envelope.version === undefined || envelope.version < TESS_DOCUMENT_VERSION) return envelope.workflow;
    const workflowId = text(envelope.workflow.workflowId) || text(envelope.workflowId);
    if (!workflowId) throw new Error("Tệp .tess thiếu ID workflow ổn định.");
    const embeddedInterface = normalizeWorkflowInterface(envelope.workflow.workflowInterface ?? envelope.workflowInterface);
    const declaredInterface = normalizeWorkflowInterface(envelope.workflowInterface ?? envelope.workflow.workflowInterface);
    if (JSON.stringify(embeddedInterface) !== JSON.stringify(declaredInterface)) {
      throw new Error("Metadata interface của tệp .tess không khớp workflow bên trong.");
    }
    return { ...envelope.workflow, workflowId, workflowInterface: embeddedInterface };
  }
  // Giữ khả năng mở workflow JSON cũ; lần lưu tiếp theo sẽ chuyển sang .tess.
  return JSON.parse(sourceText);
}
