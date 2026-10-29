import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const host = "127.0.0.1";
const port = Number(process.env.CONTENT_FLOW_MEDIA_PORT) || 4317;
const maxFileBytes = 4 * 1024 * 1024 * 1024;
const allowedLocalVideoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".wmv", ".mpeg", ".mpg"]);
const allowedLocalAudioExtensions = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"]);
const allowedLocalImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const allowedLocalSubtitleExtensions = new Set([".srt", ".vtt", ".ass"]);
const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://[::1]:3000",
]);
let busy = false;
const executionStorage = new AsyncLocalStorage();
let activeLocalExecution;
const localTranscribers = new Map();
const LOCAL_TRANSCRIPT_MODEL_IDS = {
  "Nhanh (Whisper tiny)": "onnx-community/whisper-tiny",
  "Cân bằng (Whisper base)": "onnx-community/whisper-base",
  "Chất lượng (Whisper small)": "onnx-community/whisper-small",
  "Tiếng Việt (PhoWhisper base)": "onnx-community/PhoWhisper-base-ONNX",
  "Tiếng Việt chất lượng cao (PhoWhisper small)": "huuquyet/PhoWhisper-small",
};
const LOCAL_TRANSCRIPT_PROCESSOR_LABELS = {
  "onnx-community/whisper-tiny": "Whisper tiny",
  "onnx-community/whisper-base": "Whisper base",
  "onnx-community/whisper-small": "Whisper small",
  "onnx-community/PhoWhisper-base-ONNX": "PhoWhisper base",
  "huuquyet/PhoWhisper-small": "PhoWhisper small",
};
const localWhisperCache = path.join(root, "data", "local-whisper-cache");
const localProcessorMetadataPath = path.join(root, "data", "local-processors.json");

