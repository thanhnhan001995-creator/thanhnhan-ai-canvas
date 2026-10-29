import { mkdir, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { dirname, resolve } from "node:path";

const [sourceArgument, outputPath, modelLabel = "Tiếng Việt chất lượng cao (PhoWhisper small)"] = process.argv.slice(2);
const sourcePath = sourceArgument?.startsWith("base64:")
  ? Buffer.from(sourceArgument.slice("base64:".length), "base64").toString("utf8")
  : sourceArgument;

if (!sourcePath || !outputPath) {
  throw new Error("Usage: node capture-local-transcript.mjs <sourcePath> <outputPath> [modelLabel]");
}

const query = new URLSearchParams({
  transcriptMode: "Transcript cục bộ",
  localTranscriptModel: modelLabel,
  language: "vi",
  speakerDiarization: "false",
  chunkMinutes: "10",
  enhanceSpeech: "true",
});

const body = await new Promise((resolveBody, rejectBody) => {
  const payload = JSON.stringify({ filePath: sourcePath });
  const client = request({
    hostname: "127.0.0.1",
    port: 4317,
    path: `/transcribe-path?${query}`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    },
  }, (response) => {
    let responseBody = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { responseBody += chunk; });
    response.on("end", () => {
      if ((response.statusCode || 500) >= 400) {
        rejectBody(new Error(`Phiên âm thất bại (${response.statusCode}): ${responseBody}`));
        return;
      }
      resolveBody(responseBody);
    });
  });
  client.on("error", rejectBody);
  client.end(payload);
});

const destination = resolve(outputPath);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, body, "utf8");
console.log(`Đã lưu transcript: ${destination}`);
