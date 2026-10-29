import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mediaScript = path.join(root, "support", "media", "video-transcription-service.mjs");
const vinextCli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
const runMode = process.argv[2] === "dev" ? "dev" : "start";
const children = new Set();
let stopping = false;

function start(script, args = []) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.add(child);
  child.on("exit", (code) => {
    children.delete(child);
    if (!stopping) stop(code || 1);
  });
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 250).unref();
}

async function mediaIsReady() {
  try {
    const response = await fetch("http://127.0.0.1:4317/health");
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForMedia() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await mediaIsReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error("Dịch vụ video cục bộ không khởi động được");
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));

try {
  if (!await mediaIsReady()) {
    start(mediaScript);
    await waitForMedia();
  }
  start(vinextCli, [runMode]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop(1);
}
