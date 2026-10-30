import assert from "node:assert/strict";
import test from "node:test";
import { isWorkflowDocumentPath, parseWorkflowDocument, serializeTessWorkflow, workflowNameFromPath, workflowPathWithTessExtension } from "../../shared/tess-document.mjs";

test("Tesseract saves a distinct .tess container and reads it back", () => {
  const workflow = { version: 6, name: "Kế hoạch quý 4", nodes: [], edges: [], groups: [] };
  const serialized = serializeTessWorkflow(workflow);
  assert.match(serialized, /^TESSERACT\/1\n/);
  assert.deepEqual(parseWorkflowDocument(serialized), workflow);
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