async function readLocalProcessorMetadata() {
  try {
    const parsed = JSON.parse(await readFile(localProcessorMetadataPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function recordLocalProcessorChange(processorId, action) {
  const metadata = await readLocalProcessorMetadata();
  if (action === "remove") delete metadata[processorId];
  else metadata[processorId] = { updatedAt: new Date().toISOString(), source: "managed" };
  await mkdir(path.dirname(localProcessorMetadataPath), { recursive: true });
  await writeFile(localProcessorMetadataPath, JSON.stringify(metadata, null, 2), "utf8");
}

function localModelFolder(modelId) {
  if (!Object.values(LOCAL_TRANSCRIPT_MODEL_IDS).includes(modelId)) throw new Error("Model Whisper cục bộ không hợp lệ");
  return path.join(localWhisperCache, ...modelId.split("/"));
}

async function isLocalModelInstalled(modelId) {
  try {
    await Promise.all([
      stat(path.join(localModelFolder(modelId), "config.json")),
      stat(path.join(localModelFolder(modelId), "preprocessor_config.json")),
      stat(path.join(localModelFolder(modelId), "tokenizer.json")),
      stat(path.join(localModelFolder(modelId), "onnx", "encoder_model.onnx")),
      stat(path.join(localModelFolder(modelId), "onnx", "decoder_model_merged.onnx")),
    ]);
    return true;
  } catch {
    return false;
  }
}

function missingLocalTranscriptProcessorError(modelId) {
  const label = LOCAL_TRANSCRIPT_PROCESSOR_LABELS[modelId] ?? "Whisper đã chọn";
  return new Error(`Chưa có bộ xử lý ${label}, vui lòng cài đặt và thử lại.`);
}

async function loadLocalTranscriber(modelId, allowRemoteModels = false) {
  if (!allowRemoteModels && !(await isLocalModelInstalled(modelId))) {
    throw missingLocalTranscriptProcessorError(modelId);
  }
  let transcriber = localTranscribers.get(modelId);
  if (transcriber) return transcriber;
  const { pipeline: createPipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = localWhisperCache;
  const previousAllowRemoteModels = env.allowRemoteModels;
  env.allowRemoteModels = allowRemoteModels;
  try {
    transcriber = await createPipeline("automatic-speech-recognition", modelId);
    localTranscribers.set(modelId, transcriber);
    return transcriber;
  } finally {
    env.allowRemoteModels = previousAllowRemoteModels;
  }
}

async function transcribeLocalAudioFile(filePath, options) {
  await waitForLocalExecutionPermission();
  const wavefileModule = await import("wavefile");
  const modelId = LOCAL_TRANSCRIPT_MODEL_IDS[options.localTranscriptModel] || LOCAL_TRANSCRIPT_MODEL_IDS["Cân bằng (Whisper base)"];
  const transcriber = await loadLocalTranscriber(modelId);
  const WaveFile = wavefileModule.default.WaveFile;
  const wav = new WaveFile(await readFile(filePath));
  wav.toBitDepth("32f");
  wav.toSampleRate(16_000);
  const rawSamples = wav.getSamples();
  const channels = Array.isArray(rawSamples) ? rawSamples : [rawSamples];
  const samples = channels.length > 1
    ? Float32Array.from(channels[0], (_, index) => channels.reduce((sum, channel) => sum + Number(channel[index] ?? 0), 0) / channels.length)
    : Float32Array.from(channels[0] ?? []);
  if (!samples.length) throw new Error("Không đọc được mẫu audio cho Whisper cục bộ");
  const request = { return_timestamps: true, task: "transcribe" };
  // PhoWhisper chỉ phục vụ tiếng Việt. Ép mã ngôn ngữ đúng giúp model không
  // đoán nhầm ngôn ngữ khi audio có tiếng game/nhạc hoặc khoảng lặng dài.
  if (/PhoWhisper/i.test(modelId)) request.language = "vi";
  else if (options.language && options.language !== "auto") request.language = options.language;
  const result = await transcriber(samples, request);
  await waitForLocalExecutionPermission();
  const segments = Array.isArray(result.chunks)
    ? result.chunks.map((chunk) => ({
      start: Number(chunk.timestamp?.[0] ?? 0),
      end: Number(chunk.timestamp?.[1] ?? 0),
      text: String(chunk.text ?? "").trim(),
    })).filter((segment) => segment.text)
    : [];
  return { text: String(result.text ?? "").trim(), segments, model: `local:${modelId}` };
}

function registerExecutionChild(child, execution = executionStorage.getStore()) {
  if (!execution) return;
  execution.children.add(child);
  const forget = () => execution.children.delete(child);
  child.once("error", forget);
  child.once("close", forget);
  if (execution.paused) void setChildSuspended(child, true).catch(() => undefined);
}

function createLocalWhisperWorker(modelId) {
  const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "local-whisper-worker.mjs");
  const child = spawn(process.execPath, [workerPath], { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const pending = new Map();
  let sequence = 0;
  registerExecutionChild(child);
  const rejectPending = (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  child.on("error", (error) => rejectPending(new Error(`Không khởi động được Whisper cục bộ: ${error.message}`)));
  child.on("close", () => rejectPending(new LocalExecutionStoppedError()));
  child.on("message", (message) => {
    const requestId = Number(message?.requestId);
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    if (message?.error) request.reject(new Error(String(message.error)));
    else request.resolve(message?.transcript);
  });
  return {
    async transcribe(filePath, options) {
      await waitForLocalExecutionPermission();
      if (!child.connected || child.exitCode !== null) throw new LocalExecutionStoppedError();
      const requestId = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        child.send({ action: "transcribe", requestId, filePath, modelId, language: options.language }, (error) => {
          if (!error) return;
          pending.delete(requestId);
          reject(new Error(`Không gửi được việc phiên âm tới Whisper cục bộ: ${error.message}`));
        });
      });
    },
    close() {
      if (child.connected && child.exitCode === null) child.send({ action: "shutdown" }, () => undefined);
    },
  };
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  return {
    "access-control-allow-origin": origin && allowedOrigins.has(origin) ? origin : "http://localhost:3000",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-content-flow-run-id",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(payload));
}

function diagnosticErrorPayload(error, context = {}) {
  const exception = error instanceof Error ? error : new Error(String(error));
  return {
    error: exception.message || "Lỗi xử lý video cục bộ",
    diagnostic: {
      executor: "Dịch vụ phiên âm cục bộ",
      ...context,
      exception: {
        name: exception.name,
        message: exception.message,
        stack: exception.stack || "(không có stack)",
      },
    },
  };
}

class LocalExecutionStoppedError extends Error {
  constructor() {
    super("Tác vụ cục bộ đã bị dừng cưỡng bức từ workflow.");
    this.name = "LocalExecutionStoppedError";
  }
}

function workflowRunId(request) {
  const value = String(request.headers["x-content-flow-run-id"] ?? "").trim();
  return /^[a-z0-9-]{8,80}$/i.test(value) ? value : "";
}

function runProcessControl(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} lỗi ${code}`)));
  });
}

async function setChildSuspended(child, suspended) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const action = suspended ? "Suspend-Process" : "Resume-Process";
    await runProcessControl("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `${action} -Id ${child.pid} -ErrorAction Stop`]);
    return;
  }
  child.kill(suspended ? "SIGSTOP" : "SIGCONT");
}

async function terminateChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await runProcessControl("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"]);
    return;
  }
  child.kill("SIGKILL");
}

async function waitForLocalExecutionPermission(execution = executionStorage.getStore()) {
  if (!execution) return;
  if (execution.stopped) throw new LocalExecutionStoppedError();
  if (!execution.paused) return;
  await new Promise((resolve) => execution.resumeWaiters.push(resolve));
  if (execution.stopped) throw new LocalExecutionStoppedError();
}

function createLocalExecution(request) {
  return {
    runId: workflowRunId(request),
    paused: false,
    stopped: false,
    children: new Set(),
    resumeWaiters: [],
  };
}

async function runWithLocalExecution(request, action) {
  if (busy || activeLocalExecution) return action();
  const execution = createLocalExecution(request);
  activeLocalExecution = execution;
  try {
    return await executionStorage.run(execution, action);
  } finally {
    if (activeLocalExecution === execution) activeLocalExecution = undefined;
  }
}

async function controlLocalExecution(runId, action) {
  const execution = activeLocalExecution;
  if (!execution || !execution.runId || execution.runId !== runId) {
    return { active: false, message: "Không có tác vụ cục bộ phù hợp đang chạy." };
  }
  if (action === "pause") {
    execution.paused = true;
    await Promise.all([...execution.children].map((child) => setChildSuspended(child, true).catch(() => undefined)));
    return { active: true, paused: true, message: "Đã tạm dừng tiến trình cục bộ đang chạy." };
  }
  if (action === "resume") {
    execution.paused = false;
    await Promise.all([...execution.children].map((child) => setChildSuspended(child, false).catch(() => undefined)));
    execution.resumeWaiters.splice(0).forEach((resume) => resume());
    return { active: true, paused: false, message: "Đã tiếp tục tiến trình cục bộ." };
  }
  if (action === "stop") {
    execution.stopped = true;
    execution.paused = false;
    execution.resumeWaiters.splice(0).forEach((resume) => resume());
    await Promise.all([...execution.children].map((child) => terminateChild(child).catch(() => undefined)));
    return { active: true, stopped: true, message: "Đã gửi lệnh dừng cưỡng bức đến tiến trình cục bộ." };
  }
  throw new Error("Lệnh điều khiển workflow cục bộ không hợp lệ.");
}

async function handleWorkflowControl(request, response, headers) {
  try {
    const data = await jsonBody(request);
    const runId = String(data.runId ?? "").trim();
    const action = String(data.action ?? "").trim();
    if (!/^[a-z0-9-]{8,80}$/i.test(runId)) throw new Error("Mã phiên chạy cục bộ không hợp lệ.");
    return sendJson(response, 200, await controlLocalExecution(runId, action), headers);
  } catch (error) {
    return sendJson(response, 400, { error: error instanceof Error ? error.message : "Không thể điều khiển tác vụ cục bộ." }, headers);
  }
}

function runLocalCommand(command, args) {
  const execution = executionStorage.getStore();
  return (async () => {
    await waitForLocalExecutionPermission(execution);
    return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    if (execution) {
      execution.children.add(child);
      if (execution.paused) void setChildSuspended(child, true).catch(() => undefined);
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      execution?.children.delete(child);
      reject(new Error(`Không chạy được ${command}: ${error.message}`));
    });
    child.on("close", (code) => {
      execution?.children.delete(child);
      if (execution?.stopped) return reject(new LocalExecutionStoppedError());
      return code === 0 ? resolve(stdout) : reject(new Error(`${command} lỗi ${code}: ${stderr.slice(-2_000)}`));
    });
    });
  })();
}

async function saveRequestBody(request, destination) {
  const declaredSize = Number(request.headers["content-length"] ?? 0);
  if (declaredSize > maxFileBytes) throw new Error("Video vượt quá giới hạn xử lý cục bộ 4 GB");
  let received = 0;
  request.on("data", (chunk) => {
    received += chunk.length;
    if (received > maxFileBytes) request.destroy(new Error("Video vượt quá giới hạn xử lý cục bộ 4 GB"));
  });
  await pipeline(request, createWriteStream(destination, { flags: "wx" }));
}

async function transcribeAudioFile(filePath, fileName, options = {}) {
  if (options.transcriptMode === "Transcript cục bộ") return transcribeLocalAudioFile(filePath, options);
  const apiKey = String(options.apiKey || "").trim();
  if (!apiKey) throw new Error("Phiên âm video cần API key từ node Thiết lập AI hoặc cổng APIKey.");
  const bytes = await readFile(filePath);
  if (bytes.length > 25 * 1024 * 1024) throw new Error(`${fileName} vượt quá giới hạn phiên âm 25 MB`);
  const model = options.diarize
    ? "gpt-4o-transcribe-diarize"
    : "gpt-transcribe";
  const form = new FormData();
  form.set("file", new File([bytes], fileName, { type: "audio/mpeg" }), fileName);
  form.set("model", model);
  if (options.language && options.language !== "auto") form.set("language", options.language);
  if (options.knownTerms) form.set("prompt", `Tên riêng và thuật ngữ cần nhận diện chính xác: ${options.knownTerms}`);
  if (options.diarize) {
    form.set("response_format", "diarized_json");
    form.set("chunking_strategy", "auto");
  } else if (model === "whisper-1") {
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
  } else {
    form.set("response_format", "json");
  }
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message;
    throw new Error(typeof message === "string" ? message : `Phiên âm lỗi ${response.status}`);
  }
  return { ...payload, model };
}

async function transcribeVideo(inputPath, fileName, options = {}, workspace) {
  const localTranscript = options.transcriptMode === "Transcript cục bộ";
  const localTranscriptModel = LOCAL_TRANSCRIPT_MODEL_IDS[options.localTranscriptModel] || LOCAL_TRANSCRIPT_MODEL_IDS["Cân bằng (Whisper base)"];
  if (localTranscript && !(await isLocalModelInstalled(localTranscriptModel))) throw missingLocalTranscriptProcessorError(localTranscriptModel);
  const probeText = await runLocalCommand("ffprobe", [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", inputPath,
  ]);
  const probe = JSON.parse(probeText);
  const duration = Number(probe.format?.duration ?? 0);
  if (!Array.isArray(probe.streams) || !probe.streams.some((stream) => stream.codec_type === "audio")) {
    throw new Error("Video không có audio để phiên âm");
  }
  const chunkSeconds = Math.max(120, Math.min(1_200, Math.round(options.chunkMinutes * 60)));
  const outputPattern = path.join(workspace, `audio-%03d.${localTranscript ? "wav" : "mp3"}`);
  const filters = options.enhanceSpeech
    ? "highpass=f=100,lowpass=f=8500,afftdn=nf=-25,acompressor=threshold=-18dB:ratio=3:attack=20:release=250,loudnorm=I=-16:LRA=7:TP=-1.5"
    : "loudnorm=I=-16:LRA=9:TP=-1.5";
  await runLocalCommand("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", inputPath, "-map", "0:a:0?", "-vn", "-ac", "1", "-ar", "16000",
    "-af", filters, "-c:a", localTranscript ? "pcm_s16le" : "libmp3lame", ...(localTranscript ? [] : ["-b:a", "48k"]), "-f", "segment", "-segment_time", String(chunkSeconds),
    "-reset_timestamps", "1", outputPattern,
  ]);
  const chunkNames = (await readdir(workspace)).filter((name) => new RegExp(`^audio-\\d+\\.${localTranscript ? "wav" : "mp3"}$`).test(name)).sort();
  if (!chunkNames.length) throw new Error("Video không có audio hoặc FFmpeg không thể tách lời nói");
  const chunks = [];
  const segments = [];
  const localWorker = localTranscript ? createLocalWhisperWorker(localTranscriptModel) : undefined;
  try {
  for (let index = 0; index < chunkNames.length; index += 1) {
    await waitForLocalExecutionPermission();
    const chunkPath = path.join(workspace, chunkNames[index]);
    const transcription = localWorker
      ? await localWorker.transcribe(chunkPath, options)
      : await transcribeAudioFile(chunkPath, chunkNames[index], options);
    const offset = index * chunkSeconds;
    const chunkEnd = Math.min(duration || offset + chunkSeconds, offset + chunkSeconds);
    const localSegments = Array.isArray(transcription.segments) ? transcription.segments : [];
    if (localSegments.length) {
      segments.push(...localSegments.map((segment) => ({
        ...segment,
        start: Math.min(chunkEnd, Math.max(offset, Number(segment.start ?? 0) + offset)),
        end: Math.min(chunkEnd, Math.max(offset, Number(segment.end ?? 0) + offset)),
      })));
    } else {
      segments.push({
        start: offset,
        end: chunkEnd,
        text: String(transcription.text ?? ""),
        speaker: null,
        approximateTiming: true,
      });
    }
    chunks.push({
      index: index + 1,
      start: offset,
      end: chunkEnd,
      text: String(transcription.text ?? ""),
      model: transcription.model,
    });
  }
  } finally {
    localWorker?.close();
  }
  return {
    fileName,
    duration,
    video: { streams: probe.streams ?? [] },
    text: chunks.map((chunk) => chunk.text).join(" ").trim(),
    segments,
    chunks,
    enhancedSpeech: options.enhanceSpeech,
    diarized: options.diarize,
    sourceType: "timed-video-transcription",
  };
}

async function handleTranscription(request, response, url, headers) {
  if (busy) return sendJson(response, 429, { error: "Dịch vụ video đang xử lý một file khác. Hãy thử lại sau." }, headers);
  busy = true;
  const workspace = await mkdtemp(path.join(tmpdir(), "content-flow-video-"));
  const requestedName = path.basename(url.searchParams.get("fileName") || "video.mp4");
  const extension = path.extname(requestedName).replace(/[^.a-z0-9]/gi, "") || ".mp4";
  const inputPath = path.join(workspace, `input${extension}`);
  try {
    await saveRequestBody(request, inputPath);
    const transcript = await transcribeVideo(inputPath, requestedName, {
      enhanceSpeech: url.searchParams.get("enhanceSpeech") !== "false",
      language: url.searchParams.get("language") || "auto",
      knownTerms: url.searchParams.get("knownTerms") || "",
      diarize: url.searchParams.get("speakerDiarization") !== "false",
      chunkMinutes: Math.max(2, Math.min(20, Number(url.searchParams.get("chunkMinutes")) || 10)),
      apiKey: url.searchParams.get("apiKey") || "",
      transcriptMode: url.searchParams.get("transcriptMode") || "Transcript bằng API",
      localTranscriptModel: url.searchParams.get("localTranscriptModel") || "Cân bằng (Whisper base)",
    }, workspace);
    sendJson(response, 200, { transcript }, headers);
  } catch (error) {
    sendJson(response, 500, diagnosticErrorPayload(error, {
      route: url.pathname,
      transcriptMode: url.searchParams.get("transcriptMode") || "Transcript bằng API",
      requestOptionNames: [...url.searchParams.keys()].sort(),
    }), headers);
  } finally {
    busy = false;
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function handlePathTranscription(request, response, url, headers) {
  if (busy) return sendJson(response, 429, { error: "Dịch vụ video đang xử lý một file khác. Hãy thử lại sau." }, headers);
  busy = true;
  const workspace = await mkdtemp(path.join(tmpdir(), "content-flow-video-"));
  let localPathProvided = false;
  try {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const parsed = JSON.parse(body || "{}");
    const filePath = String(parsed.filePath || "");
    localPathProvided = Boolean(filePath);
    const extension = path.extname(filePath).toLowerCase();
    if (!path.isAbsolute(filePath) || (!allowedLocalVideoExtensions.has(extension) && !allowedLocalAudioExtensions.has(extension))) throw new Error("Đường dẫn audio hoặc video cục bộ không hợp lệ");
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) throw new Error("Đường dẫn không phải file audio hoặc video");
    const transcript = await transcribeVideo(filePath, path.basename(filePath), {
      enhanceSpeech: url.searchParams.get("enhanceSpeech") !== "false",
      language: url.searchParams.get("language") || "auto",
      knownTerms: url.searchParams.get("knownTerms") || "",
      diarize: url.searchParams.get("speakerDiarization") !== "false",
      chunkMinutes: Math.max(2, Math.min(20, Number(url.searchParams.get("chunkMinutes")) || 10)),
      apiKey: String(parsed.apiKey || ""),
      transcriptMode: url.searchParams.get("transcriptMode") || "Transcript bằng API",
      localTranscriptModel: url.searchParams.get("localTranscriptModel") || "Cân bằng (Whisper base)",
    }, workspace);
    sendJson(response, 200, { transcript, localPath: filePath, processedBytes: fileInfo.size }, headers);
  } catch (error) {
    sendJson(response, 500, diagnosticErrorPayload(error, {
      route: url.pathname,
      transcriptMode: url.searchParams.get("transcriptMode") || "Transcript bằng API",
      requestOptionNames: [...url.searchParams.keys()].sort(),
      localPathProvided,
    }), headers);
  } finally {
    busy = false;
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function handlePathIndex(request, response, headers) {
  if (busy) return sendJson(response, 429, { error: "Dịch vụ video đang xử lý một file khác. Hãy thử lại sau." }, headers);
  busy = true;
  const workspace = await mkdtemp(path.join(tmpdir(), "content-flow-frames-"));
  try {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const parsed = JSON.parse(body || "{}");
    const filePath = String(parsed.filePath || "");
    if (!path.isAbsolute(filePath) || !allowedLocalVideoExtensions.has(path.extname(filePath).toLowerCase())) throw new Error("Đường dẫn video cục bộ không hợp lệ");
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) throw new Error("Đường dẫn không phải file video");
    const probe = JSON.parse(await runLocalCommand("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", filePath]));
    const duration = Number(probe.format?.duration ?? 0);
    const video = (probe.streams ?? []).find((stream) => stream.codec_type === "video");
    if (!Number.isFinite(duration) || duration <= 0 || !video) throw new Error("Không đọc được metadata video");
    const heartbeat = Math.max(5, Number(parsed.heartbeatSeconds) || 15);
    const maxFrames = Math.max(1, Math.min(120, Number(parsed.maxFrames) || 24));
    const count = Math.min(maxFrames, Math.max(1, Math.ceil(duration / heartbeat)));
    const timestamps = Array.from({ length: count }, (_, index) => Number((Math.min(duration - 0.05, index * duration / count)).toFixed(3)));
    const frames = [];
    for (let index = 0; index < timestamps.length; index += 1) {
      const framePath = path.join(workspace, `frame-${String(index + 1).padStart(4, "0")}.jpg`);
      await runLocalCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(timestamps[index]), "-i", filePath, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", "-q:v", "5", "-y", framePath]);
      frames.push({ timestamp: timestamps[index], name: path.basename(framePath), base64: (await readFile(framePath)).toString("base64") });
    }
    sendJson(response, 200, { index: { fileName: path.basename(filePath), duration, width: Number(video.width ?? 0), height: Number(video.height ?? 0), frames }, processedBytes: fileInfo.size }, headers);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Lỗi trích frame video theo đường dẫn cục bộ" }, headers);
  } finally {
    busy = false;
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function cropFilter(region) {
  if (!region || typeof region !== "object") return "";
  const x = boundedNumber(region.x, 0, 0, 0.95);
  const y = boundedNumber(region.y, 0, 0, 0.95);
  const width = boundedNumber(region.width, 1, 0.05, 1 - x);
  const height = boundedNumber(region.height, 1, 0.05, 1 - y);
  return `crop=trunc(iw*${width}/2)*2:trunc(ih*${height}/2)*2:trunc(iw*${x}/2)*2:trunc(ih*${y}/2)*2,`;
}

async function handlePathFrameExtraction(request, response, headers) {
  if (busy) return sendJson(response, 429, { error: "Dịch vụ video đang xử lý một file khác. Hãy thử lại sau." }, headers);
  busy = true;
  const workspace = await mkdtemp(path.join(tmpdir(), "content-flow-detail-frames-"));
  try {
    const data = await jsonBody(request);
    const filePath = await verifiedPath(data.filePath, allowedLocalVideoExtensions, "Video");
    const probe = JSON.parse(await runLocalCommand("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", filePath]));
    const duration = Number(probe.format?.duration ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Không đọc được thời lượng video");
    const timestamps = [...new Set((Array.isArray(data.timestamps) ? data.timestamps : [])
      .map((value) => boundedNumber(value, -1, 0, Math.max(0, duration - 0.05)))
      .filter((value) => value >= 0))].sort((left, right) => left - right).slice(0, 24);
    if (!timestamps.length) throw new Error("Cần ít nhất một timecode để trích frame chi tiết");
    const longSide = boundedNumber(data.longSide, 960, 480, 1280);
    const attentionRegions = (Array.isArray(data.attentionRegions) ? data.attentionRegions : (data.attentionRegion ? [data.attentionRegion] : []))
      .filter((region) => region && typeof region === "object")
      .slice(0, 3);
    const frames = [];
    for (let index = 0; index < timestamps.length; index += 1) {
      const variants = [
        { kind: "frame", filter: `scale='min(${longSide},iw)':-2` },
        ...attentionRegions.map((region, regionIndex) => ({ kind: `attention-${regionIndex + 1}`, filter: `${cropFilter(region)}scale='min(${longSide},iw)':-2` })),
      ];
      for (const variant of variants) {
        const framePath = path.join(workspace, `${variant.kind}-${String(index + 1).padStart(3, "0")}.jpg`);
        await runLocalCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(timestamps[index]), "-i", filePath, "-frames:v", "1", "-vf", variant.filter, "-q:v", "5", "-y", framePath]);
        frames.push({ timestamp: timestamps[index], kind: variant.kind, name: path.basename(framePath), base64: (await readFile(framePath)).toString("base64") });
      }
    }
    return sendJson(response, 200, { duration, frames }, headers);
  } catch (error) {
    return sendJson(response, 500, { error: error instanceof Error ? error.message : "Không thể trích frame chi tiết" }, headers);
  } finally {
    busy = false;
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

function mediaContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if ([".mp4", ".m4v"].includes(extension)) return "video/mp4";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".m4a") return "audio/mp4";
  if (extension === ".aac") return "audio/aac";
  if (extension === ".flac") return "audio/flac";
  if ([".ogg", ".opus"].includes(extension)) return "audio/ogg";
  return "application/octet-stream";
}

async function handleLocalMediaPreview(request, response, url, headers) {
  try {
    const filePath = await verifiedPath(url.searchParams.get("filePath"), new Set([...allowedLocalVideoExtensions, ...allowedLocalImageExtensions, ...allowedLocalAudioExtensions]), "Ảnh, video hoặc âm thanh");
    const info = await stat(filePath);
    const range = String(request.headers.range ?? "");
    const contentType = mediaContentType(filePath);
    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      const start = Math.max(0, Number(match?.[1] || 0));
      const end = Math.min(info.size - 1, Number(match?.[2] || info.size - 1));
      if (start > end || start >= info.size) return sendJson(response, 416, { error: "Range không hợp lệ" }, { ...headers, "content-range": `bytes */${info.size}` });
      response.writeHead(206, { ...headers, "content-type": contentType, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${info.size}`, "content-length": end - start + 1 });
      createReadStream(filePath, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, { ...headers, "content-type": contentType, "accept-ranges": "bytes", "content-length": info.size });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : "Không thể mở preview media" }, headers);
  }
}

