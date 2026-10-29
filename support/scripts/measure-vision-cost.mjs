import { readFile, stat } from "node:fs/promises";

function loadEnv(text) {
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^("|')|("|')$/g, "");
  }
}

async function imagePart(filePath) {
  const [bytes, info] = await Promise.all([readFile(filePath), stat(filePath)]);
  return {
    type: "input_image",
    image_url: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    detail: "high",
    fileName: filePath.split(/[\\/]/).pop(),
    bytes: info.size,
  };
}

function responseUsage(payload) {
  const usage = payload.usage ?? {};
  return {
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? 0),
    cachedInputTokens: Number(usage.input_tokens_details?.cached_tokens ?? 0),
  };
}

async function measure(apiKey, baseUrl, model, label, files) {
  const parts = await Promise.all(files.map(imagePart));
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      // gpt-4.1-mini chỉ hỗ trợ medium; dùng cùng mức mà runtime Content Flow chọn.
      text: { verbosity: "medium" },
      max_output_tokens: 24,
      input: [
        { role: "system", content: "Bạn đang kiểm tra ảnh cho pipeline dựng video. Chỉ trả lời: CHECKED." },
        { role: "user", content: [{ type: "input_text", text: "Kiểm tra đủ chi tiết để nhận ra thông tin giao diện trong ảnh. Chỉ trả lời: CHECKED." }, ...parts.map(({ fileName, bytes, ...part }) => part)] },
      ],
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `Vision API lỗi ${response.status}`);
  return { label, detail: "high", files: parts.map(({ fileName, bytes }) => ({ fileName, bytes })), usage: responseUsage(payload) };
}

const [overview720, overview480, attentionCrop] = process.argv.slice(2);
if (!overview720 || !overview480 || !attentionCrop) throw new Error("Dùng: node measure-vision-cost.mjs <overview-720.jpg> <overview-480.jpg> <attention-crop.jpg>");
await loadEnv(await readFile(new URL("../../.env", import.meta.url), "utf8"));
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Thiếu OPENAI_API_KEY trong .env");
const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const model = process.env.OPENAI_VISION_BENCHMARK_MODEL || "gpt-4.1-mini";
const results = [
  await measure(apiKey, baseUrl, model, "Một ảnh toàn cảnh 720p", [overview720]),
  await measure(apiKey, baseUrl, model, "Toàn cảnh 480p + crop vùng chú ý gốc", [overview480, attentionCrop]),
];
console.log(JSON.stringify({ model, results, totalTokens: results.reduce((sum, item) => sum + item.usage.totalTokens, 0) }, null, 2));
