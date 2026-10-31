import assert from "node:assert/strict";
import test from "node:test";
import { isWorkflowDocumentPath, parseWorkflowDocument, prepareWorkflowForSave, serializeTessWorkflow, validateWorkflowInterface, workflowNameFromPath, workflowPathWithTessExtension } from "../../shared/tess-document.mjs";

test("Tesseract saves a distinct .tess container and reads it back", () => {
  const workflow = { version: 6, name: "Kế hoạch quý 4", nodes: [], edges: [], groups: [] };
  const serialized = serializeTessWorkflow(workflow);
  assert.match(serialized, /^TESSERACT\/1\n/);
  const parsed = parseWorkflowDocument(serialized);
  assert.equal(parsed.name, workflow.name);
  assert.match(parsed.workflowId, /^workflow-/);
  assert.deepEqual(parsed.workflowInterface, { version: 1, inputs: [], outputs: [] });
});

test("Tesseract persists a stable validated workflow interface", () => {
  const workflow = prepareWorkflowForSave({
    version: 6,
    name: "Workflow có cổng",
    workflowId: "workflow-stable-id",
    workflowInterface: {
      version: 1,
      inputs: [{ id: "brief", name: "Brief", type: "Text", required: true }],
      outputs: [{ id: "result", name: "Kết quả", type: "Text" }],
    },
    nodes: [],
    edges: [],
  });
  assert.equal(parseWorkflowDocument(serializeTessWorkflow(workflow)).workflowId, "workflow-stable-id");
  assert.equal(validateWorkflowInterface({ inputs: [{ id: "x", name: "X", type: "Text" }], outputs: [] }).valid, true);
  assert.equal(validateWorkflowInterface({ inputs: [{ id: "x", name: "", type: "Text" }], outputs: [] }).valid, false);
});

test("Tesseract keeps legacy JSON readable but writes every new path as .tess", () => {
  const legacy = { version: 6, name: "Workflow cũ", nodes: [], edges: [] };
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(legacy)), legacy);
  assert.equal(workflowPathWithTessExtension("C:\\Work\\Kế hoạch.json"), "C:\\Work\\Kế hoạch.tess");
  assert.equal(workflowPathWithTessExtension("C:\\Work\\Kế hoạch"), "C:\\Work\\Kế hoạch.tess");
  assert.equal(workflowNameFromPath("C:\\Work\\Kế hoạch.tess"), "Kế hoạch");
  assert.equal(isWorkflowDocumentPath("C:\\Work\\Kế hoạch.tess"), true);
  assert.equal(isWorkflowDocumentPath("C:\\Work\\Kế hoạch.json"), true);
  assert.equal(isWorkflowDocumentPath("C:\\Work\\Kế hoạch.txt"), false);
});