async function verifiedPath(rawPath, extensions, label) {
  const filePath = String(rawPath || "");
  if (!path.isAbsolute(filePath) || !extensions.has(path.extname(filePath).toLowerCase())) throw new Error(`${label} không hợp lệ`);
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error(`${label} không phải file`);
  return filePath;
}

async function jsonBody(request) {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return JSON.parse(body || "{}");
}

function imageMimeType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : extension === ".bmp" ? "image/bmp" : "image/jpeg";
}

async function collectImageFiles(folderPath, includeSubfolders, maximum, found = []) {
  if (found.length >= maximum) return found;
  const entries = await readdir(folderPath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "vi"))) {
    if (found.length >= maximum) break;
    const itemPath = path.join(folderPath, entry.name);
    if (entry.isDirectory() && includeSubfolders) await collectImageFiles(itemPath, true, maximum, found);
    else if (entry.isFile() && allowedLocalImageExtensions.has(path.extname(entry.name).toLowerCase())) {
      const info = await stat(itemPath);
      found.push({ filePath: itemPath, fileName: entry.name, bytes: info.size, type: imageMimeType(entry.name) });
    }
  }
  return found;
}

async function handleImageLibrary(request, response, headers) {
  try {
    const data = await jsonBody(request);
    const folderPath = path.resolve(String(data.folderPath || ""));
    const info = await stat(folderPath);
    if (!info.isDirectory()) throw new Error("Đường dẫn kho ảnh không phải thư mục");
    const maxImages = Math.max(1, Math.min(500, Number(data.maxImages) || 120));
    const images = await collectImageFiles(folderPath, Boolean(data.includeSubfolders), maxImages);
    return sendJson(response, 200, { images }, headers);
  } catch (error) {
    return sendJson(response, 500, { error: error instanceof Error ? error.message : "Không thể quét kho ảnh cục bộ" }, headers);
  }
}

