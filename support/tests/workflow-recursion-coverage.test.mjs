import assert from "node:assert/strict";
import test from "node:test";

const { findWorkflowReferenceCycles, workflowReferenceKey } = await import("../../shared/workflow-recursion.mjs");

test("uses workflow ID and normalized file path so copied workflows do not become a false recursion", async () => {
  const test2 = { workflowId: "copied-id", path: "C:\\Test\\Test 2.tess", label: "Test 2", calls: [{ id: "test2-calls-test1", target: "test1" }] };
  const test1 = { workflowId: "copied-id", path: "C:/Test/Test 1.tess", label: "Test 1", calls: [] };
  const documents = new Map([["test1", test1]]);
  const cycles = await findWorkflowReferenceCycles(test2, {
    getKey: (workflow) => workflowReferenceKey({ workflowId: workflow.workflowId, path: workflow.path }),
    getLabel: (workflow) => workflow.label,
    getCalls: (workflow) => workflow.calls,
    resolveTarget: async (call) => documents.get(call.target),
  });
  assert.deepEqual(cycles, []);
});

test("normalizes Windows path spelling when detecting the same workflow", () => {
  assert.equal(
    workflowReferenceKey({ workflowId: "workflow-a", path: "C:\\Test\\A.tess" }),
    workflowReferenceKey({ workflowId: "workflow-a", path: "c:/test/a.tess" }),
  );
});

test("detects indirect workflow recursion A to B to A with the full call chain", async () => {
  const a = { id: "A", label: "Workflow A", calls: [{ id: "call-b", target: "B" }] };
  const b = { id: "B", label: "Workflow B", calls: [{ id: "call-a", target: "A" }] };
  const documents = new Map([[a.id, a], [b.id, b]]);
  const cycles = await findWorkflowReferenceCycles(a, {
    getKey: (document) => document.id,
    getLabel: (document) => document.label,
    getCalls: (document) => document.calls,
    resolveTarget: async (call) => documents.get(call.target),
  });

  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].originCall.id, "call-a");
  assert.deepEqual(cycles[0].chain, ["Workflow A", "Workflow B", "Workflow A"]);
});
