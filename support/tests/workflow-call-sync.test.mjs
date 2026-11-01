import assert from "node:assert/strict";
import test from "node:test";

const { planWorkflowCallInterfaceSync, reconnectIssuesForWorkflowCall } = await import("../../shared/workflow-call-sync.mjs");

const image = { id: "image", name: "Ảnh", type: "Image[]", artifactType: "ImageSet", cardinality: "many", required: true };
const text = { id: "text", name: "Văn bản", type: "Text", artifactType: "Text", cardinality: "one", required: false };

test("workflow call sync keeps stable ports and reports only changed contracts", () => {
  const plan = planWorkflowCallInterfaceSync(
    { inputs: [image], outputs: [text] },
    { inputs: [{ ...image, name: "Ảnh nguồn" }], outputs: [{ ...text, type: "JSON", artifactType: "Record" }] },
  );
  assert.equal(plan.changed, true);
  assert.equal(plan.changes.length, 2);
  assert.equal(plan.changes.find((item) => item.id === "image")?.reconnectRequired, false);
  assert.equal(plan.changes.find((item) => item.id === "text")?.reconnectRequired, true);
});

test("workflow call sync never deletes lines and lists only lines that need reconnecting", () => {
  const plan = planWorkflowCallInterfaceSync(
    { inputs: [image], outputs: [text] },
    { inputs: [], outputs: [{ ...text, type: "JSON", artifactType: "Record" }] },
  );
  const edges = [
    { id: "keep-label-change", source: "source", sourceHandle: "out", target: "call", targetHandle: "workflow-port-image" },
    { id: "output-contract-change", source: "call", sourceHandle: "workflow-port-text", target: "viewer", targetHandle: "in" },
  ];
  const reconnect = reconnectIssuesForWorkflowCall({ edges, nodeId: "call", plan });
  assert.deepEqual(reconnect.map((item) => item.edgeId), ["keep-label-change", "output-contract-change"]);
  assert.match(reconnect[0].reason, /đã bị xóa/);
  assert.match(reconnect[1].reason, /đã thay đổi/);
  assert.equal(edges.length, 2);
});

test("adding a workflow port does not request reconnecting existing lines", () => {
  const plan = planWorkflowCallInterfaceSync(
    { inputs: [image], outputs: [] },
    { inputs: [image, text], outputs: [] },
  );
  assert.equal(plan.changes[0].kind, "added");
  assert.deepEqual(reconnectIssuesForWorkflowCall({
    edges: [{ id: "image-line", source: "source", sourceHandle: "out", target: "call", targetHandle: "workflow-port-image" }],
    nodeId: "call",
    plan,
  }), []);
});