async function handleReadImages(request, response, headers) {
  try {
    const data = await jsonBody(request);
    const paths = Array.isArray(data.imagePaths) ? data.imagePaths.slice(0, 12) : [];
    if (!paths.length) throw new Error("Chưa có ảnh cục bộ để gửi AI");
    let totalBytes = 0;
    const images = [];
    for (const rawPath of paths) {
      const imagePath = await verifiedPath(rawPath, allowedLocalImageExtensions, "Ảnh");
      const info = await stat(imagePath);
      if (info.size > 12 * 1024 * 1024) throw new Error(`${path.basename(imagePath)} lớn hơn 12 MB, không gửi AI trực tiếp`);
      totalBytes += info.size;
      if (totalBytes > 40 * 1024 * 1024) throw new Error("Nhóm ảnh gửi AI vượt quá 40 MB");
      images.push({ filePath: imagePath, fileName: path.basename(imagePath), type: imageMimeType(imagePath), base64: (await readFile(imagePath)).toString("base64") });
    }
    return sendJson(response, 200, { images }, headers);
  } catch (error) {
    return sendJson(response, 500, { error: error instanceof Error ? error.message : "Không thể đọc ảnh cục bộ" }, headers);
  }
}

function normalizedAttentionRegions(rawRegions) {
  return (Array.isArray(rawRegions) ? rawRegions : [])
    .filter((region) => region && typeof region === "object")
    .slice(0, 3)
    .map((region) => {
      const x = boundedNumber(region.x, 0, 0, 0.95);
      const y = boundedNumber(region.y, 0, 0, 0.95);
      return {
        x,
        y,
        width: boundedNumber(region.width, 0.05, 0.05, 1 - x),
        height: boundedNumber(region.height, 0.05, 0.05, 1 - y),
      };
    });
}

function attentionOutlineFilter(regions) {
  return regions.flatMap((region) => {
    const x = Number(region.x.toFixed(6));
    const y = Number(region.y.toFixed(6));
    const width = Number(region.width.toFixed(6));
    const height = Number(region.height.toFixed(6));
    // Hai khung lồng nhau, không chồng cùng một đường: đen 5px ở ngoài,
    // trắng 2px ở trong. Cả nền đen lẫn nền trắng đều giữ được tương phản.
    const outer = `drawbox=x=trunc(iw*${x}):y=trunc(ih*${y}):w=trunc(iw*${width}):h=trunc(ih*${height}):color=black@1:t=5`;
    const inner = `drawbox=x=trunc(iw*${x})+5:y=trunc(ih*${y})+5:w=trunc(iw*${width})-10:h=trunc(ih*${height})-10:color=white@1:t=2`;
    return [outer, inner];
  });
}

