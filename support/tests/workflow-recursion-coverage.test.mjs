import assert from "node:assert/strict";
import test from "node:test";

const { findWorkflowReferenceCycles } = await import("../../shared/workflow-recursion.mjs");

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
  assert.equal(cycles[0].originCall.id, "call-b");
  assert.deepEqual(cycles[0].chain, ["Workflow A", "Workflow B", "Workflow A"]);
});
