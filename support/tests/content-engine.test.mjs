import assert from "node:assert/strict";
import test from "node:test";

const { executeCalledWorkflow, executeWorkflowNode, frameImageAssets, parseDurationInput } = await import("../../app/research-client.ts");
const { NODE_SPECS } = await import("../../app/node-specs.ts");
const { BASIC_NODE_PRESETS } = await import("../../app/basic-node-presets.ts");
const { SELF_CONFIGURED_NODE_NAMES, getPortContract, portTypesCompatible } = await import("../../app/node-contracts.ts");
const { hasNodeExecutor } = await import("../../app/node-execution.ts");
const { displayPortLabel, getPortVisual } = await import("../../app/port-library.ts");
const { currentOpenAiModel, getAiModelCapabilities, openAiImageDetail, openAiResponseVerbosity, replacementForRetiredOpenAiModel, supportsOpenAiReasoning } = await import("../../app/ai-model-capabilities.ts");
const { localAiModelIds, mergeScannedOllamaModel, normalizeLocalAiRegistry, removeLocalAiModel } = await import("../../app/local-ai-registry.ts");
const { nextNodeName } = await import("../../app/node-identity.ts");
const { aiExecutionProfile, aiReport, artifactOutputsForPorts, artifactSummary, artifactTypeForPortType, cardinalityForPortType, executionDiagnostic, finishNodeRun, isArtifact, portCardinalityCompatible, portSpecFor, startNodeRun, taskSpec, unwrapArtifact } = await import("../../app/data-contracts.ts");

function workflowNode(label, inputTypes, outputTypes, config = {}) {
  return {
    id: `test-${label}`,
    data: {
      label,
      category: "Phát triển nội dung",
      kind: `test-${label}`,
      inputs: inputTypes.map((type, index) => ({ id: `input-${index + 1}`, type })),
      outputs: outputTypes.map((type, index) => ({ id: `output-${index + 1}`, type })),
      config,
    },
  };
}

test("local Ollama registry keeps only user-added models and never removes the installed model", () => {
  const initial = normalizeLocalAiRegistry([
    { id: "qwen3:4b", provider: "Ollama", size: 2_500, addedAt: "2026-10-31T00:00:00.000Z" },
    { id: "qwen3:4b", provider: "Other", addedAt: "bad" },
    { id: "", provider: "Ollama" },
  ]);
  assert.deepEqual(localAiModelIds(initial), ["qwen3:4b"]);
  const added = mergeScannedOllamaModel(initial, { id: "qwen3-vl:2b-instruct", provider: "Ollama", size: 1_930_568_531, modifiedAt: "2026-10-29T23:56:16Z" }, "2026-10-31T01:00:00.000Z");
  assert.deepEqual(localAiModelIds(added), ["qwen3-vl:2b-instruct", "qwen3:4b"]);
  assert.deepEqual(localAiModelIds(removeLocalAiModel(added, "qwen3:4b")), ["qwen3-vl:2b-instruct"]);
  assert.equal(getAiModelCapabilities("Ollama", "qwen3:4b").text, "supported");
  assert.equal(getAiModelCapabilities("Ollama", "embeddinggemma:latest").text, "unsupported");
});

test("artifact contracts preserve data type, cardinality, provenance, and legacy payload access", () => {
  assert.equal(artifactTypeForPortType("Image[]"), "ImageSet");
  assert.equal(artifactTypeForPortType("FrameIndex"), "FrameIndex");
  assert.equal(artifactTypeForPortType("TimedTranscript"), "TimedTranscript");
  assert.equal(artifactTypeForPortType("AIText"), "Text");
  assert.equal(artifactTypeForPortType("AIJson"), "Record");
  assert.equal(cardinalityForPortType("Image[]"), "many");
  assert.equal(cardinalityForPortType("ImageSearchList"), "many");
  assert.equal(cardinalityForPortType("Audio"), "one");

  const imagesPort = portSpecFor({ id: "output-images", label: "image[]", type: "Image[]" });
  const singleImagePort = portSpecFor({ id: "input-image", label: "image", type: "Image" });
  assert.equal(portCardinalityCompatible(imagesPort, singleImagePort), false);
  assert.equal(portCardinalityCompatible(singleImagePort, imagesPort), true);

  const payload = [{ name: "frame-0001.jpg", localPath: "C:/tmp/frame-0001.jpg", type: "image/jpeg" }];
  const outputs = artifactOutputsForPorts({ "output-images": payload }, [imagesPort], {
    workflowId: "workflow-1",
    nodeId: "node-prepare",
    runId: "run-1",
  });
  assert.ok(isArtifact(outputs["output-images"]));
  assert.equal(outputs["output-images"].type, "ImageSet");
  assert.equal(outputs["output-images"].provenance.portId, "output-images");
  assert.deepEqual(unwrapArtifact(outputs["output-images"]), payload);
  assert.equal(artifactSummary(outputs["output-images"]).location, undefined);

  const running = startNodeRun({ runId: "run-1", nodeId: "node-prepare", status: "running", inputs: [artifactSummary(outputs["output-images"])] });
  const failed = finishNodeRun(running, "failed", { diagnostic: executionDiagnostic(new Error("Thiếu ảnh mẫu")) });
  assert.equal(failed.status, "failed");
  assert.equal(failed.diagnostics[0].code, "execution_failed");
  assert.match(failed.diagnostics[0].message, /Thiếu ảnh mẫu/);
});

test("AI execution profiles keep secrets out of portable contracts and reports retain their task", () => {
  const profile = aiExecutionProfile({
    provider: "Ollama",
    model: "qwen3:4b",
    localEndpoint: "http://127.0.0.1:11434",
    secretRef: "ai-profile:node-1",
    temperature: 0.4,
    maxOutputTokens: 800,
  });
  assert.equal(profile.kind, "tesseract-ai-profile");
  assert.equal(profile.executionMode, "local");
  assert.equal(profile.secretRef, "ai-profile:node-1");
  assert.equal(Object.hasOwn(profile, "apiKey"), false);

  const task = taskSpec({
    nodeId: "node-1",
    goal: "Tóm tắt tài liệu",
    expectedOutput: "Report",
    inputTypes: ["Text", "Text"],
  });
  const report = aiReport({
    status: "needs-review",
    conclusion: "Đã tóm tắt từ nguồn đầu vào.",
    evidence: [{ source: "input-1" }],
    needsFix: false,
    task,
  });
  assert.equal(report.task.id, task.id);
  assert.equal(report.status, "needs-review");
  assert.equal(report.evidence.length, 1);
});

test("AI setup node emits a reusable profile without exposing its API key", async () => {
  const providerNode = workflowNode("Chọn nhà cung cấp AI", ["APIKey"], ["AIProvider"], {
    provider: "OpenAI",
    apiKey: "test-secret-key",
    maxInputTokens: 12000,
  });
  const providerOutput = await executeWorkflowNode(providerNode, {}, new Map());
  const profile = providerOutput["output-1"];
  assert.equal(profile.kind, "tesseract-ai-profile");
  assert.equal(profile.provider, "OpenAI");
  assert.equal(profile.maxInputTokens, 12000);
  assert.equal(Object.hasOwn(profile, "apiKey"), false);
  assert.match(profile.secretRef, /^ai-profile:/);
});

test("basic catalog covers valid primitive nodes without replacing the advanced catalog", () => {
  const primitiveNames = new Set(NODE_SPECS.map((spec) => spec.name));
  assert.equal(BASIC_NODE_PRESETS.length, 65);
  assert.equal(new Set(BASIC_NODE_PRESETS.map((preset) => preset.id)).size, 65);
  for (const preset of BASIC_NODE_PRESETS) {
    assert.ok(preset.nodes.length > 0, `${preset.label} has no steps`);
    for (const label of preset.nodes) assert.ok(primitiveNames.has(label), `${preset.label} references missing node ${label}`);
  }
  assert.equal(NODE_SPECS.length, 242);
  assert.deepEqual(BASIC_NODE_PRESETS.find((preset) => preset.id === "ai-task")?.nodes, ["Thực thi tác vụ AI"]);
  assert.deepEqual(BASIC_NODE_PRESETS.find((preset) => preset.id === "ai-check")?.nodes, ["Kiểm tra bằng AI"]);
  assert.equal(BASIC_NODE_PRESETS.find((preset) => preset.id === "ai-media")?.hiddenInLibrary, true);
  assert.equal(BASIC_NODE_PRESETS.find((preset) => preset.id === "media-image-ai")?.category, "Hình ảnh");
  assert.equal(BASIC_NODE_PRESETS.find((preset) => preset.id === "media-audio-ai")?.category, "Âm thanh");
  assert.equal(BASIC_NODE_PRESETS.find((preset) => preset.id === "media-video-ai")?.category, "Video");
  assert.equal(NODE_SPECS.find((spec) => spec.name === "Thực thi tác vụ AI")?.output, "AIResult, Report, CachedData");
  assert.equal(BASIC_NODE_PRESETS.find((preset) => preset.id === "ai-media")?.label, "Phân tích media bằng AI");
  assert.deepEqual(BASIC_NODE_PRESETS.find((preset) => preset.id === "ai-media")?.nodes, ["Phân tích hình ảnh bằng AI", "Phân tích âm thanh bằng AI", "Phân tích video bằng AI"]);
  assert.match(NODE_SPECS.find((spec) => spec.name === "Phân tích video bằng AI")?.input ?? "", /FrameIndex/);
  assert.equal(NODE_SPECS.find((spec) => spec.name === "Phân tích hình ảnh bằng AI")?.group, "Hình ảnh");
  assert.equal(NODE_SPECS.find((spec) => spec.name === "Phân tích âm thanh bằng AI")?.group, "Âm thanh");
  assert.equal(NODE_SPECS.find((spec) => spec.name === "Phân tích video bằng AI")?.group, "Video");
  assert.deepEqual(BASIC_NODE_PRESETS.find((preset) => preset.id === "prepare-video-analysis")?.nodes, ["Trích frame từ video", "Tách âm thanh từ video", "Phiên âm video theo thời gian"]);
  assert.equal(BASIC_NODE_PRESETS.find((preset) => preset.id === "prepare-video-analysis")?.category, "Video");
  assert.equal(BASIC_NODE_PRESETS.some((preset) => preset.id === "extract-video-frames"), false);
  assert.equal(NODE_SPECS.find((spec) => spec.name === "Tìm ảnh tương đồng")?.group, "Hình ảnh");
  assert.match(NODE_SPECS.find((spec) => spec.name === "Tìm ảnh tương đồng")?.input ?? "", /ImageSample, ImageSearch, ImageSearchList, SearchFolder, FrameIndex/);
});