async function handleImageInputOptimization(request, response, headers) {
  if (busy) return sendJson(response, 429, { error: "Dịch vụ media đang xử lý một file khác. Hãy thử lại sau." }, headers);
  busy = true;
  try {
    const data = await jsonBody(request);
    const imagePaths = Array.isArray(data.imagePaths) ? data.imagePaths.slice(0, 12) : [];
    if (!imagePaths.length) throw new Error("Tối ưu input ảnh cần ít nhất một ảnh cục bộ.");
    const requestedShortSide = Number(data.targetShortSide ?? data.targetHeight);
    const targetShortSide = requestedShortSide === 720 ? 720 : requestedShortSide === 480 ? 480 : 0;
    const regions = normalizedAttentionRegions(data.regions);
    if (!targetShortSide && !regions.length) throw new Error("Cần chọn cạnh ngắn 720/480 hoặc có ít nhất một vùng chú ý để xử lý ảnh.");
    // Ảnh trung gian chỉ phục vụ node tiếp theo nên luôn vào cache runtime; node
    // Quản lý dữ liệu (Lưu file) mới là nơi người dùng chọn tên và thư mục đích.
    const outputFolder = path.join(root, "Content Flow Runtime");
    await mkdir(outputFolder, { recursive: true });
    const outputBase = "input-optimized";
    const files = [];
    for (let index = 0; index < imagePaths.length; index += 1) {
      const imagePath = await verifiedPath(imagePaths[index], allowedLocalImageExtensions, "Ảnh");
      const sourceName = path.basename(imagePath, path.extname(imagePath)).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 64) || `image-${index + 1}`;
      const outputPath = path.join(outputFolder, `${outputBase}-${String(index + 1).padStart(2, "0")}-${sourceName}-${targetShortSide ? `${targetShortSide}-short-side` : "marked"}.jpg`);
      const filter = [
        // 720/480 ở node ảnh là cạnh ngắn tối đa: cùng mức giữ chi tiết tương
        // đương cho ảnh ngang (1280×720) lẫn ảnh dọc (720×1280). Ảnh nhỏ hơn
        // không bị phóng to: scale giữ nguyên iw/ih khi cạnh ngắn đã đủ nhỏ.
        targetShortSide ? `scale=w='if(lte(min(iw,ih),${targetShortSide}),iw,if(gte(iw,ih),-2,${targetShortSide}))':h='if(lte(min(iw,ih),${targetShortSide}),ih,if(gte(iw,ih),${targetShortSide},-2))'` : "",
        ...attentionOutlineFilter(regions),
      ].filter(Boolean).join(",");
      await runLocalCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", imagePath, "-vf", filter, "-frames:v", "1", "-q:v", "2", "-y", outputPath]);
      const info = await stat(outputPath);
      files.push({ filePath: outputPath, fileName: path.basename(outputPath), type: "image/jpeg", bytes: info.size, targetShortSide, regions });
    }
    sendJson(response, 200, { files, targetShortSide, regionCount: regions.length }, headers);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Không thể tối ưu input ảnh" }, headers);
  } finally {
    busy = false;
  }
}

function safeOutputName(rawName, fallback, extension = ".mp4") {
  const name = String(rawName || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim();
  return (name || fallback).replace(/\.[^.]+$/, "") + extension;
}

function storageSizeLabel(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 ** 3) return `${Math.max(1, Math.round(value / 1024 ** 3))}gb`;
  if (value >= 1024 ** 2) return `${Math.max(1, Math.round(value / 1024 ** 2))}mb`;
  if (value >= 1024) return `${Math.max(1, Math.round(value / 1024))}kb`;
  return `${Math.round(value)}b`;
}

function storageDateTokens(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return {
    "#today#": `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    "#now#": `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    "#hour#": pad(now.getHours()),
  };
}

