import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const localWhisperCache = path.join(root, "data", "local-whisper-cache");
const transcribers = new Map();
const LOCAL_MODEL_LABELS = {
  "onnx-community/whisper-tiny": "Whisper tiny",
  "onnx-community/whisper-base": "Whisper base",
  "onnx-community/whisper-small": "Whisper small",
  "onnx-community/PhoWhisper-base-ONNX": "PhoWhisper base",
  "huuquyet/PhoWhisper-small": "PhoWhisper small",
};

async function isModelInstalled(modelId) {
  const folder = path.join(localWhisperCache, ...String(modelId).split("/"));
  try {
    await Promise.all([
      readFile(path.join(folder, "config.json")),
      readFile(path.join(folder, "preprocessor_config.json")),
      readFile(path.join(folder, "tokenizer.json")),
      readFile(path.join(folder, "onnx", "encoder_model.onnx")),
      readFile(path.join(folder, "onnx", "decoder_model_merged.onnx")),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function loadTranscriber(modelId) {
  let transcriber = transcribers.get(modelId);
  if (transcriber) return transcriber;
  if (!(await isModelInstalled(modelId))) {
    throw new Error(`Chưa có bộ xử lý ${LOCAL_MODEL_LABELS[modelId] ?? "Whisper đã chọn"}, vui lòng cài đặt và thử lại.`);
  }
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = localWhisperCache;
  env.allowRemoteModels = false;
  transcriber = await pipeline("automatic-speech-recognition", modelId);
  transcribers.set(modelId, transcriber);
  return transcriber;
}

async function transcribeAudioFile(filePath, options) {
  const wavefileModule = await import("wavefile");
  const transcriber = await loadTranscriber(String(options.modelId));
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
  // Whisper chỉ nhận tối đa khoảng 30 giây audio mỗi lần. Nếu bỏ chunking,
  // Transformers.js chỉ phiên âm phần đầu của một file WAV dài và timestamp
  // của phần còn lại trở nên sai. Giữ overlap 5 giây để không mất câu ở ranh giới.
  const request = {
    return_timestamps: true,
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
  };
  if (/PhoWhisper/i.test(String(options.modelId))) request.language = "vi";
  else if (options.language && options.language !== "auto") request.language = options.language;
  const result = await transcriber(samples, request);
  const segments = Array.isArray(result.chunks)
    ? result.chunks.map((chunk) => ({
      start: Number(chunk.timestamp?.[0] ?? 0),
      end: Number(chunk.timestamp?.[1] ?? 0),
      text: String(chunk.text ?? "").trim(),
    })).filter((segment) => segment.text)
    : [];
  return { text: String(result.text ?? "").trim(), segments, model: `local:${options.modelId}` };
}

process.on("message", async (message) => {
  if (!message || typeof message !== "object") return;
  if (message.action === "shutdown") return process.exit(0);
  if (message.action !== "transcribe") return;
  try {
    const transcript = await transcribeAudioFile(String(message.filePath ?? ""), {
      modelId: message.modelId,
      language: message.language,
    });
    process.send?.({ requestId: message.requestId, transcript });
  } catch (error) {
    process.send?.({ requestId: message.requestId, error: error instanceof Error ? error.message : "Whisper cục bộ gặp lỗi." });
  }
});
