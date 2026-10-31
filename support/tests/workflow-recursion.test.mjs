import assert from "node:assert/strict";
import test from "node:test";

const { findWorkflowReferenceCycles } = await import("../../shared/workflow-recursion.mjs");

function workflow(id, calls = []) {
  return { id, label: `Workflow ${id}`, calls };
}

async function cyclesFrom(root, documents) {
  return findWorkflowReferenceCycles(root, {
    getKey: (document) => document.id,
    getLabel: (document) => document.label,
    getCalls: (document) => document.calls,
    resolveTarget: async (call) => documents.get(call.target),
  });
}

test("detects direct workflow recursion A to A with the full call chain", async () => {
  const a = workflow("A", [{ id: "call-a", target: "A" }]);
  const cycles = await cyclesFrom(a, new Map([["A", a]]));

  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].originCall.id, "call-a");
  assert.deepEqual(cycles[0].chain, ["Workflow A", "Workflow A"]);
});

test("detects indirect workflow recursion A to B to C to A with the full chain", async () => {
  const a = workflow("A", [{ id: "call-b", target: "B" }]);
  const b = workflow("B", [{ id: "call-c", target: "C" }]);
  const c = workflow("C", [{ id: "call-a", target: "A" }]);
  const cycles = await cyclesFrom(a, new Map([["A", a], ["B", b], ["C", c]]));

  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].originCall.id, "call-b");
  assert.deepEqual(cycles[0].chain, ["Workflow A", "Workflow B", "Workflow C", "Workflow A"]);
});

test("allows a non-recursive call graph", async () => {
  const a = workflow("A", [{ id: "call-b", target: "B" }]);
  const b = workflow("B", [{ id: "call-c", target: "C" }]);
  const c = workflow("C");
  const cycles = await cyclesFrom(a, new Map([["A", a], ["B", b], ["C", c]]));

  assert.deepEqual(cycles, []);
});