function storageFileName(template, sourcePath, destinationFolder, stt, bytes, fallback = {}) {
  const configuredExtension = String(fallback.extension || "").trim();
  const extension = path.extname(sourcePath) || (/^\.[a-z0-9]+$/i.test(configuredExtension) ? configuredExtension : "");
  const originalName = path.basename(sourcePath, extension) || String(fallback.name || "undefine");
  const tokens = {
    "#file-name#": originalName,
    "#stt#": String(Math.max(1, Math.round(Number(stt) || 1))),
    "#folder-name#": path.basename(destinationFolder) || "root",
    "#file-type#": extension.replace(/^\./, "").toLowerCase(),
    "#file-size#": storageSizeLabel(bytes),
    ...storageDateTokens(),
  };
  // Chỉ các token được liệt kê ở đây mới được thay thế. Chuỗi gần giống, ví dụ
  // #file name#, được giữ nguyên đúng như người dùng đã nhập.
  const expanded = String(template || "#file-name#").replace(/#file-name#|#stt#|#folder-name#|#file-type#|#file-size#|#today#|#now#|#hour#/g, (token) => tokens[token]);
  const safeBase = expanded.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim().replace(/[. ]+$/g, "") || originalName || "undefine";
  return extension && !safeBase.toLowerCase().endsWith(extension.toLowerCase()) ? `${safeBase}${extension}` : safeBase;
}

function storageFolderName(template, sourcePath, parentFolder, stt, bytes, fallback = {}) {
  const fileName = storageFileName(template, sourcePath, parentFolder, stt, bytes, fallback);
  const extension = path.extname(fileName);
  const templateName = (extension ? fileName.slice(0, -extension.length) : fileName) || "undefine";
  // Folder lô luôn cho biết nó đến từ cổng nào; mẫu tên vẫn được giữ nguyên
  // phía sau để người dùng phân biệt những lần lưu khác nhau của cùng cổng.
  const portName = String(fallback.sourcePortName || "data")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim()
    .replace(/[. ]+$/g, "") || "data";
  return `${portName} - ${templateName}`;
}

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createUniqueStorageFolder(parentFolder, name) {
  let destinationFolder = path.join(parentFolder, name);
  let suffix = 1;
  while (await pathExists(destinationFolder)) {
    destinationFolder = path.join(parentFolder, `${name}-${suffix}`);
    suffix += 1;
  }
  await mkdir(destinationFolder, { recursive: true });
  return destinationFolder;
}

async function handleStoreFiles(request, response, headers) {
  try {
    const data = await jsonBody(request);
    const rawFolder = String(data.outputFolder || "").trim();
    if (!rawFolder) throw new Error("Cần chọn thư mục lưu.");
    const outputFolder = path.resolve(rawFolder);
    await mkdir(outputFolder, { recursive: true });
    const overwrite = data.duplicateMode === "overwrite";
    const requested = Array.isArray(data.files) ? data.files.slice(0, 500) : [];
    if (!requested.length) throw new Error("Chưa có file cần lưu.");
    const prepared = [];
    for (let index = 0; index < requested.length; index += 1) {
      const item = requested[index] && typeof requested[index] === "object" ? requested[index] : {};
      const sourcePath = String(item.filePath || "");
      const inlineContent = typeof item.inlineContent === "string" ? item.inlineContent : undefined;
      const inlineBase64 = typeof item.inlineBase64 === "string" ? item.inlineBase64 : undefined;
      if (!sourcePath && inlineContent === undefined && inlineBase64 === undefined) throw new Error("Cần file cục bộ hoặc dữ liệu để lưu.");
      if (sourcePath && !path.isAbsolute(sourcePath)) throw new Error("Đường dẫn file nguồn không hợp lệ.");
      const sourceInfo = sourcePath ? await stat(sourcePath) : undefined;
      if (sourceInfo && !sourceInfo.isFile()) throw new Error("Đường dẫn nguồn không phải file.");
      const binaryContent = inlineBase64 === undefined ? undefined : Buffer.from(inlineBase64, "base64");
      const bytes = sourceInfo ? sourceInfo.size : binaryContent !== undefined ? binaryContent.length : Buffer.byteLength(inlineContent, "utf8");
      if (bytes > maxFileBytes) throw new Error(`${sourcePath ? path.basename(sourcePath) : "Dữ liệu"} vượt quá giới hạn lưu cục bộ 4 GB.`);
      prepared.push({ item, sourcePath, inlineContent, binaryContent, bytes, index });
    }

    // Nhiều file (ví dụ danh sách frame JPG) được giữ chung trong một thư mục
    // con để không làm lẫn vào file đơn đã lưu trong thư mục người dùng chọn.
    // Thư mục này luôn tránh trùng tên, kể cả khi người dùng chọn Ghi đè file.
    let destinationFolder = outputFolder;
    if (prepared.length > 1) {
      const first = prepared[0];
      const folderName = storageFolderName(first.item.namingPattern, first.sourcePath, outputFolder, first.item.stt ?? 1, first.bytes, {
        name: String(first.item.sourceName || "undefine"),
        extension: String(first.item.sourceExtension || ".json"),
        sourcePortName: String(first.item.sourcePortName || "data"),
      });
      destinationFolder = await createUniqueStorageFolder(outputFolder, folderName);
    }

    const files = [];
    for (const { item, sourcePath, inlineContent, binaryContent, bytes, index } of prepared) {
      const preferredName = storageFileName(item.namingPattern, sourcePath, outputFolder, item.stt ?? index + 1, bytes, {
        name: String(item.sourceName || "undefine"),
        extension: String(item.sourceExtension || ".json"),
      });
      let destinationPath = path.join(destinationFolder, preferredName);
      if (!overwrite && await fileExists(destinationPath)) {
        const extension = path.extname(preferredName);
        const stem = preferredName.slice(0, preferredName.length - extension.length);
        let suffix = Math.max(1, Math.round(Number(item.stt) || index + 1));
        do {
          destinationPath = path.join(destinationFolder, `${stem}-${suffix}${extension}`);
          suffix += 1;
        } while (await fileExists(destinationPath));
      }
      if (sourcePath) await copyFile(sourcePath, destinationPath);
      else if (binaryContent !== undefined) await writeFile(destinationPath, binaryContent);
      else await writeFile(destinationPath, inlineContent, "utf8");
      const savedInfo = await stat(destinationPath);
      files.push({ filePath: destinationPath, fileName: path.basename(destinationPath), bytes: savedInfo.size, sourcePath: sourcePath || undefined, folderPath: destinationFolder });
    }
    sendJson(response, 200, { files }, headers);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Không thể lưu file" }, headers);
  }
}

function frameRate(value) {
  const [numerator, denominator] = String(value || "0/1").split("/").map(Number);
  return denominator ? Number((numerator / denominator).toFixed(3)) : 0;
}

async function videoMetadata(filePath) {
  const probe = JSON.parse(await runLocalCommand("ffprobe", [
    "-v", "error", "-show_entries", "format=duration,size,bit_rate,format_name:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,bit_rate,sample_rate,channels,pix_fmt", "-of", "json", filePath,
  ]));
  const video = (probe.streams ?? []).find((stream) => stream.codec_type === "video") ?? {};
  const audio = (probe.streams ?? []).find((stream) => stream.codec_type === "audio") ?? {};
  return {
    fileName: path.basename(filePath), duration: Number(probe.format?.duration ?? 0), size: Number(probe.format?.size ?? 0),
    bitRate: Number(probe.format?.bit_rate ?? video.bit_rate ?? 0), format: String(probe.format?.format_name ?? ""),
    video: { codec: String(video.codec_name ?? ""), width: Number(video.width ?? 0), height: Number(video.height ?? 0), fps: frameRate(video.avg_frame_rate || video.r_frame_rate), pixelFormat: String(video.pix_fmt ?? ""), bitRate: Number(video.bit_rate ?? 0) },
    audio: audio.codec_name ? { codec: String(audio.codec_name), sampleRate: Number(audio.sample_rate ?? 0), channels: Number(audio.channels ?? 0), bitRate: Number(audio.bit_rate ?? 0) } : null,
  };
}

function srtTime(value) {
  const milliseconds = Math.max(0, Math.round(Number(value || 0) * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds % 1000).padStart(3, "0")}`;
}

function subtitleStyle(data) {
  const style = String(data.style || "Nổi bật · trắng viền đen");
  const fontSize = Math.max(16, Math.min(72, Math.round(Number(data.fontSize) || 30)));
  const alignment = String(data.position || "Dưới") === "Trên" ? 8 : String(data.position || "Dưới") === "Giữa" ? 5 : 2;
  const primary = style.startsWith("Gaming") ? "&H0000D7FF" : "&H00FFFFFF";
  const outline = style.startsWith("Tối giản") ? 1 : 3;
  return `FontName=Arial,FontSize=${fontSize},PrimaryColour=${primary},OutlineColour=&H00101010,BackColour=&H80000000,BorderStyle=1,Outline=${outline},Shadow=1,Alignment=${alignment},MarginV=48`;
}

function escapedSubtitlePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function handleWriteSubtitles(request, response, headers) {
  try {
    const data = await jsonBody(request);
    const rawCues = Array.isArray(data.cues) ? data.cues.slice(0, 5_000) : [];
    const cues = rawCues.map((cue) => ({ start: Math.max(0, Number(cue?.start ?? 0)), end: Math.max(0, Number(cue?.end ?? 0)), text: String(cue?.text ?? "").replace(/\r/g, "").trim() }))
      .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.text);
    if (!cues.length) throw new Error("Cần ít nhất một subtitle có start, end và text hợp lệ");
    const outputFolder = path.resolve(String(data.outputFolder || path.join(root, "Content Flow Output")));
    await mkdir(outputFolder, { recursive: true });
    const outputPath = path.join(outputFolder, safeOutputName(data.outputName, "subtitle-final", ".srt"));
    const content = cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join("\n");
    await writeFile(outputPath, content, "utf8");
    const info = await stat(outputPath);
    sendJson(response, 200, { filePath: outputPath, fileName: path.basename(outputPath), bytes: info.size, cueCount: cues.length }, headers);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Không thể tạo subtitle" }, headers);
  }
}

async function handleVideoProbe(request, response, headers) {
  try {
    const data = await jsonBody(request);
    const filePath = await verifiedPath(data.filePath, allowedLocalVideoExtensions, "Video");
    sendJson(response, 200, await videoMetadata(filePath), headers);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Không thể đọc metadata video" }, headers);
  }
}

function thumbnailText(rawText) {
  return String(rawText || "").replace(/[\\:']/g, (character) => `\\${character}`).replace(/%/g, "\\%").replace(/[\r\n]+/g, " ").slice(0, 180);
}

function thumbnailPosition(position, fontSize) {
  const value = String(position || "bottom-left");
  const horizontal = value.endsWith("right") ? "w-text_w-60" : value.endsWith("center") || value === "center" ? "(w-text_w)/2" : "60";
  const center = value.startsWith("center") || value === "center";
  const bottom = value.startsWith("bottom");
  return {
    horizontal,
    textY: bottom ? `h-${fontSize + 60}` : center ? `h/2-${Math.round(fontSize / 2)}` : "60",
    // drawbox dùng `h` cho chính chiều cao box; phải dùng `ih` cho chiều cao ảnh.
    boxY: bottom ? `ih-${fontSize + 95}` : center ? `ih/2-${Math.round((fontSize + 70) / 2)}` : "35",
  };
}

async function handleThumbnailRender(request, response, headers) {
  if (busy) return sendJson(response, 429, { error: "Dịch vụ media đang xử lý một file khác. Hãy thử lại sau." }, headers);
  busy = true;
  try {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const data = JSON.parse(body || "{}");
    const imagePath = await verifiedPath(data.imagePath, allowedLocalImageExtensions, "Ảnh nguồn");
    const layout = data.layout && typeof data.layout === "object" ? data.layout : {};
    const title = thumbnailText(data.title || layout.title);
    if (!title) throw new Error("Thumbnail cần tiêu đề để ghép lên ảnh");
    const outputFolder = path.resolve(String(data.outputFolder || path.join(path.dirname(imagePath), "Content Flow Output")));
    await mkdir(outputFolder, { recursive: true });
    const outputPath = path.join(outputFolder, safeOutputName(data.outputName, "thumbnail-youtube", ".jpg"));
    const fontSize = Math.max(32, Math.min(140, Math.round(Number(layout.fontSize) || 72)));
    const opacity = Math.max(0, Math.min(1, Number(layout.boxOpacity ?? 0.65)));
    const color = /^#[0-9a-f]{6}$/i.test(String(layout.textColor ?? "")) ? String(layout.textColor) : "#FFFFFF";
    const box = /^#[0-9a-f]{6}$/i.test(String(layout.boxColor ?? "")) ? String(layout.boxColor) : "#000000";
    const point = thumbnailPosition(layout.position, fontSize);
    const fontFile = "C\\:/Windows/Fonts/arialbd.ttf";
    const filter = [
      // Không resize/crop: thumbnail phải giữ nguyên kích thước pixel của ảnh đã chọn.
      // Dùng biểu thức theo w/h để hộp chữ vẫn nằm gọn trên ảnh dọc, ngang hoặc vuông.
      `drawbox=x=35:y=${point.boxY}:w=iw-70:h=${fontSize + 70}:color=${box}@${opacity}:t=fill`,
      `drawtext=fontfile='${fontFile}':text='${title}':fontcolor=${color}:fontsize=${fontSize}:x=${point.horizontal}:y=${point.textY}:shadowcolor=black@0.8:shadowx=3:shadowy=3`,
    ].join(",");
    await runLocalCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", imagePath, "-vf", filter, "-frames:v", "1", "-q:v", "2", "-y", outputPath]);
    const info = await stat(outputPath);
    sendJson(response, 200, { filePath: outputPath, fileName: path.basename(outputPath), bytes: info.size }, headers);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Lỗi ghép thumbnail cục bộ" }, headers);
  } finally {
    busy = false;
  }
}

async function handleVideoRender(request, response, headers) {
  if (busy) return sendJson(response, 429, { error: "Dịch vụ video đang xử lý một file khác. Hãy thử lại sau." }, headers);
  busy = true;
  const workspace = await mkdtemp(path.join(tmpdir(), "content-flow-render-"));
  try {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const data = JSON.parse(body || "{}");
    const operation = String(data.operation || "");
    const videoPaths = await Promise.all((Array.isArray(data.videoPaths) ? data.videoPaths : []).map((item) => verifiedPath(item, allowedLocalVideoExtensions, "Video")));
    if (!videoPaths.length) throw new Error("Chưa có video đầu vào theo đường dẫn cục bộ");
    const outputFolder = path.resolve(String(data.outputFolder || path.join(path.dirname(videoPaths[0]), "Content Flow Output")));
    await mkdir(outputFolder, { recursive: true });
    const audioFormat = String(data.audioFormat || "mp3").toLowerCase() === "wav" ? "wav" : "mp3";
    const outputExtension = operation === "extract-audio" ? `.${audioFormat}` : ".mp4";
    const outputPath = path.join(outputFolder, safeOutputName(data.outputName, `content-flow-${operation || "video"}`, outputExtension));
    if (operation === "normalize") {
      const maxWidth = Math.max(0, Math.min(3840, Math.round(Number(data.maxWidth) || 0)));
      const maxHeight = Math.max(0, Math.min(2160, Math.round(Number(data.maxHeight) || 0)));
      const fps = Math.max(12, Math.min(120, Math.round(Number(data.fps) || 30)));
      const filters = [];
      if (maxWidth && maxHeight) filters.push(`scale=w='min(${maxWidth},iw)':h='min(${maxHeight},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`);
      filters.push(`fps=${fps}`, "format=yuv420p");
      await runLocalCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", videoPaths[0], "-map", "0:v:0", "-map", "0:a?", "-vf", filters.join(","), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", outputPath]);
    } else if (operation === "trim") {
      const start = Math.max(0, Number(data.startSeconds) || 0);
      const end = Math.max(start + 0.1, Number(data.endSeconds) || 0);
      if (!end) throw new Error("Điểm kết thúc phải lớn hơn điểm bắt đầu");
      await runLocalCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(start), "-to", String(end), "-i", videoPaths[0], "-c", "copy", "-y", outputPath]);
    } else if (operation === "highlight") {
      const maxDuration = Math.max(30, Math.min(420, Number(data.maxDurationSeconds) || 420));
      const rawSegments = Array.isArray(data.segments) ? data.segments.slice(0, 60) : [];
      const segments = rawSegments.map((item) => ({ start: Math.max(0, Number(item?.start ?? 0)), end: Math.max(0, Number(item?.end ?? 0)) })).filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end - item.start >= 1);
      const requestedDuration = segments.reduce((total, item) => total + item.end - item.start, 0);
      if (!segments.length) throw new Error("Kế hoạch highlight không có đoạn timecode hợp lệ");
      if (requestedDuration > maxDuration + 0.01) throw new Error(`Kế hoạch highlight dài ${requestedDuration.toFixed(1)} giây, vượt giới hạn ${maxDuration} giây`);
      const segmentPaths = [];
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const segmentPath = path.join(workspace, `highlight-${String(index + 1).padStart(3, "0")}.mp4`);
        await runLocalCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(segment.start), "-to", String(segment.end), "-i", videoPaths[0], "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-c:a", "aac", "-movflags", "+faststart", "-y", segmentPath]);
        segmentPaths.push(segmentPath);
      }
      const listPath = path.join(workspace, "highlight-concat.txt");
      await writeFile(listPath, segmentPaths.map((item) => `file '${item.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
      await runLocalCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", "-y", outputPath]);
    } else if (operation === "concat") {
      const listPath = path.join(workspace, "concat.txt");
      await writeFile(listPath, videoPaths.map((item) => `file '${item.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
      await runLocalCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-y", outputPath]);
    } else if (operation === "mix-audio") {
      const audioPaths = await Promise.all((Array.isArray(data.audioPaths) ? data.audioPaths : []).map((item) => verifiedPath(item, allowedLocalAudioExtensions, "Nhạc nền")));
      if (!audioPaths.length) throw new Error("Chưa có nhạc nền theo đường dẫn cục bộ");
      const volume = Math.max(0, Math.min(1, Number(data.volumePercent ?? 30) / 100));
      const args = ["-hide_banner", "-loglevel", "error", "-i", videoPaths[0]];
      audioPaths.forEach((item) => args.push("-stream_loop", "-1", "-i", item));
      const musicInputs = audioPaths.map((_, index) => `[${index + 1}:a]volume=${volume}[m${index}]`);
      const musicMix = audioPaths.length === 1 ? "[m0]anull[music]" : `${audioPaths.map((_, index) => `[m${index}]`).join("")}amix=inputs=${audioPaths.length}:duration=longest[music]`;
      const audioFilter = `${musicInputs.join(";")};${musicMix};[0:a][music]amix=inputs=2:duration=first[aout]`;
      args.push("-filter_complex", audioFilter, "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-shortest", "-y", outputPath);
      await runLocalCommand("ffmpeg", args);
    } else if (operation === "extract-audio") {
      const bitrate = Math.max(64, Math.min(320, Math.round(Number(data.audioBitrate) || 128)));
      const args = ["-hide_banner", "-loglevel", "error", "-i", videoPaths[0], "-map", "0:a:0"];
      if (audioFormat === "wav") args.push("-c:a", "pcm_s16le");
      else args.push("-c:a", "libmp3lame", "-b:a", `${bitrate}k`);
      args.push("-y", outputPath);
      await runLocalCommand("ffmpeg", args);
    } else if (operation === "burn-subtitles") {
      const subtitlePath = await verifiedPath(data.subtitlePath, allowedLocalSubtitleExtensions, "Subtitle");
      const filter = `subtitles=filename='${escapedSubtitlePath(subtitlePath)}':force_style='${subtitleStyle(data)}'`;
      await runLocalCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", videoPaths[0], "-vf", filter, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", "-y", outputPath]);
    } else if (operation === "save") {
      await copyFile(videoPaths[0], outputPath);
    } else {
      throw new Error("Thao tác render video không hợp lệ");
    }
    const outputInfo = await stat(outputPath);
    sendJson(response, 200, { filePath: outputPath, fileName: path.basename(outputPath), bytes: outputInfo.size, operation }, headers);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Lỗi dựng video cục bộ" }, headers);
  } finally {
    busy = false;
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

const LOCAL_PROCESSOR_MODELS = {
  "whisper-tiny": { label: "Whisper tiny", modelId: LOCAL_TRANSCRIPT_MODEL_IDS["Nhanh (Whisper tiny)"], description: "Nhanh nhất, phù hợp thử nhanh hoặc audio ngắn." },
  "whisper-base": { label: "Whisper base", modelId: LOCAL_TRANSCRIPT_MODEL_IDS["Cân bằng (Whisper base)"], description: "Cân bằng tốc độ và chất lượng cho transcript tiếng Việt." },
  "whisper-small": { label: "Whisper small", modelId: LOCAL_TRANSCRIPT_MODEL_IDS["Chất lượng (Whisper small)"], description: "Chất lượng cao hơn, cần nhiều dung lượng và thời gian hơn." },
  "phowhisper-base": { label: "PhoWhisper base", modelId: LOCAL_TRANSCRIPT_MODEL_IDS["Tiếng Việt (PhoWhisper base)"], description: "Chuyên tiếng Việt và nhiều vùng giọng; lựa chọn khuyến nghị để thay Whisper base." },
  "phowhisper-small": { label: "PhoWhisper small", modelId: LOCAL_TRANSCRIPT_MODEL_IDS["Tiếng Việt chất lượng cao (PhoWhisper small)"], description: "Chuyên tiếng Việt, chính xác hơn nhưng nặng và chậm hơn PhoWhisper base." },
};

async function folderBytes(folderPath) {
  try {
    const entries = await readdir(folderPath, { withFileTypes: true });
    return (await Promise.all(entries.map(async (entry) => entry.isDirectory()
      ? folderBytes(path.join(folderPath, entry.name))
      : entry.isFile() ? Number((await stat(path.join(folderPath, entry.name))).size) : 0))).reduce((total, bytes) => total + bytes, 0);
  } catch {
    return 0;
  }
}

async function latestLocalModelModifiedAt(modelId) {
  try {
    const folder = localModelFolder(modelId);
    const files = [
      path.join(folder, "onnx", "encoder_model.onnx"),
      path.join(folder, "onnx", "decoder_model_merged.onnx"),
      path.join(folder, "tokenizer.json"),
    ];
    const timestamps = await Promise.all(files.map(async (filePath) => Number((await stat(filePath)).mtimeMs) || 0));
    const latest = Math.max(...timestamps);
    return latest ? new Date(latest).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

async function commandVersion(command) {
  try {
    const text = String(await runLocalCommand(command, ["-version"]));
    return { installed: true, version: text.split(/\r?\n/).find(Boolean) ?? command };
  } catch (error) {
    return { installed: false, error: error instanceof Error ? error.message : `Không tìm thấy ${command}` };
  }
}

async function localProcessorStatus() {
  const metadata = await readLocalProcessorMetadata();
  const ffmpeg = await commandVersion("ffmpeg");
  const ffprobe = await commandVersion("ffprobe");
  const whisperModels = await Promise.all(Object.entries(LOCAL_PROCESSOR_MODELS).map(async ([id, model]) => {
    const installed = await isLocalModelInstalled(model.modelId);
    return {
      id,
      label: model.label,
      description: model.description,
      installed,
      bytes: installed ? await folderBytes(localModelFolder(model.modelId)) : 0,
      updatedAt: installed ? metadata[id]?.updatedAt ?? await latestLocalModelModifiedAt(model.modelId) : undefined,
      updatedAtEstimated: installed && !metadata[id]?.updatedAt,
    };
  }));
  return {
    processors: [
      { id: "ffmpeg", label: "FFmpeg + FFprobe", description: "Trích frame, tách audio, render và xử lý media cục bộ.", installed: ffmpeg.installed && ffprobe.installed, version: ffmpeg.version, error: ffmpeg.error || ffprobe.error, bytes: 0, updatedAt: metadata.ffmpeg?.updatedAt, updatedAtEstimated: false },
      ...whisperModels,
    ],
  };
}

async function manageLocalProcessor(processorId, action) {
  if (!['install', 'update', 'remove'].includes(action)) throw new Error("Thao tác xử lý cục bộ không hợp lệ");
  if (processorId === "ffmpeg") {
    const wingetAction = action === "install" ? "install" : action === "update" ? "upgrade" : "uninstall";
    await runLocalCommand("winget", [wingetAction, "--id", "Gyan.FFmpeg", "--exact", "--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity"]);
    await recordLocalProcessorChange(processorId, action);
    return;
  }
  const model = LOCAL_PROCESSOR_MODELS[processorId];
  if (!model) throw new Error("Bộ xử lý cục bộ không hợp lệ");
  const folder = localModelFolder(model.modelId);
  localTranscribers.delete(model.modelId);
  if (action === "remove") {
    await rm(folder, { recursive: true, force: true });
    await recordLocalProcessorChange(processorId, action);
    return;
  }
  if (action === "update") await rm(folder, { recursive: true, force: true });
  await mkdir(localWhisperCache, { recursive: true });
  await loadLocalTranscriber(model.modelId, true);
  await recordLocalProcessorChange(processorId, action);
}

async function handleLocalProcessors(request, response, headers) {
  if (request.method === "GET") {
    try {
      return sendJson(response, 200, await localProcessorStatus(), headers);
    } catch (error) {
      return sendJson(response, 500, { error: error instanceof Error ? error.message : "Không đọc được trạng thái xử lý cục bộ" }, headers);
    }
  }
  if (busy) return sendJson(response, 429, { error: "Dịch vụ media đang bận; hãy đợi tác vụ hiện tại hoàn tất." }, headers);
  busy = true;
  try {
    const data = await jsonBody(request);
    await manageLocalProcessor(String(data.processorId ?? ""), String(data.action ?? ""));
    return sendJson(response, 200, await localProcessorStatus(), headers);
  } catch (error) {
    return sendJson(response, 500, { error: error instanceof Error ? error.message : "Không thể điều chỉnh xử lý cục bộ" }, headers);
  } finally {
    busy = false;
  }
}

const server = createServer(async (request, response) => {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    return response.end();
  }
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, { ok: true, busy, service: "Content Flow local media" }, headers);
  }
  if ((request.method === "GET" || request.method === "POST") && url.pathname === "/local-processors") {
    return handleLocalProcessors(request, response, headers);
  }
  if (request.method === "POST" && url.pathname === "/workflow-control") {
    return handleWorkflowControl(request, response, headers);
  }
  if (request.method === "POST" && url.pathname === "/transcribe") {
    return runWithLocalExecution(request, () => handleTranscription(request, response, url, headers));
  }
  if (request.method === "POST" && url.pathname === "/transcribe-path") {
    return runWithLocalExecution(request, () => handlePathTranscription(request, response, url, headers));
  }
  if (request.method === "POST" && url.pathname === "/index-path") {
    return runWithLocalExecution(request, () => handlePathIndex(request, response, headers));
  }
  if (request.method === "POST" && url.pathname === "/extract-frames-path") {
    return runWithLocalExecution(request, () => handlePathFrameExtraction(request, response, headers));
  }
  if (request.method === "POST" && url.pathname === "/write-subtitles") {
    return runWithLocalExecution(request, () => handleWriteSubtitles(request, response, headers));
  }
  if (request.method === "POST" && url.pathname === "/probe-video") {
    return runWithLocalExecution(request, () => handleVideoProbe(request, response, headers));
  }
  if (request.method === "GET" && url.pathname === "/preview-media") {
    return handleLocalMediaPreview(request, response, url, headers);
  }
  if (request.method === "POST" && url.pathname === "/list-images") {
    return runWithLocalExecution(request, () => handleImageLibrary(request, response, headers));
  }
  if (request.method === "POST" && url.pathname === "/read-images") {
    return runWithLocalExecution(request, () => handleReadImages(request, response, headers));
  }
  if (request.method === "POST" && url.pathname === "/optimize-image-inputs") {
    return runWithLocalExecution(request, () => handleImageInputOptimization(request, response, headers));
  }
  if (request.method === "POST" && url.pathname === "/store-files") {
    return runWithLocalExecution(request, () => handleStoreFiles(request, response, headers));
  }
  if (request.method === "POST" && url.pathname === "/render-video") {
    return runWithLocalExecution(request, () => handleVideoRender(request, response, headers));
  }
  if (request.method === "POST" && url.pathname === "/render-thumbnail") {
    return runWithLocalExecution(request, () => handleThumbnailRender(request, response, headers));
  }
  return sendJson(response, 404, { error: "Endpoint không tồn tại" }, headers);
});

server.listen(port, host, () => {
  console.log(`Dịch vụ video cục bộ đang chạy tại http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
