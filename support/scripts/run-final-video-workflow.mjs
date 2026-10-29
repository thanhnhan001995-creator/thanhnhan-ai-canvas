import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const appUrl = process.env.CONTENT_FLOW_APP_URL || "http://127.0.0.1:3000";
const mediaUrl = process.env.CONTENT_FLOW_MEDIA_URL || "http://127.0.0.1:4317";
const videoPath = "C:\\Users\\Owner\\Desktop\\Test-Media\\videos long.mp4";
const imageFolder = "D:\\Youtube\\Ảnh";
const outputFolder = "C:\\Users\\Owner\\Desktop\\Test-Media\\Content Flow Output";
const model = "gpt-4.1-mini";
const budget = { inputLimit: 40_000, outputLimit: 20_000, reservedInput: 0, reservedOutput: 0, actualInput: 0, actualOutput: 0 };

function compactText(value, maximum) {
  const text = String(value ?? "").trim();
  if (text.length <= maximum) return text;
  const part = Math.floor((maximum - 180) / 3);
  return `${text.slice(0, part)}\n… [đã rút gọn để giữ ngân sách] …\n${text.slice(Math.max(part, Math.floor(text.length / 2) - Math.floor(part / 2)), Math.floor(text.length / 2) + Math.floor(part / 2))}\n…\n${text.slice(-part)}`;
}

function reserve(input, output) {
  if (budget.reservedInput + input > budget.inputLimit) throw new Error(`Dừng để giữ giới hạn ${budget.inputLimit} input token.`);
  if (budget.reservedOutput + output > budget.outputLimit) throw new Error(`Dừng để giữ giới hạn ${budget.outputLimit} output token.`);
  budget.reservedInput += input;
  budget.reservedOutput += output;
}

function captureUsage(value) {
  const usage = value?.usage ?? {};
  budget.actualInput += Number(usage.inputTokens ?? 0);
  budget.actualOutput += Number(usage.outputTokens ?? 0);
}

async function requestJson(url, body, timeoutMs = 180_000) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
  return payload;
}

async function requestForm(form, timeoutMs = 180_000) {
  const response = await fetch(`${appUrl}/api/research`, { method: "POST", body: form, signal: AbortSignal.timeout(timeoutMs) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `AI API HTTP ${response.status}`);
  captureUsage(payload);
  return payload;
}

async function callText(system, prompt, inputTokens, outputTokens) {
  reserve(inputTokens, outputTokens);
  const payload = await requestJson(`${appUrl}/api/research`, { action: "ai", model, system, prompt, json: true, maxOutputTokens: outputTokens });
  captureUsage(payload);
  return payload.result;
}

function asBlob(image) {
  return new Blob([Buffer.from(image.base64, "base64")], { type: image.type || "image/jpeg" });
}

async function callVision(action, images, fields, inputTokens, outputTokens) {
  reserve(inputTokens, outputTokens);
  const form = new FormData();
  form.set("action", action);
  form.set("model", model);
  form.set("maxOutputTokens", String(outputTokens));
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  for (const image of images) form.append("files", asBlob(image), image.fileName);
  return requestForm(form);
}

function jsonResult(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  throw new Error("AI không trả JSON hợp lệ.");
}

function normalizedSegments(value) {
  const rows = Array.isArray(value?.segments) ? value.segments : Array.isArray(value?.highlights) ? value.highlights : [];
  const result = [];
  let duration = 0;
  for (const row of rows) {
    const rawStart = Number(row.start ?? row.startSeconds);
    const rawEnd = Number(row.end ?? row.endSeconds);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) continue;
    const previous = result.at(-1);
    const start = previous ? Math.max(rawStart, previous.end) : Math.max(0, rawStart);
    const end = Math.min(rawEnd, start + 75, start + (420 - duration));
    if (end - start < 2) continue;
    result.push({ start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), reason: String(row.reason ?? row.summary ?? "Highlight do AI chọn"), score: Number(row.score ?? row.confidence ?? 0) });
    duration += end - start;
    if (duration >= 420) break;
  }
  if (!result.length) throw new Error("AI không chọn được timecode highlight hợp lệ.");
  return { segments: result, totalDurationSeconds: Number(duration.toFixed(2)), maxDurationSeconds: 420 };
}