test("node identity separates immutable family from user-editable name", async () => {
  const existing = [
    { data: { family: "Nguồn file", label: "Nguồn file 1" } },
    { data: { family: "Nguồn file", label: "Video game đã chọn" } },
    { data: { family: "Nguồn folder", label: "Nguồn folder 1" } },
  ];
  assert.equal(nextNodeName("Nguồn file", existing), "Nguồn file 3");
  assert.equal(nextNodeName("Nguồn folder", existing), "Nguồn folder 2");

  const renamedQualityNode = workflowNode("Bản kiểm tra do người dùng đặt", ["Dữ liệu"], ["QAReport"], { requirements: "Hades" });
  renamedQualityNode.data.family = "Kiểm tra yêu cầu và cấu trúc";
  const result = await executeWorkflowNode(renamedQualityNode, { "input-1": "Hades xuất hiện trong nội dung." }, new Map());
  assert.equal(result["output-1"].status, "Đạt");
});

test("ports in the same group keep their shape level but use distinct type colors", () => {
  const visuals = ["Audio", "Document", "File", "Image", "Video"].map(getPortVisual);
  assert.ok(visuals.every((visual) => visual.shape === "triangle"));
  assert.equal(new Set(visuals.map((visual) => visual.color)).size, visuals.length);
  assert.equal(getPortVisual("Video").color, getPortVisual("Video").color);
});

test("every visible port name is the lowest declared hierarchy level", () => {
  assert.equal(displayPortLabel("AIText"), "text");
  assert.equal(displayPortLabel("AIAnalysis"), "analysis");
  assert.equal(displayPortLabel("Video[]"), "video[]");
  assert.equal(displayPortLabel("Dữ liệu"), "free");
});

test("every visible input port has a compatible output contract", () => {
  const outputTypes = NODE_SPECS.flatMap((spec) => spec.output.split(",").map((type) => type.trim()).filter(Boolean));
  const unresolved = NODE_SPECS.flatMap((spec) => {
    if (spec.group === "Đầu vào" || SELF_CONFIGURED_NODE_NAMES.has(spec.name)) return [];
    return spec.input.split(",").map((type) => type.trim()).filter(Boolean)
      .filter((input) => !outputTypes.some((output) => portTypesCompatible(output, input)))
      .map((input) => `${spec.name}: ${input}`);
  });
  assert.deepEqual(unresolved, []);
  assert.equal(portTypesCompatible("AIAnalysis", "Dữ liệu"), true);
  assert.deepEqual(getPortContract("Dữ liệu"), { hierarchy: { free: "free" }, size: "all", lowestLevel: "free" });
  assert.deepEqual(getPortContract("Video"), { hierarchy: { free: "free", group: "data", type: "video" }, size: "exact", lowestLevel: "type" });
  assert.equal(getPortContract("AIAnalysis").lowestLevel, "kind");
  assert.equal(portTypesCompatible("Video", "Audio"), false);
  assert.equal(portTypesCompatible("AIAnalysis", "AIAnalysis"), true);
  assert.equal(portTypesCompatible({ type: "Video", connectSize: "all" }, "VideoIndex"), true);
  assert.equal(portTypesCompatible({ type: "VideoIndex", connectSize: "up" }, "Video"), true);
  assert.equal(portTypesCompatible({ type: "Video", connectSize: "all" }, "Audio"), false);
  assert.equal(portTypesCompatible("Boolean", "Condition"), true);
  assert.equal(portTypesCompatible("Image[]", "ImageSample"), true);
  assert.equal(portTypesCompatible("Image[]", "ImageSearchList"), true);
  assert.equal(portTypesCompatible("Folder", "SearchFolder"), true);
});

test("If/Else and Switch use the Condition port before their local fallback", async () => {
  const ifNode = workflowNode("If/Else", ["Dữ liệu bất kỳ", "Condition"], ["Nhánh đúng", "Nhánh sai"], { fallbackCondition: "Sai" });
  ifNode.data.category = "Điều khiển workflow";
  const trueBranch = await executeWorkflowNode(ifNode, { "input-1": { id: "payload" }, "input-2": true }, new Map());
  assert.deepEqual(trueBranch["output-1"], { id: "payload" });
  assert.equal(trueBranch["output-2"], undefined);
  const falseBranch = await executeWorkflowNode(ifNode, { "input-1": { id: "payload" }, "input-2": false }, new Map());
  assert.deepEqual(falseBranch["output-2"], { id: "payload" });

  const switchNode = workflowNode("Switch", ["Dữ liệu bất kỳ", "Condition"], ["Nhánh 1", "Nhánh 2", "Mặc định"], { case1: "win", case2: "lose", ignoreCase: true });
  switchNode.data.category = "Điều khiển workflow";
  const matched = await executeWorkflowNode(switchNode, { "input-1": "video", "input-2": "WIN" }, new Map());
  assert.equal(matched["output-1"], "video");
  const fallback = await executeWorkflowNode(switchNode, { "input-1": "video", "input-2": "draw" }, new Map());
  assert.equal(fallback["output-3"], "video");
});

test("basic source blocks configure their own query, files, media, URL, or local library", () => {
  const sourceBlocks = BASIC_NODE_PRESETS.filter((preset) => preset.sourceNode).map((preset) => preset.id);
  assert.deepEqual(sourceBlocks, ["direct-input", "file-source", "folder-source", "image-folder-source", "web-research"]);
  assert.equal(BASIC_NODE_PRESETS.some((preset) => preset.id === "collect-video"), false);
  assert.deepEqual(BASIC_NODE_PRESETS.find((preset) => preset.id === "file-source")?.nodes, ["Tải file không rõ kiểu", "Nhập tài liệu", "Tải ảnh lên", "Tải âm thanh lên", "Tải video lên"]);
  const sourceIds = new Set(["direct-input", "file-source", "folder-source", "image-folder-source"]);
  assert.ok(BASIC_NODE_PRESETS.filter((preset) => sourceIds.has(preset.id)).every((preset) => preset.category === "Đầu vào"));
  assert.deepEqual(BASIC_NODE_PRESETS.filter((preset) => sourceIds.has(preset.id)).map((preset) => preset.label), ["Nhập trực tiếp", "Nguồn file", "Nguồn folder", "Kho ảnh từ thư mục"]);
  assert.deepEqual(BASIC_NODE_PRESETS.find((preset) => preset.id === "direct-input")?.nodes, ["Nhập văn bản", "Nhập URL", "Nhập ngày giờ", "Nhập thời gian", "Nhập Boolean", "Nhập biến"]);
  assert.deepEqual(BASIC_NODE_PRESETS.find((preset) => preset.id === "file-source")?.operationLabels, { "Tải file không rõ kiểu": "Không rõ kiểu file", "Nhập tài liệu": "Văn bản", "Tải ảnh lên": "Hình ảnh", "Tải âm thanh lên": "Âm thanh", "Tải video lên": "Video" });
  assert.deepEqual(BASIC_NODE_PRESETS.find((preset) => preset.id === "edit-image")?.nodes, ["Xóa nền ảnh", "Thay nền ảnh", "Mở rộng khung ảnh", "Resize/crop ảnh", "Upscale ảnh"]);
  assert.deepEqual(BASIC_NODE_PRESETS.find((preset) => preset.id === "finish-image")?.nodes, ["Chỉnh màu ảnh", "Thêm chữ vào ảnh", "Thêm logo vào ảnh"]);
  assert.deepEqual(BASIC_NODE_PRESETS.find((preset) => preset.id === "review-image")?.nodes, ["Chấm điểm ảnh", "Chọn ảnh", "Duyệt ảnh"]);
  assert.deepEqual(BASIC_NODE_PRESETS.find((preset) => preset.id === "image-search")?.nodes, ["Tìm ảnh tương đồng"]);
  assert.deepEqual(BASIC_NODE_PRESETS.find((preset) => preset.id === "video-highlight")?.nodes, ["Chọn highlight bằng AI", "Dựng video highlight"]);
});

