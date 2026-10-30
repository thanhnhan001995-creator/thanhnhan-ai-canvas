export const TESS_EXTENSION = ".tess";
export const TESS_MAGIC = "TESSERACT/1";
export const TESS_FORMAT = "tesseract-workflow";

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
  return `${TESS_MAGIC}\n${JSON.stringify({ format: TESS_FORMAT, version: 1, workflow }, null, 2)}\n`;
}

export function parseWorkflowDocument(source) {
  const text = String(source ?? "").replace(/^\uFEFF/, "");
  if (text.trimStart().startsWith(TESS_MAGIC)) {
    const payload = text.slice(text.indexOf(TESS_MAGIC) + TESS_MAGIC.length).trim();
    const envelope = JSON.parse(payload);
    if (!envelope || envelope.format !== TESS_FORMAT || !envelope.workflow || typeof envelope.workflow !== "object") {
      throw new Error("Tệp .tess không đúng định dạng Tesseract.");
    }
    return envelope.workflow;
  }
  // Giữ khả năng mở workflow JSON cũ; lần lưu tiếp theo sẽ chuyển sang .tess.
  return JSON.parse(text);
}