function scoreImageName(item, terms) {
  const name = item.fileName.toLocaleLowerCase("vi-VN");
  return terms.reduce((score, term) => score + (name.includes(term) ? 1 : 0), 0);
}

async function main() {
  await mkdir(outputFolder, { recursive: true });
  console.log("1/7 Lấy 24 frame đại diện từ video cục bộ…");
  const indexed = await requestJson(`${mediaUrl}/index-path`, { filePath: videoPath, heartbeatSeconds: 60, maxFrames: 24 }, 600_000);
  const frames = indexed.index.frames;
  const visualFrames = [0, 3, 6, 9, 12, 15, 18, 21].map((index) => frames[index]).filter(Boolean).map((frame) => ({ fileName: frame.name, type: "image/jpeg", base64: frame.base64, timestamp: frame.timestamp }));

  const transcriptCachePath = path.join(outputFolder, "video-transcript-final.json");
  let transcription;
  try {
    transcription = JSON.parse(await readFile(transcriptCachePath, "utf8"));
    console.log("2/7 Dùng transcript final đã lưu từ lần chạy trước…");
  } catch {
    console.log("2/7 Phiên âm video bằng API theo đường dẫn cục bộ…");
    transcription = await requestJson(`${mediaUrl}/transcribe-path?enhanceSpeech=true&language=auto&speakerDiarization=false&chunkMinutes=10`, { filePath: videoPath }, 900_000);
    await writeFile(transcriptCachePath, JSON.stringify(transcription, null, 2));
  }
  const transcript = transcription.transcript;
  const timeline = visualFrames.map((frame) => ({ start: frame.timestamp, end: frame.timestamp, timecode: new Date(frame.timestamp * 1000).toISOString().slice(14, 19) }));
  const transcriptSample = compactText(transcript.text, 8_000);

  console.log("3/7 Phân tích frame và lời nói bằng AI…");
  const scenePayload = await callVision("analyze-video-frames", visualFrames, {
    detail: "low", goal: "Tìm nội dung, diễn biến và khoảnh khắc phù hợp làm video highlight", instructions: "Chỉ nêu chi tiết có bằng chứng và ghi timecode. Ưu tiên thời điểm có diễn biến, nhân vật/chủ thể, phản ứng hoặc thay đổi đáng chú ý.", timeline: JSON.stringify(timeline), transcript: transcriptSample,
  }, 10_000, 4_500);
  const sceneAnalysis = jsonResult(scenePayload.result);

  console.log("4/7 Tổng hợp nội dung và chọn highlight có timecode…");
  const report = await callText("Bạn là biên tập viên video. Dùng đúng bằng chứng có timestamp, không bịa chi tiết. Trả JSON.", `Tổng hợp video từ phân tích frame và transcript.\n\nPHÂN TÍCH FRAME:\n${compactText(JSON.stringify(sceneAnalysis), 12_000)}\n\nTRANSCRIPT:\n${transcriptSample}\n\nTrả về {"summary":"","keyEvents":[],"highlights":[{"start":0,"end":0,"reason":"","score":0}],"thumbnailKeywords":[]}.`, 7_000, 3_500);
  const highlightRaw = await callText("Bạn là dựng phim. Chỉ chọn timecode có bằng chứng trong báo cáo và trả JSON.", `Hãy chọn các đoạn theo thứ tự thời gian để dựng video highlight tối đa 420 giây, mỗi đoạn tối đa 75 giây. Không chọn đoạn mơ hồ.\n\nBÁO CÁO:\n${compactText(JSON.stringify(report), 12_000)}\n\nTrả về {"segments":[{"start":0,"end":0,"reason":"","score":0}],"editorialSummary":""}.`, 4_500, 2_000);
  const highlightPlan = normalizedSegments(highlightRaw);
  await writeFile(path.join(outputFolder, "video-highlight-final-plan.json"), JSON.stringify({ indexed: { duration: indexed.index.duration, width: indexed.index.width, height: indexed.index.height }, report, highlightPlan, transcript: { duration: transcript.duration, chunkCount: transcript.chunks?.length ?? 0 } }, null, 2));

  console.log("5/7 Dựng video highlight final bằng FFmpeg cục bộ…");
  const renderedVideo = await requestJson(`${mediaUrl}/render-video`, { operation: "highlight", videoPaths: [videoPath], segments: highlightPlan.segments, maxDurationSeconds: 420, outputName: "video-highlight-final", outputFolder }, 900_000);

  console.log("6/7 Lọc và chọn ảnh thumbnail bằng AI…");
  const library = await requestJson(`${mediaUrl}/list-images`, { folderPath: imageFolder, includeSubfolders: true, maxImages: 120 });
  const terms = `${JSON.stringify(report)} ${JSON.stringify(sceneAnalysis)}`.toLocaleLowerCase("vi-VN").split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 4).slice(0, 200);
  const shortlist = [...library.images].sort((left, right) => scoreImageName(right, terms) - scoreImageName(left, terms) || left.fileName.localeCompare(right.fileName, "vi")).slice(0, 4);
  const imageBytes = await requestJson(`${mediaUrl}/read-images`, { imagePaths: shortlist.map((item) => item.filePath) });
  const thumbPayload = await callVision("analyze-images", imageBytes.images, {
    detail: "low", goal: "Chọn ảnh thumbnail và đề xuất chữ", system: "Bạn là biên tập viên thumbnail YouTube. Chỉ được chọn fileName có trong danh sách và trả JSON hợp lệ.", prompt: `Nội dung video:\n${compactText(JSON.stringify(report), 10_000)}\n\nẢnh ứng viên:\n${shortlist.map((item, index) => `${index + 1}. ${item.fileName}`).join("\n")}\n\nChọn đúng một fileName, tiêu đề tiếng Việt ngắn, và bố cục chữ không che chủ thể. Trả về {"fileName":"","reason":"","title":"","position":"top-left|top-center|top-right|center-left|center|center-right|bottom-left|bottom-center|bottom-right","fontSize":72,"textColor":"#FFFFFF","boxColor":"#000000","boxOpacity":0.65}.`,
  }, 6_000, 2_000);
  const thumbnail = jsonResult(thumbPayload.result);
  const selected = shortlist.find((item) => item.fileName.toLocaleLowerCase("vi-VN") === String(thumbnail.fileName ?? "").trim().toLocaleLowerCase("vi-VN"));
  if (!selected) throw new Error("AI thumbnail không trả về fileName thuộc danh sách ảnh ứng viên.");

  console.log("7/7 Ghép chữ và lưu thumbnail final giữ nguyên độ phân giải…");
  const renderedThumbnail = await requestJson(`${mediaUrl}/render-thumbnail`, { imagePath: selected.filePath, outputFolder, outputName: "thumbnail-final", title: String(thumbnail.title ?? "").trim(), layout: thumbnail }, 180_000);
  const manifest = { createdAt: new Date().toISOString(), model, source: { videoPath, imageFolder }, outputs: { video: renderedVideo, thumbnail: renderedThumbnail, highlightPlan: "video-highlight-final-plan.json" }, selectedThumbnail: { ...thumbnail, sourcePath: selected.filePath }, tokenUsage: budget, transcript: { duration: transcript.duration, chunkCount: transcript.chunks?.length ?? 0 } };
  await writeFile(path.join(outputFolder, "video-production-final.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch(async (error) => {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  await mkdir(outputFolder, { recursive: true }).catch(() => undefined);
  await writeFile(path.join(outputFolder, "video-production-final-error.log"), `${new Date().toISOString()}\n${details}\n`).catch(() => undefined);
  console.error(details);
  process.exitCode = 1;
});