test("multi-choice blocks expose every contract, while one-operation blocks are fixed", () => {
  const choiceBlocks = BASIC_NODE_PRESETS.filter((preset) => preset.mode === "choice");
  assert.ok(choiceBlocks.length > 0);
  for (const preset of choiceBlocks) {
    assert.ok(preset.nodes.length > 0, `${preset.label} needs at least one selectable operation`);
  }
  const fixedBlocks = choiceBlocks.filter((preset) => preset.nodes.length === 1);
  assert.deepEqual(fixedBlocks.map((preset) => preset.id), ["topic-input", "folder-source", "image-folder-source", "brand-input", "audience-profile", "content-angle", "content-outline", "image-search", "thumbnail-image-select"]);
  assert.ok(choiceBlocks.filter((preset) => preset.nodes.length > 1).every((preset) => preset.nodes.length > 1));
});

test("direct time input normalizes unit strings and plain seconds", () => {
  assert.equal(parseDurationInput("3d120m"), 266400);
  assert.equal(parseDurationInput("1y2M3d4h5m6s"), 36993906);
  assert.equal(parseDurationInput("3600"), 3600);
  assert.throws(() => parseDurationInput("1h30"), /Định dạng thời gian/);
});

test("AI prompt nodes return the composed prompt instead of a runtime stub", async () => {
  const systemNode = {
    id: "system-prompt",
    data: {
      label: "Soạn system prompt",
      category: "AI & mô hình",
      kind: "system-prompt",
      inputs: [{ id: "input-1", type: "Text" }],
      outputs: [{ id: "output-1", type: "SystemPrompt" }],
      config: { role: "Biên tập viên nội dung", rules: "Không bịa nguồn.", responseFormat: "Markdown" },
    },
  };
  const system = await executeWorkflowNode(systemNode, { "input-1": "Dữ liệu cần kiểm chứng" }, new Map());
  assert.match(system["output-1"], /Bạn là Biên tập viên nội dung/);
  assert.match(system["output-1"], /Không bịa nguồn/);
  assert.match(system["output-1"], /Markdown/);

  const promptNode = {
    id: "data-prompt",
    data: {
      label: "Tạo prompt từ dữ liệu",
      category: "AI & mô hình",
      kind: "data-prompt",
      inputs: [{ id: "input-1", type: "Data" }],
      outputs: [{ id: "output-1", type: "Prompt" }],
      config: { template: "Tóm tắt dữ liệu", instructions: "Ưu tiên mốc thời gian." },
    },
  };
  const prompt = await executeWorkflowNode(promptNode, { "input-1": { title: "Video thử", duration: 120 } }, new Map());
  assert.match(prompt["output-1"], /Hãy tóm tắt dữ liệu/);
  assert.match(prompt["output-1"], /Video thử/);
  assert.match(prompt["output-1"], /Ưu tiên mốc thời gian/);

  const pureNode = workflowNode("Tạo prompt thuần", ["Dữ liệu", "Biến"], ["Prompt"], { content: "Hãy tóm tắt {{topic}}.", contextMode: "Đính kèm cuối prompt" });
  const pure = await executeWorkflowNode(pureNode, { "input-1": { title: "Nguồn thử" }, "input-2": { topic: "workflow" } }, new Map());
  assert.match(pure["output-1"], /Hãy tóm tắt workflow/);
  assert.match(pure["output-1"], /NGỮ CẢNH BỔ SUNG/);
});

test("generic AI task requires a connected profile and returns result, task spec, report and cache", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/research");
    const body = JSON.parse(String(init.body));
    assert.equal(body.action, "ai");
    assert.equal(body.provider, "OpenAI");
    assert.equal(body.model, "gpt-5.6-luna");
    assert.equal(body.json, true);
    assert.match(body.prompt, /Trích xuất/);
    assert.match(body.prompt, /Tư liệu cần trích xuất/);
    return Response.json({ result: { summary: "Đã trích xuất dữ kiện.", facts: ["A"] }, usage: { inputTokens: 40, outputTokens: 16 } });
  };
  try {
    const node = workflowNode(
      "Thực thi tác vụ AI",
      ["AIModel", "Dữ liệu", "Prompt", "SystemPrompt", "CachedData"],
      ["AIResult", "Report", "CachedData"],
      { taskType: "Trích xuất", instructions: "Trích xuất dữ kiện có căn cứ.", outputFormat: "JSON", successCriteria: "Không bịa dữ kiện" },
    );
    const result = await executeWorkflowNode(node, {
      "input-1": { provider: "OpenAI", model: "gpt-5.6-luna", apiKey: "test-api-key", maxInputTokens: 40000, maxOutputWorkflowTokens: 20000 },
      "input-2": { text: "Tư liệu cần trích xuất" },
    }, new Map());
    assert.equal(result["output-1"].taskSpec.kind, "tesseract-task");
    assert.equal(result["output-1"].report.kind, "tesseract-ai-report");
    assert.equal(result["output-2"].task.goal, "Trích xuất: Trích xuất dữ kiện có căn cứ.");
    assert.equal(result["output-3"].itemCount, 3);
    await assert.rejects(
      () => executeWorkflowNode(node, { "input-2": "Không có profile" }, new Map()),
      /cần nối cổng AIModel/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI checker returns a repairable verdict with evidence from its connected profile", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/research");
    const body = JSON.parse(String(init.body));
    assert.equal(body.action, "ai");
    assert.equal(body.json, true);
    assert.match(body.prompt, /CHECKLIST/);
    assert.match(body.prompt, /Không bịa dữ kiện/);
    return Response.json({
      result: {
        status: "Cần sửa",
        summary: "Có một dữ kiện không có nguồn.",
        evidence: [{ location: "Đoạn 2", detail: "Không thấy nguồn dẫn" }],
        issues: [{ severity: "warning", location: "Đoạn 2", reason: "Khẳng định chưa có bằng chứng.", fix: "Bổ sung nguồn hoặc bỏ khẳng định." }],
      },
      usage: { inputTokens: 60, outputTokens: 20 },
    });
  };
  try {
    const node = workflowNode(
      "Kiểm tra bằng AI",
      ["AIModel", "Dữ liệu", "CachedData"],
      ["QAReport", "Report", "CachedData"],
      { checkGoal: "Kiểm tra tính chính xác", checklist: "Không bịa dữ kiện", strictness: "Nghiêm ngặt" },
    );
    const result = await executeWorkflowNode(node, {
      "input-1": { provider: "OpenAI", model: "gpt-5.6-luna", apiKey: "test-api-key", maxInputTokens: 40000, maxOutputWorkflowTokens: 20000 },
      "input-2": "Bài viết có một khẳng định cần đối chiếu.",
    }, new Map());
    assert.equal(result["output-1"].verdict, "Cần sửa");
    assert.equal(result["output-1"].repairItems[0].location, "Đoạn 2");
    assert.equal(result["output-2"].needsFix, true);
    assert.equal(result["output-2"].task.expectedOutput, "Report");
    await assert.rejects(
      () => executeWorkflowNode(node, { "input-2": "Không có profile" }, new Map()),
      /cần nối cổng AIModel/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI material cache keeps reusable in-session references and emits a typed cache handle", async () => {
  const cacheNode = {
    id: "cache-materials",
    data: {
      label: "Cache kết quả",
      category: "Quản lý dữ liệu",
      kind: "cache-results",
      inputs: [{ id: "input-1", type: "Dữ liệu" }],
      outputs: [{ id: "output-1", type: "CachedData" }],
      config: { cacheKey: "unit-materials", retention: "30 phút" },
    },
  };
  const cached = await executeWorkflowNode(cacheNode, { "input-1": { prompt: "Tóm tắt tư liệu game", files: [{ runtimeKey: "source:images", name: "cover.png", type: "image/png", size: 128 }] } }, new Map());
  assert.equal(cached["output-1"].cacheKey, "unit-materials");
  assert.match(cached["output-1"].manifest, /cover\.png/);
  assert.match(cached["output-1"].storage, /Bộ nhớ phiên app/);
  assert.equal(hasNodeExecutor("Cache kết quả", "Quản lý dữ liệu"), true);
  assert.equal(hasNodeExecutor("Lựa chọn model AI", "AI & mô hình"), true);
  assert.equal(portTypesCompatible("CachedData", "CachedData"), true);
  assert.equal(portTypesCompatible("CachedData", "Image[]"), false);
});

