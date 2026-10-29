import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appUrl = "http://localhost:3000";
const launcher = path.join(root, "support", "scripts", "dev-with-media.mjs");
const preload = path.join(root, "desktop", "preload.cjs");
const systemNode = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "node.exe");
const nodeExecutable = existsSync(systemNode) ? systemNode : process.execPath;
let mainWindow = null;
let localServer = null;
let serverWasStartedHere = false;
let isQuitting = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
// File lớn được xử lý theo đường dẫn bởi FFmpeg/dịch vụ local. Đọc chúng vào
// Buffer rồi gửi qua IPC sẽ chạm giới hạn Buffer 2 GiB và nhân bản RAM.
const INLINE_FILE_LIMIT_BYTES = 128 * 1024 * 1024;

const ACCEPTED_FILE_EXTENSIONS = {
  "image/*": ["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "avif", "tiff"],
  "video/*": ["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "mpeg", "mpg"],
  "audio/*": ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma"],
};

function extensionsForAccept(accept) {
  return [...new Set(String(accept || "").split(",").flatMap((token) => {
    const value = token.trim().toLowerCase();
    if (ACCEPTED_FILE_EXTENSIONS[value]) return ACCEPTED_FILE_EXTENSIONS[value];
    if (value.startsWith(".")) return [value.slice(1)];
    const match = value.match(/^\w+\/(\w+)$/);
    return match ? [match[1]] : [];
  }))];
}

function mimeTypeForPath(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (ACCEPTED_FILE_EXTENSIONS["image/*"].includes(extension)) return `image/${extension === "jpg" ? "jpeg" : extension}`;
  if (ACCEPTED_FILE_EXTENSIONS["video/*"].includes(extension)) return `video/${extension === "m4v" ? "mp4" : extension}`;
  if (ACCEPTED_FILE_EXTENSIONS["audio/*"].includes(extension)) return `audio/${extension === "m4a" ? "mp4" : extension}`;
  return "application/octet-stream";
}

function safeWorkflowName(value) {
  return String(value || "New workflow").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "New workflow";
}

function workflowNameFromPath(filePath) {
  return path.basename(filePath).replace(/\.contentflow\.json$/i, "").replace(/\.json$/i, "").trim() || "New workflow";
}

function workflowPathWithJsonExtension(filePath) {
  return path.extname(filePath).toLowerCase() === ".json" ? filePath : `${filePath}.json`;
}

function uniqueWorkflowPath(candidatePath, existingPath = null) {
  const candidate = path.resolve(candidatePath);
  const existing = existingPath ? path.resolve(existingPath) : null;
  if (existing && candidate.toLowerCase() === existing.toLowerCase()) return candidate;
  if (!existsSync(candidate)) return candidate;
  const directory = path.dirname(candidate);
  const extension = path.extname(candidate) || ".json";
  const stem = path.basename(candidate, extension);
  for (let index = 2; ; index += 1) {
    const numbered = path.join(directory, `${stem} (${index})${extension}`);
    if (!existsSync(numbered)) return numbered;
  }
}

app.setName("Content Flow");
app.setAppUserModelId("com.contentflow.desktop");

if (!hasSingleInstanceLock) app.quit();

async function isServerReady() {
  try {
    const response = await fetch(appUrl, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

function startLocalServer() {
  serverWasStartedHere = true;
  localServer = spawn(nodeExecutable, [launcher, "start"], {
    cwd: root,
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  });
}

async function ensureLocalServer() {
  if (await isServerReady()) return;
  startLocalServer();

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await isServerReady()) return;
    if (localServer?.exitCode != null) {
      throw new Error("Dịch vụ Content Flow đã dừng khi đang khởi động.");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error("Content Flow khởi động quá lâu. Hãy thử lại sau.");
}

function stopLocalServer() {
  if (!serverWasStartedHere || !localServer || localServer.exitCode != null) return;
  localServer.kill("SIGTERM");
  const child = localServer;
  setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 1500).unref();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Content Flow",
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#080d17",
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && (input.control || input.meta) && input.shift && !input.alt && input.key.toLowerCase() === "w") {
      event.preventDefault();
      mainWindow?.webContents.send("content-flow:close-canvas");
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow.loadURL(appUrl).then(() => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

ipcMain.handle("content-flow:pick-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, { properties: ["openDirectory"] });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle("content-flow:pick-files", async (_event, request = {}) => {
  const extensions = extensionsForAccept(request.accept);
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: "Chọn nguồn file",
    properties: request.multiple ? ["openFile", "multiSelections"] : ["openFile"],
    filters: extensions.length ? [{ name: "Tệp phù hợp", extensions }] : [{ name: "Tất cả tệp", extensions: ["*"] }],
  });
  return result.canceled ? { canceled: true } : { canceled: false, paths: result.filePaths };
});

ipcMain.handle("content-flow:read-files", async (_event, filePaths = []) => {
  try {
    const paths = Array.isArray(filePaths) ? filePaths.filter((filePath) => typeof filePath === "string") : [];
    const files = await Promise.all(paths.map(async (filePath) => {
      const info = await stat(filePath);
      const pathOnly = info.size > INLINE_FILE_LIMIT_BYTES;
      return {
        path: filePath,
        name: path.basename(filePath),
        type: mimeTypeForPath(filePath),
        size: info.size,
        pathOnly,
        data: pathOnly ? undefined : await readFile(filePath),
      };
    }));
    return { files };
  } catch (error) {
    return { error: error instanceof Error ? `Không thể đọc nguồn file: ${error.message}` : "Không thể đọc nguồn file." };
  }
});

ipcMain.handle("content-flow:open-workflow", async () => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: "Mở workflow",
    properties: ["openFile"],
    filters: [{ name: "Content Flow workflow", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  try {
    return { canceled: false, path: filePath, workflow: JSON.parse(await readFile(filePath, "utf8")) };
  } catch (error) {
    return { canceled: false, error: error instanceof Error ? `Không thể mở workflow: ${error.message}` : "Không thể mở workflow." };
  }
});

ipcMain.handle("content-flow:open-recent-workflow", async (_event, requestedPath) => {
  if (typeof requestedPath !== "string" || path.extname(requestedPath).toLowerCase() !== ".json") {
    return { canceled: false, error: "Đường dẫn workflow gần đây không hợp lệ." };
  }
  const filePath = path.resolve(requestedPath);
  try {
    return { canceled: false, path: filePath, workflow: JSON.parse(await readFile(filePath, "utf8")) };
  } catch (error) {
    return { canceled: false, error: error instanceof Error ? `Không thể mở workflow gần đây: ${error.message}` : "Không thể mở workflow gần đây." };
  }
});

ipcMain.handle("content-flow:save-workflow", async (_event, request = {}) => {
  const workflow = request.workflow;
  const defaultName = safeWorkflowName(request.defaultName);
  const currentPath = typeof request.currentPath === "string" && request.currentPath ? path.resolve(request.currentPath) : null;
  let targetPath = request.saveAs ? null : currentPath;

  try {
    if (!targetPath) {
      const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
        title: "Lưu workflow",
        defaultPath: `${defaultName}.json`,
        filters: [{ name: "Content Flow workflow", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      targetPath = result.filePath;
    } else if (workflowNameFromPath(targetPath) !== defaultName) {
      targetPath = path.join(path.dirname(targetPath), `${defaultName}.json`);
    }
    targetPath = uniqueWorkflowPath(workflowPathWithJsonExtension(targetPath), request.saveAs ? null : currentPath);
    const persistedName = workflowNameFromPath(targetPath);
    const persistedWorkflow = workflow && typeof workflow === "object" && !Array.isArray(workflow)
      ? { ...workflow, name: persistedName }
      : workflow;
    await writeFile(targetPath, JSON.stringify(persistedWorkflow, null, 2), "utf8");
    if (!request.saveAs && currentPath && currentPath.toLowerCase() !== targetPath.toLowerCase() && existsSync(currentPath)) {
      await unlink(currentPath);
    }
    return { canceled: false, path: targetPath, name: persistedName };
  } catch (error) {
    return { canceled: false, error: error instanceof Error ? `Không thể lưu workflow: ${error.message}` : "Không thể lưu workflow." };
  }
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  try {
    await ensureLocalServer();
    await createWindow();
  } catch (error) {
    const details = error instanceof Error ? error.message : "Không thể khởi động Content Flow.";
    await dialog.showMessageBox({ type: "error", title: "Content Flow", message: details });
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopLocalServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

process.on("SIGTERM", () => {
  if (!isQuitting) app.quit();
});
