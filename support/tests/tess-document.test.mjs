import assert from "node:assert/strict";
import test from "node:test";
import { TESS_DATA_CONTRACT_VERSION, TESS_DOCUMENT_VERSION, TESS_MAGIC, describeWorkflowInterfaceChange, isWorkflowDocumentPath, parseWorkflowDocument, prepareWorkflowForSave, serializeTessWorkflow, validateWorkflowInterface, workflowInterfaceFingerprint, workflowNameFromPath, workflowPathWithTessExtension } from "../../shared/tess-document.mjs";

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

test("workflow interfaces persist typed port contracts and describe a caller-breaking change", () => {
  const before = {
    version: 1,
    inputs: [{ id: "media", name: "Media", type: "Image[]", artifactType: "ImageSet", cardinality: "many", required: true }],
    outputs: [{ id: "report", name: "Báo cáo", type: "AIAnalysis", artifactType: "Report", cardinality: "one", required: false }],
  };
  const parsed = parseWorkflowDocument(serializeTessWorkflow({ version: 6, name: "Typed workflow", workflowId: "workflow-typed", workflowInterface: before, nodes: [], edges: [] }));
  assert.equal(parsed.workflowInterface.inputs[0].artifactType, "ImageSet");
  assert.equal(parsed.workflowInterface.inputs[0].cardinality, "many");
  assert.equal(workflowInterfaceFingerprint(before), workflowInterfaceFingerprint(parsed.workflowInterface));

  const after = { ...before, outputs: [{ ...before.outputs[0], type: "Text", artifactType: "Text" }] };
  assert.match(describeWorkflowInterfaceChange(before, after), /đổi hợp đồng cổng đầu ra “Báo cáo”/);
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

test("Tesseract migrates earlier .tess contracts and rejects versions newer than the app", () => {
  const legacyEnvelope = {
    format: "tesseract-workflow",
    version: 2,
    workflowId: "workflow-v2",
    workflowInterface: { version: 1, inputs: [], outputs: [] },
    workflow: { version: 6, name: "Bản v2", workflowId: "workflow-v2", workflowInterface: { version: 1, inputs: [], outputs: [] }, nodes: [], edges: [] },
  };
  const migrated = parseWorkflowDocument(`${TESS_MAGIC}\n${JSON.stringify(legacyEnvelope)}`);
  assert.equal(migrated.workflowId, "workflow-v2");
  assert.equal(migrated.dataContractVersion, TESS_DATA_CONTRACT_VERSION);

  const future = { ...legacyEnvelope, version: TESS_DOCUMENT_VERSION + 1 };
  assert.throws(
    () => parseWorkflowDocument(`${TESS_MAGIC}\n${JSON.stringify(future)}`),
    /mới hơn Tesseract hiện tại/,
  );
});