test("video attention node creates up to three normalized AI priority regions from the 3x3 grid", async () => {
  const node = workflowNode("Thiết lập vùng chú ý video", ["Video"], ["AttentionRegion"], { selectionMode: "Đơn giản (lưới 3×3)", simpleCells: "0,4,8" });
  const video = new File(["video"], "match.mp4", { type: "video/mp4" });
  video.contentFlowPath = "C:\\test\\match.mp4";
  const store = new Map([["video-reference", [video]]]);
  const result = await executeWorkflowNode(node, { "input-1": [{ runtimeKey: "video-reference", fileIndex: 0, name: video.name, type: video.type }] }, store);
  assert.equal(result["output-1"].mode, "simple-3x3");
  assert.equal(result["output-1"].regions.length, 3);
  assert.deepEqual(result["output-1"].regions.map((region) => [region.x, region.y]), [[0, 0], [1 / 3, 1 / 3], [2 / 3, 2 / 3]]);
  assert.equal(result["output-1"].coordinateSystem, "normalized-0-to-1");
  assert.match(result["output-1"].instruction, /Vùng chú ý người dùng chọn/);
  assert.equal(hasNodeExecutor("Lấy vùng chú ý", "AI & mô hình"), true);
  assert.equal(hasNodeExecutor("Giảm độ phân giải ảnh", "Hình ảnh"), true);
  assert.equal(hasNodeExecutor("Làm rõ highlight lặp", "Video"), true);
});

