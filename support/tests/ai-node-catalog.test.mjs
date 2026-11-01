import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { AI_CORE_V1, AI_NODE_AUDIT_V1 } from "../../shared/ai-node-catalog.mjs";

test("AI node audit v1 covers each existing AI family exactly once", async () => {
  assert.deepEqual(AI_CORE_V1, ["Cấu hình AI", "Tạo prompt", "Thực thi tác vụ AI", "Kiểm tra bằng AI"]);
  assert.equal(AI_NODE_AUDIT_V1.length, 12);
  assert.equal(new Set(AI_NODE_AUDIT_V1.map((entry) => entry.family)).size, AI_NODE_AUDIT_V1.length);

  const specs = await readFile(new URL("../../app/node-specs.ts", import.meta.url), "utf8");
  for (const entry of AI_NODE_AUDIT_V1) {
    assert.match(specs, new RegExp(`"name": "${entry.family}"`));
    assert.ok(entry.inputs.length > 0);
    assert.ok(entry.outputs.length > 0);
  }
});

test("AI audit keeps old workflows and separates media from generic AI execution", () => {
  const byFamily = Object.fromEntries(AI_NODE_AUDIT_V1.map((entry) => [entry.family, entry]));
  assert.equal(byFamily["Gọi AI tạo văn bản"].decision, "migrate");
  assert.equal(byFamily["Gọi AI trả JSON"].decision, "migrate");
  assert.equal(byFamily["Phân tích video bằng AI"].decision, "move-to-media");
  assert.equal(byFamily["Chấm điểm đầu ra AI"].decision, "compatibility-only");
  assert.equal(byFamily["Duyệt đầu ra AI"].decision, "compatibility-only");
});