test("iterative highlight uses local frames, never exceeds three passes or one frame per second, and returns cache", async () => {
  const originalFetch = globalThis.fetch;
  const frameRequests = [];
  const aiRequests = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.includes("/extract-frames-path")) {
      const request = JSON.parse(init.body);
      frameRequests.push(request);
      return Response.json({
        frames: request.timestamps.flatMap((timestamp) => [
          { timestamp, kind: "frame", name: `frame-${timestamp}.jpg`, base64: "aW1hZ2U=" },
          { timestamp, kind: "attention", name: `attention-${timestamp}.jpg`, base64: "aW1hZ2U=" },
        ]),
      });
    }
    if (target === "/api/research") {
      const form = init.body;
      aiRequests.push({ action: form.get("action"), model: form.get("model") });
      return Response.json({
        result: {
          segments: [{ start: 10, end: 13, reason: "Có giao tranh và thay đổi điểm", score: 88, confidence: 0.88 }],
          confirmed: false,
          needsAnotherRound: true,
          notes: "Cần tiếp tục xác nhận theo vòng lặp.",
        },
        usage: { inputTokens: 120, outputTokens: 30 },
      });
    }
    throw new Error(`Unexpected request ${target}`);
  };
  try {
    const node = workflowNode(
      "Làm rõ highlight lặp",
      ["Video", "HighlightPlan", "TimedTranscript", "AttentionRegion", "AIModel", "CachedData"],
      ["HighlightPlan", "SceneAnalysis[]", "CachedData"],
      { focusMode: "Tập trung hình ảnh (80/20)", maxRounds: 3, frameIntervalSeconds: 0.25, maxFramesPerRound: 4, minimumConfidence: 70, imageDetail: "low" },
    );
    const video = Object.assign(new File(["video"], "match.mp4", { type: "video/mp4" }), { contentFlowPath: "C:\\Test-Media\\match.mp4" });
    const store = new Map([["video-source", [video]]]);
    const result = await executeWorkflowNode(node, {
      "input-1": [{ runtimeKey: "video-source", fileIndex: 0, name: video.name, type: video.type }],
      "input-2": { segments: [{ start: 10, end: 13, reason: "Giao tranh", score: 80, confidence: 0.8 }], maxDurationSeconds: 120 },
      "input-3": { text: "Mười giây đầu có giao tranh lớn." },
      "input-4": { label: "Bảng điểm", x: 0.7, y: 0.05, width: 0.28, height: 0.2 },
      "input-5": { provider: "OpenAI", model: "gpt-4.1-mini", apiKey: "test-key", maxInputTokens: 40000, maxOutputWorkflowTokens: 20000 },
    }, store);
    assert.equal(frameRequests.length, 3);
    assert.equal(aiRequests.length, 3);
    assert.ok(frameRequests.every((request) => request.timestamps.every((timestamp, index, values) => index === 0 || timestamp - values[index - 1] >= 1)));
    assert.ok(frameRequests.every((request) => request.attentionRegions.length === 1 && request.attentionRegions[0].label === "Bảng điểm"));
    assert.ok(aiRequests.every((request) => request.action === "analyze-video-frames"));
    assert.equal(result["output-1"].rounds.length, 3);
    assert.equal(result["output-1"].focusMode, "Tập trung hình ảnh (80/20)");
    assert.equal(result["output-3"].itemCount, 4);
    assert.match(result["output-3"].manifest, /Mười giây đầu có giao tranh lớn/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI processing nodes prefer a valid input cache and fall back to direct materials when the cache is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    requests.push(body);
    return Response.json({ result: { text: "Kết quả kiểm tra cache" }, usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 } });
  };
  try {
    const store = new Map();
    const cacheNode = workflowNode("Cache kết quả", ["Dữ liệu"], ["CachedData"], { cacheKey: "priority-cache", retention: "30 phút" });
    const cached = await executeWorkflowNode(cacheNode, { "input-1": "TƯ LIỆU TỪ CACHE" }, store);
    const textNode = workflowNode("Gọi AI tạo văn bản", ["AIModel", "Prompt", "CachedData"], ["AIText", "CachedData"], { temperature: 0.2 });
    const model = { provider: "OpenAI", model: "gpt-4.1-mini", apiKey: "test-key", maxOutputTokens: 120 };
    const cachedResult = await executeWorkflowNode(textNode, { "input-1": model, "input-2": "TƯ LIỆU TRỰC TIẾP KHÔNG ĐƯỢC DÙNG", "input-3": cached["output-1"] }, store);
    const fallbackResult = await executeWorkflowNode(textNode, { "input-1": model, "input-2": "TƯ LIỆU TRỰC TIẾP DỰ PHÒNG", "input-3": { cacheKey: "missing-or-expired-cache" } }, store);
    assert.equal(requests[0].prompt, "TƯ LIỆU TỪ CACHE");
    assert.equal(requests[1].prompt, "TƯ LIỆU TRỰC TIẾP DỰ PHÒNG");
    assert.equal(requests[0].promptCacheKey, "priority-cache");
    assert.ok(String(requests[1].promptCacheKey).length > 8);
    assert.equal(cachedResult["output-1"].cacheSource, "cache");
    assert.equal(fallbackResult["output-1"].cacheSource, "direct");
    assert.ok(cachedResult["output-2"].cacheKey);
    assert.ok(fallbackResult["output-2"].cacheKey);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("nodes without an executor fail visibly instead of returning a successful mock", async () => {
  const node = {
    id: "unsupported-render",
    data: {
      label: "Render video chính",
      category: "Video",
      kind: "render-video-main",
      inputs: [{ id: "input-1", type: "Timeline" }],
      outputs: [{ id: "output-1", type: "Video" }],
      config: {},
    },
  };
  await assert.rejects(
    () => executeWorkflowNode(node, { "input-1": { scenes: [] } }, new Map()),
    /không trả output mô phỏng hoặc trạng thái thành công giả/,
  );
});

test("execution capability is explicit for both supported and blocked node catalog entries", () => {
  assert.equal(hasNodeExecutor("Tạo prompt từ dữ liệu", "AI & mô hình"), true);
  assert.equal(hasNodeExecutor("Gọi AI tạo văn bản", "AI & mô hình"), true);
  assert.equal(hasNodeExecutor("Gọi AI trả JSON", "AI & mô hình"), true);
  assert.equal(hasNodeExecutor("Phân tích hình ảnh bằng AI", "AI & mô hình"), true);
  assert.equal(hasNodeExecutor("Phân tích âm thanh bằng AI", "AI & mô hình"), true);
  assert.equal(hasNodeExecutor("Phân tích video bằng AI", "AI & mô hình"), true);
  assert.equal(hasNodeExecutor("Trích frame từ video", "Video"), true);
  assert.equal(hasNodeExecutor("Tách âm thanh từ video", "Video"), true);
  assert.equal(hasNodeExecutor("Chấm điểm đầu ra AI", "AI & mô hình"), true);
  assert.equal(hasNodeExecutor("Duyệt đầu ra AI", "AI & mô hình"), true);
  assert.equal(hasNodeExecutor("Cổng vào", "Điều khiển workflow"), true);
  assert.equal(hasNodeExecutor("Cổng ra", "Điều khiển workflow"), true);
  assert.equal(hasNodeExecutor("Gọi workflow", "Điều khiển workflow"), true);
  assert.equal(hasNodeExecutor("Tạo transcript video theo thời gian", "Nghiên cứu"), true);
  assert.equal(hasNodeExecutor("Trích xuất transcript video", "Nghiên cứu"), false);
  assert.equal(hasNodeExecutor("Tạo ảnh bằng AI", "Hình ảnh"), false);
  assert.equal(hasNodeExecutor("Render video chính", "Dựng video tổng"), false);
});

test("workflow input gateway replays caller values by stable port ID", async () => {
  const node = workflowNode("Cổng vào", [], ["Text"]);
  const result = await executeWorkflowNode(node, { "output-1": "Dữ liệu từ workflow cha" }, new Map());
  assert.deepEqual(result, { "output-1": "Dữ liệu từ workflow cha" });
});

test("called workflow passes values from its input gateway to output gateway", async () => {
  const workflow = {
    workflowId: "workflow-child",
    nodes: [
      {
        id: "gateway-in",
        data: { label: "Cổng vào", family: "Cổng vào", category: "Điều khiển workflow", kind: "workflow-input-gateway", inputs: [], outputs: [{ id: "workflow-port-title", type: "Text" }], config: {} },
      },
      {
        id: "gateway-out",
        data: { label: "Cổng ra", family: "Cổng ra", category: "Điều khiển workflow", kind: "workflow-output-gateway", inputs: [{ id: "workflow-port-title", type: "Text", required: true }], outputs: [], config: {} },
      },
    ],
    edges: [{ source: "gateway-in", sourceHandle: "workflow-port-title", target: "gateway-out", targetHandle: "workflow-port-title" }],
  };
  const result = await executeCalledWorkflow(workflow, { "workflow-port-title": "Xin chào từ workflow cha" }, new Map());
  assert.deepEqual(result, { "workflow-port-title": "Xin chào từ workflow cha" });
});

test("called workflow can invoke a nested workflow through the supplied resolver", async () => {
  const workflow = {
    workflowId: "workflow-parent",
    nodes: [
      {
        id: "gateway-in",
        data: { label: "Cổng vào", family: "Cổng vào", category: "Điều khiển workflow", kind: "workflow-input-gateway", inputs: [], outputs: [{ id: "workflow-port-source", type: "Text" }], config: {} },
      },
      {
        id: "call-child",
        data: { label: "Gọi workflow", family: "Gọi workflow", category: "Điều khiển workflow", kind: "workflow-call", inputs: [{ id: "workflow-port-source", type: "Text", required: true }], outputs: [{ id: "workflow-port-result", type: "Text" }], config: {} },
      },
      {
        id: "gateway-out",
        data: { label: "Cổng ra", family: "Cổng ra", category: "Điều khiển workflow", kind: "workflow-output-gateway", inputs: [{ id: "workflow-port-result", type: "Text", required: true }], outputs: [], config: {} },
      },
    ],
    edges: [
      { source: "gateway-in", sourceHandle: "workflow-port-source", target: "call-child", targetHandle: "workflow-port-source" },
      { source: "call-child", sourceHandle: "workflow-port-result", target: "gateway-out", targetHandle: "workflow-port-result" },
    ],
  };
  const result = await executeCalledWorkflow(
    workflow,
    { "workflow-port-source": "Dữ liệu từ workflow cha" },
    new Map(),
    {
      callWorkflow: async (_node, inputs) => ({ "workflow-port-result": `${inputs["workflow-port-source"]} / workflow con` }),
    },
  );
  assert.deepEqual(result, { "workflow-port-result": "Dữ liệu từ workflow cha / workflow con" });
});

test("model capabilities identify image support and only send reasoning to compatible OpenAI models", () => {
  const gpt41 = getAiModelCapabilities("OpenAI", "gpt-4.1");
  assert.equal(gpt41.text, "supported");
  assert.equal(gpt41.image, "supported");
  assert.equal(gpt41.reasoning, "unsupported");
  assert.equal(supportsOpenAiReasoning("gpt-4.1"), false);
  assert.equal(supportsOpenAiReasoning("gpt-5.1"), true);
  assert.equal(openAiResponseVerbosity("gpt-4.1-nano"), "medium");
  assert.equal(openAiResponseVerbosity("gpt-4.1-mini"), "medium");
  assert.equal(replacementForRetiredOpenAiModel("gpt-4.1-nano"), "gpt-5-nano");
  assert.equal(currentOpenAiModel("gpt-4.1-nano"), "gpt-5-nano");
  assert.equal(currentOpenAiModel("gpt-4.1-mini"), "gpt-4.1-mini");
  assert.equal(openAiImageDetail("gpt-4.1-mini", "low"), "low");
  assert.equal(openAiImageDetail("gpt-4o-mini", "low"), "low");
  assert.equal(getAiModelCapabilities("OpenAI", "gpt-3.5-turbo").image, "unsupported");
});

function contractTypes(value) {
  return value.split(",").map((type) => type.trim()).filter(Boolean);
}

function visiblePrimitiveInputs(spec) {
  if (spec.group === "Đầu vào" || SELF_CONFIGURED_NODE_NAMES.has(spec.name)) return [];
  return contractTypes(spec.input);
}

function basicContracts() {
  const primitives = new Map(NODE_SPECS.map((spec) => [spec.name, spec]));
  return BASIC_NODE_PRESETS.map((preset) => {
    const steps = preset.nodes.map((name) => primitives.get(name));
    const outputs = [...new Set(steps.flatMap((step) => contractTypes(step.output)))];
    if (preset.sourceNode) return { id: preset.id, inputs: [], outputs };
    if (preset.mode === "choice") {
      return { id: preset.id, inputs: [...new Set(steps.flatMap(visiblePrimitiveInputs))], outputs };
    }
    const available = [];
    const inputs = [];
    for (const step of steps) {
      for (const input of visiblePrimitiveInputs(step)) {
        if (!available.some((type) => portTypesCompatible(type, input))) {
          inputs.push(input);
          available.push(input);
        }
      }
      available.push(...contractTypes(step.output));
    }
    return { id: preset.id, inputs: [...new Set(inputs)], outputs };
  });
}

test("every Basic input port has a Basic source or is intentionally configured in its node", () => {
  const contracts = basicContracts();
  const outputTypes = contracts.flatMap((contract) => contract.outputs);
  const unresolved = contracts.flatMap((contract) => contract.inputs
    .filter((input) => !outputTypes.some((output) => portTypesCompatible(output, input)))
    .map((input) => `${contract.id}: ${input}`));
  assert.deepEqual(unresolved, []);
});

test("video analysis catalog exposes the adaptive six-step protocol", () => {
  const preset = BASIC_NODE_PRESETS.find((item) => item.id === "analyze-video-content");
  assert.deepEqual(preset?.nodes, [
    "Lập chỉ mục video",
    "Phiên âm video theo thời gian",
    "Tạo storyboard video",
    "Phân tích từng đoạn video",
    "Kiểm tra đoạn chưa chắc chắn",
    "Tổng hợp nội dung video",
  ]);
});

test("video report synthesis keeps review intervals and protocol metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.action, "ai");
    return Response.json({ result: { summary: "Người chơi giải thích chiến thuật kiểm soát khu vực.", keyEvents: [{ timecode: "01:10", event: "Đổi chiến thuật" }] } });
  };
  try {
    const node = {
      id: "video-summary",
      data: {
        label: "Tổng hợp nội dung video",
        category: "Tư liệu video",
        kind: "video-summary",
        inputs: [
          { id: "input-1", type: "SceneAnalysis[]" },
          { id: "input-2", type: "TimedTranscript" },
          { id: "input-3", type: "ReviewInterval[]" },
        ],
        outputs: [{ id: "output-1", type: "VideoAnalysis" }],
        config: { reportType: "Gameplay và chiến thuật", reportDetail: "Cân bằng", model: "gpt-5.6-luna" },
      },
    };
    const result = await executeWorkflowNode(node, {
      "input-1": [{ start: 60, end: 90, summary: "Một lượt chơi", confidence: 0.62 }],
      "input-2": { text: "Tôi sẽ kiểm soát khu vực trung tâm." },
      "input-3": [{ start: 65, end: 80, confidence: 0.62 }],
    }, new Map());
    assert.equal(result["output-1"].reviewIntervals.length, 1);
    assert.equal(result["output-1"].protocol, "adaptive-frames+timed-transcript+hierarchical-summary");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("basic image source passes its selected runtime image to an AI-compatible Image[] output", async () => {
  const macro = {
    id: "basic-image-source-test",
    data: {
      label: "Nguồn file",
      category: "Đầu vào",
      kind: "basic-file-source",
      inputs: [],
      outputs: [{ id: "output-1", type: "Image[]" }],
      config: { basicOperation: "Hình ảnh" },
      basicMode: "choice",
      basicSteps: [{
        kind: "image-upload",
        label: "Tải ảnh từ máy",
        operation: "Hình ảnh",
        category: "Đầu vào",
        inputs: [],
        outputs: [{ id: "output-1", type: "Image[]" }],
        config: {},
      }],
    },
  };
  const image = Object.assign(new Blob(["image"], { type: "image/jpeg" }), { name: "batman.jpg" });
  const store = new Map([["basic-image-source-test:images", [image]]]);
  const result = await executeWorkflowNode(macro, {}, store);
  assert.equal(result["output-1"][0].name, "batman.jpg");
  assert.equal(result["output-1"][0].runtimeKey, "basic-image-source-test::1:images");
});

test("every extracted frame keeps its own runtime file index for Image[] storage", () => {
  const first = Object.assign(new Blob(["first"], { type: "image/jpeg" }), { name: "frame-0001.jpg" });
  const second = Object.assign(new Blob(["second"], { type: "image/jpeg" }), { name: "frame-0002.jpg" });
  const assets = frameImageAssets([
    { runtimeKey: "frames", fileIndex: 0, timestamp: 0, timecode: "00:00" },
    { runtimeKey: "frames", fileIndex: 1, timestamp: 15, timecode: "00:15" },
  ], new Map([["frames", [first, second]]]));
  assert.deepEqual(assets.map((asset) => asset.fileIndex), [0, 1]);
  assert.deepEqual(assets.map((asset) => asset.name), ["frame-0001.jpg", "frame-0002.jpg"]);
});

test("basic pipeline executes its primitive steps and returns the final typed output", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ result: { ideas: [{ title: "Ý tưởng workflow con", premise: "Một hướng nội dung đủ cụ thể để chấm điểm." }] } });
  try {
    const macro = {
      id: "basic-idea-test",
      data: {
        label: "Phát triển ý tưởng",
        category: "Phát triển nội dung",
        kind: "basic-idea-development",
        inputs: [{ id: "input-1", type: "Topic" }],
        outputs: [{ id: "output-1", type: "ScoredIdea[]" }],
        config: { model: "gpt-5.6-luna", useAI: false, minimumScore: 0, ideaCount: 1 },
        basicMode: "pipeline",
        basicNodeLabels: ["Tạo ý tưởng", "Chấm điểm ý tưởng"],
        basicSteps: [
          {
            kind: "node-create-idea",
            label: "Tạo ý tưởng",
            category: "Phát triển nội dung",
            inputs: [{ id: "input-1", type: "Topic" }, { id: "input-2", type: "ResearchBrief" }],
            outputs: [{ id: "output-1", type: "Idea[]" }],
            config: { ideaCount: 1, model: "gpt-5.6-luna", apiKey: "test-api-key" },
          },
          {
            kind: "node-score-idea",
            label: "Chấm điểm ý tưởng",
            category: "Phát triển nội dung",
            inputs: [{ id: "input-1", type: "Idea[]" }],
            outputs: [{ id: "output-1", type: "ScoredIdea[]" }],
            config: { useAI: false, minimumScore: 0 },
          },
        ],
      },
    };
    const result = await executeWorkflowNode(macro, { "input-1": { topic: "Video bán hàng" } }, new Map());
    assert.equal(result["output-1"][0].title, "Ý tưởng workflow con");
    assert.equal(result["output-1"][0].rank, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("basic file storage keeps the original source-port label after its naming step", async () => {
  const originalFetch = globalThis.fetch;
  let storageRequest;
  globalThis.fetch = async (_url, request) => {
    storageRequest = JSON.parse(String(request?.body ?? "{}"));
    return Response.json({ files: [{ filePath: "C:\\temp\\image - frame-0001\\frame-0001.json", fileName: "frame-0001.json", bytes: 2 }] });
  };
  try {
    const macro = {
      id: "basic-storage-source-port-test",
      data: {
        label: "Lưu file",
        category: "Quản lý dữ liệu",
        kind: "basic-data-save-file",
        inputs: [{ id: "data", type: "Dữ liệu" }, { id: "folder", type: "Folder" }],
        outputs: [{ id: "stored", type: "StoredFile" }],
        config: { namingPattern: "#file-name#", duplicateMode: "Lưu mới" },
        basicPresetId: "data-save-file",
        basicMode: "pipeline",
        basicSteps: [
          { kind: "node-name-file", label: "Đặt tên", category: "Quản lý dữ liệu", inputs: [{ id: "data", type: "Dữ liệu" }], outputs: [{ id: "named", type: "NamedFile" }], config: { namingPattern: "#file-name#" } },
          { kind: "node-save-file", label: "Lưu file", category: "Quản lý dữ liệu", inputs: [{ id: "named", type: "NamedFile hoặc Dữ liệu" }, { id: "folder", type: "Folder" }], outputs: [{ id: "stored", type: "StoredFile" }], config: {} },
        ],
      },
    };
    await executeWorkflowNode(macro, {
      data: [{ frame: 1 }, { frame: 2 }],
      folder: "C:\\temp",
      __contentFlowInputSources: { data: { outputName: "image" } },
    }, new Map());
    assert.equal(storageRequest.files[0].sourcePortName, "image");
    assert.equal(storageRequest.files[1].sourcePortName, "image");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("frame index is stored as one reusable JSON timeline, not one JSON per frame", async () => {
  const originalFetch = globalThis.fetch;
  let storageRequest;
  globalThis.fetch = async (_url, request) => {
    storageRequest = JSON.parse(String(request?.body ?? "{}"));
    return Response.json({ files: [{ filePath: "C:\\temp\\frameindex.json", fileName: "frameindex.json", bytes: 20 }] });
  };
  try {
    const node = {
      id: "frame-index-storage-test",
      data: {
        label: "Lưu file", category: "Quản lý dữ liệu", kind: "basic-data-save-file",
        inputs: [{ id: "data", type: "Dữ liệu" }, { id: "folder", type: "Folder" }],
        outputs: [{ id: "stored", type: "StoredFile" }], config: { namingPattern: "#file-name#", duplicateMode: "Lưu mới" },
        basicPresetId: "data-save-file", basicMode: "pipeline",
        basicSteps: [
          { kind: "node-name-file", label: "Đặt tên", category: "Quản lý dữ liệu", inputs: [{ id: "data", type: "Dữ liệu" }], outputs: [{ id: "named", type: "NamedFile" }], config: { namingPattern: "#file-name#" } },
          { kind: "node-save-file", label: "Lưu file", category: "Quản lý dữ liệu", inputs: [{ id: "named", type: "NamedFile hoặc Dữ liệu" }, { id: "folder", type: "Folder" }], outputs: [{ id: "stored", type: "StoredFile" }], config: {} },
        ],
      },
    };
    const frameFile = Object.assign(new Blob(["jpg"], { type: "image/jpeg" }), { name: "frame-0001.jpg" });
    await executeWorkflowNode(node, {
      data: [{ timestamp: 0, runtimeKey: "frame-index-runtime", fileIndex: 0, fileName: "frame-0001.jpg" }, { timestamp: 15, runtimeKey: "frame-index-runtime", fileIndex: 0, fileName: "frame-0002.jpg" }],
      folder: "C:\\temp",
      __contentFlowInputSources: { data: { outputName: "frameindex" } },
    }, new Map([["frame-index-runtime", [frameFile]]]));
    assert.equal(storageRequest.files.length, 1);
    assert.equal(storageRequest.files[0].sourceName, "frameindex");
    assert.equal(storageRequest.files[0].sourcePortName, "frameindex");
    assert.match(storageRequest.files[0].inlineContent, /frame-0001\.jpg/);
    assert.match(storageRequest.files[0].inlineContent, /frame-0002\.jpg/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stored file node reuses its linked local file without requiring a new input", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("stored file must not call save endpoint again"); };
  try {
    const stored = Object.assign(new Blob(["audio"], { type: "audio/mpeg" }), {
      name: "cached-audio.mp3",
      contentFlowPath: "C:\\saved\\cached-audio.mp3",
      contentFlowPathOnly: true,
      contentFlowSize: 5,
    });
    const node = {
      id: "stored-file-reuse-test",
      data: {
        label: "Lưu file", category: "Quản lý dữ liệu", kind: "node-save-file",
        inputs: [{ id: "data", type: "NamedFile hoặc Dữ liệu" }, { id: "folder", type: "Folder" }],
        outputs: [{ id: "stored", type: "Audio" }], config: {},
        storedFiles: [{ filePath: "C:\\saved\\cached-audio.mp3", name: "cached-audio.mp3", type: "audio/mpeg", size: 5 }],
      },
    };
    const result = await executeWorkflowNode(node, {}, new Map([["stored-file-reuse-test:stored-files", [stored]]]));
    assert.equal(result.stored[0].name, "cached-audio.mp3");
    assert.equal(result.stored[0].localPath, "C:\\saved\\cached-audio.mp3");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("basic stored file node becomes a source when no new data is connected", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("stored file source must not call save endpoint"); };
  try {
    const stored = Object.assign(new Blob(["audio"], { type: "audio/mpeg" }), {
      name: "cached-audio.mp3", contentFlowPath: "C:\\saved\\cached-audio.mp3", contentFlowPathOnly: true, contentFlowSize: 5,
    });
    const node = {
      id: "basic-stored-file-source-test",
      data: {
        label: "Lưu file", category: "Quản lý dữ liệu", kind: "basic-data-save-file",
        inputs: [{ id: "data", type: "Dữ liệu" }, { id: "folder", type: "Folder" }],
        outputs: [{ id: "stored", type: "Audio" }], config: {},
        basicPresetId: "data-save-file", basicMode: "pipeline",
        basicSteps: [{ kind: "node-name-file", label: "Đặt tên", category: "Quản lý dữ liệu", inputs: [], outputs: [], config: {} }],
        storedFiles: [{ filePath: "C:\\saved\\cached-audio.mp3", name: "cached-audio.mp3", type: "audio/mpeg", size: 5 }],
      },
    };
    const result = await executeWorkflowNode(node, {}, new Map([["basic-stored-file-source-test:stored-files", [stored]]]));
    assert.equal(result.stored[0].localPath, "C:\\saved\\cached-audio.mp3");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stored file node appends newly saved files to its linked Stored file", async () => {
  const originalFetch = globalThis.fetch;
  let storageRequest;
  globalThis.fetch = async (_url, request) => {
    storageRequest = JSON.parse(String(request?.body ?? "{}"));
    return new Response(JSON.stringify({ files: [{ filePath: "C:\\saved\\new-audio.mp3", bytes: 8 }] }), { status: 200 });
  };
  try {
    const oldFile = Object.assign(new Blob(["old"], { type: "audio/mpeg" }), {
      name: "cached-audio.mp3", contentFlowPath: "C:\\saved\\cached-audio.mp3", contentFlowPathOnly: true, contentFlowSize: 5,
    });
    const incomingFile = new File(["incoming"], "new-audio.mp3", { type: "audio/mpeg" });
    const node = {
      id: "stored-file-append-test",
      data: {
        label: "Lưu file", category: "Quản lý dữ liệu", kind: "node-save-file",
        inputs: [{ id: "data", type: "NamedFile hoặc Dữ liệu" }, { id: "folder", type: "Folder" }],
        outputs: [{ id: "stored", type: "Audio" }], config: {},
        storedFiles: [{ filePath: "C:\\saved\\cached-audio.mp3", name: "cached-audio.mp3", type: "audio/mpeg", size: 5 }],
      },
    };
    const result = await executeWorkflowNode(node, {
      data: [{ runtimeKey: "incoming-audio", fileIndex: 0, name: "new-audio.mp3", type: "audio/mpeg" }],
      folder: "C:\\output",
    }, new Map([
      ["stored-file-append-test:stored-files", [oldFile]],
      ["incoming-audio", [incomingFile]],
    ]));
    assert.equal(storageRequest.files.length, 1);
    assert.equal(result.stored.length, 2);
    assert.deepEqual(result.stored.map((item) => item.localPath), ["C:\\saved\\cached-audio.mp3", "C:\\saved\\new-audio.mp3"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("basic workflow with legacy missing config reports its real missing input", async () => {
  const legacyMacro = {
    id: "basic-legacy-config-test",
    data: {
      label: "Chuẩn bị tư liệu phân tích video",
      category: "Video",
      kind: "basic-prepare-video-analysis",
      inputs: [],
      outputs: [{ id: "output-1", type: "TimedTranscript" }],
      basicMode: "pipeline",
      basicSteps: [{
        kind: "node-transcribe-video",
        label: "Tạo transcript video theo thời gian",
        category: "Video",
        inputs: [{ id: "input-1", type: "Video" }],
        outputs: [{ id: "output-1", type: "TimedTranscript" }],
        config: {},
      }],
    },
  };
  await assert.rejects(() => executeWorkflowNode(legacyMacro, {}, new Map()), /chưa nhận được file Video/);
});

test("legacy AI video node without config reports its missing material, not an internal config error", async () => {
  const legacyVideoAnalysis = {
    id: "legacy-video-analysis-no-config",
    data: {
      label: "Phân tích video bằng AI",
      category: "AI & mô hình",
      kind: "node-analyze-video-ai",
      inputs: [
        { id: "model", type: "AIModel" },
        { id: "frames", type: "Image[]" },
        { id: "index", type: "FrameIndex" },
        { id: "audio", type: "Audio" },
        { id: "prompt", type: "Prompt" },
      ],
      outputs: [{ id: "analysis", type: "AIAnalysis" }],
    },
  };
  await assert.rejects(
    () => executeWorkflowNode(legacyVideoAnalysis, {
      model: { provider: "OpenAI", model: "gpt-5.6-luna", apiKey: "test-api-key" },
    }, new Map()),
    /cần Image\[\]/,
  );
});

test("media analysis only accepts its model and key from a connected AIModel", async () => {
  const node = workflowNode(
    "Phân tích video bằng AI",
    ["Image[]", "FrameIndex", "Audio", "Prompt"],
    ["AIAnalysis"],
    { model: "gpt-4.1-nano", apiKey: "must-not-be-used" },
  );
  await assert.rejects(
    () => executeWorkflowNode(node, {}, new Map()),
    /cần nối cổng AIModel từ node Thiết lập AI/,
  );
});

test("AI video analysis reads a saved frameindex.json as the complete timeline", async () => {
  const originalFetch = globalThis.fetch;
  let receivedTimeline;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/research");
    const form = init.body;
    assert.equal(form.get("action"), "analyze-video-frames");
    receivedTimeline = JSON.parse(String(form.get("timeline")));
    return Response.json({ result: { summary: "Đã đối chiếu đúng frame và transcript." }, usage: { inputTokens: 20, outputTokens: 5 } });
  };
  try {
    const node = workflowNode(
      "Phân tích video bằng AI",
      ["AIModel", "Image[]", "FrameIndex", "Audio", "TimedTranscript", "Prompt"],
      ["AIAnalysis"],
      { analysisGoal: "Tóm tắt", detail: "low" },
    );
    const frameOne = new File(["frame-1"], "frame-0001.jpg", { type: "image/jpeg" });
    const frameTwo = new File(["frame-2"], "frame-0002.jpg", { type: "image/jpeg" });
    const indexFile = new File([JSON.stringify([
      { timestamp: 0, timecode: "00:00", fileName: "frame-0001.jpg" },
      { timestamp: 15, timecode: "00:15", fileName: "frame-0002.jpg" },
    ])], "frameindex.json", { type: "application/json" });
    const audio = new File(["audio"], "audio.mp3", { type: "audio/mpeg" });
    const result = await executeWorkflowNode(node, {
      "input-1": { provider: "OpenAI", model: "gpt-5.6-luna", apiKey: "test-api-key", maxInputTokens: 40000, maxOutputWorkflowTokens: 20000 },
      "input-2": [{ runtimeKey: "saved-frames", fileIndex: 0 }, { runtimeKey: "saved-frames", fileIndex: 1 }],
      "input-3": [{ runtimeKey: "saved-frame-index", fileIndex: 0, name: "frameindex.json", type: "application/json" }],
      "input-4": [{ runtimeKey: "saved-audio", fileIndex: 0 }],
      "input-5": { text: "Bình luận theo mốc thời gian.", segments: [{ start: 0, end: 15, text: "Bình luận theo mốc thời gian." }] },
      "input-6": "Tóm tắt diễn biến.",
    }, new Map([
      ["saved-frames", [frameOne, frameTwo]],
      ["saved-frame-index", [indexFile]],
      ["saved-audio", [audio]],
    ]));
    assert.equal(receivedTimeline.frames.length, 2);
    assert.deepEqual(receivedTimeline.frames.map((frame) => frame.timecode), ["00:00", "00:15"]);
    assert.equal(result["output-1"].evidence.frameIndexEntries, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI content nodes send structured requests and return usable ideas", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/research");
    const body = JSON.parse(String(init.body));
    assert.equal(body.action, "ai");
    assert.equal(body.model, "gpt-5.6-luna");
    assert.equal(body.apiKey, "test-api-key");
    return Response.json({ result: { ideas: [{ title: "Ý tưởng thử nghiệm", premise: "Giải quyết một vấn đề cụ thể" }] } });
  };
  try {
    const node = workflowNode("Tạo ý tưởng", ["Topic", "ResearchBrief"], ["Idea[]"], { ideaCount: 1, model: "gpt-5.6-luna", apiKey: "test-api-key" });
    const result = await executeWorkflowNode(node, { "input-1": { topic: "Video bán hàng" } }, new Map());
    assert.equal(result["output-1"][0].title, "Ý tưởng thử nghiệm");
    assert.equal(result["output-1"][0].id, "idea-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-AI content nodes score, shorten, review, check and approve content", async () => {
  const ideas = [{ title: "5 cách cải thiện video bán hàng", premise: "Các bước thực tế giúp người mới tăng chất lượng nội dung và chuyển đổi." }];
  const scoreNode = workflowNode("Chấm điểm ý tưởng", ["Idea[]"], ["ScoredIdea[]"], { useAI: false, minimumScore: 50 });
  const scored = await executeWorkflowNode(scoreNode, { "input-1": ideas }, new Map());
  assert.equal(scored["output-1"][0].rank, 1);
  assert.equal(scored["output-1"][0].passed, true);

  const content = { title: "Bài thử", body: "Video bán hàng hiệu quả cần một thông điệp rõ ràng. Người xem phải hiểu vấn đề và lợi ích ngay từ đầu. Hãy thử ngay phương pháp này và theo dõi kết quả." };
  const shortenNode = workflowNode("Rút gọn", ["Content"], ["Content"], { useAI: false, targetLength: 30, preserve: "thông điệp" });
  const shortened = await executeWorkflowNode(shortenNode, { "input-1": content }, new Map());
  assert.match(shortened["output-1"].body, /thông điệp/i);

  const reviewNode = workflowNode("Kiểm tra nội dung", ["Content"], ["ReviewResult"], { useAI: false });
  const reviewed = await executeWorkflowNode(reviewNode, { "input-1": content }, new Map());
  assert.equal(typeof reviewed["output-1"].score, "number");

  const duplicateNode = workflowNode("Kiểm tra trùng lặp", ["Content", "nguồn"], ["DuplicateReport"], { threshold: 60, comparisonText: content.body });
  const duplicate = await executeWorkflowNode(duplicateNode, { "input-1": content }, new Map());
  assert.equal(duplicate["output-1"].duplicated, true);

  const policyNode = workflowNode("Kiểm tra chính sách", ["Content"], ["PolicyReport"], { useAI: false, platform: "Chung", customRules: "" });
  const policy = await executeWorkflowNode(policyNode, { "input-1": { body: "Sản phẩm này chắc chắn hiệu quả 100%." } }, new Map());
  assert.equal(policy["output-1"].requiresHumanReview, true);

  const approveNode = workflowNode("Duyệt nội dung", ["Content", "ReviewResult"], ["Approval", "Content"], { decision: "Đã duyệt", editedContent: "", approvalNote: "Đạt" });
  const approved = await executeWorkflowNode(approveNode, { "input-1": content, "input-2": reviewed["output-1"] }, new Map());
  assert.equal(approved["output-1"].approved, true);
  assert.equal(approved["output-2"].body, content.body);
});

test("quality nodes return a repairable report and only prepare AI work instead of calling an API", async () => {
  const requirementsNode = workflowNode("Kiểm tra yêu cầu và cấu trúc", ["Dữ liệu"], ["QAReport"], {
    requirements: "Tiêu đề\nKêu gọi hành động",
    minWords: 12,
    maxWords: 40,
  });
  const failed = await executeWorkflowNode(requirementsNode, { "input-1": "Tiêu đề ngắn cho bài thử" }, new Map());
  assert.equal(failed["output-1"].status, "Không đạt");
  assert.equal(failed["output-1"].needsFix, true);
  assert.match(failed["output-1"].repairItems[0].reason, /Kêu gọi hành động/);

  const passed = await executeWorkflowNode(requirementsNode, {
    "input-1": "Tiêu đề bài thử có đủ ngữ cảnh để người đọc hiểu yêu cầu. Kêu gọi hành động ngay hôm nay để xem phần tiếp theo.",
  }, new Map());
  assert.equal(passed["output-1"].status, "Đạt");
  assert.deepEqual(passed["output-1"].repairItems, []);

  const prepareAiNode = workflowNode("Chuẩn bị kiểm tra AI", ["Dữ liệu"], ["Prompt"], {
    checkGoal: "Kiểm tra độ rõ ràng của bài viết",
    requirements: "Không tự bịa\nNêu việc cần sửa",
  });
  const prompt = await executeWorkflowNode(prepareAiNode, { "input-1": "Bài thử để chuyển cho AI." }, new Map());
  assert.match(prompt["output-1"], /Chỉ trả JSON/);
  assert.match(prompt["output-1"], /Không tự bịa/);

  const readAiNode = workflowNode("Đọc kết quả AI kiểm tra", ["Dữ liệu", "AIJson"], ["QAReport"], {});
  const aiReport = await executeWorkflowNode(readAiNode, {
    "input-1": "Bài thử để đối chiếu",
    "input-2": { status: "Cần sửa", summary: "Thiếu lời kêu gọi hành động.", issues: [{ severity: "warning", location: "Đoạn kết", reason: "Chưa có CTA.", fix: "Thêm một CTA cụ thể ở cuối bài." }] },
  }, new Map());
  assert.equal(aiReport["output-1"].status, "Cần sửa");
  assert.equal(aiReport["output-1"].repairItems[0].location, "Đoạn kết");

  const incompleteAiReport = await executeWorkflowNode(readAiNode, { "input-1": "Bài thử", "input-2": { text: "{\"status\":\"Cần sửa\"" } }, new Map());
  assert.equal(incompleteAiReport["output-1"].status, "Không thể kiểm tra");
  assert.equal(incompleteAiReport["output-1"].passed, false);

  const aggregateNode = workflowNode("Tổng hợp báo cáo kiểm tra", ["QAReport"], ["QAReport"], { cannotCheckIsFail: true });
  const combined = await executeWorkflowNode(aggregateNode, { "input-1": [passed["output-1"], aiReport["output-1"]] }, new Map());
  assert.equal(combined["output-1"].status, "Cần sửa");
  assert.equal(combined["output-1"].repairItems.length, 1);

  const notChecked = await executeWorkflowNode(aggregateNode, { "input-1": { status: "Không thể kiểm tra", issues: [] } }, new Map());
  assert.equal(notChecked["output-1"].status, "Không đạt");
  assert.match(notChecked["output-1"].repairItems[0].fix, /Bổ sung tư liệu/);

  const scoreNode = workflowNode("Chấm điểm thành phẩm", ["QAReport"], ["QAReport"], { warningDeduction: 10, failDeduction: 30 });
  const scored = await executeWorkflowNode(scoreNode, { "input-1": combined["output-1"] }, new Map());
  assert.equal(scored["output-1"].score, 90);

  const approvalNode = workflowNode("Duyệt xuất bản", ["QAReport"], ["Approval"], { decision: "Theo kết quả kiểm tra", note: "Sửa CTA rồi chạy lại." });
  const approval = await executeWorkflowNode(approvalNode, { "input-1": scored["output-1"] }, new Map());
  assert.equal(approval["output-1"].decision, "Yêu cầu sửa");
  assert.equal(approval["output-1"].approved, false);
  assert.match(approval["output-1"].note, /CTA/);
});

test("AI content pipeline creates audience, angles, outline and finished content", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { prompt } = JSON.parse(String(init.body));
    if (prompt.includes("Xây dựng AudienceProfile")) return Response.json({ result: { audienceProfile: { summary: "Chủ shop mới", painPoints: ["Thiếu ý tưởng"] } } });
    if (prompt.includes("góc tiếp cận")) return Response.json({ result: { angles: [{ title: "Từ vấn đề đến giải pháp", hook: "Vì sao video không ra đơn?" }] } });
    if (prompt.includes("Tạo dàn ý")) return Response.json({ result: { title: "Dàn ý bán hàng", sections: [{ heading: "Vấn đề", keyPoints: ["Thông điệp chưa rõ"] }] } });
    if (prompt.includes("Viết nội dung hoàn chỉnh")) return Response.json({ result: { title: "Video bán hàng", body: "Một video tốt bắt đầu bằng vấn đề thật của khách hàng và đưa ra giải pháp cụ thể." } });
    return Response.json({ result: { title: "Bản chỉnh sửa", body: "Nội dung đã được chỉnh sửa nhưng vẫn giữ nguyên dữ kiện." } });
  };
  try {
    const model = { model: "gpt-5.6-luna", apiKey: "test-api-key" };
    const audienceNode = workflowNode("Xác định khán giả", ["Topic", "dữ liệu kênh"], ["AudienceProfile"], model);
    const audience = await executeWorkflowNode(audienceNode, { "input-1": { topic: "Video bán hàng" } }, new Map());
    assert.equal(audience["output-1"].summary, "Chủ shop mới");

    const angleNode = workflowNode("Tạo góc tiếp cận", ["Idea", "AudienceProfile"], ["Angle[]"], { ...model, angleCount: 1 });
    const angles = await executeWorkflowNode(angleNode, { "input-1": [{ title: "Ý tưởng A", totalScore: 85 }], "input-2": audience["output-1"] }, new Map());
    assert.equal(angles["output-1"][0].id, "angle-1");

    const outlineNode = workflowNode("Tạo dàn ý", ["Angle", "Source[]"], ["Outline"], { ...model, sectionCount: 4 });
    const outline = await executeWorkflowNode(outlineNode, { "input-1": angles["output-1"] }, new Map());
    assert.equal(outline["output-1"].sections[0].heading, "Vấn đề");

    const writeNode = workflowNode("Viết nội dung", ["Outline", "Source[]", "BrandProfile"], ["Content"], model);
    const content = await executeWorkflowNode(writeNode, { "input-1": outline["output-1"] }, new Map());
    assert.match(content["output-1"].body, /giải pháp cụ thể/);
    assert.equal(content["output-1"].operation, "write");

    for (const label of ["Viết lại", "Mở rộng", "Thay đổi giọng văn"]) {
      const transformNode = workflowNode(label, ["Content"], ["Content"], model);
      const transformed = await executeWorkflowNode(transformNode, { "input-1": content["output-1"] }, new Map());
      assert.match(transformed["output-1"].body, /đã được chỉnh sửa/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
